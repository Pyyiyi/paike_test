import { createRouter, createWebHistory, type RouteRecordRaw, type RouterHistory } from 'vue-router';
import { useSessionStore } from '@/shared/stores/session';
import { collectDomainRoutes, type DomainRouteModule } from './route-registry';

const modules = import.meta.glob<DomainRouteModule>('../views/*/routes.ts', { eager: true });
export const domainRoutes = collectDomainRoutes(modules);

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/auth/LoginView.vue'),
    meta: { publicPage: true, title: '登录' },
  },
  {
    path: '/change-password',
    name: 'change-password',
    component: () => import('@/views/auth/ChangePasswordView.vue'),
    meta: { requiresAuth: true, allowForcedPasswordChange: true, title: '修改密码' },
  },
  {
    path: '/403',
    name: 'forbidden',
    component: () => import('@/views/auth/ForbiddenView.vue'),
    meta: { requiresAuth: true, title: '权限不足' },
  },
  {
    path: '/',
    component: () => import('@/layouts/AppLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      ...domainRoutes,
      {
        path: '/:pathMatch(.*)*',
        name: 'not-found',
        component: () => import('@/views/auth/NotFoundView.vue'),
        meta: { requiresAuth: true, title: '页面不存在' },
      },
    ],
  },
];

export function createAppRouter(history: RouterHistory = createWebHistory()): ReturnType<typeof createRouter> {
  return createRouter({
    history,
    routes,
    scrollBehavior: () => ({ top: 0 }),
  });
}

export function installRouteGuards(router: ReturnType<typeof createRouter>): void {
  router.beforeEach(async (to) => {
    const session = useSessionStore();
    if (!session.loaded) {
      await session.fetchMe();
    }

    if (to.meta.publicPage) {
      if (to.name === 'login' && session.isAuthenticated) {
        return session.mustChangePassword ? '/change-password' : session.homePath;
      }
      return true;
    }

    if (to.meta.requiresAuth && !session.isAuthenticated) {
      return {
        name: 'login',
        query: { redirect: to.fullPath },
      };
    }

    if (session.mustChangePassword && !to.meta.allowForcedPasswordChange) {
      return { name: 'change-password' };
    }

    if (!session.mustChangePassword && to.name === 'change-password') {
      return session.homePath;
    }

    const roles = to.meta.roles;
    if (roles && (!session.user || !roles.includes(session.user.role))) {
      return { name: 'forbidden' };
    }

    return true;
  });
}
