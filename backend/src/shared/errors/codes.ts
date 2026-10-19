export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'DUPLICATE'
  | 'REFERENCE_PROTECTED'
  | 'STATE_CONFLICT'
  | 'FILE_TOO_LARGE'
  | 'IMPORT_ROW_ERROR'
  | 'ACCOUNT_LOCKED'
  | 'DATABASE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: '保存失败，请检查输入内容',
  UNAUTHENTICATED: '登录已失效，请重新登录',
  FORBIDDEN: '您没有权限执行此操作',
  NOT_FOUND: '未找到该数据，可能已被删除',
  VERSION_CONFLICT: '数据已被他人修改，请刷新后重试',
  DUPLICATE: '该名称已存在，请更换后重试',
  REFERENCE_PROTECTED: '该数据正被使用，暂时无法删除',
  STATE_CONFLICT: '当前状态不允许此操作',
  FILE_TOO_LARGE: '文件超过 20 MB，请拆分后重试',
  IMPORT_ROW_ERROR: '文件中有无法导入的行',
  ACCOUNT_LOCKED: '登录失败次数过多，请 15 分钟后再试',
  DATABASE_UNAVAILABLE: '数据库暂时不可用，请稍后重试',
  INTERNAL_ERROR: '系统暂时不可用，请稍后重试',
};
