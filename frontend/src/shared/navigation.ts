export interface NavItem {
  key: string;
  label: string;
  to?: string;
  action?: 'logout';
  children?: NavItem[];
}

export const ADMIN_NAV: NavItem[] = [
  { key: 'overview', label: '系统概览', to: '/' },
  {
    key: 'registry',
    label: '基础数据',
    children: [
      { key: 'semesters', label: '学期管理', to: '/semesters' },
      { key: 'schedule-templates', label: '作息模板', to: '/schedule-templates' },
      { key: 'grades-classes', label: '年级与班级', to: '/grades-classes' },
      { key: 'subjects', label: '科目与课时', to: '/subjects' },
      { key: 'teachers', label: '教师与任课', to: '/teachers' },
      { key: 'venues', label: '场地与功能室', to: '/venues' },
      { key: 'combined-classes', label: '合班课', to: '/combined-classes' },
      { key: 'walking-groups', label: '走班配置', to: '/walking-groups' },
    ],
  },
  {
    key: 'scheduling',
    label: '排课管理',
    children: [
      { key: 'scheduling-run', label: '一键排课', to: '/scheduling' },
      { key: 'scheduling-pre', label: '预排与锁定', to: '/scheduling/pre' },
      { key: 'conflicts', label: '冲突校验', to: '/conflicts' },
    ],
  },
  {
    key: 'timetables',
    label: '课表管理',
    children: [
      { key: 'timetables-view', label: '多维度课表', to: '/timetables' },
      { key: 'timetables-adjust', label: '拖拽调课', to: '/timetables/adjust' },
    ],
  },
  { key: 'idle-slots', label: '空闲时段', to: '/idle-slots' },
  { key: 'statistics', label: '工作量统计', to: '/statistics' },
  {
    key: 'exchange',
    label: '数据交换',
    children: [
      { key: 'import', label: '批量导入', to: '/import' },
      { key: 'export', label: 'Excel 导出', to: '/export' },
      { key: 'print', label: '模板打印', to: '/print' },
    ],
  },
  {
    key: 'governance',
    label: '日志与存档',
    children: [
      { key: 'logs', label: '操作日志', to: '/logs' },
      { key: 'archive', label: '多学期存档', to: '/archive' },
    ],
  },
  { key: 'users', label: '用户与角色', to: '/users' },
];

export const TEACHER_NAV: NavItem[] = [
  { key: 'my-timetable', label: '我的课表', to: '/me/timetable' },
  { key: 'my-idle-slots', label: '我的空闲时段', to: '/me/idle-slots' },
  { key: 'logout', label: '退出登录', action: 'logout' },
];
