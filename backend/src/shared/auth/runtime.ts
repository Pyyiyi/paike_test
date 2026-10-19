import type { Pool } from 'pg';
import type { AuthConfig } from '../../config/auth';
import { writeSecurityAudit, type SecurityAuditInput } from '../audit/security-audit';
import { systemClock, type Clock } from '../time/clock';
import { LockoutService } from './lockout';

export interface AuthRuntime {
  config: AuthConfig;
  pool: Pool;
  now: () => number;
  lockout: LockoutService;
  writeAudit: (input: SecurityAuditInput) => Promise<void>;
}

export function createAuthRuntime(input: {
  config: AuthConfig;
  pool: Pool;
  now?: () => number;
}): AuthRuntime {
  const now = input.now ?? Date.now;
  const clock: Clock = { ...systemClock, now: () => new Date(now()) };
  const auditQuery = (sql: string, params?: unknown[]) => input.pool.query(sql, params);

  return {
    config: input.config,
    pool: input.pool,
    now,
    lockout: new LockoutService(input.pool, {
      maxFailures: input.config.loginMaxFailures,
      failureWindowMs: input.config.loginFailureWindowMs,
      lockMs: input.config.loginLockMs,
      now,
    }),
    writeAudit: (auditInput) =>
      writeSecurityAudit(auditInput, { query: auditQuery, clock }),
  };
}
