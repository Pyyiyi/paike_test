import type { RouteRecordRaw } from 'vue-router';

export const routes: RouteRecordRaw[] = [
  {
    path: '',
    name: 'overview',
    component: () => import('@/shared/views/PlaceholderView.vue'),
    meta: {
      roles: ['ADMIN'],
      title: '系统概览',
      description: '查看当前学期状态、快捷入口与最近操作。',
      nav: 'overview',
    },
  },
];
