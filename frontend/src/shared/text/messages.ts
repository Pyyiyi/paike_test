import type { ErrorDetail } from '@/shared/api/types';

export const MESSAGES = {
  UNAUTHENTICATED: '登录已失效，请重新登录',
  FORBIDDEN: '您没有权限执行此操作',
  NOT_FOUND: '未找到该数据，可能已被删除',
  VERSION_CONFLICT: '数据已被他人修改，请刷新页面后重试',
  DUPLICATE: '该名称已存在，请更换后重试',
  REFERENCE_PROTECTED: '该数据正被使用，暂时无法删除',
  STATE_CONFLICT: '当前状态不允许此操作，请刷新页面后重试',
  VALIDATION_ERROR: '保存失败，请检查输入内容',
  FILE_TOO_LARGE: '文件超过 20 MB，请拆分后重试',
  IMPORT_ROW_ERROR: '文件中有无法导入的行，请检查后重试',
  ACCOUNT_LOCKED: '登录失败次数过多，请稍后再试',
  INTERNAL_ERROR: '系统暂时不可用，请稍后重试',
  DATABASE_UNAVAILABLE: '系统暂时不可用，请稍后重试',
  NETWORK_ERROR: '网络连接失败，请检查网络后重试',
  UNKNOWN_ERROR: '操作未完成，请稍后重试',
} as const;

export type KnownErrorCode = keyof typeof MESSAGES;

export const COPY_RULES = {
  genericConfirm: '此操作会立即生效，请确认对象与影响范围。',
  irreversible: '此操作不可撤销。',
  reversible: '此操作可撤销。',
  emptyFallback: '暂无数据，请先完成相关配置。',
  loadFailed: '数据加载失败，请重试。',
  startup: '页面正在加载，请稍候。',
} as const;

export interface FriendlyErrorInput {
  code?: string;
  message?: string;
  details?: ErrorDetail[];
}

const TECHNICAL_LEAK = /(?:VERSION_CONFLICT|STATE_CONFLICT|INTERNAL_ERROR|[A-Z][A-Z0-9_]{3,}|\b(?:SQL|SELECT|INSERT|UPDATE|DELETE|stack|Error)\b|HTTP\s*\d{3}|\b[45]\d{2}\b)/i;

function isKnownCode(code: string | undefined): code is KnownErrorCode {
  return Boolean(code && code in MESSAGES);
}

function isSafeUserMessage(message: string | undefined): message is string {
  return Boolean(message && /[\u3400-\u9fff]/.test(message) && !TECHNICAL_LEAK.test(message));
}

export function friendlyError(error: unknown): string {
  if (typeof error === 'string') {
    return isSafeUserMessage(error) ? error : MESSAGES.UNKNOWN_ERROR;
  }

  if (error && typeof error === 'object') {
    const candidate = error as FriendlyErrorInput;
    if (isSafeUserMessage(candidate.message)) {
      return candidate.message;
    }
    if (isKnownCode(candidate.code)) {
      return MESSAGES[candidate.code];
    }
  }

  return MESSAGES.UNKNOWN_ERROR;
}

export function fieldErrors(error: unknown): Record<string, string> {
  if (!error || typeof error !== 'object') {
    return {};
  }
  const details = (error as FriendlyErrorInput).details;
  if (!Array.isArray(details)) {
    return {};
  }
  return details.reduce<Record<string, string>>((result, detail) => {
    if (detail.field && isSafeUserMessage(detail.message)) {
      result[detail.field] = detail.message;
    }
    return result;
  }, {});
}

export const AUTH_COPY = {
  loginTitle: '登录工作台',
  loginIntro: '请使用学校分配的账号登录。',
  usernameLabel: '用户名',
  usernamePlaceholder: '请输入用户名',
  passwordLabel: '密码',
  passwordPlaceholder: '请输入密码',
  loginButton: '登录系统',
  credentialError: '用户名或密码错误',
  sessionExpired: MESSAGES.UNAUTHENTICATED,
  passwordChanged: '密码修改成功，请重新登录',
  forcedPasswordTitle: '请先修改初始密码',
  forcedPasswordIntro: '首次登录需要设置新密码。修改成功后，当前登录会话将失效，请使用新密码重新登录。',
  voluntaryPasswordTitle: '修改登录密码',
  voluntaryPasswordIntro: '定期更换密码有助于保护账号安全。修改成功后，当前登录会话将失效，请使用新密码重新登录。',
  currentPasswordLabel: '当前密码',
  newPasswordLabel: '新密码',
  confirmPasswordLabel: '确认新密码',
  changePasswordButton: '保存并重新登录',
  backToWorkspace: '返回工作台',
  lockout: (minutes: number) => `登录失败次数过多，请 ${minutes} 分钟后再试`,
} as const;

export const PASSWORD_POLICY_COPY = {
  title: '密码策略',
  minLength: '至少 8 个字符',
  characterClasses: '大写字母、小写字母、数字、符号至少包含 3 类',
  differentFromCurrent: '不能与当前密码相同',
  confirmationMatches: '两次输入的新密码一致',
  currentPasswordRequired: '请输入当前密码',
  newPasswordRequired: '请输入新密码',
  confirmPasswordRequired: '请再次输入新密码',
  confirmationMismatch: '两次输入的新密码不一致',
  sameAsCurrent: '新密码不能与当前密码相同',
} as const;

export interface PasswordPolicyState {
  length: boolean;
  classes: boolean;
  different: boolean;
  matches: boolean;
  classCount: number;
}

const PASSWORD_CLASS_PATTERNS = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/] as const;

export function evaluatePasswordPolicy(
  newPassword: string,
  currentPassword: string,
  confirmation: string,
): PasswordPolicyState {
  const classCount = PASSWORD_CLASS_PATTERNS.filter((pattern) => pattern.test(newPassword)).length;
  return {
    length: newPassword.length >= 8,
    classes: classCount >= 3,
    different: newPassword.length > 0 && newPassword !== currentPassword,
    matches: confirmation.length > 0 && confirmation === newPassword,
    classCount,
  };
}

export const ROLE_LABELS = {
  ADMIN: '教务管理员',
  TEACHER: '教师',
} as const;

export const SEMESTER_STATUS_LABELS = {
  NOT_STARTED: '未开始',
  IN_PROGRESS: '进行中',
  ENDED: '已结束',
  ARCHIVED: '已存档',
} as const;

export const WEEK_PARITY_LABELS = {
  ALL: '每周',
  ODD: '单周',
  EVEN: '双周',
} as const;
