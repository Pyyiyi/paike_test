import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import LoginView from './LoginView.vue';
import { ApiError } from '@/shared/api/http';
import { authApi } from '@/shared/api/auth.api';
import type { CurrentUser } from '@/shared/api/types';
import { AUTH_COPY } from '@/shared/text/messages';

vi.mock('@/shared/api/auth.api', () => ({
  authApi: {
    me: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    changePassword: vi.fn(),
    csrf: vi.fn(),
  },
}));

const StubView = { template: '<div />' };

const admin: CurrentUser = {
  userId: 'admin-1',
  username: 'admin',
  displayName: '教务管理员',
  role: 'ADMIN',
  teacherId: null,
  mustChangePassword: false,
};

const teacher: CurrentUser = {
  userId: 'teacher-1',
  username: 'T1001',
  displayName: '张老师',
  role: 'TEACHER',
  teacherId: 'teacher-record-1',
  mustChangePassword: false,
};

async function mountLogin(path = '/login') {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'login', component: StubView },
      { path: '/', name: 'home', component: StubView },
      { path: '/me/timetable', name: 'teacher-home', component: StubView },
      { path: '/change-password', name: 'change-password', component: StubView },
      { path: '/semesters', component: StubView },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(LoginView, { global: { plugins: [pinia, router] } });
  return { wrapper, router, pinia };
}

async function submitCredentials(wrapper: Awaited<ReturnType<typeof mountLogin>>['wrapper']): Promise<void> {
  await wrapper.get('#username').setValue('admin');
  await wrapper.get('#password').setValue('WrongPass1!');
  await wrapper.get('form').trigger('submit');
  await flushPromises();
}

describe('LoginView', () => {
  beforeEach(() => {
    vi.mocked(authApi.login).mockReset();
    vi.mocked(authApi.me).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows only the unified credential error and never account-existence or technical detail', async () => {
    vi.mocked(authApi.login).mockRejectedValue(
      new ApiError('UNAUTHENTICATED', 401, AUTH_COPY.credentialError),
    );
    const { wrapper } = await mountLogin();

    await submitCredentials(wrapper);

    const alert = wrapper.get('[data-login-error]').text();
    expect(alert).toContain(AUTH_COPY.credentialError);
    expect(wrapper.text()).not.toContain('账号不存在');
    expect(wrapper.text()).not.toContain('用户名不存在');
    expect(wrapper.text()).not.toContain('401');
    expect(wrapper.text()).not.toContain('UNAUTHENTICATED');
  });

  it('starts a visible countdown, disables submission, and recovers after the lockout', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
    vi.mocked(authApi.login).mockRejectedValue(
      new ApiError(
        'ACCOUNT_LOCKED',
        423,
        '登录失败次数过多，请 15 分钟后再试',
        [],
        15 * 60,
      ),
    );
    const { wrapper } = await mountLogin();

    await submitCredentials(wrapper);

    expect(wrapper.get('[data-lockout]').text()).toContain('请 15 分钟后再试');
    expect(wrapper.get('.login-button').attributes('disabled')).toBeDefined();

    vi.advanceTimersByTime(60_000);
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-lockout]').text()).toContain('请 14 分钟后再试');

    vi.advanceTimersByTime(14 * 60_000);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-lockout]').exists()).toBe(false);
    expect(wrapper.get('.login-button').attributes('disabled')).toBeUndefined();
  });

  it.each([
    [admin, '/'] ,
    [teacher, '/me/timetable'],
  ])('routes $role users to their role home after login', async (user, expectedPath) => {
    vi.mocked(authApi.login).mockResolvedValue(user);
    const { wrapper, router } = await mountLogin();

    await submitCredentials(wrapper);

    expect(router.currentRoute.value.path).toBe(expectedPath);
  });

  it('forces a password-change redirect before any other post-login landing', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ ...admin, mustChangePassword: true });
    const { wrapper, router } = await mountLogin('/login?redirect=/semesters');

    await submitCredentials(wrapper);

    expect(router.currentRoute.value.path).toBe('/change-password');
  });

  it('shows the session-expired and password-changed notices from the redirect reason', async () => {
    const expired = await mountLogin('/login?reason=session-expired');
    expect(expired.wrapper.get('[data-auth-notice]').text()).toContain(AUTH_COPY.sessionExpired);

    const changed = await mountLogin('/login?reason=password-changed');
    expect(changed.wrapper.get('[data-auth-notice]').text()).toContain(AUTH_COPY.passwordChanged);
  });

  it('contains no demo credentials, default-password hint, one-click fill, or autofill attributes', async () => {
    const { wrapper } = await mountLogin();
    const text = wrapper.text();

    expect(text).not.toContain('演示账号');
    expect(text).not.toContain('默认密码');
    expect(text).not.toContain('一键填充');
    expect(text).not.toContain('admin /');
    expect(wrapper.findAll('input').map((input) => input.attributes('autocomplete'))).toEqual(['off', 'off']);
  });
});
