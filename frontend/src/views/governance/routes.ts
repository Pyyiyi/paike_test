import type { RouteRecordRaw } from 'vue-router';

const placeholder = () => import('@/shared/views/PlaceholderView.vue');

export const routes: RouteRecordRaw[] = [
  { path: '/conflicts', name: 'conflicts', component: placeholder, meta: { roles: ['ADMIN'], title: '冲突校验', description: '集中查看并处理课表冲突。', nav: 'governance' } },
  { path: '/logs', name: 'logs', component: placeholder, meta: { roles: ['ADMIN'], title: '操作日志', description: '查询关键操作与处理结果。', nav: 'governance' } },
  { path: '/archive', name: 'archive', component: placeholder, meta: { roles: ['ADMIN'], title: '多学期存档', description: '查看和恢复历史学期存档。', nav: 'governance' } },
];
