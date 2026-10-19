import { showVersionConflict } from '@/shared/composables/useVersionConflict';
import { friendlyError } from '@/shared/text/messages';
import type { ErrorDetail } from './types';

export const SESSION_EXPIRED_EVENT = 'paike:session-expired';

interface ApiErrorPayload {
  error?: {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
}

interface ApiEnvelope<T> {
  data: T;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: ErrorDetail[];
  readonly retryAfterSeconds?: number;

  constructor(
    code: string,
    status: number,
    message: string,
    details: ErrorDetail[] = [],
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

let csrfToken: string | null = null;
let csrfRequest: Promise<string> | null = null;
const defaultUnauthorizedHandler = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  }
};
let unauthorizedHandler: () => void = defaultUnauthorizedHandler;

const API_BASE = import.meta.env.VITE_API_BASE_PATH ?? '/api/v1';

export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler;
}

export function resetUnauthorizedHandler(): void {
  unauthorizedHandler = defaultUnauthorizedHandler;
}

export function resetCsrfToken(): void {
  csrfToken = null;
  csrfRequest = null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readDetails(value: unknown): ErrorDetail[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      field: readString(item.field),
      message: readString(item.message) ?? '',
      rowNo: typeof item.rowNo === 'number' ? item.rowNo : undefined,
      column: readString(item.column),
      rawValue: readString(item.rawValue),
    }))
    .filter((item) => item.message.length > 0);
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function rawErrorMessage(payload: unknown): string | undefined {
  return readString((payload as ApiErrorPayload | null)?.error?.message);
}

function errorFromResponse(response: Response, payload: unknown): ApiError {
  const raw = (payload as ApiErrorPayload | null)?.error;
  const code = readString(raw?.code) ?? 'UNKNOWN_ERROR';
  const message = friendlyError({ code, message: readString(raw?.message) });
  const retryAfter = Number(response.headers.get('retry-after') ?? '');
  const retryAfterSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
  return new ApiError(code, response.status, message, readDetails(raw?.details), retryAfterSeconds);
}

async function fetchCsrfToken(): Promise<string> {
  if (csrfToken) {
    return csrfToken;
  }
  if (!csrfRequest) {
    csrfRequest = fetch(`${API_BASE}/auth/csrf`, {
      method: 'GET',
      credentials: 'include',
      headers: { accept: 'application/json' },
    })
      .then(async (response) => {
        const payload = await readPayload(response);
        if (!response.ok) {
          throw errorFromResponse(response, payload);
        }
        const token = readString((payload as { data?: { csrfToken?: unknown } } | null)?.data?.csrfToken);
        if (!token) {
          throw new ApiError('UNKNOWN_ERROR', response.status, '页面校验信息已更新，请刷新页面后重试');
        }
        csrfToken = token;
        return token;
      })
      .finally(() => {
        csrfRequest = null;
      });
  }
  return csrfRequest;
}

function buildUrl(path: string, params?: Record<string, unknown>): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${API_BASE}${normalized}`, window.location.origin);
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return `${url.pathname}${url.search}`;
}

async function request<T>(method: string, path: string, body?: unknown, params?: Record<string, unknown>): Promise<T> {
  const safeMethod = method.toUpperCase();
  const canRetryCsrf = !['GET', 'HEAD', 'OPTIONS'].includes(safeMethod);
  let csrfRetried = false;

  for (;;) {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (canRetryCsrf) {
      headers['x-csrf-token'] = await fetchCsrfToken();
    }

    let response: Response;
    try {
      response = await fetch(buildUrl(path, params), {
        method: safeMethod,
        credentials: 'include',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError('NETWORK_ERROR', 0, friendlyError({ code: 'NETWORK_ERROR' }));
    }

    const payload = await readPayload(response);
    if (canRetryCsrf && response.status === 403 && !csrfRetried) {
      const rawMessage = rawErrorMessage(payload);
      if (rawMessage?.includes('校验')) {
        csrfRetried = true;
        resetCsrfToken();
        continue;
      }
    }

    if (response.status === 401) {
      unauthorizedHandler();
    }
    if (!response.ok) {
      const apiError = errorFromResponse(response, payload);
      if (apiError.status === 409 && apiError.code === 'VERSION_CONFLICT') {
        showVersionConflict(apiError.message);
      }
      throw apiError;
    }

    if (response.status === 204) {
      return undefined as T;
    }
    return (payload as ApiEnvelope<T> | null)?.data as T;
  }
}

export const http = {
  get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
    return request<T>('GET', url, undefined, params);
  },
  post<T>(url: string, body?: unknown): Promise<T> {
    return request<T>('POST', url, body);
  },
  patch<T>(url: string, body?: unknown): Promise<T> {
    return request<T>('PATCH', url, body);
  },
  put<T>(url: string, body?: unknown): Promise<T> {
    return request<T>('PUT', url, body);
  },
  delete<T>(url: string): Promise<T> {
    return request<T>('DELETE', url);
  },
  async download(url: string, body?: unknown): Promise<Blob> {
    const headers: Record<string, string> = { 'x-csrf-token': await fetchCsrfToken() };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const response = await fetch(buildUrl(url), {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'include',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 401) {
      unauthorizedHandler();
    }
    if (!response.ok) {
      throw errorFromResponse(response, await readPayload(response));
    }
    return response.blob();
  },
};

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
