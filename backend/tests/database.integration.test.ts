import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool, type PoolClient } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import {
  MigrationChecksumError,
  loadMigrationFiles,
  runMigrations,
} from '../src/shared/db/migrate';
import { executeTransaction } from '../src/shared/db/transaction';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const sharedTables = [
  'sys_audit_log',
  'sys_config',
  'sys_controlled_vocabulary',
  'sys_login_attempt',
  'sys_migration',
  'sys_outbox_event',
  'sys_session',
  'sys_user',
];
const expectedColumns: Record<string, string[]> = {
  sys_migration: [
    'migration_id',
    'filename',
    'checksum',
    'applied_at',
    'duration_ms',
    'applied_by',
    'created_at',
    'updated_at',
  ],
  sys_user: [
    'user_id',
    'username',
    'display_name',
    'password_hash',
    'role',
    'status',
    'must_change_password',
    'teacher_id',
    'last_login_at',
    'password_changed_at',
    'version',
    'created_at',
    'updated_at',
  ],
  sys_session: [
    'sid',
    'user_id',
    'data',
    'created_at',
    'updated_at',
    'last_seen_at',
    'expires_at',
    'revoked_at',
  ],
  sys_login_attempt: [
    'attempt_id',
    'username',
    'ip_address',
    'success',
    'failure_reason',
    'attempted_at',
    'created_at',
    'updated_at',
  ],
  sys_config: ['config_key', 'config_value', 'description', 'updated_by', 'created_at', 'updated_at'],
  sys_controlled_vocabulary: [
    'vocabulary_id',
    'vocab_type',
    'canonical_name',
    'synonym_of',
    'sort_order',
    'is_active',
    'created_at',
    'updated_at',
  ],
  sys_outbox_event: [
    'event_id',
    'event_name',
    'schema_version',
    'aggregate_type',
    'aggregate_id',
    'payload',
    'occurred_at',
    'occurred_by',
    'published_at',
    'attempt_count',
    'last_error',
    'created_at',
    'updated_at',
  ],
  sys_audit_log: [
    'audit_id',
    'actor_id',
    'actor_name',
    'action',
    'target_type',
    'target_id',
    'result',
    'ip_address',
    'user_agent',
    'detail',
    'occurred_at',
    'created_at',
    'updated_at',
  ],
};

function schemaPool(databaseUrl: string, schema: string, max = 4): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max,
    connectionTimeoutMillis: 1_000,
    options: `-c search_path=${schema},public`,
  });
}

async function createSchema(adminPool: Pool, prefix: string): Promise<string> {
  const schema = `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  return schema;
}

describeWithDatabase('shared database and migrations', () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;
  let migrationsDir: string;

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      return;
    }
    migrationsDir = path.resolve(process.cwd(), 'migrations');
    adminPool = new Pool({ connectionString: testDatabaseUrl, max: 2 });
    await adminPool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public');
    schema = await createSchema(adminPool, 'p001');
    pool = schemaPool(testDatabaseUrl, schema);
  });

  afterAll(async () => {
    if (!testDatabaseUrl) {
      return;
    }
    await pool.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminPool.end();
  });

  it('applies all pending migrations to an empty schema and creates the frozen tables', async () => {
    const messages: string[] = [];
    const result = await runMigrations({
      pool,
      migrationsDir,
      logger: { info: (message) => messages.push(message) },
    });

    const pendingMigrations = await loadMigrationFiles(migrationsDir);
    expect(result.applied.map((migration) => migration.filename)).toEqual(
      pendingMigrations.map((migration) => migration.filename),
    );
    expect(result.skipped).toBe(0);
    expect(messages.some((message) => message.includes('迁移完成'))).toBe(true);

    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = $1 AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
      [schema],
    );
    const tableNames = tables.rows.map((row) => row.table_name);
    expect(tableNames.filter((name) => sharedTables.includes(name))).toEqual(sharedTables);
    expect(tableNames).toEqual(
      expect.arrayContaining([
        'semester',
        'schedule_template',
        'schedule_template_version',
        'calendar_exception',
      ]),
    );

    const columns = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = ANY($2::text[])
        ORDER BY table_name, ordinal_position`,
      [schema, sharedTables],
    );
    const actualColumns = new Map<string, string[]>();
    for (const table of sharedTables) {
      actualColumns.set(table, []);
    }
    for (const column of columns.rows) {
      actualColumns.get(column.table_name)?.push(column.column_name);
    }
    expect(Object.fromEntries(actualColumns)).toEqual(expectedColumns);

    const timestamps = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = ANY($2::text[])
          AND column_name IN ('created_at', 'updated_at')
          AND data_type = 'timestamp with time zone'
          AND is_nullable = 'NO'
        ORDER BY table_name, column_name`,
      [schema, sharedTables],
    );
    expect(timestamps.rows).toHaveLength(sharedTables.length * 2);

    const triggers = await pool.query<{ table_name: string }>(
      `SELECT event_object_table AS table_name
         FROM information_schema.triggers
        WHERE trigger_schema = $1 AND trigger_name LIKE 'trg_%_updated_at'
        ORDER BY event_object_table`,
      [schema],
    );
    const triggerTables = triggers.rows.map((row) => row.table_name);
    expect(triggerTables.filter((name) => sharedTables.includes(name))).toEqual(sharedTables);
    expect(triggerTables).toEqual(
      expect.arrayContaining(['schedule_template', 'semester', 'calendar_exception']),
    );

    const functionExists = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = $1 AND p.proname = 'set_updated_at'
       ) AS exists`,
      [schema],
    );
    expect(functionExists.rows[0]?.exists).toBe(true);

    const diskMigrations = await loadMigrationFiles(migrationsDir);
    const ledger = await pool.query<{ filename: string; checksum: string; duration_ms: number }>(
      'SELECT filename, checksum, duration_ms FROM sys_migration ORDER BY filename',
    );
    expect(ledger.rows.map((row) => row.filename)).toEqual(
      diskMigrations.map((migration) => migration.filename),
    );
    ledger.rows.forEach((row, index) => {
      expect(row.checksum).toBe(diskMigrations[index]?.checksum);
      expect(row.duration_ms).toBeGreaterThanOrEqual(0);
    });
  });

  it('is idempotent and reports no pending migrations on rerun', async () => {
    const before = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM information_schema.tables
        WHERE table_schema = $1 AND table_type = 'BASE TABLE'`,
      [schema],
    );
    const messages: string[] = [];

    const result = await runMigrations({
      pool,
      migrationsDir,
      logger: { info: (message) => messages.push(message) },
    });

    const diskMigrations = await loadMigrationFiles(migrationsDir);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toBe(diskMigrations.length);
    expect(result.total).toBe(diskMigrations.length);
    expect(messages).toContain('无待执行迁移');

    const after = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM information_schema.tables
        WHERE table_schema = $1 AND table_type = 'BASE TABLE'`,
      [schema],
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
    const ledgerCount = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM sys_migration',
    );
    expect(ledgerCount.rows[0]?.count).toBe(String(diskMigrations.length));
  });

  it('updates updated_at through the trigger', async () => {
    const before = await pool.query<{ updated_at: Date }>(
      "SELECT updated_at FROM sys_config WHERE config_key = 'password.minLength'",
    );
    await delay(20);
    const updated = await pool.query<{ updated_at: Date }>(
      "UPDATE sys_config SET description = description || ' ' WHERE config_key = 'password.minLength' RETURNING updated_at",
    );

    expect(updated.rows[0]?.updated_at.getTime()).toBeGreaterThan(
      before.rows[0]!.updated_at.getTime(),
    );
  });

  it('serializes concurrent writes to the same sys_config key without dirty writes', async () => {
    const first: PoolClient = await pool.connect();
    const second: PoolClient = await pool.connect();

    try {
      await first.query('BEGIN');
      await first.query(
        "UPDATE sys_config SET config_value = '\"tx1\"'::jsonb WHERE config_key = 'login.maxFailures'",
      );
      await second.query('BEGIN');

      let secondSettled = false;
      const secondUpdate = second
        .query(
          "UPDATE sys_config SET config_value = '\"tx2\"'::jsonb WHERE config_key = 'login.maxFailures'",
        )
        .then(() => {
          secondSettled = true;
        });

      await delay(150);
      expect(secondSettled).toBe(false);

      await first.query('COMMIT');
      await secondUpdate;
      await second.query('COMMIT');
    } catch (error) {
      await first.query('ROLLBACK').catch(() => undefined);
      await second.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      first.release();
      second.release();
    }

    const row = await pool.query<{ config_value: string }>(
      "SELECT config_value FROM sys_config WHERE config_key = 'login.maxFailures'",
    );
    expect(row.rows[0]?.config_value).toBe('tx2');
  });

  it('rolls back a failed withTransaction callback', async () => {
    const client = await pool.connect();
    try {
      await expect(
        executeTransaction(client, async (tx) => {
          await tx.query(
            "INSERT INTO sys_audit_log (action, result) VALUES ('rollback-proof', 'SUCCESS')",
          );
          throw new Error('forced rollback');
        }),
      ).rejects.toThrow('forced rollback');
    } finally {
      client.release();
    }

    const count = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM sys_audit_log WHERE action = 'rollback-proof'",
    );
    expect(count.rows[0]?.count).toBe('0');
  });

  it('fails clearly when an applied migration checksum changes', async () => {
    const diskMigrations = await loadMigrationFiles(migrationsDir);
    const secondMigration = diskMigrations[1]!;
    await pool.query('UPDATE sys_migration SET checksum = $1 WHERE filename = $2', [
      'tampered',
      secondMigration.filename,
    ]);

    try {
      await expect(runMigrations({ pool, migrationsDir })).rejects.toBeInstanceOf(
        MigrationChecksumError,
      );
    } finally {
      await pool.query('UPDATE sys_migration SET checksum = $1 WHERE filename = $2', [
        secondMigration.checksum,
        secondMigration.filename,
      ]);
    }
  });

  it('serializes two concurrent runners without duplicate ledger rows', async () => {
    if (!testDatabaseUrl) {
      return;
    }
    const raceSchema = await createSchema(adminPool, 'p001_race');
    const racePool = schemaPool(testDatabaseUrl, raceSchema);
    try {
      const results = await Promise.all([
        runMigrations({ pool: racePool, migrationsDir }),
        runMigrations({ pool: racePool, migrationsDir }),
      ]);
      const diskMigrations = await loadMigrationFiles(migrationsDir);
      expect(results.map((result) => result.applied.length).sort()).toEqual([0, diskMigrations.length]);
      const ledger = await racePool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM sys_migration',
      );
      expect(ledger.rows[0]?.count).toBe(String(diskMigrations.length));
    } finally {
      await racePool.end();
      await adminPool.query(`DROP SCHEMA IF EXISTS "${raceSchema}" CASCADE`);
    }
  });

  it('returns a clear 503 when the connection pool is exhausted', async () => {
    if (!testDatabaseUrl) {
      return;
    }
    const limitedPool = new Pool({
      connectionString: testDatabaseUrl,
      max: 1,
      connectionTimeoutMillis: 100,
      options: `-c search_path=${schema},public`,
    });
    const heldClient = await limitedPool.connect();

    try {
      const response = await request(
        await createApp({
          probe: async () => {
            try {
              await limitedPool.query('SELECT 1');
              return true;
            } catch {
              return false;
            }
          },
        }),
      ).get('/api/v1/health');

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('DATABASE_UNAVAILABLE');
    } finally {
      heldClient.release();
      await limitedPool.end();
    }
  });
});
