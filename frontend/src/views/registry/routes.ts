import type { RouteRecordRaw } from 'vue-router';

const gradesClasses = () => import('./GradesClassesView.vue');
const subjects = () => import('./SubjectsView.vue');
const semesterList = () => import('./SemesterListView.vue');
const scheduleTemplates = () => import('./ScheduleTemplateListView.vue');

export const routes: RouteRecordRaw[] = [
  { path: '/semesters', name: 'semesters', component: semesterList, meta: { roles: ['ADMIN'], title: '学期管理', description: '配置学期时间范围、引用作息模板与校历。', nav: 'registry' } },
  { path: '/schedule-templates', name: 'schedule-templates', component: scheduleTemplates, meta: { roles: ['ADMIN'], title: '作息模板', description: '维护作息节次、开放星期与不可变版本。', nav: 'registry' } },
  { path: '/grades-classes', name: 'grades-classes', component: gradesClasses, meta: { roles: ['ADMIN'], title: '年级与班级', description: '维护年级、班级与学生规模。', nav: 'registry' } },
  { path: '/combined-classes', name: 'combined-classes', component: () => import('@/views/registry/CombinedClassView.vue'), meta: { roles: ['ADMIN'], title: '合班课', description: '维护多班静态合并的排课单元。', nav: 'registry' } },
  { path: '/walking-groups', name: 'walking-groups', component: () => import('@/views/registry/WalkingGroupView.vue'), meta: { roles: ['ADMIN'], title: '走班配置', description: '维护科目走班与目标场地。', nav: 'registry' } },
  { path: '/subjects', name: 'subjects', component: subjects, meta: { roles: ['ADMIN'], title: '科目与课时', description: '维护科目及每周课时规则。', nav: 'registry' } },
];
