CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  oib TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('firm', 'accountant')),
  created_at TEXT NOT NULL,
  accountant_tenant_id TEXT,
  accountant_id TEXT,
  email_ingestion_enabled INTEGER DEFAULT 0,
  ingestion_email TEXT,
  erp_format TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'firm_user',
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  managed_tenants TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_key TEXT,
  file_url TEXT,
  status TEXT NOT NULL,
  type TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  recognized_data TEXT NOT NULL DEFAULT '{}',
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  audit_log TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS ocr_feedback (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  incorrect_fields TEXT NOT NULL,
  corrections TEXT NOT NULL,
  comment TEXT,
  submitted_by TEXT NOT NULL,
  submitted_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_tenant_created ON documents(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tenants_accountant ON tenants(accountant_tenant_id);
