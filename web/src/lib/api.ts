/**
 * Thin fetch wrapper around the API.
 *
 * The JWT lives in an httpOnly cookie on the same domain, so there is nothing to
 * attach by hand - only `credentials: include` so the cookie travels.
 */
const BASE_URL = '/api';

/**
 * Fired when a call that needed a session came back 401. The session can die
 * behind a page's back - another tab of the same browser logged out (one cookie
 * is shared by every tab), or the 8-hour token ran out - and without this the
 * page keeps showing the old identity while every call fails.
 */
export const SESSION_EXPIRED_EVENT = 'cpru:session-expired';

/**
 * 401 on these is an answer, not an expired session: /auth/me is how the app
 * asks whether anyone is signed in, /auth/login means a wrong password, and
 * /auth/logout is already on its way out.
 */
const AUTH_PROBES = ['/auth/me', '/auth/login', '/auth/logout'];

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level messages returned by the Zod layer, keyed by field name. */
  get fieldErrors(): Record<string, string> {
    const details = this.details as { field: string; message: string }[] | undefined;
    if (!Array.isArray(details)) return {};
    return Object.fromEntries(details.map((item) => [item.field, item.message]));
  }

  /** Business-rule failures returned by the submit gate. */
  get issues(): { code: string; message: string }[] {
    const details = this.details as { issues?: { code: string; message: string }[] } | undefined;
    return details?.issues ?? [];
  }
}

async function parse(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    credentials: 'include',
    headers:
      init.body instanceof FormData
        ? init.headers
        : { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });

  const body = await parse(response);

  if (!response.ok) {
    if (response.status === 401 && !AUTH_PROBES.some((probe) => path.startsWith(probe))) {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    const error = (body as { error?: ApiErrorBody } | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? 'เกิดข้อผิดพลาดในการเชื่อมต่อระบบ',
      error?.details,
    );
  }

  return body as T;
}

function withQuery(path: string, params?: Record<string, unknown>): string {
  if (!params) return path;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const queryString = search.toString();
  return queryString ? `${path}?${queryString}` : path;
}

export const api = {
  get: <T>(path: string, params?: Record<string, unknown>) => request<T>(withQuery(path, params)),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) =>
    request<T>(path, { method: 'POST', body: formData }),
  /** Opens a streamed file (PDF, Excel) in a new tab through the permission check. */
  fileUrl: (path: string) => `${BASE_URL}${path}`,
};
