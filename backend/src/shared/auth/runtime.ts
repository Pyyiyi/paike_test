import type { Pool } from 'pg';
import type { AuthConfig } from '../../config/auth';
import { LockoutService } from './lockout';

export interface AuthRuntime {
  config: AuthConfig;
  pool: Pool;
  now: () => number;
  lockout: LockoutService;
}

export function createAuthRuntime(input: {
  config: AuthConfig;
  pool: Pool;
  now?: () => number;
}): AuthRuntime {
  const now = input.now ?? Date.now;
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
  };
}
