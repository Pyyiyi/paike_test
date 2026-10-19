import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { AuthConfig } from '../src/config/auth';
import { parseSeedConfig } from '../src/config/seed';
import { createAuthRuntime } from '../src/shared/auth/runtime';
import { verifyPassword } from '../src/shared/auth/password';
import { runMigrations } from '../src/shared/db/migrate';
import {
  reportSeedResult,
  runSeed,
  SEEDED_VOCABULARY_IDS,
  type SeedResult,
} from '../src/shared/db/seed';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const ARGON2_OPTIONS = { memoryCost: 8_192, timeCost: 2, parallelism: 1 };
const PASSWORD_POLICY = { minLength: 8, requiredClasses: 3 };
const ANCHORS_PATH = path.resolve(process.cwd(), 'seed-anchors.sql');

const D15_TABLES = [
  'schedule_template',
  'schedule_template_version',
  'semester',
  'grade',
  'class',
  'subject',
  'teacher',
  'venue',
  'teaching_assignment',
  'subject_period_rule',
] as const;

const D15_DOMAIN_DDL = `
CREATE TABLE IF NOT EXISTS schedule_template (
  template_id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  status text NOT NULL,
  latest_version_no integer NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule_template_version (
  version_id uuid PRIMARY KEY,
  template_id uuid NOT NULL REFERENCES schedule_template(template_id),
  version_no integer NOT NULL,
  open_weekdays smallint[] NOT NULL,
  periods jsonb NOT NULL,
  status text NOT NULL,
  UNIQUE (template_id, version_no)
);

CREATE TABLE IF NOT EXISTS semester (
  semester_id uuid PRIMARY KEY,
  name text NOT NULL,
  academic_year text NOT NULL,
  term text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL,
  schedule_template_version_id uuid REFERENCES schedule_template_version(version_id),
  is_current boolean NOT NULL
);

CREATE TABLE IF NOT EXISTS grade (
  grade_id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  sort_order integer NOT NULL
);

CREATE TABLE IF NOT EXISTS class (
  class_id uuid PRIMARY KEY,
  grade_id uuid NOT NULL REFERENCES grade(grade_id),
  name text NOT NULL,
  serial_no integer NOT NULL,
  student_count integer NOT NULL,
  UNIQUE (grade_id, serial_no)
);

CREATE TABLE IF NOT EXISTS subject (
  subject_id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS teacher (
  teacher_id uuid PRIMARY KEY,
  employee_no text NOT NULL UNIQUE,
  name text NOT NULL,
  gender text NOT NULL,
  phone text NOT NULL,
  status text NOT NULL
);

CREATE TABLE IF NOT EXISTS venue (
  venue_id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  type text NOT NULL,
  capacity integer NOT NULL,
  status text NOT NULL
);

CREATE TABLE IF NOT EXISTS teaching_assignment (
  assignment_id uuid PRIMARY KEY,
  teacher_id uuid NOT NULL REFERENCES teacher(teacher_id),
  subject_id uuid NOT NULL REFERENCES subject(subject_id),
  class_id uuid NOT NULL REFERENCES class(class_id),
  venue_id uuid REFERENCES venue(venue_id),
  weekly_periods integer NOT NULL,
  consecutive_preference text NOT NULL,
  forbidden_slots jsonb NOT NULL,
  exempted_slots jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS subject_period_rule (
  rule_id uuid PRIMARY KEY,
  subject_id uuid NOT NULL UNIQUE REFERENCES subject(subject_id),
  weekly_periods integer NOT NULL,
  consecutive_preference text NOT NULL,
  forbidden_slots jsonb NOT NULL,
  time_slot_preference text NOT NULL,
  period_balance_enabled boolean NOT NULL,
  am_pm_balance_enabled boolean NOT NULL,
  fixed_slot_rule_enabled boolean NOT NULL
);
`;

let adminPool: Pool;
const schemas: string[] = [];

function makeAuthConfig(): AuthConfig {
  return {
    nodeEnv: 'test',
    sessionSecret: 'test-seed-session-secret-at-least-32-characters',
    sessionCookieName: 'paike.sid',
    sessionIdleMs: 8 * 60 * 60 * 1000,
    sessionAbsoluteMs: 7 * 24 * 60 * 60 * 1000,
    passwordMinLength: PASSWORD_POLICY.minLength,
    passwordRequiredClasses: PASSWORD_POLICY.requiredClasses,
    loginMaxFailures: 5,
    loginFailureWindowMs: 15 * 60 * 1000,
    loginLockMs: 15 * 60 * 1000,
    argon2MemoryCost: ARGON2_OPTIONS.memoryCost,
    argon2TimeCost: ARGON2_OPTIONS.timeCost,
    argon2Parallelism: ARGON2_OPTIONS.parallelism,
    secureCookies: false,
  };
}

async function createSeedSchema(): Promise<{ pool: Pool; schema: string }> {
  const schema = `p005_seed_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  schemas.push(schema);

  const pool = new Pool({
    connectionString: testDatabaseUrl,
    max: 4,
    connectionTimeoutMillis: 1_000,
    options: `-c search_path=${schema},public`,
  });
  await runMigrations({ pool, logger: { info: () => undefined } });
  await pool.query(D15_DOMAIN_DDL);
  return { pool, schema };
}

async function seed(pool: Pool, initialPassword?: string): Promise<SeedResult> {
  return runSeed({
    pool,
    initialPassword,
    passwordPolicy: PASSWORD_POLICY,
    argon2Options: ARGON2_OPTIONS,
    anchorsPath: ANCHORS_PATH,
  });
}

async function anchorCounts(pool: Pool): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of D15_TABLES) {
    const result = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ${table}`,
    );
    counts[table] = result.rows[0]?.count ?? -1;
  }
  return counts;
}

describe('seed environment parsing', () => {
  it('treats an empty initial-password variable as unset', () => {
    const config = parseSeedConfig({
      PAIKE_ADMIN_INITIAL_PASSWORD: '',
      PASSWORD_MIN_LENGTH: '10',
      PASSWORD_REQUIRED_CLASSES: '4',
      ARGON2_MEMORY_KIB: '16384',
      ARGON2_TIME_COST: '4',
      ARGON2_PARALLELISM: '2',
    });

    expect(config.initialPassword).toBeUndefined();
    expect(config.passwordPolicy).toEqual({ minLength: 10, requiredClasses: 4 });
    expect(config.argon2Options).toEqual({ memoryCost: 16_384, timeCost: 4, parallelism: 2 });
  });
});

describeWithDatabase('seed anchors and administrator', () => {
  beforeAll(async () => {
    if (!testDatabaseUrl) {
      return;
    }
    adminPool = new Pool({ connectionString: testDatabaseUrl, max: 2 });
    await adminPool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public');
  });

  afterAll(async () => {
    if (!testDatabaseUrl) {
      return;
    }
    for (const schema of schemas) {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await adminPool?.end();
  });

  it('is idempotent for the unique admin, vocabulary, and every D15 anchor table', async () => {
    const { pool } = await createSeedSchema();
    const initialPassword = 'SeedPass1!';

    try {
      const first = await seed(pool, initialPassword);
      expect(first.adminCreated).toBe(true);
      expect(first.adminPasswordInitialized).toBe(true);
      expect(first.generatedPassword).toBeUndefined();
      expect(first.controlledVocabularyCount).toBe(SEEDED_VOCABULARY_IDS.length);
      expect(first.d15AnchorsApplied).toBe(true);
      expect(first.durationMs).toBeGreaterThanOrEqual(0);

      const firstCounts = await anchorCounts(pool);
      const admins = await pool.query<{
        user_id: string;
        username: string;
        password_hash: string;
        role: string;
        status: string;
        must_change_password: boolean;
      }>(
        `SELECT user_id, username, password_hash, role, status, must_change_password
           FROM sys_user
          WHERE username = 'admin'`,
      );
      expect(admins.rowCount).toBe(1);
      expect(admins.rows[0]?.user_id).toBe('00000000-0000-4000-8000-000000000100');
      expect(admins.rows[0]?.role).toBe('ADMIN');
      expect(admins.rows[0]?.status).toBe('ENABLED');
      expect(admins.rows[0]?.must_change_password).toBe(true);
      expect(admins.rows[0]?.password_hash.startsWith('$argon2id$')).toBe(true);
      expect(admins.rows[0]?.password_hash).not.toContain(initialPassword);
      expect(await verifyPassword(admins.rows[0]?.password_hash ?? '', initialPassword)).toBe(true);

      const second = await seed(pool, initialPassword);
      expect(second.adminCreated).toBe(false);
      expect(second.adminPasswordInitialized).toBe(false);
      expect(second.generatedPassword).toBeUndefined();
      expect(second.controlledVocabularyCount).toBe(SEEDED_VOCABULARY_IDS.length);
      expect(second.d15AnchorsApplied).toBe(true);
      expect(await anchorCounts(pool)).toEqual(firstCounts);

      const adminCount = await pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM sys_user WHERE username = 'admin'",
      );
      expect(adminCount.rows[0]?.count).toBe(1);
    } finally {
      await pool.end();
    }
  });

  it('seeds the complete controlled vocabulary and readable D15 inputs', async () => {
    const { pool } = await createSeedSchema();

    try {
      await seed(pool, 'Vocabulary1!');

      const vocabulary = await pool.query<{
        vocabulary_id: string;
        vocab_type: string;
        canonical_name: string;
        synonym_of: string | null;
      }>(
        `SELECT vocabulary_id, vocab_type, canonical_name, synonym_of
           FROM sys_controlled_vocabulary
          WHERE vocabulary_id = ANY($1::uuid[])
          ORDER BY vocab_type, vocabulary_id`,
        [SEEDED_VOCABULARY_IDS],
      );
      expect(vocabulary.rowCount).toBe(23);
      expect(
        vocabulary.rows.filter((row) => row.vocab_type === 'GRADE').map((row) => row.canonical_name),
      ).toEqual(['七年级', '八年级', '九年级']);
      expect(
        vocabulary.rows.filter((row) => row.vocab_type === 'SUBJECT').map((row) => row.canonical_name),
      ).toEqual(['语文', '数学', '英语', '物理', '化学', '生物', '体育', '音乐', '美术']);
      expect(
        vocabulary.rows.filter((row) => row.vocab_type === 'VENUE').map((row) => row.canonical_name),
      ).toEqual(['301', '实验室1', '音乐教室', '美术教室', '操场']);
      expect(
        vocabulary.rows
          .filter((row) => row.vocab_type === 'SUBJECT_SYNONYM')
          .map((row) => [row.canonical_name, row.synonym_of]),
      ).toEqual([
        ['语', '语文'],
        ['语文课', '语文'],
        ['数', '数学'],
        ['数学课', '数学'],
        ['英', '英语'],
        ['英语课', '英语'],
      ]);
      expect(vocabulary.rows.map((row) => row.vocabulary_id)).toContain(
        '00000000-0000-4000-8000-000000000150',
      );

      const template = await pool.query<{
        template_id: string;
        template_name: string;
        version_id: string;
        semester_id: string;
        grade_id: string;
      }>(
        `SELECT st.template_id,
                st.name AS template_name,
                stv.version_id,
                sem.semester_id,
                g.grade_id
           FROM schedule_template st
           JOIN schedule_template_version stv ON stv.template_id = st.template_id
           JOIN semester sem ON sem.schedule_template_version_id = stv.version_id
           JOIN grade g ON g.name = '七年级'`,
      );
      expect(template.rows).toEqual([
        {
          template_id: '00000000-0000-4000-8000-000000000101',
          template_name: 'D15-基准作息',
          version_id: '00000000-0000-4000-8000-000000000102',
          semester_id: '00000000-0000-4000-8000-000000000103',
          grade_id: '00000000-0000-4000-8000-000000000104',
        },
      ]);

      const classes = await pool.query<{ class_id: string; name: string }>(
        `SELECT class_id, name FROM class ORDER BY serial_no`,
      );
      expect(classes.rows).toEqual([
        { class_id: '00000000-0000-4000-8000-000000000105', name: '七年级（1）班' },
        { class_id: '00000000-0000-4000-8000-000000000106', name: '七年级（2）班' },
      ]);

      const teachers = await pool.query<{ teacher_id: string; name: string }>(
        `SELECT teacher_id, name FROM teacher ORDER BY employee_no`,
      );
      expect(teachers.rows).toEqual([
        { teacher_id: '00000000-0000-4000-8000-000000000109', name: '张老师' },
        { teacher_id: '00000000-0000-4000-8000-00000000010a', name: '李老师' },
      ]);

      const subjects = await pool.query<{ subject_id: string; name: string }>(
        `SELECT subject_id, name FROM subject ORDER BY name`,
      );
      expect(subjects.rows).toEqual([
        { subject_id: '00000000-0000-4000-8000-000000000107', name: '数学' },
        { subject_id: '00000000-0000-4000-8000-000000000108', name: '英语' },
      ]);

      const venues = await pool.query<{ venue_id: string; name: string }>(
        `SELECT venue_id, name FROM venue`,
      );
      expect(venues.rows).toEqual([
        { venue_id: '00000000-0000-4000-8000-00000000010b', name: '301' },
      ]);

      const assignments = await pool.query<{
        assignment_id: string;
        teacher_name: string;
        subject_name: string;
        class_name: string;
        venue_name: string | null;
        weekly_periods: number;
        consecutive_preference: string;
        exempted_slots: Array<{ weekday: number; period: number }>;
      }>(
        `SELECT ta.assignment_id,
                t.name AS teacher_name,
                s.name AS subject_name,
                c.name AS class_name,
                v.name AS venue_name,
                ta.weekly_periods,
                ta.consecutive_preference,
                ta.exempted_slots
           FROM teaching_assignment ta
           JOIN teacher t ON t.teacher_id = ta.teacher_id
           JOIN subject s ON s.subject_id = ta.subject_id
           JOIN class c ON c.class_id = ta.class_id
           LEFT JOIN venue v ON v.venue_id = ta.venue_id
          ORDER BY ta.assignment_id`,
      );
      expect(assignments.rows).toEqual([
        {
          assignment_id: '00000000-0000-4000-8000-00000000010c',
          teacher_name: '张老师',
          subject_name: '数学',
          class_name: '七年级（1）班',
          venue_name: null,
          weekly_periods: 2,
          consecutive_preference: 'REQUIRED',
          exempted_slots: [{ weekday: 3, period: 4 }],
        },
        {
          assignment_id: '00000000-0000-4000-8000-00000000010d',
          teacher_name: '李老师',
          subject_name: '英语',
          class_name: '七年级（1）班',
          venue_name: '301',
          weekly_periods: 1,
          consecutive_preference: 'NONE',
          exempted_slots: [{ weekday: 2, period: 1 }],
        },
        {
          assignment_id: '00000000-0000-4000-8000-00000000010e',
          teacher_name: '李老师',
          subject_name: '数学',
          class_name: '七年级（2）班',
          venue_name: null,
          weekly_periods: 2,
          consecutive_preference: 'NONE',
          exempted_slots: [{ weekday: 2, period: 1 }],
        },
        {
          assignment_id: '00000000-0000-4000-8000-00000000010f',
          teacher_name: '张老师',
          subject_name: '英语',
          class_name: '七年级（2）班',
          venue_name: '301',
          weekly_periods: 1,
          consecutive_preference: 'NONE',
          exempted_slots: [{ weekday: 3, period: 4 }],
        },
      ]);

      const rule = await pool.query<{
        rule_id: string;
        subject_id: string;
        forbidden_slots: Array<{ weekday: number; period: number }>;
      }>('SELECT rule_id, subject_id, forbidden_slots FROM subject_period_rule');
      expect(rule.rows).toEqual([
        {
          rule_id: '00000000-0000-4000-8000-000000000110',
          subject_id: '00000000-0000-4000-8000-000000000108',
          forbidden_slots: [
            { weekday: 3, period: 3 },
            { weekday: 3, period: 4 },
          ],
        },
      ]);
    } finally {
      await pool.end();
    }
  });

  it('prints a generated password exactly once and never stores the plaintext', async () => {
    const { pool } = await createSeedSchema();

    try {
      const first = await seed(pool);
      expect(first.generatedPassword).toMatch(/^\S{16}$/);
      const lines: string[] = [];
      reportSeedResult(first, (line) => lines.push(line));

      const second = await seed(pool);
      expect(second.generatedPassword).toBeUndefined();
      reportSeedResult(second, (line) => lines.push(line));

      const password = first.generatedPassword as string;
      const output = lines.join('\n');
      expect(output.split(password)).toHaveLength(2);
      expect(lines.filter((line) => line.includes(password))).toHaveLength(1);

      const stored = await pool.query<{ password_hash: string }>(
        "SELECT password_hash FROM sys_user WHERE username = 'admin'",
      );
      expect(stored.rows[0]?.password_hash).not.toContain(password);
      expect(await verifyPassword(stored.rows[0]?.password_hash ?? '', password)).toBe(true);
    } finally {
      await pool.end();
    }
  });

  it('allows admin login with the initial password and forces a password change', async () => {
    const { pool } = await createSeedSchema();
    const initialPassword = 'LoginPass1!';

    try {
      await seed(pool, initialPassword);
      const app = await createApp({
        auth: createAuthRuntime({ config: makeAuthConfig(), pool }),
      });
      const agent = request.agent(app);
      const csrf = await agent.get('/api/v1/auth/csrf');
      expect(csrf.status).toBe(200);

      const login = await agent
        .post('/api/v1/auth/login')
        .set('X-CSRF-Token', csrf.body.data.csrfToken as string)
        .send({ username: 'admin', password: initialPassword });

      expect(login.status).toBe(200);
      expect(login.body.data.user).toMatchObject({
        username: 'admin',
        role: 'ADMIN',
        mustChangePassword: true,
      });
    } finally {
      await pool.end();
    }
  });
});
