import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createResourceRouter } from '../src/modules/resource/resource.router';
import { SchedulingUnitQueryService } from '../src/modules/resource/scheduling-unit-query.service';
import { VenueQueryService } from '../src/modules/resource/venue-query.service';
import { errorHandler } from '../src/shared/errors/error-handler';
import { requestIdMiddleware } from '../src/shared/http/request-id';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

let adminPool: Pool;
let pool: Pool;
let schema = '';
let app: ReturnType<typeof express>;
let teacherId = '';
let classAId = '';
let classBId = '';
let classCId = '';
let subjectId = '';
let venueId = '';
let planId = '';
let adminUserId = '';

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
      userId: adminUserId,
      username: 'd04_test_admin',
      displayName: 'D04 测试管理员',
      role: 'ADMIN',
      teacherId: null,
      mustChangePassword: false,
    };
    next();
  });
  instance.use('/api/v1', createResourceRouter(pool));
  instance.use(errorHandler);
  return instance;
}

async function insertBaseFixtures(): Promise<void> {
  adminUserId = randomUUID();
  teacherId = randomUUID();
  classAId = randomUUID();
  classBId = randomUUID();
  classCId = randomUUID();
  subjectId = randomUUID();
  venueId = randomUUID();
  const gradeId = randomUUID();

  await pool.query(
    `INSERT INTO sys_user (user_id, username, display_name, password_hash, role, must_change_password)
     VALUES ($1, 'd04_admin', 'D04 管理员', 'test-hash', 'ADMIN', false)`,
    [adminUserId],
  );
  await pool.query(
    `INSERT INTO sys_controlled_vocabulary (vocab_type, canonical_name, sort_order)
     VALUES ('VENUE', '301', 10),
            ('VENUE', '实验室1', 20),
            ('VENUE', '美术教室', 30),
            ('COMBINED_CLASS', '体育合班', 10),
            ('COMBINED_CLASS', '化学合班', 20),
            ('COMBINED_CLASS', '广播合班', 30),
            ('WALKING_GROUP', '英语走班', 10)`,
  );
  await pool.query(
    `INSERT INTO teacher (teacher_id, employee_no, name, status)
     VALUES ($1, 'T9001', 'D04 教师', 'ACTIVE')`,
    [teacherId],
  );
  await pool.query(
    `INSERT INTO grade (grade_id, name, sort_order) VALUES ($1, 'D04 年级', 10)`,
    [gradeId],
  );
  await pool.query(
    `INSERT INTO class (class_id, grade_id, name, serial_no, student_count)
     VALUES ($1, $4, 'D04 年级（1）班', 1, 40),
            ($2, $4, 'D04 年级（2）班', 2, 41),
            ($3, $4, 'D04 年级（3）班', 3, 42)`,
    [classAId, classBId, classCId, gradeId],
  );
  await pool.query(`INSERT INTO subject (subject_id, name) VALUES ($1, 'D04 英语')`, [subjectId]);
  await pool.query(
    `INSERT INTO venue (venue_id, name, type, capacity, status)
     VALUES ($1, '301', 'FUNCTION_ROOM', 45, 'AVAILABLE')`,
    [venueId],
  );

  const templateId = randomUUID();
  const versionId = randomUUID();
  const semesterId = randomUUID();
  planId = randomUUID();
  await pool.query(
    `INSERT INTO schedule_template (template_id, name) VALUES ($1, 'D04 模板')`,
    [templateId],
  );
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
     VALUES ($1, 'D04 学期', '2026-2027', 'FALL', '2026-09-01', '2027-01-31', 'IN_PROGRESS', $2)`,
    [semesterId, versionId],
  );
  await pool.query(
    `INSERT INTO timetable_plan (plan_id, semester_id, name, schedule_template_version_id)
     VALUES ($1, $2, 'D04 方案', $3)`,
    [planId, semesterId, versionId],
  );
}

beforeAll(async () => {
  if (!testDatabaseUrl) {
    return;
  }
  adminPool = new Pool({ connectionString: testDatabaseUrl, connectionTimeoutMillis: 1_000 });
  schema = `d04_resource_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  pool = schemaPool(testDatabaseUrl, schema);
  const root = path.resolve(process.cwd());
  const contractSql = await readFile(path.join(root, 'contracts/schema.sql'), 'utf8');
  const migrationSql = await readFile(
    path.join(root, 'migrations/0015_resource_venue_units.sql'),
    'utf8',
  );
  await pool.query(contractSql);
  await pool.query(migrationSql);
  await insertBaseFixtures();
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

describeWithDatabase('D04 venue and scheduling-unit configuration', () => {
  it('rejects a third venue type and duplicate controlled names', async () => {
    const thirdType = await request(app)
      .post('/api/v1/venues')
      .send({ name: '实验室1', type: 'LAB', capacity: 20 });
    expect(thirdType.status).toBe(400);
    expect(thirdType.body.error.details[0].field).toBe('type');

    const duplicate = await request(app)
      .post('/api/v1/venues')
      .send({ name: '301', type: 'CLASSROOM', capacity: 30 });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE');
    expect(duplicate.body.error.details[0].field).toBe('name');
  });

  it('protects a venue referenced by a combined class without mutating it', async () => {
    const created = await request(app).post('/api/v1/combined-classes').send({
      name: '化学合班',
      teacherId,
      venueId,
      classIds: [classAId, classBId],
      periodConstraint: { slots: [{ weekday: 3, period: 7 }] },
    });
    expect(created.status).toBe(201);

    const deletion = await request(app).delete(`/api/v1/venues/${venueId}`);
    expect(deletion.status).toBe(409);
    expect(deletion.body.error.code).toBe('REFERENCE_PROTECTED');

    const venue = await new VenueQueryService(pool).getById(venueId);
    expect(venue).toMatchObject({ venueId, name: '301', capacity: 45 });
  });

  it('identifies invalid combined-class fields', async () => {
    const invalidName = await request(app).post('/api/v1/combined-classes').send({
      name: '未收录合班',
      teacherId,
      venueId,
      classIds: [classAId, classBId],
    });
    expect(invalidName.status).toBe(400);
    expect(invalidName.body.error.details[0].field).toBe('name');

    const missingClasses = await request(app).post('/api/v1/combined-classes').send({
      name: '体育合班',
      teacherId,
      venueId,
      classIds: [],
    });
    expect(missingClasses.status).toBe(400);
    expect(missingClasses.body.error.details[0].field).toBe('classIds');

    const invalidTeacher = await request(app).post('/api/v1/combined-classes').send({
      name: '体育合班',
      teacherId: randomUUID(),
      venueId,
      classIds: [classAId, classBId],
    });
    expect(invalidTeacher.status).toBe(400);
    expect(invalidTeacher.body.error.details[0].field).toBe('teacherId');

    const missingVenue = await request(app).post('/api/v1/combined-classes').send({
      name: '体育合班',
      teacherId,
      classIds: [classAId, classBId],
    });
    expect(missingVenue.status).toBe(400);
    expect(missingVenue.body.error.details[0].field).toBe('venueId');

    const invalidPeriod = await request(app).post('/api/v1/combined-classes').send({
      name: '体育合班',
      teacherId,
      venueId,
      classIds: [classAId, classBId],
      periodConstraint: { weekday: 8, period: 1 },
    });
    expect(invalidPeriod.status).toBe(400);
    expect(invalidPeriod.body.error.details[0].field).toBe('periodConstraint');
  });

  it('requires a target venue and members for a walking group', async () => {
    const missingVenue = await request(app).post('/api/v1/walking-groups').send({
      name: '英语走班',
      subjectId,
      teacherId,
      classIds: [classCId],
    });
    expect(missingVenue.status).toBe(400);
    expect(missingVenue.body.error.details[0].field).toBe('venueId');

    const emptyMembers = await request(app).post('/api/v1/walking-groups').send({
      name: '英语走班',
      subjectId,
      teacherId,
      venueId,
      classIds: [],
    });
    expect(emptyMembers.status).toBe(400);
    expect(emptyMembers.body.error.details[0].field).toBe('classIds');
  });

  it('persists a walking group as a subject-aware scheduling unit', async () => {
    const response = await request(app).post('/api/v1/walking-groups').send({
      name: '英语走班',
      subjectId,
      teacherId,
      venueId,
      classIds: [classCId, classAId],
    });
    expect(response.status).toBe(201);
    const walkingGroupId = response.body.data.walkingGroupId as string;
    expect(response.body.data.classIds).toEqual([classCId, classAId]);

    const members = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM walking_group_member WHERE walking_group_id = $1',
      [walkingGroupId],
    );
    expect(members.rows[0]?.count).toBe(2);

    const snapshot = await new SchedulingUnitQueryService(pool).getById('WALKING_GROUP', walkingGroupId);
    expect(snapshot).toMatchObject({
      unitId: walkingGroupId,
      unitType: 'WALKING_GROUP',
      subjectId,
      teacherId,
      venueId,
      classIds: [classAId, classCId].sort(),
    });
  });

  it('persists members and returns the same unit through the query service', async () => {
    const response = await request(app).post('/api/v1/combined-classes').send({
      name: '体育合班',
      teacherId,
      venueId,
      classIds: [classAId, classBId],
      periodConstraint: { slots: [{ weekday: 4, period: 5 }] },
    });
    expect(response.status).toBe(201);
    const body = response.body.data as {
      combinedClassId: string;
      classIds: string[];
      venueId: string;
      periodConstraint: { slots: Array<{ weekday: number; period: number }> };
    };
    expect(body.classIds).toEqual([classAId, classBId]);

    const members = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM combined_class_member WHERE combined_class_id = $1',
      [body.combinedClassId],
    );
    expect(members.rows[0]?.count).toBe(body.classIds.length);

    const snapshot = await new SchedulingUnitQueryService(pool).getById(
      'COMBINED_CLASS',
      body.combinedClassId,
    );
    expect(snapshot).toMatchObject({
      unitId: body.combinedClassId,
      unitType: 'COMBINED_CLASS',
      subjectId: null,
      teacherId,
      venueId,
      classIds: [classAId, classBId].sort(),
      periodConstraint: { slots: [{ weekday: 4, period: 5 }] },
    });
    const listed = await new SchedulingUnitQueryService(pool).list({ classId: classAId });
    expect(listed.map((unit) => unit.unitId)).toContain(body.combinedClassId);
  });

  it('rejects deleting a unit referenced by a scheduling plan', async () => {
    const created = await request(app).post('/api/v1/combined-classes').send({
      name: '广播合班',
      teacherId,
      venueId,
      classIds: [classAId, classCId],
    });
    expect(created.status).toBe(201);
    const combinedClassId = created.body.data.combinedClassId as string;

    await pool.query(
      `INSERT INTO lesson
         (plan_id, weekday, period, subject_id, teacher_id, venue_id, unit_type, unit_id)
       VALUES ($1, 1, 1, $2, $3, $4, 'COMBINED_CLASS', $5)`,
      [planId, subjectId, teacherId, venueId, combinedClassId],
    );

    const deletion = await request(app).delete(`/api/v1/combined-classes/${combinedClassId}`);
    expect(deletion.status).toBe(409);
    expect(deletion.body.error.code).toBe('REFERENCE_PROTECTED');

    const unit = await new SchedulingUnitQueryService(pool).getById('COMBINED_CLASS', combinedClassId);
    expect(unit).not.toBeNull();
  });
});
