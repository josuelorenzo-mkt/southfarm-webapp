export interface AuthSessionPayload {
  token: string;
  refresh_token?: string;
  user: unknown;
}

export class AuthApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
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

async function refreshStoredAccessToken(apiBase: string): Promise<string | null> {
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
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const storedToken = window.localStorage.getItem('southfarm_token');
  const activeToken = storedToken || token;
  if (activeToken) headers.set('Authorization', `Bearer ${activeToken}`);

  const response = await fetch(`${apiBase}${path}`, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && retry && activeToken && !isSessionControlPath(path)) {
    const refreshedToken = await refreshStoredAccessToken(apiBase);
    if (refreshedToken) return authRequest<T>(apiBase, path, refreshedToken, init, false);
  }
  if (!response.ok) {
    throw new AuthApiError(
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error?: unknown }).error || 'No se pudo completar la solicitud')
        : 'No se pudo completar la solicitud',
      response.status,
    );
  }
  return data as T;
}
