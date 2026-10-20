import type { RouteRecordRaw } from 'vue-router';

export const routes: RouteRecordRaw[] = [
  {
    path: '/statistics',
    name: 'statistics',
    component: () => import('./WorkloadStatisticsView.vue'),
    meta: {
      roles: ['ADMIN'],
      title: '工作量统计',
      description: '按周或学期查看教师常规、连堂、合班与加班课时。',
      nav: 'statistics',
    },
  },
];
