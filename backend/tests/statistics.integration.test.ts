import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStatisticsRouter } from '../src/modules/statistics/statistics.router';
import { errorHandler } from '../src/shared/errors/error-handler';
import { requestIdMiddleware } from '../src/shared/http/request-id';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

let adminPool: Pool;
let pool: Pool;
let schema = '';
let app: ReturnType<typeof express>;
let publishedSemesterId = '';
let draftSemesterId = '';
let teacherOneId = '';
let teacherTwoId = '';

function schemaPool(databaseUrl: string, schemaName: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 4,
    connectionTimeoutMillis: 1_000,
    options: `-c search_path=${schemaName},public`,
  });
}

function createTestApp(): express.Express {
  const instance = express();
  instance.use(requestIdMiddleware);
  instance.use(express.json());
  instance.use((req, _res, next) => {
    req.currentUser = {
      userId: randomUUID(),
      username: 'd11_admin',
      displayName: 'D11 测试管理员',
      role: 'ADMIN',
      teacherId: null,
      mustChangePassword: false,
    };
    next();
  });
  instance.use('/api/v1', createStatisticsRouter(pool));
  instance.use(errorHandler);
  return instance;
}

async function insertFixtures(): Promise<void> {
  teacherOneId = randomUUID();
  teacherTwoId = randomUUID();
  const subjectId = randomUUID();
  const secondSubjectId = randomUUID();
  const templateId = randomUUID();
  const versionId = randomUUID();
  const publishedPlanId = randomUUID();
  const draftPlanId = randomUUID();
  publishedSemesterId = randomUUID();
  draftSemesterId = randomUUID();
  const gradeSevenId = randomUUID();
  const gradeEightId = randomUUID();
  const classSevenId = randomUUID();
  const classEightId = randomUUID();

  await pool.query(
    `INSERT INTO teacher (teacher_id, employee_no, name, status)
     VALUES ($1, 'T1101', '张老师', 'ACTIVE'),
            ($2, 'T1102', '李老师', 'ACTIVE')`,
    [teacherOneId, teacherTwoId],
  );
  await pool.query(
    `INSERT INTO subject (subject_id, name)
     VALUES ($1, '数学'), ($2, '语文')`,
    [subjectId, secondSubjectId],
  );
  await pool.query(
    `INSERT INTO grade (grade_id, name, sort_order)
     VALUES ($1, '七年级', 7), ($2, '八年级', 8)`,
    [gradeSevenId, gradeEightId],
  );
  await pool.query(
    `INSERT INTO class (class_id, grade_id, name, serial_no, student_count)
     VALUES ($1, $3, '七年级（1）班', 1, 40),
            ($2, $4, '八年级（1）班', 1, 42)`,
    [classSevenId, classEightId, gradeSevenId, gradeEightId],
  );
  await pool.query(`INSERT INTO schedule_template (template_id, name) VALUES ($1, 'D11 模板')`, [templateId]);
  await pool.query(
    `INSERT INTO schedule_template_version
       (version_id, template_id, version_no, open_weekdays, periods)
     VALUES ($1, $2, 1, ARRAY[1,2,3,4,5]::smallint[],
             '[{"periodNo":1,"startTime":"08:00","endTime":"08:45"}]'::jsonb)`,
    [versionId, templateId],
  );
  await pool.query(
    `INSERT INTO semester
       (semester_id, name, academic_year, term, start_date, end_date, status, schedule_template_version_id)
     VALUES ($1, '已发布学期', '2026-2027', 'FALL', '2026-09-01', '2026-09-27', 'IN_PROGRESS', $3),
            ($2, '草稿学期', '2026-2027', 'FALL', '2026-09-01', '2026-09-27', 'IN_PROGRESS', $3)`,
    [publishedSemesterId, draftSemesterId, versionId],
  );
  await pool.query(
    `INSERT INTO timetable_plan (plan_id, semester_id, name, status, schedule_template_version_id, published_at)
     VALUES ($1, $2, '正式方案', 'PUBLISHED', $3, now()),
            ($4, $5, '草稿方案', 'DRAFT', $3, NULL)`,
    [publishedPlanId, publishedSemesterId, versionId, draftPlanId, draftSemesterId],
  );

  const combinedLessonId = randomUUID();
  const blockFirstLessonId = randomUUID();
  const blockSecondLessonId = randomUUID();
  const regularLessonId = randomUUID();
  const combinedUnitId = randomUUID();
  const blockUnitId = randomUUID();
  const regularUnitId = randomUUID();
  await pool.query(
    `INSERT INTO lesson
       (lesson_id, plan_id, weekday, period, week_parity, subject_id, teacher_id, unit_type, unit_id)
     VALUES ($1, $2, 1, 1, 'ALL', $5, $6, 'COMBINED_CLASS', $7),
            ($3, $2, 2, 1, 'ALL', $5, $6, 'ASSIGNMENT', $8),
            ($4, $2, 2, 2, 'ALL', $5, $6, 'ASSIGNMENT', $8),
            ($9, $2, 3, 1, 'ALL', $5, $6, 'ASSIGNMENT', $10)`,
    [
      combinedLessonId,
      publishedPlanId,
      blockFirstLessonId,
      blockSecondLessonId,
      subjectId,
      teacherOneId,
      combinedUnitId,
      blockUnitId,
      regularLessonId,
      regularUnitId,
    ],
  );
  await pool.query(
    `INSERT INTO lesson_class (lesson_id, class_id) VALUES ($1, $2), ($1, $3)`,
    [combinedLessonId, classSevenId, classEightId],
  );

  const allUnit = randomUUID();
  const oddUnit = randomUUID();
  const evenUnit = randomUUID();
  await pool.query(
    `INSERT INTO lesson
       (lesson_id, plan_id, weekday, period, week_parity, subject_id, teacher_id, unit_type, unit_id)
     VALUES ($1, $2, 4, 1, 'ALL', $5, $6, 'ASSIGNMENT', $7),
            ($3, $2, 4, 3, 'ODD', $5, $6, 'ASSIGNMENT', $8),
            ($4, $2, 4, 5, 'EVEN', $5, $6, 'ASSIGNMENT', $9)`,
    [randomUUID(), publishedPlanId, randomUUID(), randomUUID(), secondSubjectId, teacherTwoId, allUnit, oddUnit, evenUnit],
  );
}

beforeAll(async () => {
  if (!testDatabaseUrl) {
    return;
  }
  adminPool = new Pool({ connectionString: testDatabaseUrl, connectionTimeoutMillis: 1_000 });
  schema = `d11_statistics_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  pool = schemaPool(testDatabaseUrl, schema);
  const contractSql = await readFile(path.resolve(process.cwd(), 'contracts/schema.sql'), 'utf8');
  await pool.query(contractSql);
  await insertFixtures();
  app = createTestApp();
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

describeWithDatabase('D11 workload statistics integration', () => {
  it('counts combined=1, consecutive=2, regular=1, total=4 from the PUBLISHED plan', async () => {
    const response = await request(app)
      .get('/api/v1/statistics/workload')
      .query({ semesterId: publishedSemesterId, scope: 'WEEK', weekIndex: 1 });

    expect(response.status).toBe(200);
    expect(response.body.data.items).toContainEqual({
      teacherId: teacherOneId,
      teacherName: '张老师',
      regular: 1,
      consecutive: 2,
      combined: 1,
      overtime: 0,
      total: 4,
    });
  });

  it('applies ALL + ODD in week 1 and ALL + EVEN in week 2', async () => {
    const weekOne = await request(app)
      .get('/api/v1/statistics/workload')
      .query({ semesterId: publishedSemesterId, scope: 'WEEK', weekIndex: 1 });
    const weekTwo = await request(app)
      .get('/api/v1/statistics/workload')
      .query({ semesterId: publishedSemesterId, scope: 'WEEK', weekIndex: 2 });

    const weekOneTeacher = weekOne.body.data.items.find((row: { teacherId: string }) => row.teacherId === teacherTwoId);
    const weekTwoTeacher = weekTwo.body.data.items.find((row: { teacherId: string }) => row.teacherId === teacherTwoId);
    expect(weekOneTeacher).toMatchObject({ regular: 2, total: 2 });
    expect(weekTwoTeacher).toMatchObject({ regular: 2, total: 2 });
  });

  it('accumulates all teaching weeks for SEMESTER scope', async () => {
    const response = await request(app)
      .get('/api/v1/statistics/workload')
      .query({ semesterId: publishedSemesterId, scope: 'SEMESTER' });

    const teacher = response.body.data.items.find((row: { teacherId: string }) => row.teacherId === teacherTwoId);
    expect(response.body.data.weekCount).toBe(4);
    expect(teacher).toMatchObject({ regular: 8, overtime: 0, total: 8 });
  });

  it('returns an empty list and publish prompt when only a draft plan exists', async () => {
    const response = await request(app)
      .get('/api/v1/statistics/workload')
      .query({ semesterId: draftSemesterId, scope: 'SEMESTER' });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      items: [],
      publishedPlanId: null,
      message: '请先发布课表',
    });
  });
});
