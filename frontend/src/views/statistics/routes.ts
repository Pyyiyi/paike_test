import type { RouteRecordRaw } from 'vue-router';

export const routes: RouteRecordRaw[] = [
  { path: '/statistics', name: 'statistics', component: () => import('@/shared/views/PlaceholderView.vue'), meta: { roles: ['ADMIN'], title: '工作量统计', description: '按教师与科目查看工作量分布。', nav: 'statistics' } },
];
