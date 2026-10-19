import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { AuthConfig } from '../src/config/auth';
import { hashPassword, verifyPassword } from '../src/shared/auth/password';
import { createAuthRuntime, type AuthRuntime } from '../src/shared/auth/runtime';
import { runMigrations } from '../src/shared/db/migrate';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const ARGON2 = { memoryCost: 8192, timeCost: 2, parallelism: 1 };
const GOOD_PASSWORD = 'GoodPass1!';
const NEW_PASSWORD = 'NewPass2!';

let adminPool: Pool;
let pool: Pool;
let schema = '';
let passwordHash = '';
let runtime: AuthRuntime;
let nowMs = Date.now();
let app: ReturnType<typeof createApp>;
let userCounter = 0;

function makeConfig(): AuthConfig {
  return {
    nodeEnv: 'test',
    sessionSecret: 'test-session-secret-at-least-32-characters-long',
    sessionCookieName: 'paike.sid',
    sessionIdleMs: 8 * 60 * 60 * 1000,
    sessionAbsoluteMs: 7 * 24 * 60 * 60 * 1000,
    passwordMinLength: 8,
    passwordRequiredClasses: 3,
    loginMaxFailures: 5,
    loginFailureWindowMs: 15 * 60 * 1000,
    loginLockMs: 15 * 60 * 1000,
    argon2MemoryCost: ARGON2.memoryCost,
    argon2TimeCost: ARGON2.timeCost,
    argon2Parallelism: ARGON2.parallelism,
    secureCookies: false,
  };
}

function schemaPool(databaseUrl: string, schemaName: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 4,
    connectionTimeoutMillis: 1_000,
    options: `-c search_path=${schemaName},public`,
  });
}

function setCookies(headers: unknown): string[] {
  const record = headers as Record<string, unknown>;
  const raw = record['set-cookie'];
  if (Array.isArray(raw)) {
    return raw as string[];
  }
  if (typeof raw === 'string') {
    return [raw];
  }
  return [];
}

type Agent = ReturnType<typeof request.agent>;

async function getCsrf(agent: Agent): Promise<string> {
  const response = await agent.get('/api/v1/auth/csrf');
  expect(response.status).toBe(200);
  return response.body.data.csrfToken as string;
}

async function createUser(
  options: {
    role?: 'ADMIN' | 'TEACHER';
    mustChangePassword?: boolean;
    status?: 'ENABLED' | 'DISABLED';
  } = {},
): Promise<{ userId: string; username: string }> {
  userCounter += 1;
  const username = `p002_${userCounter}`;
  const userId = randomUUID();
  const role = options.role ?? 'ADMIN';
  const teacherId = role === 'TEACHER' ? randomUUID() : null;
  await pool.query(
    `INSERT INTO sys_user
       (user_id, username, display_name, password_hash, role, status, must_change_password, teacher_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      userId,
      username,
      `用户${userCounter}`,
      passwordHash,
      role,
      options.status ?? 'ENABLED',
      options.mustChangePassword ?? false,
      teacherId,
    ],
  );
  return { userId, username };
}

async function login(agent: Agent, token: string, username: string, password: string) {
  return agent
    .post('/api/v1/auth/login')
    .set('X-CSRF-Token', token)
    .send({ username, password });
}

beforeAll(async () => {
  if (!testDatabaseUrl) {
    return;
  }
  adminPool = new Pool({ connectionString: testDatabaseUrl, connectionTimeoutMillis: 1_000 });
  schema = `p002_auth_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  pool = schemaPool(testDatabaseUrl, schema);
  await runMigrations({ pool, logger: { info: () => undefined } });
  passwordHash = await hashPassword(GOOD_PASSWORD, ARGON2);
  nowMs = Date.now();
  runtime = createAuthRuntime({ config: makeConfig(), pool, now: () => nowMs });
  app = createApp({ auth: runtime });
});

afterAll(async () => {
  if (!testDatabaseUrl) {
    return;
  }
  await pool?.end();
  if (schema) {
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  await adminPool?.end();
});

beforeEach(async () => {
  if (!testDatabaseUrl) {
    return;
  }
  nowMs = Date.now();
  await pool.query('DELETE FROM sys_login_attempt');
  await pool.query('UPDATE sys_session SET revoked_at = now() WHERE revoked_at IS NULL');
  app = createApp({ auth: runtime });
});

describeWithDatabase('auth and session security', () => {
  it('logs in with correct credentials and creates a server session', async () => {
    const { userId, username } = await createUser({ mustChangePassword: true });
    const agent = request.agent(app);
    const token = await getCsrf(agent);

    const response = await login(agent, token, username, GOOD_PASSWORD);
    expect(response.status).toBe(200);
    expect(response.body.data.user).toMatchObject({
      username,
      role: 'ADMIN',
      teacherId: null,
      mustChangePassword: true,
    });

    const sessionCookie = setCookies(response.headers)
      .find((cookie) => cookie.startsWith('paike.sid='));
    expect(sessionCookie).toBeTruthy();
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');

    const expiresPart = (sessionCookie as string)
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('Expires='));
    expect(expiresPart).toBeTruthy();
    const idleHours = (new Date((expiresPart as string).slice('Expires='.length)).getTime() - Date.now()) / 3_600_000;
    expect(idleHours).toBeGreaterThan(7.5);
    expect(idleHours).toBeLessThan(8.5);

    const sessions = await pool.query<{ expires_at: Date; revoked_at: Date | null }>(
      'SELECT expires_at, revoked_at FROM sys_session WHERE user_id = $1',
      [userId],
    );
    expect(sessions.rowCount).toBe(1);
    expect(sessions.rows[0]?.revoked_at).toBeNull();
    const absoluteDays =
      ((sessions.rows[0] as { expires_at: Date }).expires_at.getTime() - Date.now()) / 86_400_000;
    expect(absoluteDays).toBeGreaterThan(6.9);
    expect(absoluteDays).toBeLessThan(7.1);
  });

  it('returns a unified credential error for wrong passwords and unknown users', async () => {
    const { username } = await createUser();
    const agent = request.agent(app);
    const token = await getCsrf(agent);

    const wrongPassword = await login(agent, token, username, 'WrongPass1!');
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body.error).toMatchObject({
      code: 'UNAUTHENTICATED',
      message: '用户名或密码错误',
    });

    const unknownUser = await login(agent, token, 'p002_missing', 'WrongPass1!');
    expect(unknownUser.status).toBe(401);
    expect(unknownUser.body.error).toMatchObject({
      code: 'UNAUTHENTICATED',
      message: '用户名或密码错误',
    });
    expect(unknownUser.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it('locks after five failures and unlocks after the lock window', async () => {
    const { username } = await createUser();
    const agent = request.agent(app);
    const token = await getCsrf(agent);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await login(agent, token, username, 'WrongPass1!');
      expect(response.status).toBe(401);
    }

    const locked = await login(agent, token, username, 'WrongPass1!');
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');

    nowMs += 16 * 60 * 1000;
    const unlocked = await login(agent, token, username, GOOD_PASSWORD);
    expect(unlocked.status).toBe(200);

    const attempts = await pool.query<{ failures: number; successes: number }>(
      `SELECT
         count(*) FILTER (WHERE success = false)::int AS failures,
         count(*) FILTER (WHERE success = true)::int AS successes
       FROM sys_login_attempt
       WHERE username = $1`,
      [username],
    );
    expect(attempts.rows[0]?.failures).toBe(0);
    expect(attempts.rows[0]?.successes).toBe(1);
  });

  it('invalidates the session immediately on logout', async () => {
    const { userId, username } = await createUser();
    const agent = request.agent(app);
    const token = await getCsrf(agent);

    const loggedIn = await login(agent, token, username, GOOD_PASSWORD);
    expect(loggedIn.status).toBe(200);
    const sessionCookie = setCookies(loggedIn.headers)
      .find((cookie) => cookie.startsWith('paike.sid='))
      ?.split(';')[0] ?? '';
    expect(sessionCookie).not.toBe('');

    const logout = await agent.post('/api/v1/auth/logout').set('X-CSRF-Token', token);
    expect(logout.status).toBe(200);

    const reused = await request(app).get('/api/v1/auth/me').set('Cookie', sessionCookie);
    expect(reused.status).toBe(401);
    expect(reused.body.error.code).toBe('UNAUTHENTICATED');

    const sessions = await pool.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM sys_session WHERE user_id = $1',
      [userId],
    );
    expect(sessions.rows.every((row) => row.revoked_at !== null)).toBe(true);
  });

  it('enforces CSRF double-submit on non-GET requests', async () => {
    const { username } = await createUser();
    const agent = request.agent(app);
    const token = await getCsrf(agent);

    const missing = await agent
      .post('/api/v1/auth/login')
      .send({ username, password: GOOD_PASSWORD });
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe('FORBIDDEN');

    const wrong = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', 'not-the-token')
      .send({ username, password: GOOD_PASSWORD });
    expect(wrong.status).toBe(403);

    const accepted = await login(agent, token, username, GOOD_PASSWORD);
    expect(accepted.status).toBe(200);
  });

  it('blocks a must-change-password user until the password is changed', async () => {
    const { userId, username } = await createUser({ mustChangePassword: true });
    const agent = request.agent(app);
    const token = await getCsrf(agent);

    const loggedIn = await login(agent, token, username, GOOD_PASSWORD);
    expect(loggedIn.status).toBe(200);
    expect(loggedIn.body.data.user.mustChangePassword).toBe(true);

    const blocked = await agent.get('/api/v1/semesters');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('STATE_CONFLICT');

    const blockedMe = await agent.get('/api/v1/auth/me');
    expect(blockedMe.status).toBe(403);
    expect(blockedMe.body.error.code).toBe('STATE_CONFLICT');

    const changed = await agent
      .post('/api/v1/auth/change-password')
      .set('X-CSRF-Token', token)
      .send({ currentPassword: GOOD_PASSWORD, newPassword: NEW_PASSWORD });
    expect(changed.status).toBe(200);

    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.mustChangePassword).toBe(false);

    const unblocked = await agent.get('/api/v1/semesters');
    expect(unblocked.status).toBe(404);

    const stored = await pool.query<{ password_hash: string; must_change_password: boolean }>(
      'SELECT password_hash, must_change_password FROM sys_user WHERE user_id = $1',
      [userId],
    );
    expect(stored.rows[0]?.must_change_password).toBe(false);
    expect(stored.rows[0]?.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(stored.rows[0]?.password_hash ?? '', NEW_PASSWORD)).toBe(true);
  });

  it('rejects a disabled account on the next request', async () => {
    const { userId, username } = await createUser();
    const agent = request.agent(app);
    const token = await getCsrf(agent);

    const loggedIn = await login(agent, token, username, GOOD_PASSWORD);
    expect(loggedIn.status).toBe(200);

    await pool.query("UPDATE sys_user SET status = 'DISABLED' WHERE user_id = $1", [userId]);

    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('UNAUTHENTICATED');

    const sessions = await pool.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM sys_session WHERE user_id = $1',
      [userId],
    );
    expect(sessions.rows.every((row) => row.revoked_at !== null)).toBe(true);
  });

  it('expires idle sessions after the configured idle window', async () => {
    const { userId, username } = await createUser();
    const agent = request.agent(app);
    const token = await getCsrf(agent);

    const loggedIn = await login(agent, token, username, GOOD_PASSWORD);
    expect(loggedIn.status).toBe(200);

    nowMs += 9 * 60 * 60 * 1000;
    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(401);

    const sessions = await pool.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM sys_session WHERE user_id = $1',
      [userId],
    );
    expect(sessions.rows.every((row) => row.revoked_at !== null)).toBe(true);
  });

  it('logs in a teacher account with the TEACHER role and forced password change', async () => {
    const { username } = await createUser({ role: 'TEACHER', mustChangePassword: true });
    const agent = request.agent(app);
    const token = await getCsrf(agent);

    const response = await login(agent, token, username, GOOD_PASSWORD);
    expect(response.status).toBe(200);
    expect(response.body.data.user).toMatchObject({
      role: 'TEACHER',
      mustChangePassword: true,
    });
    expect(response.body.data.user.teacherId).toBeTruthy();
  });

});
