/**
 * API client（最薄一层）
 *
 * 自动处理：
 * - base URL（NEXT_PUBLIC_API_URL）
 * - Authorization 头（从 localStorage）
 * - 错误码转抛
 * - PUT / DELETE / 查询字符串
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
  const token = window.localStorage.getItem('access_token');
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

async function handleResponse<T>(res: Response): Promise<T> {
  let json: ApiResponse<T>;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ApiClientError({
      code: 'E9999',
      message: `HTTP ${res.status} (invalid json)`,
      timestamp: new Date().toISOString(),
    } as ApiError);
  }
  if (json.error) throw new ApiClientError(json.error);
  if (!res.ok) {
    throw new ApiClientError({
      code: 'E0000',
      message: `HTTP ${res.status}`,
      timestamp: new Date().toISOString(),
    } as ApiError);
  }
  return json.data as T;
}

export async function apiGet<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const res = await fetch(buildUrl(path, query), { headers: { ...authHeader() } });
  return handleResponse<T>(res);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(res);
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...authHeader() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(res);
}

export async function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', ...authHeader() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(res);
}

// ──────────────── tokens ────────────────

export function saveTokens(accessToken: string, refreshToken: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem('access_token', accessToken);
  window.localStorage.setItem('refresh_token', refreshToken);
}

export function clearTokens() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem('access_token');
  window.localStorage.removeItem('refresh_token');
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('access_token');
}
