import type { RouteRecordRaw } from 'vue-router';

const placeholder = () => import('@/shared/views/PlaceholderView.vue');

export const routes: RouteRecordRaw[] = [
  { path: '/semesters', name: 'semesters', component: placeholder, meta: { roles: ['ADMIN'], title: '学期管理', description: '配置学期时间范围并选择当前学期。', nav: 'registry' } },
  { path: '/schedule-templates', name: 'schedule-templates', component: placeholder, meta: { roles: ['ADMIN'], title: '作息模板', description: '维护作息节次与开放时段。', nav: 'registry' } },
  { path: '/grades-classes', name: 'grades-classes', component: placeholder, meta: { roles: ['ADMIN'], title: '年级与班级', description: '维护年级、班级与学生规模。', nav: 'registry' } },
  { path: '/subjects', name: 'subjects', component: placeholder, meta: { roles: ['ADMIN'], title: '科目与课时', description: '维护科目及每周课时规则。', nav: 'registry' } },
  { path: '/combined-classes', name: 'combined-classes', component: placeholder, meta: { roles: ['ADMIN'], title: '合班课', description: '配置跨班共同上课关系。', nav: 'registry' } },
  { path: '/walking-groups', name: 'walking-groups', component: placeholder, meta: { roles: ['ADMIN'], title: '走班配置', description: '配置走班分组与目标场地。', nav: 'registry' } },
];
