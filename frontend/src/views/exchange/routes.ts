import type { RouteRecordRaw } from 'vue-router';

const placeholder = () => import('@/shared/views/PlaceholderView.vue');

export const routes: RouteRecordRaw[] = [
  { path: '/import', name: 'import', component: placeholder, meta: { roles: ['ADMIN'], title: '批量导入', description: '上传固定模板，预览校验结果后提交导入。', nav: 'exchange' } },
  { path: '/export', name: 'export', component: placeholder, meta: { roles: ['ADMIN'], title: 'Excel 导出', description: '按当前学期导出课表与统计结果。', nav: 'exchange' } },
  { path: '/print', name: 'print', component: placeholder, meta: { roles: ['ADMIN'], title: '模板打印', description: '选择模板并打印课表。', nav: 'exchange' } },
];
