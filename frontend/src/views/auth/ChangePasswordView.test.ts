import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import ChangePasswordView from './ChangePasswordView.vue';
import { authApi } from '@/shared/api/auth.api';
import type { CurrentUser } from '@/shared/api/types';
import { useSessionStore } from '@/shared/stores/session';
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

const forcedAdmin: CurrentUser = {
  userId: 'admin-1',
  username: 'admin',
  displayName: '教务管理员',
  role: 'ADMIN',
  teacherId: null,
  mustChangePassword: true,
};

async function mountChangePassword(user: CurrentUser) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/change-password', name: 'change-password', component: StubView },
      { path: '/login', name: 'login', component: StubView },
      { path: '/', name: 'home', component: StubView },
      { path: '/me/timetable', name: 'teacher-home', component: StubView },
    ],
  });
  await router.push('/change-password');
  await router.isReady();
  const session = useSessionStore();
  session.user = user;
  session.loaded = true;
  const wrapper = mount(ChangePasswordView, { global: { plugins: [pinia, router] } });
  return { wrapper, router, session };
}

async function fillPasswordForm(
  wrapper: Awaited<ReturnType<typeof mountChangePassword>>['wrapper'],
  values = { current: 'OldPass1!', next: 'NewPass2!', confirm: 'NewPass2!' },
): Promise<void> {
  await wrapper.get('#current-password').setValue(values.current);
  await wrapper.get('#new-password').setValue(values.next);
  await wrapper.get('#confirm-password').setValue(values.confirm);
}

describe('ChangePasswordView', () => {
  beforeEach(() => {
    vi.mocked(authApi.changePassword).mockReset();
  });

  it('renders forced mode without a workspace escape', async () => {
    const { wrapper } = await mountChangePassword(forcedAdmin);

    expect(wrapper.text()).toContain(AUTH_COPY.forcedPasswordTitle);
    expect(wrapper.text()).toContain('首次登录需要设置新密码');
    expect(wrapper.findAll('button').some((button) => button.text().includes(AUTH_COPY.backToWorkspace))).toBe(false);
  });

  it('renders voluntary mode and returns to the role home', async () => {
    const { wrapper, router } = await mountChangePassword({ ...forcedAdmin, mustChangePassword: false });

    expect(wrapper.text()).toContain(AUTH_COPY.voluntaryPasswordTitle);
    const back = wrapper.findAll('button').find((button) => button.text().includes(AUTH_COPY.backToWorkspace));
    expect(back).toBeDefined();
    await back?.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/');
  });

  it('updates policy checks in real time and keeps password inputs non-autofillable', async () => {
    const { wrapper } = await mountChangePassword(forcedAdmin);

    await wrapper.get('#current-password').setValue('OldPass1!');
    await wrapper.get('#new-password').setValue('abcdefgh');
    await wrapper.get('#confirm-password').setValue('abcdefgh');

    expect(wrapper.get('[data-policy="length"]').classes()).toContain('passed');
    expect(wrapper.get('[data-policy="classes"]').classes()).not.toContain('passed');
    expect(wrapper.get('[data-policy="different"]').classes()).toContain('passed');
    expect(wrapper.get('[data-policy="matches"]').classes()).toContain('passed');

    await wrapper.get('#new-password').setValue('Abcdefg1!');
    expect(wrapper.get('[data-policy="classes"]').classes()).toContain('passed');
    expect(wrapper.findAll('input').map((input) => input.attributes('autocomplete'))).toEqual([
      'off',
      'off',
      'off',
    ]);
    expect(wrapper.findAll('.el-input__password')).toHaveLength(3);
  });

  it('submits a valid password, clears the session, and requires a fresh login', async () => {
    vi.mocked(authApi.changePassword).mockResolvedValue(undefined);
    const { wrapper, router, session } = await mountChangePassword(forcedAdmin);

    await fillPasswordForm(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(authApi.changePassword).toHaveBeenCalledWith({
      currentPassword: 'OldPass1!',
      newPassword: 'NewPass2!',
    });
    expect(session.isAuthenticated).toBe(false);
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query.reason).toBe('password-changed');
  });
});
