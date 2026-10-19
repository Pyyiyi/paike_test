import type { RouteRecordRaw } from 'vue-router';

const placeholder = () => import('@/shared/views/PlaceholderView.vue');

export const routes: RouteRecordRaw[] = [
  { path: '/scheduling', name: 'scheduling', component: placeholder, meta: { roles: ['ADMIN'], title: '一键排课', description: '启动排课任务并查看结果摘要。', nav: 'timetable' } },
  { path: '/scheduling/pre', name: 'scheduling-pre', component: placeholder, meta: { roles: ['ADMIN'], title: '预排与锁定', description: '预先安排并锁定关键课程。', nav: 'timetable' } },
  { path: '/timetables', name: 'timetables', component: placeholder, meta: { roles: ['ADMIN'], title: '多维度课表', description: '按班级、教师、全校、场地或任课视图查看课表。', nav: 'timetable' } },
  { path: '/timetables/adjust', name: 'timetables-adjust', component: placeholder, meta: { roles: ['ADMIN'], title: '拖拽调课', description: '调整课次并完成冲突校验。', nav: 'timetable' } },
  { path: '/idle-slots', name: 'idle-slots', component: placeholder, meta: { roles: ['ADMIN'], title: '空闲时段', description: '查询教师、班级与场地的空闲时段。', nav: 'timetable' } },
  { path: '/me/timetable', name: 'my-timetable', component: placeholder, meta: { roles: ['TEACHER'], title: '我的课表', description: '查看本人及关联班级课程。', nav: 'teacher' } },
  { path: '/me/idle-slots', name: 'my-idle-slots', component: placeholder, meta: { roles: ['TEACHER'], title: '我的空闲时段', description: '查看本人可安排课程的时段。', nav: 'teacher' } },
];
