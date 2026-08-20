export interface AuthSessionPayload {
  token: string;
  refresh_token?: string;
  user: unknown;
}

export class AuthApiError extends Error {
  status: number;
  error_code?: string;

  constructor(message: string, status: number, error_code?: string) {
    super(message);
    this.status = status;
    if (error_code !== undefined) this.error_code = error_code;
  }
}

let refreshInFlight: Promise<string | null> | null = null;

export function persistSession(session: AuthSessionPayload): void {
  window.localStorage.setItem('southfarm_token', session.token);
  if (session.refresh_token) {
    window.localStorage.setItem('southfarm_refresh_token', session.refresh_token);
  }
  window.localStorage.setItem('southfarm_user', JSON.stringify(session.user));
}

export function clearSession(): void {
  window.localStorage.removeItem('southfarm_token');
  window.localStorage.removeItem('southfarm_refresh_token');
  window.localStorage.removeItem('southfarm_user');
}

function isSessionControlPath(path: string): boolean {
  return /\/api\/auth\/(login|register|refresh|logout)$/.test(path);
}

export function getActiveAccessToken(fallbackToken?: string): string | null {
  return window.localStorage.getItem('southfarm_token') || fallbackToken || null;
}

export async function refreshStoredAccessToken(apiBase: string): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  const refreshToken = window.localStorage.getItem('southfarm_refresh_token');
  if (!refreshToken) return null;

  refreshInFlight = (async () => {
    const response = await fetch(`${apiBase}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const data = await response.json().catch(() => ({})) as Partial<AuthSessionPayload>;
    if (!response.ok || typeof data.token !== 'string') {
      if (response.status === 401 || response.status === 403) {
        clearSession();
      }
      return null;
    }

    persistSession({
      token: data.token,
      refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
      user: (data.user && typeof data.user === 'object' ? data.user : {}) as Record<string, unknown>,
    });
    return data.token;
  })().catch(() => null);

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export async function authRequest<T>(
  apiBase: string,
  path: string,
  token?: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const headers = new Headers(init.headers);
  // FormData NO lleva Content-Type acá: el browser genera el boundary multipart.
  if (init.body && !headers.has('Content-Type') && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const activeToken = getActiveAccessToken(token);
  if (activeToken) headers.set('Authorization', `Bearer ${activeToken}`);

  const response = await fetch(`${apiBase}${path}`, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && retry && activeToken && !isSessionControlPath(path)) {
    const refreshedToken = await refreshStoredAccessToken(apiBase);
    if (refreshedToken) return authRequest<T>(apiBase, path, refreshedToken, init, false);
  }
  if (!response.ok) {
    const errorPayload = data && typeof data === 'object' ? data as Record<string, unknown> : {};
    throw new AuthApiError(
      typeof errorPayload.error === 'string' ? errorPayload.error : 'No se pudo completar la solicitud',
      response.status,
      typeof errorPayload.error_code === 'string' ? errorPayload.error_code : undefined,
    );
  }
  return data as T;
}
