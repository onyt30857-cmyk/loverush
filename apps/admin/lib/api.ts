/**
 * Admin API client（复用 web 的设计，独立模块避免跨 app import）
 */

import type { ApiResponse, ApiError } from '@loverush/types';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';

export class ApiClientError extends Error {
  constructor(public payload: ApiError) {
    super(payload.message);
    this.name = 'ApiClientError';
  }
}

function authHeader(): HeadersInit {
  if (typeof window === 'undefined') return {};
  const token = window.localStorage.getItem('admin_access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// 401 时用 admin_refresh_token 续 access · 续完重试原请求一次
async function authedFetch(input: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const res = await fetch(input, { ...init, headers: { ...(init.headers || {}), ...authHeader() } });
  if (res.status !== 401 || retried || typeof window === 'undefined') return res;
  const refreshTok = window.localStorage.getItem('admin_refresh_token');
  if (!refreshTok) return res;
  try {
    const r = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshTok }),
    });
    if (r.ok) {
      const j = (await r.json()) as { data?: { access_token?: string; refresh_token?: string } };
      const newAccess = j?.data?.access_token;
      const newRefresh = j?.data?.refresh_token;
      if (newAccess && newRefresh) {
        window.localStorage.setItem('admin_access_token', newAccess);
        window.localStorage.setItem('admin_refresh_token', newRefresh);
        return authedFetch(input, init, true);
      }
    }
  } catch {
    // fall through
  }
  window.localStorage.removeItem('admin_access_token');
  window.localStorage.removeItem('admin_refresh_token');
  return res;
}

function buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
  if (!query) return `${BASE}${path}`;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return `${BASE}${path}${qs ? `?${qs}` : ''}`;
}

async function handle<T>(res: Response): Promise<T> {
  let json: ApiResponse<T>;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ApiClientError({ code: 'E9999', message: `HTTP ${res.status}`, timestamp: '' } as ApiError);
  }
  if (json.error) throw new ApiClientError(json.error);
  if (!res.ok) throw new ApiClientError({ code: 'E0000', message: `HTTP ${res.status}`, timestamp: '' } as ApiError);
  return json.data as T;
}

export const api = {
  get: <T>(path: string, query?: Record<string, string | number | boolean | undefined>) =>
    authedFetch(buildUrl(path, query)).then((r) => handle<T>(r)),
  post: <T>(path: string, body?: unknown) =>
    authedFetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then((r) => handle<T>(r)),
  put: <T>(path: string, body?: unknown) =>
    authedFetch(`${BASE}${path}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then((r) => handle<T>(r)),
  patch: <T>(path: string, body?: unknown) =>
    authedFetch(`${BASE}${path}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then((r) => handle<T>(r)),
  delete: <T>(path: string, body?: unknown) =>
    authedFetch(`${BASE}${path}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then((r) => handle<T>(r)),
};

export function saveAdminTokens(access: string, refresh: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem('admin_access_token', access);
  window.localStorage.setItem('admin_refresh_token', refresh);
}

export function clearAdminTokens() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem('admin_access_token');
  window.localStorage.removeItem('admin_refresh_token');
}

export function hasAdminToken(): boolean {
  if (typeof window === 'undefined') return false;
  return !!window.localStorage.getItem('admin_access_token');
}
