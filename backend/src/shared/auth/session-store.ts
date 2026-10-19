import session from 'express-session';
import type { Pool } from 'pg';
import type { AuthConfig } from '../../config/auth';

interface SysSessionRow {
  sid: string;
  user_id: string | null;
  data: session.SessionData;
  expires_at: Date;
  revoked_at: Date | null;
  last_seen_at: Date;
}

type GetCallback = (err: unknown, value?: session.SessionData | null) => void;
type DoneCallback = (err?: unknown) => void;

export interface PgSessionStoreOptions {
  pool: Pool;
  config: AuthConfig;
  now?: () => number;
}

export class PgSessionStore extends session.Store {
  private readonly pool: Pool;
  private readonly config: AuthConfig;
  private readonly now: () => number;

  constructor(options: PgSessionStoreOptions) {
    super();
    this.pool = options.pool;
    this.config = options.config;
    this.now = options.now ?? Date.now;
  }

  get(sid: string, callback: GetCallback): void {
    void this.getAsync(sid).then((value) => callback(null, value)).catch(callback);
  }

  set(sid: string, value: session.SessionData, callback?: DoneCallback): void {
    void this.setAsync(sid, value).then(() => callback?.()).catch((error) => callback?.(error));
  }

  touch(sid: string, value: session.SessionData, callback?: DoneCallback): void {
    void this.touchAsync(sid, value).then(() => callback?.()).catch((error) => callback?.(error));
  }

  destroy(sid: string, callback?: DoneCallback): void {
    void this.destroyAsync(sid).then(() => callback?.()).catch((error) => callback?.(error));
  }

  private async getAsync(sid: string): Promise<session.SessionData | null> {
    const result = await this.pool.query<SysSessionRow>(
      `SELECT sid, user_id, data, expires_at, revoked_at, last_seen_at
       FROM sys_session
       WHERE sid = $1`,
      [sid],
    );
    const row = result.rows[0];
    if (!row || row.revoked_at) {
      return null;
    }

    const now = this.now();
    if (row.expires_at.getTime() <= now) {
      await this.revoke(sid);
      return null;
    }
    if (now - row.last_seen_at.getTime() > this.config.sessionIdleMs) {
      await this.revoke(sid);
      return null;
    }

    return row.data;
  }

  private async setAsync(sid: string, value: session.SessionData): Promise<void> {
    const now = this.now();
    const absoluteExpiresAt =
      typeof value.absoluteExpiresAt === 'number' && value.absoluteExpiresAt > now
        ? value.absoluteExpiresAt
        : now + this.config.sessionAbsoluteMs;
    const userId = typeof value.userId === 'string' ? value.userId : null;

    await this.pool.query(
      `INSERT INTO sys_session (sid, user_id, data, last_seen_at, expires_at)
       VALUES ($1, $2, $3::jsonb, now(), to_timestamp($4 / 1000.0))
       ON CONFLICT (sid) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             data = EXCLUDED.data,
             last_seen_at = now(),
             expires_at = EXCLUDED.expires_at`,
      [sid, userId, JSON.stringify(value), absoluteExpiresAt],
    );
  }

  private async touchAsync(sid: string, value: session.SessionData): Promise<void> {
    const absoluteExpiresAt =
      typeof value.absoluteExpiresAt === 'number' ? new Date(value.absoluteExpiresAt) : null;
    await this.pool.query(
      `UPDATE sys_session
       SET data = $2::jsonb,
           last_seen_at = now(),
           expires_at = COALESCE($3, expires_at)
       WHERE sid = $1 AND revoked_at IS NULL`,
      [sid, JSON.stringify(value), absoluteExpiresAt],
    );
  }

  private async destroyAsync(sid: string): Promise<void> {
    await this.revoke(sid);
  }

  private async revoke(sid: string): Promise<void> {
    await this.pool.query(
      `UPDATE sys_session
       SET revoked_at = now()
       WHERE sid = $1 AND revoked_at IS NULL`,
      [sid],
    );
  }
}
