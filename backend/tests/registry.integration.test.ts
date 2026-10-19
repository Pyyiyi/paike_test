import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { AuthConfig } from '../src/config/auth';
import { createClassQueryService, createSubjectQueryService } from '../src/modules/registry';
import { hashPassword } from '../src/shared/auth/password';
import { createAuthRuntime, type AuthRuntime } from '../src/shared/auth/runtime';
import { runMigrations } from '../src/shared/db/migrate';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const ARGON2 = { memoryCost: 8192, timeCost: 2, parallelism: 1 };
const PASSWORD = 'GoodPass1!';

let adminPool: Pool;
let pool: Pool;
let schema = '';
let runtime: AuthRuntime;
let app: ReturnType<typeof createApp>;
let passwordHash = '';
type Agent = ReturnType<typeof request.agent>;

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

async function getCsrf(agent: Agent): Promise<string> {
  const response = await agent.get('/api/v1/auth/csrf');
  expect(response.status).toBe(200);
  return response.body.data.csrfToken as string;
}

async function loginAsAdmin(): Promise<{ agent: Agent; csrf: string }> {
  const agent = request.agent(app);
  const csrf = await getCsrf(agent);
  const response = await agent
    .post('/api/v1/auth/login')
    .set('X-CSRF-Token', csrf)
    .send({ username: 'd02_admin', password: PASSWORD });
  expect(response.status).toBe(200);
  return { agent, csrf };
}

async function createGrade(agent: Agent, csrf: string, name = '七年级'): Promise<string> {
  const response = await agent
    .post('/api/v1/grades')
    .set('X-CSRF-Token', csrf)
    .send({ name });
  expect(response.status).toBe(201);
  return response.body.data.gradeId as string;
}

async function createSubject(agent: Agent, csrf: string, name = '语文'): Promise<string> {
  const response = await agent
    .post('/api/v1/subjects')
    .set('X-CSRF-Token', csrf)
    .send({ name });
  expect(response.status).toBe(201);
  return response.body.data.subjectId as string;
}

async function count(table: 'grade' | 'class' | 'subject'): Promise<number> {
  const result = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`);
  return result.rows[0]?.count ?? 0;
}

beforeAll(async () => {
  if (!testDatabaseUrl) {
    return;
  }
  adminPool = new Pool({ connectionString: testDatabaseUrl, connectionTimeoutMillis: 1_000 });
  await adminPool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public');
  schema = `d02_registry_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  pool = schemaPool(testDatabaseUrl, schema);
  await runMigrations({ pool, logger: { info: () => undefined } });

  // D03 尚未合入时，用最小任课表验证科目引用保护。
  await pool.query(`
    CREATE TABLE teaching_assignment (
      assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      teacher_id uuid NOT NULL,
      subject_id uuid NOT NULL REFERENCES subject(subject_id),
      class_id uuid NOT NULL REFERENCES class(class_id),
      venue_id uuid NULL,
      weekly_periods integer NOT NULL DEFAULT 1,
      deleted_at timestamptz NULL
    )
  `);

  await pool.query(`
    INSERT INTO sys_controlled_vocabulary (vocab_type, canonical_name, sort_order)
    VALUES ('GRADE', '七年级', 10), ('GRADE', '八年级', 20),
           ('SUBJECT', '语文', 10), ('SUBJECT', '数学', 20)
    ON CONFLICT (vocab_type, canonical_name) DO NOTHING;
    INSERT INTO sys_controlled_vocabulary (vocab_type, canonical_name, synonym_of)
    VALUES ('SUBJECT_SYNONYM', '语', '语文'),
           ('SUBJECT_SYNONYM', '语文课', '语文'),
           ('SUBJECT_SYNONYM', '数', '数学')
    ON CONFLICT (vocab_type, canonical_name) DO NOTHING;
  `);

  passwordHash = await hashPassword(PASSWORD, ARGON2);
  await pool.query(
    `INSERT INTO sys_user
       (username, display_name, password_hash, role, status, must_change_password)
     VALUES ('d02_admin', 'D02 管理员', $1, 'ADMIN', 'ENABLED', false)`,
    [passwordHash],
  );
  runtime = createAuthRuntime({ config: makeConfig(), pool });
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
  await pool.query(
    'DELETE FROM sys_outbox_event; DELETE FROM teaching_assignment; DELETE FROM class; DELETE FROM subject_period_rule; DELETE FROM subject; DELETE FROM grade;',
  );
  app = createApp({ auth: runtime });
});

describeWithDatabase('D02 registry grade, class, subject and period rules', () => {
  it('accepts only controlled grade names', async () => {
    const { agent, csrf } = await loginAsAdmin();

    const freeText = await agent.post('/api/v1/grades').set('X-CSRF-Token', csrf).send({ name: '高一年级' });
    expect(freeText.status).toBe(400);
    expect(freeText.body.error.code).toBe('VALIDATION_ERROR');
    expect(await count('grade')).toBe(0);

    const accepted = await agent.post('/api/v1/grades').set('X-CSRF-Token', csrf).send({ name: '七年级' });
    expect(accepted.status).toBe(201);
    expect(accepted.body.data).toMatchObject({ name: '七年级', classCount: 0, version: 1 });

    const vocabulary = await agent.get('/api/v1/controlled-vocabularies?type=GRADE');
    expect(vocabulary.status).toBe(200);
    expect(vocabulary.body.data.items.map((item: { name: string }) => item.name)).toContain('七年级');
  });

  it('rejects serialNo 0, 100 and 1.5 with no record, and generates the class name', async () => {
    const { agent, csrf } = await loginAsAdmin();
    const gradeId = await createGrade(agent, csrf);

    for (const serialNo of [0, 100, 1.5]) {
      const response = await agent
        .post('/api/v1/classes')
        .set('X-CSRF-Token', csrf)
        .send({ gradeId, serialNo, studentCount: 40 });
      expect(response.status).toBe(400);
      expect(response.body.error.details[0].message).toBe('须为 1-99 整数');
      expect(await count('class')).toBe(0);
    }

    const withName = await agent
      .post('/api/v1/classes')
      .set('X-CSRF-Token', csrf)
      .send({ gradeId, serialNo: 1, studentCount: 40, name: '自由文本班' });
    expect(withName.status).toBe(400);
    expect(await count('class')).toBe(0);

    const created = await agent
      .post('/api/v1/classes')
      .set('X-CSRF-Token', csrf)
      .send({ gradeId, serialNo: 1, studentCount: 40 });
    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe('七年级（1）班');

    const renamed = await agent
      .patch(`/api/v1/grades/${gradeId}`)
      .set('X-CSRF-Token', csrf)
      .send({ name: '八年级', version: 1 });
    expect(renamed.status).toBe(200);

    const classes = await agent.get(`/api/v1/classes?gradeId=${gradeId}`);
    expect(classes.body.data.items[0].name).toBe('八年级（1）班');
  });

  it('rejects subject synonyms before writing a record', async () => {
    const { agent, csrf } = await loginAsAdmin();
    const subjectId = await createSubject(agent, csrf, '语文');
    expect(subjectId).toBeTruthy();

    const synonym = await agent.post('/api/v1/subjects').set('X-CSRF-Token', csrf).send({ name: '语' });
    expect(synonym.status).toBe(409);
    expect(synonym.body.error.message).toContain('语文');
    expect(await count('subject')).toBe(1);

    const duplicate = await agent
      .post('/api/v1/subjects')
      .set('X-CSRF-Token', csrf)
      .send({ name: '语文' });
    expect(duplicate.status).toBe(409);
    expect(await count('subject')).toBe(1);
  });

  it('stores the three switches independently and defaults them to false', async () => {
    const { agent, csrf } = await loginAsAdmin();
    const subjectId = await createSubject(agent, csrf);

    const initial = await agent
      .put(`/api/v1/subjects/${subjectId}/period-rule`)
      .set('X-CSRF-Token', csrf)
      .send({ weeklyPeriods: 2 });
    expect(initial.status).toBe(200);
    expect(initial.body.data).toMatchObject({
      weeklyPeriods: 2,
      consecutivePreference: 'NONE',
      timeSlotPreference: 'NONE',
      periodBalanceEnabled: false,
      amPmBalanceEnabled: false,
      fixedSlotRuleEnabled: false,
      version: 1,
    });

    const periodOnly = await agent
      .put(`/api/v1/subjects/${subjectId}/period-rule`)
      .set('X-CSRF-Token', csrf)
      .send({ weeklyPeriods: 2, version: 1, periodBalanceEnabled: true });
    expect(periodOnly.body.data).toMatchObject({
      periodBalanceEnabled: true,
      amPmBalanceEnabled: false,
      fixedSlotRuleEnabled: false,
    });

    const amPmOnly = await agent
      .put(`/api/v1/subjects/${subjectId}/period-rule`)
      .set('X-CSRF-Token', csrf)
      .send({ weeklyPeriods: 2, version: 2, amPmBalanceEnabled: true });
    expect(amPmOnly.body.data).toMatchObject({
      periodBalanceEnabled: false,
      amPmBalanceEnabled: true,
      fixedSlotRuleEnabled: false,
    });

    const fixedOnly = await agent
      .put(`/api/v1/subjects/${subjectId}/period-rule`)
      .set('X-CSRF-Token', csrf)
      .send({ weeklyPeriods: 2, version: 3, fixedSlotRuleEnabled: true, timeSlotPreference: 'MORNING' });
    expect(fixedOnly.body.data).toMatchObject({
      periodBalanceEnabled: false,
      amPmBalanceEnabled: false,
      fixedSlotRuleEnabled: true,
    });
  });

  it('rejects forbidden-slot and fixed-band conflicts with a concrete explanation', async () => {
    const { agent, csrf } = await loginAsAdmin();
    const subjectId = await createSubject(agent, csrf);

    const missingBand = await agent
      .put(`/api/v1/subjects/${subjectId}/period-rule`)
      .set('X-CSRF-Token', csrf)
      .send({ weeklyPeriods: 2, fixedSlotRuleEnabled: true, timeSlotPreference: 'NONE' });
    expect(missingBand.status).toBe(409);
    expect(missingBand.body.error.code).toBe('STATE_CONFLICT');
    expect(missingBand.body.error.message).toContain('固定时段');
    expect(missingBand.body.error.details.length).toBeGreaterThan(0);

    const forbiddenSlots = [];
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      for (let period = 1; period <= 4; period += 1) {
        forbiddenSlots.push({ weekday, period });
      }
    }
    const bandConflict = await agent
      .put(`/api/v1/subjects/${subjectId}/period-rule`)
      .set('X-CSRF-Token', csrf)
      .send({ weeklyPeriods: 2, fixedSlotRuleEnabled: true, timeSlotPreference: 'MORNING', forbiddenSlots });
    expect(bandConflict.status).toBe(409);
    expect(bandConflict.body.error.code).toBe('STATE_CONFLICT');
    expect(bandConflict.body.error.message).toContain('禁排时段已覆盖固定时段');
    expect(bandConflict.body.error.details[0].field).toBe('forbiddenSlots');
  });

  it('protects referenced grades and subjects from deletion', async () => {
    const { agent, csrf } = await loginAsAdmin();
    const gradeId = await createGrade(agent, csrf);
    const classResponse = await agent
      .post('/api/v1/classes')
      .set('X-CSRF-Token', csrf)
      .send({ gradeId, serialNo: 1, studentCount: 40 });
    const classId = classResponse.body.data.classId as string;

    const gradeDelete = await agent.delete(`/api/v1/grades/${gradeId}`).set('X-CSRF-Token', csrf);
    expect(gradeDelete.status).toBe(409);
    expect(gradeDelete.body.error.code).toBe('REFERENCE_PROTECTED');
    const gradeStillThere = await agent.get('/api/v1/grades');
    expect(gradeStillThere.body.data.items.map((item: { gradeId: string }) => item.gradeId)).toContain(gradeId);

    const subjectId = await createSubject(agent, csrf, '数学');
    await pool.query(
      `INSERT INTO teaching_assignment (teacher_id, subject_id, class_id) VALUES ($1, $2, $3)`,
      [randomUUID(), subjectId, classId],
    );
    const subjectDelete = await agent.delete(`/api/v1/subjects/${subjectId}`).set('X-CSRF-Token', csrf);
    expect(subjectDelete.status).toBe(409);
    expect(subjectDelete.body.error.code).toBe('REFERENCE_PROTECTED');
    const subjects = await agent.get('/api/v1/subjects');
    expect(subjects.body.data.items.map((item: { subjectId: string }) => item.subjectId)).toContain(subjectId);
  });

  it('exports ClassQueryService and SubjectQueryService snapshots for D05', async () => {
    const { agent, csrf } = await loginAsAdmin();
    const gradeId = await createGrade(agent, csrf);
    const classResponse = await agent
      .post('/api/v1/classes')
      .set('X-CSRF-Token', csrf)
      .send({ gradeId, serialNo: 1, studentCount: 42 });
    const classId = classResponse.body.data.classId as string;
    const subjectId = await createSubject(agent, csrf, '语文');
    await agent
      .put(`/api/v1/subjects/${subjectId}/period-rule`)
      .set('X-CSRF-Token', csrf)
      .send({ weeklyPeriods: 4, consecutivePreference: 'PREFERRED' });

    const classQuery = createClassQueryService(pool);
    const classSnapshot = await classQuery.getClass(classId);
    expect(classSnapshot).toMatchObject({
      classId,
      gradeId,
      gradeName: '七年级',
      name: '七年级（1）班',
      serialNo: 1,
      studentCount: 42,
    });

    const subjectQuery = createSubjectQueryService(pool);
    const rules = await subjectQuery.listPeriodRules();
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      subjectId,
      weeklyPeriods: 4,
      consecutivePreference: 'PREFERRED',
      periodBalanceEnabled: false,
      amPmBalanceEnabled: false,
      fixedSlotRuleEnabled: false,
    });
    expect(await subjectQuery.getSubject(subjectId)).toEqual({ subjectId, name: '语文' });
  });
});
