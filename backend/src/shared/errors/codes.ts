/**
 * 全后端统一错误码。
 *
 * 唯一来源：conventions.md §3.2。新增错误码必须同步 HTTP 映射与默认中文文案。
 */
export const ERROR_HTTP_STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  DUPLICATE: 409,
  REFERENCE_PROTECTED: 409,
  STATE_CONFLICT: 409,
  FILE_TOO_LARGE: 413,
  IMPORT_ROW_ERROR: 422,
  ACCOUNT_LOCKED: 423,
  INTERNAL_ERROR: 500,
  DATABASE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_HTTP_STATUS;

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
  INTERNAL_ERROR: '系统暂时不可用，请稍后重试',
  DATABASE_UNAVAILABLE: '数据库暂时不可用，请稍后重试',
};

export function httpStatusFor(code: ErrorCode): number {
  return ERROR_HTTP_STATUS[code];
}
