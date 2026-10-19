import { describe, expect, it } from 'vitest';
import { DatabaseConfigError, parseDatabaseConfig } from '../src/config/database';

const validEnv = {
  DATABASE_URL: 'postgres://paike:paike@localhost:55433/paike',
  DATABASE_POOL_MAX: '7',
  DATABASE_POOL_IDLE_MS: '12000',
  DATABASE_STATEMENT_TIMEOUT_MS: '9000',
};

describe('database configuration', () => {
  it('parses database settings with defaults', () => {
    const config = parseDatabaseConfig({ DATABASE_URL: validEnv.DATABASE_URL });
    expect(config).toEqual({
      connectionString: validEnv.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      statementTimeoutMillis: 15_000,
      connectionTimeoutMillis: 5_000,
    });
  });

  it('coerces explicit pool settings', () => {
    const config = parseDatabaseConfig(validEnv);
    expect(config.max).toBe(7);
    expect(config.idleTimeoutMillis).toBe(12_000);
    expect(config.statementTimeoutMillis).toBe(9_000);
  });

  it('rejects missing DATABASE_URL without leaking values', () => {
    expect(() => parseDatabaseConfig({})).toThrow(DatabaseConfigError);
    expect(() => parseDatabaseConfig({})).toThrow(/DATABASE_URL/);
  });

  it('rejects non-postgres protocols without echoing credentials', () => {
    let message = '';
    try {
      parseDatabaseConfig({
        DATABASE_URL: 'https://user:super-secret@example.test/database',
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/postgres/);
    expect(message).not.toContain('super-secret');
  });

  it('rejects empty database names', () => {
    expect(() => parseDatabaseConfig({ DATABASE_URL: 'postgres://localhost:5432/' })).toThrow(
      /数据库名/,
    );
  });
});
