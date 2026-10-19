import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import VersionConflictNotice from '@/shared/components/VersionConflictNotice.vue';
import { resetVersionConflict } from '@/shared/composables/useVersionConflict';
import { http, onUnauthorized, resetCsrfToken, resetUnauthorizedHandler } from './http';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('shared HTTP client', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    resetCsrfToken();
    resetVersionConflict();
  });

  afterEach(() => {
    resetUnauthorizedHandler();
    vi.unstubAllGlobals();
  });

  it('refreshes CSRF once when the server rejects a stale token', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { csrfToken: 'stale-token' } }))
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 'FORBIDDEN', message: '请求校验失败，请刷新页面后重试', details: [] } }, 403),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { csrfToken: 'fresh-token' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));

    await expect(http.post('/semesters', { name: '新学期' })).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ 'x-csrf-token': 'stale-token' });
    expect(fetchMock.mock.calls[3]?.[1]?.headers).toMatchObject({ 'x-csrf-token': 'fresh-token' });
  });

  it('keeps Retry-After seconds on a lockout response for the login countdown', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 'ACCOUNT_LOCKED',
            message: '登录失败次数过多，请 15 分钟后再试',
            details: [],
          },
        }),
        {
          status: 423,
          headers: { 'content-type': 'application/json', 'retry-after': '900' },
        },
      ),
    );

    await expect(http.get('/auth/me')).rejects.toMatchObject({
      code: 'ACCOUNT_LOCKED',
      status: 423,
      retryAfterSeconds: 900,
    });
  });

  it('dispatches the unauthorized handler for any 401 response', async () => {
    const handler = vi.fn();
    onUnauthorized(handler);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: 'UNAUTHENTICATED',
            message: '登录已失效，请重新登录',
            details: [],
          },
        },
        401,
      ),
    );

    await expect(http.get('/auth/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('injects CSRF and turns a 409 VERSION_CONFLICT into a Chinese refresh notice', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { csrfToken: 'csrf-token-123' } }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 'VERSION_CONFLICT',
              message: '数据已被他人修改，请刷新页面后重试',
              details: [],
            },
          },
          409,
        ),
      );

    await expect(http.post('/semesters/semester-1', { name: '新学期', version: 1 })).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      message: '数据已被他人修改，请刷新页面后重试',
    });

    const writeCall = fetchMock.mock.calls[1];
    expect(writeCall?.[1]?.headers).toMatchObject({ 'x-csrf-token': 'csrf-token-123' });

    const wrapper = mount(VersionConflictNotice);
    const text = wrapper.text();
    expect(text).toContain('数据已被他人修改，请刷新页面后重试');
    expect(text).toContain('刷新页面');
    expect(text).not.toContain('VERSION_CONFLICT');
    expect(text).not.toContain('409');
  });
});
