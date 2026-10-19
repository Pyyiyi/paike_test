import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory } from 'vue-router';
import { createAppRouter, installRouteGuards } from './index';
import { authApi } from '@/shared/api/auth.api';
import type { CurrentUser } from '@/shared/api/types';

vi.mock('@/shared/api/auth.api', () => ({
  authApi: {
    me: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    changePassword: vi.fn(),
    csrf: vi.fn(),
  },
}));

const admin: CurrentUser = {
  userId: 'admin-1',
  username: 'admin',
  displayName: '教务管理员',
  role: 'ADMIN',
  teacherId: null,
  mustChangePassword: false,
};

const forcedAdmin: CurrentUser = { ...admin, mustChangePassword: true };

const teacher: CurrentUser = {
  userId: 'teacher-1',
  username: 'T1001',
  displayName: '张老师',
  role: 'TEACHER',
  teacherId: 'teacher-record-1',
  mustChangePassword: false,
};

function routerWithGuards() {
  const router = createAppRouter(createMemoryHistory());
  installRouteGuards(router);
  return router;
}

describe('route guards', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(authApi.me).mockReset();
  });

  it('redirects an unauthenticated visit to /semesters to /login with the original path', async () => {
    vi.mocked(authApi.me).mockRejectedValue(new Error('登录已失效'));
    const router = routerWithGuards();

    await router.push('/semesters');

    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query.redirect).toBe('/semesters');
    expect(router.currentRoute.value.fullPath).toBe('/login?redirect=/semesters');
  });

  it('allows only /change-password while the user must change the initial password', async () => {
    vi.mocked(authApi.me).mockResolvedValue(forcedAdmin);
    const router = routerWithGuards();

    await router.push('/semesters');
    expect(router.currentRoute.value.path).toBe('/change-password');

    await router.push('/change-password');
    expect(router.currentRoute.value.path).toBe('/change-password');
  });

  it('redirects a Teacher away from an Admin route to /403', async () => {
    vi.mocked(authApi.me).mockResolvedValue(teacher);
    const router = routerWithGuards();

    await router.push('/semesters');

    expect(router.currentRoute.value.path).toBe('/403');
  });

  it('allows a Teacher to reach the personal timetable route', async () => {
    vi.mocked(authApi.me).mockResolvedValue(teacher);
    const router = routerWithGuards();

    await router.push('/me/timetable');

    expect(router.currentRoute.value.path).toBe('/me/timetable');
  });
});
