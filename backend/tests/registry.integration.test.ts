import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { AuthConfig } from '../src/config/auth';
import { createSemesterLifecycleService } from '../src/modules/registry';
import { createSemesterQueryService } from '../src/modules/registry/semester/semester.query-service';
import { hashPassword } from '../src/shared/auth/password';
import { createAuthRuntime, type AuthRuntime } from '../src/shared/auth/runtime';
import { runMigrations } from '../src/shared/db/migrate';
import { withTransactionOn } from '../src/shared/db/transaction';
import { fixedClock } from '../src/shared/time/clock';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const ARGON2 = { memoryCost: 8_192, timeCost: 2, parallelism: 1 };
const PASSWORD = 'Registry1!';
const FIXED_NOW = '2026-10-01T00:00:00.000Z';
const clock = fixedClock(FIXED_NOW);

let adminPool: Pool;
let pool: Pool;
let schema = '';
let runtime: AuthRuntime;
let app: Awaited<ReturnType<typeof createApp>>;
let agent: ReturnType<typeof request.agent>;
let csrfToken = '';
let adminId = '';

function makeConfig(): AuthConfig {
  return {
    nodeEnv: 'test',
    sessionSecret: 'test-registry-session-secret-at-least-32-characters',
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

async function login(): Promise<void> {
  agent = request.agent(app);
  const csrf = await agent.get('/api/v1/auth/csrf');
  csrfToken = csrf.body.data.csrfToken as string;
  const response = await agent
    .post('/api/v1/auth/login')
    .set('X-CSRF-Token', csrfToken)
    .send({ username: 'admin', password: PASSWORD });
  expect(response.status).toBe(200);
}

function post(path: string, body: unknown) {
  return agent.post(path).set('X-CSRF-Token', csrfToken).send(body as object);
}

function patch(path: string, body: unknown) {
  return agent.patch(path).set('X-CSRF-Token', csrfToken).send(body as object);
}

function del(path: string) {
  return agent.delete(path).set('X-CSRF-Token', csrfToken);
}

const TEMPLATE_V1 = {
  name: 'D01-基准模板',
  openWeekdays: [1, 2, 3],
  periods: [
    { periodNo: 1, startTime: '08:00', endTime: '08:45', label: '第 1 节' },
    { periodNo: 2, startTime: '08:55', endTime: '09:40', label: '第 2 节' },
  ],
};

const SEMESTER_IN_PROGRESS = {
  name: '2026 秋季学期',
  academicYear: '2026-2027',
  term: 'FALL',
  startDate: '2026-09-01',
  endDate: '2027-01-31',
};

async function createTemplate(overrides: Record<string, unknown> = {}) {
  const response = await post('/api/v1/schedule-templates', { ...TEMPLATE_V1, ...overrides });
  expect(response.status).toBe(201);
  return response.body.data as {
    templateId: string;
    latestVersionNo: number;
    latestVersion: { versionId: string; versionNo: number; periods: Array<{ periodNo: number; startTime: string; endTime: string }> };
    version: number;
  };
}

async function createSemester(versionId: string, overrides: Record<string, unknown> = {}) {
  const response = await post('/api/v1/semesters', {
    ...SEMESTER_IN_PROGRESS,
    scheduleTemplateVersionId: versionId,
    ...overrides,
  });
  return response;
}

beforeAll(async () => {
  if (!testDatabaseUrl) {
    return;
  }
  adminPool = new Pool({ connectionString: testDatabaseUrl, connectionTimeoutMillis: 1_000 });
  schema = `d01_registry_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  pool = schemaPool(testDatabaseUrl, schema);
  await runMigrations({ pool, logger: { info: () => undefined } });

  const passwordHash = await hashPassword(PASSWORD, ARGON2);
  adminId = randomUUID();
  await pool.query(
    `INSERT INTO sys_user
       (user_id, username, display_name, password_hash, role, status, must_change_password)
     VALUES ($1, 'admin', '教务管理员', $2, 'ADMIN', 'ENABLED', false)`,
    [adminId, passwordHash],
  );

  runtime = createAuthRuntime({ config: makeConfig(), pool });
  app = await createApp({ auth: runtime, clock });
  await login();
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
    'TRUNCATE calendar_exception, semester, schedule_template_version, schedule_template, sys_outbox_event CASCADE',
  );
});

describeWithDatabase('D01 学期 / 作息模板 / 校历', () => {
  it('TC-BD-003 新增学期未选模板被拒绝且不落库', async () => {
    const before = await pool.query('SELECT count(*)::int AS count FROM semester');
    const response = await post('/api/v1/semesters', SEMESTER_IN_PROGRESS);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(
      response.body.error.details.some(
        (detail: { field?: string; message: string }) =>
          detail.field === 'scheduleTemplateVersionId' && detail.message.includes('请选择作息模板'),
      ),
    ).toBe(true);
    const after = await pool.query('SELECT count(*)::int AS count FROM semester');
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it('TC-BD-006/007 模板 v1→v2 历史版本逐字段不变，学期仍钉扎 v1', async () => {
    const template = await createTemplate();
    const v1Id = template.latestVersion.versionId;
    const semesterResponse = await createSemester(v1Id);
    expect(semesterResponse.status).toBe(201);
    const semesterId = semesterResponse.body.data.semesterId as string;

    const v1Before = await pool.query('SELECT * FROM schedule_template_version WHERE version_id = $1', [v1Id]);
    expect(v1Before.rowCount).toBe(1);

    const v2Response = await post(`/api/v1/schedule-templates/${template.templateId}/versions`, {
      baseVersionId: v1Id,
      openWeekdays: [1, 2, 3, 4],
      periods: [
        { periodNo: 1, startTime: '08:10', endTime: '08:55', label: '第 1 节（新）' },
        { periodNo: 2, startTime: '09:05', endTime: '09:50', label: '第 2 节（新）' },
        { periodNo: 3, startTime: '10:00', endTime: '10:45', label: '第 3 节（新）' },
      ],
    });
    expect(v2Response.status).toBe(201);
    expect(v2Response.body.data.versionNo).toBe(2);

    const v1After = await pool.query('SELECT * FROM schedule_template_version WHERE version_id = $1', [v1Id]);
    expect(v1After.rows[0]).toEqual(v1Before.rows[0]);

    const pinned = await pool.query(
      'SELECT schedule_template_version_id FROM semester WHERE semester_id = $1',
      [semesterId],
    );
    expect(pinned.rows[0].schedule_template_version_id).toBe(v1Id);

    const v1Detail = await agent.get(`/api/v1/schedule-templates/versions/${v1Id}`);
    expect(v1Detail.status).toBe(200);
    expect(v1Detail.body.data.versionNo).toBe(1);
    expect(v1Detail.body.data.openWeekdays).toEqual([1, 2, 3]);
    expect(v1Detail.body.data.periods[0].startTime).toBe('08:00');

    const v2Detail = await agent.get(`/api/v1/schedule-templates/versions/${v2Response.body.data.versionId}`);
    expect(v2Detail.status).toBe(200);
    expect(v2Detail.body.data.periods[0].startTime).toBe('08:10');
  });

  it('TC-BD-008/A-08 非法节次返回 400 与字段级错误且不新增版本', async () => {
    const template = await createTemplate();
    const versionCountBefore = await pool.query(
      'SELECT count(*)::int AS count FROM schedule_template_version WHERE template_id = $1',
      [template.templateId],
    );

    const gap = await post(`/api/v1/schedule-templates/${template.templateId}/versions`, {
      openWeekdays: [1],
      periods: [
        { periodNo: 1, startTime: '08:00', endTime: '08:45' },
        { periodNo: 3, startTime: '09:00', endTime: '09:45' },
      ],
    });
    expect(gap.status).toBe(400);
    expect(
      gap.body.error.details.some(
        (detail: { field?: string; message: string }) =>
          detail.field === 'periods' && detail.message.includes('连续'),
      ),
    ).toBe(true);

    const reversed = await post(`/api/v1/schedule-templates/${template.templateId}/versions`, {
      openWeekdays: [1],
      periods: [{ periodNo: 1, startTime: '09:00', endTime: '08:45' }],
    });
    expect(reversed.status).toBe(400);
    expect(
      reversed.body.error.details.some(
        (detail: { field?: string; message: string }) =>
          detail.field === 'periods.0.endTime' && detail.message.includes('晚于开始时间'),
      ),
    ).toBe(true);

    const versionCountAfter = await pool.query(
      'SELECT count(*)::int AS count FROM schedule_template_version WHERE template_id = $1',
      [template.templateId],
    );
    expect(versionCountAfter.rows[0].count).toBe(versionCountBefore.rows[0].count);
  });

  it('TC-BD-002/005 状态实时推导；存档后 PATCH 返回 409 STATE_CONFLICT', async () => {
    const template = await createTemplate();
    const inProgress = await createSemester(template.latestVersion.versionId);
    expect(inProgress.status).toBe(201);
    const inProgressId = inProgress.body.data.semesterId as string;

    const future = await createSemester(template.latestVersion.versionId, {
      name: '2027 春季学期',
      term: 'SPRING',
      startDate: '2027-02-01',
      endDate: '2027-06-30',
    });
    expect(future.status).toBe(201);
    const ended = await createSemester(template.latestVersion.versionId, {
      name: '2025 秋季学期',
      startDate: '2025-09-01',
      endDate: '2026-01-31',
    });
    expect(ended.status).toBe(201);

    const list = await agent.get('/api/v1/semesters');
    expect(list.status).toBe(200);
    const byName = Object.fromEntries(
      (list.body.data.items as Array<{ name: string; status: string }>).map((item) => [item.name, item.status]),
    );
    expect(byName['2026 秋季学期']).toBe('IN_PROGRESS');
    expect(byName['2027 春季学期']).toBe('NOT_STARTED');
    expect(byName['2025 秋季学期']).toBe('ENDED');

    const lifecycle = createSemesterLifecycleService(clock);
    await withTransactionOn(pool, (tx) =>
      lifecycle.archive(tx, inProgressId, { userId: adminId, username: 'admin', displayName: '教务管理员' }),
    );

    const archivedList = await agent.get('/api/v1/semesters?includeArchived=true');
    const archived = (archivedList.body.data.items as Array<{ semesterId: string; status: string; version: number }>).find(
      (item) => item.semesterId === inProgressId,
    );
    expect(archived?.status).toBe('ARCHIVED');
    expect(archived?.version).toBe(2);

    const patchResponse = await patch(`/api/v1/semesters/${inProgressId}`, {
      name: '不允许修改',
      version: archived?.version,
    });
    expect(patchResponse.status).toBe(409);
    expect(patchResponse.body.error.code).toBe('STATE_CONFLICT');

    const calendarWrite = await post(`/api/v1/semesters/${inProgressId}/calendar-exceptions`, {
      type: 'STOP',
      startDate: '2026-10-05',
      endDate: '2026-10-06',
    });
    expect(calendarWrite.status).toBe(409);
    expect(calendarWrite.body.error.code).toBe('STATE_CONFLICT');

    const viewArchived = await agent.get('/api/v1/semesters?includeArchived=true');
    expect(viewArchived.status).toBe(200);
  });

  it('TC-BD-007 删除被学期引用的模板返回 409 REFERENCE_PROTECTED 且数据不变', async () => {
    const template = await createTemplate();
    const semester = await createSemester(template.latestVersion.versionId);
    expect(semester.status).toBe(201);

    const response = await del(`/api/v1/schedule-templates/${template.templateId}`);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('REFERENCE_PROTECTED');

    const templateRow = await pool.query('SELECT deleted_at FROM schedule_template WHERE template_id = $1', [
      template.templateId,
    ]);
    expect(templateRow.rows[0].deleted_at).toBeNull();

    const semesterRow = await pool.query('SELECT deleted_at FROM semester WHERE semester_id = $1', [
      semester.body.data.semesterId,
    ]);
    expect(semesterRow.rows[0].deleted_at).toBeNull();
  });

  it('删除被课表方案引用的学期返回 409 REFERENCE_PROTECTED，移除引用后可删除', async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS timetable_plan (
        plan_id uuid PRIMARY KEY,
        semester_id uuid NOT NULL,
        schedule_template_version_id uuid NULL,
        status text NOT NULL,
        deleted_at timestamptz NULL
      )
    `);

    const template = await createTemplate({ name: 'D01-可删除模板' });
    const semester = await createSemester(template.latestVersion.versionId, { name: '待删除学期' });
    expect(semester.status).toBe(201);
    const semesterId = semester.body.data.semesterId as string;

    const planId = randomUUID();
    await pool.query(
      'INSERT INTO timetable_plan (plan_id, semester_id, status) VALUES ($1, $2, $3)',
      [planId, semesterId, 'DRAFT'],
    );

    const blocked = await del(`/api/v1/semesters/${semesterId}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('REFERENCE_PROTECTED');

    await pool.query('DELETE FROM timetable_plan WHERE plan_id = $1', [planId]);
    const deleted = await del(`/api/v1/semesters/${semesterId}`);
    expect(deleted.status).toBe(204);

    const row = await pool.query('SELECT deleted_at FROM semester WHERE semester_id = $1', [semesterId]);
    expect(row.rows[0].deleted_at).not.toBeNull();

    const templateDelete = await del(`/api/v1/schedule-templates/${template.templateId}`);
    expect(templateDelete.status).toBe(204);
  });

  it('TC-AP-012/H-05 停课周占用周序号且奇偶继续推进', async () => {
    const template = await createTemplate({ name: 'D01-校历模板' });
    const semester = await createSemester(template.latestVersion.versionId, {
      name: '三周校历学期',
      startDate: '2026-09-07',
      endDate: '2026-09-27',
    });
    expect(semester.status).toBe(201);
    const semesterId = semester.body.data.semesterId as string;

    const stop = await post(`/api/v1/semesters/${semesterId}/calendar-exceptions`, {
      type: 'STOP',
      startDate: '2026-09-14',
      endDate: '2026-09-18',
      note: '校运会停课',
    });
    expect(stop.status).toBe(201);
    expect(stop.body.data.type).toBe('STOP');

    const missingWeekday = await post(`/api/v1/semesters/${semesterId}/calendar-exceptions`, {
      type: 'MAKEUP',
      startDate: '2026-09-19',
      endDate: '2026-09-19',
    });
    expect(missingWeekday.status).toBe(400);
    expect(
      missingWeekday.body.error.details.some(
        (detail: { field?: string; message: string }) =>
          detail.field === 'makeupWeekday' && detail.message.includes('补课星期'),
      ),
    ).toBe(true);

    const makeup = await post(`/api/v1/semesters/${semesterId}/calendar-exceptions`, {
      type: 'MAKEUP',
      startDate: '2026-09-19',
      endDate: '2026-09-19',
      makeupWeekday: 6,
    });
    expect(makeup.status).toBe(201);
    expect(makeup.body.data.makeupWeekday).toBe(6);

    const list = await agent.get(`/api/v1/semesters/${semesterId}/calendar-exceptions`);
    expect(list.status).toBe(200);
    expect(list.body.data.items).toHaveLength(2);

    const query = createSemesterQueryService(pool, clock);
    const weeks = await query.getAcademicCalendar(semesterId);
    expect(weeks).toHaveLength(3);
    expect(weeks.map((week) => week.parity)).toEqual(['ODD', 'EVEN', 'ODD']);
    expect(weeks[1]?.stopped).toBe(true);
    expect(weeks[1]?.weekIndex).toBe(2);
    expect(weeks[2]?.weekIndex).toBe(3);
    expect(weeks[2]?.stopped).toBe(false);

    const deleted = await del(`/api/v1/semesters/${semesterId}/calendar-exceptions/${stop.body.data.exceptionId}`);
    expect(deleted.status).toBe(204);
    const afterDelete = await agent.get(`/api/v1/semesters/${semesterId}/calendar-exceptions`);
    expect(afterDelete.body.data.items).toHaveLength(1);
  });
});
