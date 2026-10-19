import { z } from 'zod';

const integerFromEnv = (defaultValue: number, min: number, max: number) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? undefined : value),
    z.coerce.number().int().min(min).max(max).default(defaultValue),
  );

const AuthEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET 至少 32 个字符'),
  SESSION_COOKIE_NAME: z.string().min(1).max(64).default('paike.sid'),
  SESSION_IDLE_HOURS: integerFromEnv(8, 1, 720),
  SESSION_ABSOLUTE_DAYS: integerFromEnv(7, 1, 365),
  PASSWORD_MIN_LENGTH: integerFromEnv(8, 8, 128),
  PASSWORD_REQUIRED_CLASSES: integerFromEnv(3, 1, 4),
  LOGIN_MAX_FAILURES: integerFromEnv(5, 1, 100),
  LOGIN_FAILURE_WINDOW_MINUTES: integerFromEnv(15, 1, 1440),
  LOGIN_LOCK_MINUTES: integerFromEnv(15, 1, 1440),
  ARGON2_MEMORY_KIB: integerFromEnv(65536, 8192, 1073741824),
  ARGON2_TIME_COST: integerFromEnv(3, 2, 20),
  ARGON2_PARALLELISM: integerFromEnv(1, 1, 16),
});

export interface AuthConfig {
  nodeEnv: 'development' | 'test' | 'production';
  sessionSecret: string;
  sessionCookieName: string;
  sessionIdleMs: number;
  sessionAbsoluteMs: number;
  passwordMinLength: number;
  passwordRequiredClasses: number;
  loginMaxFailures: number;
  loginFailureWindowMs: number;
  loginLockMs: number;
  argon2MemoryCost: number;
  argon2TimeCost: number;
  argon2Parallelism: number;
  secureCookies: boolean;
}

export class AuthConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`认证配置无效：${issues.join('；')}`);
    this.name = 'AuthConfigError';
    this.issues = issues;
  }
}

export function parseAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const parsed = AuthEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new AuthConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '环境变量'}: ${issue.message}`),
    );
  }

  return Object.freeze({
    nodeEnv: parsed.data.NODE_ENV,
    sessionSecret: parsed.data.SESSION_SECRET,
    sessionCookieName: parsed.data.SESSION_COOKIE_NAME,
    sessionIdleMs: parsed.data.SESSION_IDLE_HOURS * 60 * 60 * 1000,
    sessionAbsoluteMs: parsed.data.SESSION_ABSOLUTE_DAYS * 24 * 60 * 60 * 1000,
    passwordMinLength: parsed.data.PASSWORD_MIN_LENGTH,
    passwordRequiredClasses: parsed.data.PASSWORD_REQUIRED_CLASSES,
    loginMaxFailures: parsed.data.LOGIN_MAX_FAILURES,
    loginFailureWindowMs: parsed.data.LOGIN_FAILURE_WINDOW_MINUTES * 60 * 1000,
    loginLockMs: parsed.data.LOGIN_LOCK_MINUTES * 60 * 1000,
    argon2MemoryCost: parsed.data.ARGON2_MEMORY_KIB,
    argon2TimeCost: parsed.data.ARGON2_TIME_COST,
    argon2Parallelism: parsed.data.ARGON2_PARALLELISM,
    secureCookies: parsed.data.NODE_ENV === 'production',
  });
}
