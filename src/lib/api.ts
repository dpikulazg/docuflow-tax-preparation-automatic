import { Document, Tenant, UserProfile, RecognizedData } from '../types';

export interface AppUser {
  id: string;
  email: string;
  displayName?: string;
}

export interface SessionResponse {
  user: AppUser;
  profile: UserProfile;
  tenant: Tenant;
}

export class AuthenticationError extends Error {
  constructor() {
    super('Prijavite se za nastavak.');
    this.name = 'AuthenticationError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    // Access redirects must be followed by a browser navigation, not an API fetch.
    redirect: 'manual',
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  });

  if (response.type === 'opaqueredirect' || response.status === 401 || response.status === 403 ||
      (response.status >= 300 && response.status < 400)) {
    throw new AuthenticationError();
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  login: () => window.location.assign('/api/login'),
  getSession: () => request<SessionResponse>('/api/session'),
  getDocuments: () => request<Document[]>('/api/documents'),
  getClients: () => request<Tenant[]>('/api/clients'),
  createDocument: (file: File, recognizedData: RecognizedData, tenantId: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('tenantId', tenantId);
    formData.append('recognizedData', JSON.stringify(recognizedData));
    return request<Document>('/api/documents', { method: 'POST', body: formData });
  },
  updateDocument: (id: string, changes: Record<string, unknown>) =>
    request<Document>(`/api/documents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),
  submitFeedback: (id: string, feedback: Record<string, unknown>) =>
    request(`/api/documents/${id}/feedback`, {
      method: 'POST',
      body: JSON.stringify(feedback),
    }),
  // Access owns the HttpOnly session cookie; only its logout endpoint can end it.
  logout: () => window.location.replace('/cdn-cgi/access/logout'),
};
