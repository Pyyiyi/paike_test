const PHONE_PATTERN = /(\+?86[- ]?)?(1[3-9]\d)\d{4}(\d{4})/g;
const SENSITIVE_KEY_PATTERN = /pass(word|wd)?|pwd|token|cookie|authorization|secret|csrf/i;
const SECRET_TEXT_PATTERN =
  /(password|passwd|pwd|token|cookie|authorization|secret|csrf)\s*[=:]\s*[^\s,;]+/gi;

/** 手机号脱敏：13812341234 -> 138****1234，+8613812341234 -> +86138****1234。 */
export function maskPhone(value: string): string {
  return value.replace(PHONE_PATTERN, (_match, prefix: string | undefined, head: string, tail: string) => {
    return `${prefix ?? ''}${head}****${tail}`;
  });
}

/** 日志自由文本脱敏：手机号 + 常见 secret 赋值。 */
export function maskSensitiveText(value: string): string {
  return maskPhone(value).replace(SECRET_TEXT_PATTERN, '$1=***');
}

/** 结构化 detail 脱敏：命中敏感键整值替换，字符串值再做手机号脱敏。 */
export function redactSensitive(value: unknown): unknown {
  if (typeof value === 'string') {
    return maskSensitiveText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? '***' : redactSensitive(entry);
    }
    return result;
  }
  return value;
}
