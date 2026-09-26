const TOKEN_KEY = 'cm.token';

/**
 * Where the API lives. Empty in development, where Vite proxies `/api` to
 * Fastify on the same origin; set to the deployed API's origin at build time
 * (`VITE_API_BASE_URL`) because Firebase Hosting serves the SPA from a different
 * host than the API runs on.
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

/** `/api/admin/users` -> `https://api.example.com/api/admin/users` */
export function apiUrl(path: string) {
  return path.startsWith('/') ? `${API_BASE}${path}` : path;
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(apiUrl(path), {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && getToken()) {
    // Token expired or revoked — drop it and bounce to the sign-in screen.
    setToken(null);
    window.location.href = '/login';
    throw new ApiError('Your session expired. Please sign in again.', 401);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const p = payload as { error?: string; details?: unknown } | null;
    throw new ApiError(p?.error ?? `Request failed (${res.status})`, res.status, p?.details);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/** Streams a CSV export to the browser's downloads, with the auth header attached. */
export async function downloadCsv(path: string, filename: string) {
  const res = await fetch(apiUrl(path), { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new ApiError(`Export failed (${res.status})`, res.status);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Builds a query string, dropping empty values so the API sees clean params. */
export function qs(params: Record<string, string | number | undefined | null>) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}
