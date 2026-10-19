import { z } from 'zod';
import type { Argon2Options, PasswordPolicy } from '../shared/auth/password';

const integerFromEnv = (defaultValue: number, min: number, max: number) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? undefined : value),
    z.coerce.number().int().min(min).max(max).default(defaultValue),
  );

const SeedEnvSchema = z.object({
  PAIKE_ADMIN_INITIAL_PASSWORD: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().max(256, '初始密码过长').optional(),
  ),
  PASSWORD_MIN_LENGTH: integerFromEnv(8, 8, 128),
  PASSWORD_REQUIRED_CLASSES: integerFromEnv(3, 1, 4),
  ARGON2_MEMORY_KIB: integerFromEnv(65_536, 8_192, 1_073_741_824),
  ARGON2_TIME_COST: integerFromEnv(3, 2, 20),
  ARGON2_PARALLELISM: integerFromEnv(1, 1, 16),
});

export interface SeedConfig {
  initialPassword?: string;
  passwordPolicy: PasswordPolicy;
  argon2Options: Argon2Options;
}

export class SeedConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Seed 配置无效：${issues.join('；')}`);
    this.name = 'SeedConfigError';
    this.issues = issues;
  }
}

export function parseSeedConfig(env: NodeJS.ProcessEnv = process.env): SeedConfig {
  const parsed = SeedEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new SeedConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '环境变量'}: ${issue.message}`),
    );
  }

  return Object.freeze({
    initialPassword: parsed.data.PAIKE_ADMIN_INITIAL_PASSWORD,
    passwordPolicy: {
      minLength: parsed.data.PASSWORD_MIN_LENGTH,
      requiredClasses: parsed.data.PASSWORD_REQUIRED_CLASSES,
    },
    argon2Options: {
      memoryCost: parsed.data.ARGON2_MEMORY_KIB,
      timeCost: parsed.data.ARGON2_TIME_COST,
      parallelism: parsed.data.ARGON2_PARALLELISM,
    },
  });
}
