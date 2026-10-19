import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { installSessionExpiryRedirect } from './session-expiry';
import { http, resetCsrfToken, resetUnauthorizedHandler } from '@/shared/api/http';
import { useSessionStore } from '@/shared/stores/session';

const StubView = { template: '<div />' };

function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({
      error: { code: 'UNAUTHENTICATED', message: '登录已失效，请重新登录', details: [] },
    }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  );
}

describe('session expiry redirect', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    resetCsrfToken();
    resetUnauthorizedHandler();
  });

  afterEach(() => {
    resetUnauthorizedHandler();
    vi.unstubAllGlobals();
  });

  it('clears the session and preserves the full protected path in redirect', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'login', component: StubView },
        { path: '/semesters', name: 'semesters', component: StubView },
      ],
    });
    await router.push('/semesters?tab=active');
    await router.isReady();

    const session = useSessionStore();
    session.user = {
      userId: 'admin-1',
      username: 'admin',
      displayName: '教务管理员',
      role: 'ADMIN',
      teacherId: null,
      mustChangePassword: false,
    };
    session.loaded = true;
    installSessionExpiryRedirect(router, pinia);

    fetchMock.mockResolvedValueOnce(unauthorizedResponse());
    await expect(http.get('/expire')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await flushPromises();

    expect(session.isAuthenticated).toBe(false);
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query.redirect).toBe('/semesters?tab=active');
    expect(router.currentRoute.value.query.reason).toBe('session-expired');
  });
});
