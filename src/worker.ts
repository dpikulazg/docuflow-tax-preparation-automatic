import type { AuditEntry } from './types';

interface Env {
  DB: any;
  FILES: { put: (key: string, value: Blob, options?: unknown) => Promise<void>; get: (key: string) => Promise<any> };
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

interface Identity {
  id: string;
  email: string;
  name: string;
}

const json = (value: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(value), {
    ...init,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...init.headers },
  });

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
};

function identity(request: Request): Identity | null {
  const email = request.headers.get('Cf-Access-Authenticated-User-Email');
  if (!email) return null;
  return {
    id: request.headers.get('Cf-Access-User-Id') || email,
    email,
    name: request.headers.get('Cf-Access-User-Name') || email.split('@')[0],
  };
}

async function requireIdentity(request: Request): Promise<Identity> {
  const user = identity(request);
  if (!user) throw new Response('Cloudflare Access authentication required', { status: 401 });
  return user;
}

async function profileFor(env: Env, user: Identity) {
  let profile = await env.DB.prepare('SELECT * FROM users WHERE id = ? OR email = ?').bind(user.id, user.email).first();
  if (!profile) {
    const tenantId = `tenant_${user.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    await env.DB.batch([
      env.DB.prepare('INSERT INTO tenants (id, name, oib, type, created_at) VALUES (?, ?, ?, ?, ?)').bind(tenantId, 'My Firm d.o.o.', '12345678901', 'firm', now()),
      env.DB.prepare('INSERT INTO users (id, email, name, role, tenant_id) VALUES (?, ?, ?, ?, ?)').bind(user.id, user.email, user.name, 'firm_user', tenantId),
    ]);
    profile = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
  }
  const tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(profile.tenant_id).first();
  return { profile, tenant };
}

function mapTenant(row: any) {
  return { id: row.id, name: row.name, oib: row.oib, type: row.type, createdAt: row.created_at, accountantTenantId: row.accountant_tenant_id, accountantId: row.accountant_id, emailIngestionEnabled: Boolean(row.email_ingestion_enabled), ingestionEmail: row.ingestion_email, erpFormat: row.erp_format };
}

function mapDocument(row: any) {
  return { id: row.id, fileName: row.file_name, fileUrl: row.file_url, status: row.status, type: row.type, tenantId: row.tenant_id, uploadedBy: row.uploaded_by, createdAt: row.created_at, recognizedData: parseJson(row.recognized_data, {}), paymentStatus: row.payment_status, auditLog: parseJson(row.audit_log, []) };
}

async function canAccessTenant(env: Env, profile: any, tenantId: string) {
  if (profile.role === 'admin' || profile.tenant_id === tenantId) return true;
  if (profile.role !== 'accountant') return false;
  const managed = parseJson<string[]>(profile.managed_tenants, []);
  if (managed.includes(tenantId)) return true;
  const client = await env.DB.prepare('SELECT id FROM tenants WHERE id = ? AND accountant_tenant_id = ?').bind(tenantId, profile.tenant_id).first();
  return Boolean(client);
}

async function documentsFor(env: Env, profile: any) {
  let rows: any[];
  if (profile.role === 'admin') {
    rows = (await env.DB.prepare('SELECT * FROM documents ORDER BY created_at DESC').all()).results;
  } else if (profile.role === 'accountant') {
    const managed = parseJson<string[]>(profile.managed_tenants, []);
    const ids = [profile.tenant_id, ...managed];
    const placeholders = ids.map(() => '?').join(',');
    rows = ids.length ? (await env.DB.prepare(`SELECT * FROM documents WHERE tenant_id IN (${placeholders}) ORDER BY created_at DESC`).bind(...ids).all()).results : [];
  } else {
    rows = (await env.DB.prepare('SELECT * FROM documents WHERE tenant_id = ? ORDER BY created_at DESC').bind(profile.tenant_id).all()).results;
  }
  return rows.map(mapDocument);
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/?/, '').split('/');
  if (url.pathname === '/api/login' && request.method === 'GET') {
    // Access protects /api/* and performs sign-in before this route is reached.
    // Return to the SPA even when Access is missing, so it can display an error.
    return new Response(null, {
      status: 302,
      headers: {
        Location: identity(request) ? '/' : '/?authError=access_required',
        'Cache-Control': 'no-store',
      },
    });
  }
  const user = await requireIdentity(request);
  const { profile, tenant } = await profileFor(env, user);

  if (route[0] === 'session' && request.method === 'GET') {
    return json({ user: { id: user.id, email: user.email, displayName: user.name }, profile: { id: profile.id, email: profile.email, role: profile.role, tenantId: profile.tenant_id, name: profile.name, managedTenants: parseJson(profile.managed_tenants, []) }, tenant: mapTenant(tenant) });
  }
  if (route[0] === 'documents' && route.length === 1 && request.method === 'GET') return json(await documentsFor(env, profile));
  if (route[0] === 'clients' && request.method === 'GET') {
    const rows = profile.role === 'accountant' ? (await env.DB.prepare('SELECT * FROM tenants WHERE accountant_tenant_id = ?').bind(profile.tenant_id).all()).results : [];
    return json(rows.map(mapTenant));
  }
  if (route[0] === 'documents' && route.length === 1 && request.method === 'POST') {
    const form = await request.formData();
    const file = form.get('file');
    const tenantId = String(form.get('tenantId') || profile.tenant_id);
    if (!(file instanceof File) || tenantId !== profile.tenant_id && profile.role !== 'accountant' && profile.role !== 'admin') return json({ error: 'Invalid upload' }, { status: 400 });
    const documentId = id();
    const fileKey = `${tenantId}/${documentId}-${file.name}`;
    await env.FILES.put(fileKey, file, { httpMetadata: { contentType: file.type } });
    await env.DB.prepare('INSERT INTO documents (id, file_name, file_key, file_url, status, type, tenant_id, uploaded_by, created_at, recognized_data, payment_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(documentId, file.name, fileKey, `/api/documents/${documentId}/file`, 'processed', 'incoming_invoice', tenantId, user.id, now(), String(form.get('recognizedData') || '{}'), 'unpaid').run();
    const row = await env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(documentId).first();
    return json(mapDocument(row), { status: 201 });
  }
  if (route[0] === 'documents' && route.length === 3 && route[2] === 'file' && request.method === 'GET') {
    const row = await env.DB.prepare('SELECT file_key, tenant_id FROM documents WHERE id = ?').bind(route[1]).first();
    if (!row?.file_key || !(await canAccessTenant(env, profile, row.tenant_id))) return new Response('Not found', { status: 404 });
    const object = await env.FILES.get(row.file_key);
    return object ? new Response(object.body, { headers: { 'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream' } }) : new Response('Not found', { status: 404 });
  }
  if (route[0] === 'documents' && route.length === 2 && request.method === 'PATCH') {
    const body = await request.json() as { recognizedData?: unknown; status?: string; paymentStatus?: string; audit?: AuditEntry };
    const row = await env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(route[1]).first();
    if (!row || !(await canAccessTenant(env, profile, row.tenant_id))) return json({ error: 'Not found' }, { status: 404 });
    const changes: { recognizedData?: string; status?: string; paymentStatus?: string } = body.recognizedData ? { recognizedData: JSON.stringify(body.recognizedData) } : {};
    if (body.status) changes.status = body.status;
    if (body.paymentStatus) changes.paymentStatus = body.paymentStatus;
    const audit = body.audit ? [...parseJson(row.audit_log, []), { ...body.audit, timestamp: now() }] : parseJson(row.audit_log, []);
    await env.DB.prepare('UPDATE documents SET recognized_data = ?, status = ?, payment_status = ?, audit_log = ? WHERE id = ?').bind(changes.recognizedData || row.recognized_data, changes.status || row.status, changes.paymentStatus || row.payment_status, JSON.stringify(audit), route[1]).run();
    return json(mapDocument(await env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(route[1]).first()));
  }
  if (route[0] === 'documents' && route.length === 3 && route[2] === 'feedback' && request.method === 'POST') {
    const document = await env.DB.prepare('SELECT tenant_id FROM documents WHERE id = ?').bind(route[1]).first();
    if (!document || !(await canAccessTenant(env, profile, document.tenant_id))) return json({ error: 'Not found' }, { status: 404 });
    const body = await request.json() as { incorrectFields?: string[]; corrections?: Record<string, string>; comment?: string };
    await env.DB.prepare('INSERT INTO ocr_feedback (id, document_id, incorrect_fields, corrections, comment, submitted_by, submitted_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id(), route[1], JSON.stringify(body.incorrectFields || []), JSON.stringify(body.corrections || {}), body.comment || null, user.id, user.name, now()).run();
    return json({ ok: true }, { status: 201 });
  }
  return json({ error: 'Not found' }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (new URL(request.url).pathname.startsWith('/api/')) return await handleApi(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof Response) return error;
      console.error(error);
      return json({ error: 'Internal server error' }, { status: 500 });
    }
  },
};

  5
