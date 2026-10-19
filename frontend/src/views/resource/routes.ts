import type { RouteRecordRaw } from 'vue-router';

const placeholder = () => import('@/shared/views/PlaceholderView.vue');

export const routes: RouteRecordRaw[] = [
  { path: '/teachers', name: 'teachers', component: placeholder, meta: { roles: ['ADMIN'], title: '教师与任课', description: '维护教师档案、任课与禁排信息。', nav: 'resource' } },
  { path: '/venues', name: 'venues', component: placeholder, meta: { roles: ['ADMIN'], title: '场地与功能室', description: '维护场地容量与可用时段。', nav: 'resource' } },
];
