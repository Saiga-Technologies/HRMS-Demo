/** Thin fetch wrapper. Sessions are cookie based (same origin), so no token handling is needed. */
export class ApiError extends Error {
  status: number;
  details?: any;
  constructor(status: number, message: string, details?: any) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Company slug when the browser is inside a company as agency staff (`/c/<slug>/...`). */
export function companyFromPath(): string | null {
  const m = window.location.pathname.match(/^\/c\/([a-z0-9][a-z0-9-]*)(\/|$)/);
  return m ? m[1] : null;
}
/**
 * Route an API path to the current company: under `/c/<slug>/` every `/api/...` call becomes
 * `/api/c/<slug>/...` (agency staff working in a client company). Use for <img>/<iframe> URLs too.
 */
export function apiUrl(url: string): string {
  const slug = companyFromPath();
  if (slug && url.startsWith('/api/') && !url.startsWith('/api/c/') && !url.startsWith('/api/agency')) return `/api/c/${slug}${url.slice(4)}`;
  return url;
}

async function request<T>(method: string, url: string, body?: any, opts: { form?: boolean } = {}): Promise<T> {
  url = apiUrl(url);
  const headers: Record<string, string> = { Accept: 'application/json' };
  let payload: any = undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    if (res.status === 401 && !url.includes('/auth/')) {
      window.dispatchEvent(new CustomEvent('hrms:unauthorized'));
    }
    throw new ApiError(res.status, data?.error || res.statusText || 'Request failed', data?.details);
  }
  return data as T;
}

export const api = {
  get: <T = any>(url: string) => request<T>('GET', url),
  post: <T = any>(url: string, body?: any) => request<T>('POST', url, body),
  put: <T = any>(url: string, body?: any) => request<T>('PUT', url, body),
  delete: <T = any>(url: string) => request<T>('DELETE', url),
  upload: <T = any>(url: string, form: FormData) => request<T>('POST', url, form),
};

/** Build a query string from an object, skipping empty values. */
export function qs(params: Record<string, any>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
