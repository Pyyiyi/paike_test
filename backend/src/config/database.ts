import { Pool } from 'pg';
import { z } from 'zod';

const integerFromEnv = (defaultValue: number, min: number, max: number) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? undefined : value),
    z.coerce.number().int().min(min).max(max).default(defaultValue),
  );

const PostgresUrlSchema = z
  .string()
  .trim()
  .min(1, 'DATABASE_URL 不能为空')
  .url('DATABASE_URL 必须是合法 URL')
  .superRefine((value, context) => {
    const url = new URL(value);
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'DATABASE_URL 必须使用 postgres:// 或 postgresql:// 协议',
      });
    }
    if (!url.hostname) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'DATABASE_URL 缺少主机名' });
    }
    if (!url.pathname || url.pathname === '/') {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'DATABASE_URL 缺少数据库名' });
    }
  });

const DatabaseEnvSchema = z.object({
  DATABASE_URL: PostgresUrlSchema,
  DATABASE_POOL_MAX: integerFromEnv(10, 1, 100),
  DATABASE_POOL_IDLE_MS: integerFromEnv(30_000, 1_000, 600_000),
  DATABASE_STATEMENT_TIMEOUT_MS: integerFromEnv(15_000, 1_000, 120_000),
});

export interface DatabaseConfig {
  connectionString: string;
  max: number;
  idleTimeoutMillis: number;
  statementTimeoutMillis: number;
  connectionTimeoutMillis: number;
}

export class DatabaseConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`数据库配置无效：${issues.join('；')}`);
    this.name = 'DatabaseConfigError';
    this.issues = issues;
  }
}

export function parseDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const parsed = DatabaseEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new DatabaseConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '环境变量'}: ${issue.message}`),
    );
  }

  return Object.freeze({
    connectionString: parsed.data.DATABASE_URL,
    max: parsed.data.DATABASE_POOL_MAX,
    idleTimeoutMillis: parsed.data.DATABASE_POOL_IDLE_MS,
    statementTimeoutMillis: parsed.data.DATABASE_STATEMENT_TIMEOUT_MS,
    connectionTimeoutMillis: 5_000,
  });
}

export function createDatabasePool(config: DatabaseConfig = parseDatabaseConfig()): Pool {
  const pool = new Pool({
    connectionString: config.connectionString,
    max: config.max,
    idleTimeoutMillis: config.idleTimeoutMillis,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    statement_timeout: config.statementTimeoutMillis,
    query_timeout: config.statementTimeoutMillis,
    application_name: 'paike',
  });

  // pg emits this event for idle clients. Consuming it prevents an unhandled
  // EventEmitter error from terminating the API process.
  pool.on('error', () => {
    console.error('数据库连接池回收了异常空闲连接');
  });

  return pool;
}
