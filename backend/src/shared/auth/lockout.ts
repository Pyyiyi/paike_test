import type { Pool } from 'pg';

export interface LockoutPolicy {
  maxFailures: number;
  failureWindowMs: number;
  lockMs: number;
  now: () => number;
}

interface AttemptSummary {
  failures: number | string;
  last_failure: Date | null;
}

export interface LockoutState {
  locked: boolean;
  remainingSeconds: number;
}

export class LockoutService {
  private readonly pool: Pool;
  private readonly policy: LockoutPolicy;

  constructor(pool: Pool, policy: LockoutPolicy) {
    this.pool = pool;
    this.policy = policy;
  }

  async recordFailure(username: string, ip: string, failureReason: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO sys_login_attempt (username, ip_address, success, failure_reason)
       VALUES ($1, $2::inet, false, $3)`,
      [username, ip, failureReason],
    );
  }

  async recordSuccess(username: string, ip: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO sys_login_attempt (username, ip_address, success, failure_reason)
       VALUES ($1, $2::inet, true, NULL)`,
      [username, ip],
    );
    await this.clearFailures(username, ip);
  }

  async clearFailures(username: string, ip: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM sys_login_attempt
       WHERE username = $1 AND ip_address = $2::inet AND success = false`,
      [username, ip],
    );
  }

  async isLocked(username: string, ip: string): Promise<boolean> {
    const state = await this.evaluate(username, ip);
    return state.locked;
  }

  async lockRemainingSeconds(username: string, ip: string): Promise<number> {
    const state = await this.evaluate(username, ip);
    return state.remainingSeconds;
  }

  private async evaluate(username: string, ip: string): Promise<LockoutState> {
    const now = this.policy.now();
    const windowStart = now - this.policy.failureWindowMs;
    const result = await this.pool.query<AttemptSummary>(
      `SELECT count(*)::int AS failures, max(attempted_at) AS last_failure
       FROM sys_login_attempt
       WHERE username = $1
         AND ip_address = $2::inet
         AND success = false
         AND attempted_at > to_timestamp($3 / 1000.0)`,
      [username, ip, windowStart],
    );

    const summary = result.rows[0];
    const failures = Number(summary?.failures ?? 0);
    if (failures < this.policy.maxFailures || !summary?.last_failure) {
      return { locked: false, remainingSeconds: 0 };
    }

    const lastFailureAt = summary.last_failure.getTime();
    const unlockAt = lastFailureAt + this.policy.lockMs;
    if (now < unlockAt) {
      return { locked: true, remainingSeconds: Math.ceil((unlockAt - now) / 1000) };
    }

    await this.clearFailures(username, ip);
    return { locked: false, remainingSeconds: 0 };
  }
}
