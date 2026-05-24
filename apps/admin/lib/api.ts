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
    fetch(buildUrl(path, query), { headers: { ...authHeader() } }).then((r) => handle<T>(r)),
  post: <T>(path: string, body?: unknown) =>
    fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then((r) => handle<T>(r)),
  put: <T>(path: string, body?: unknown) =>
    fetch(`${BASE}${path}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then((r) => handle<T>(r)),
  delete: <T>(path: string, body?: unknown) =>
    fetch(`${BASE}${path}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', ...authHeader() },
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
