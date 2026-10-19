import type { RouteRecordRaw } from 'vue-router';

export const routes: RouteRecordRaw[] = [
  { path: '/users', name: 'users', component: () => import('@/shared/views/PlaceholderView.vue'), meta: { roles: ['ADMIN'], title: '用户与角色', description: '维护本地账号、角色与账号状态。', nav: 'identity' } },
];
