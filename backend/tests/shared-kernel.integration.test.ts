import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Pool, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { writeOperationLog } from '../src/shared/audit/operation-log';
import { writeSecurityAudit, type AuditQuery } from '../src/shared/audit/security-audit';
import { runMigrations } from '../src/shared/db/migrate';
import { updateWithVersion } from '../src/shared/db/optimistic';
import { executeTransaction } from '../src/shared/db/transaction';
import { VersionConflictError } from '../src/shared/errors/app-error';
import {
  appendEvent,
  clearEventHandlers,
  dispatchPendingEvents,
  registerEventHandler,
  type OutboxEvent,
  type OutboxTransactionRunner,
} from '../src/shared/events/outbox';
import { fixedClock } from '../src/shared/time/clock';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const ID = '11111111-1111-4111-8111-111111111111';
const clock = fixedClock('2026-09-01T00:00:00.000Z');

interface DemoRow extends QueryResultRow {
  id: string;
  name: string;
  version: number;
}

describeWithDatabase('shared kernel integration', () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;

  const runner: OutboxTransactionRunner = async (fn) => {
    const client = await pool.connect();
    try {
      return await executeTransaction(client, fn);
    } finally {
      client.release();
    }
  };

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      return;
    }
    adminPool = new Pool({ connectionString: testDatabaseUrl, max: 2 });
    await adminPool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public');
    schema = `p003_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: testDatabaseUrl,
      max: 4,
      options: `-c search_path=${schema},public`,
    });

    await runMigrations({
      pool,
      migrationsDir: path.resolve(process.cwd(), 'migrations'),
      logger: { info: () => undefined },
    });

    await pool.query(`
      CREATE TYPE operation_module AS ENUM (
        'DELETE', 'PUBLISH', 'OVERWRITE', 'SWITCH_SEMESTER', 'IMPORT', 'ARCHIVE', 'ADJUST'
      );
      CREATE TABLE operation_log (
        log_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        operator_id  uuid NOT NULL,
        operator_name text NOT NULL,
        module       operation_module NOT NULL,
        action       text NOT NULL,
        content      text NOT NULL,
        target_type  text NOT NULL,
        target_id    uuid,
        request_id   text,
        created_at   timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE demo_item (
        id uuid PRIMARY KEY,
        name text NOT NULL,
        version integer NOT NULL DEFAULT 1
      );
    `);
  });

  beforeEach(async () => {
    if (!pool) {
      return;
    }
    clearEventHandlers();
    await pool.query('DELETE FROM sys_outbox_event');
    await pool.query('DELETE FROM operation_log');
    await pool.query('DELETE FROM sys_audit_log');
    await pool.query('DELETE FROM demo_item');
  });

  afterAll(async () => {
    if (!testDatabaseUrl) {
      return;
    }
    await pool.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminPool.end();
  });

  it('rolls outbox events back with the business transaction', async () => {
    const client = await pool.connect();
    try {
      await expect(
        executeTransaction(client, async (tx) => {
          await appendEvent(
            tx,
            {
              eventName: 'p003.rollback',
              aggregateType: 'probe',
              aggregateId: randomUUID(),
              payload: { reason: 'rollback' },
            },
            clock,
          );
          throw new Error('forced rollback');
        }),
      ).rejects.toThrow('forced rollback');
    } finally {
      client.release();
    }

    const count = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM sys_outbox_event WHERE event_name = 'p003.rollback'",
    );
    expect(count.rows[0]?.count).toBe('0');
  });

  it('commits an outbox event and dispatches it to a registered handler', async () => {
    const aggregateId = randomUUID();
    const client = await pool.connect();
    await executeTransaction(client, async (tx) => {
      await appendEvent(
        tx,
        {
          eventName: 'p003.deliver',
          aggregateType: 'probe',
          aggregateId,
          payload: { value: 1 },
        },
        clock,
      );
    });
    client.release();

    const seen: OutboxEvent[] = [];
    registerEventHandler('p003.deliver', async (event) => {
      seen.push(event);
    });

    await expect(dispatchPendingEvents(10, { clock, runner })).resolves.toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.aggregateId).toBe(aggregateId);

    const row = await pool.query<{ published_at: Date | null; attempt_count: number }>(
      "SELECT published_at, attempt_count FROM sys_outbox_event WHERE event_name = 'p003.deliver'",
    );
    expect(row.rows[0]?.published_at).not.toBeNull();
    expect(row.rows[0]?.attempt_count).toBe(0);
  });

  it('keeps failed events unpublished for at-least-once retry', async () => {
    const client = await pool.connect();
    await executeTransaction(client, async (tx) => {
      await appendEvent(
        tx,
        {
          eventName: 'p003.fail',
          aggregateType: 'probe',
          aggregateId: randomUUID(),
          payload: {},
        },
        clock,
      );
    });
    client.release();

    registerEventHandler('p003.fail', async () => {
      throw new Error('handler boom');
    });

    await expect(dispatchPendingEvents(10, { clock, runner })).resolves.toBe(0);
    await expect(dispatchPendingEvents(10, { clock, runner })).resolves.toBe(0);

    const row = await pool.query<{
      published_at: Date | null;
      attempt_count: number;
      last_error: string | null;
    }>(
      "SELECT published_at, attempt_count, last_error FROM sys_outbox_event WHERE event_name = 'p003.fail'",
    );
    expect(row.rows[0]?.published_at).toBeNull();
    expect(row.rows[0]?.attempt_count).toBe(2);
    expect(row.rows[0]?.last_error).toBe('handler boom');
  });

  it('does not write when the version guard rejects a stale update', async () => {
    const id = randomUUID();
    await pool.query('INSERT INTO demo_item (id, name, version) VALUES ($1, $2, 1)', [id, '原始']);

    const staleClient = await pool.connect();
    try {
      await expect(
        executeTransaction(staleClient, async (tx) => {
          await updateWithVersion(tx, {
            table: 'demo_item',
            id,
            expectedVersion: 2,
            values: { name: '并发修改' },
          });
        }),
      ).rejects.toBeInstanceOf(VersionConflictError);
    } finally {
      staleClient.release();
    }

    const unchanged = await pool.query<{ name: string; version: number }>(
      'SELECT name, version FROM demo_item WHERE id = $1',
      [id],
    );
    expect(unchanged.rows[0]).toEqual({ name: '原始', version: 1 });

    const freshClient = await pool.connect();
    try {
      const updated = await executeTransaction(freshClient, async (tx) => {
        return updateWithVersion<DemoRow>(tx, {
          table: 'demo_item',
          id,
          expectedVersion: 1,
          values: { name: '已更新' },
        });
      });
      expect(updated).toMatchObject({ id, name: '已更新', version: 2 });
    } finally {
      freshClient.release();
    }
  });

  it('appends operation logs inside the business transaction', async () => {
    const client = await pool.connect();
    try {
      await executeTransaction(client, async (tx) => {
        await writeOperationLog(
          tx,
          {
            operatorId: ID,
            operatorName: '管理员',
            module: 'PUBLISH',
            action: '发布',
            content: '发布 2026 秋季正式课表',
            targetType: 'plan',
            targetId: ID,
          },
          clock,
        );
      });
    } finally {
      client.release();
    }

    const row = await pool.query<{ content: string; operator_name: string; module: string }>(
      "SELECT content, operator_name, module FROM operation_log WHERE action = '发布'",
    );
    expect(row.rows[0]).toEqual({
      content: '发布 2026 秋季正式课表',
      operator_name: '管理员',
      module: 'PUBLISH',
    });
  });

  it('writes security audit events with redacted details', async () => {
    const auditQuery: AuditQuery = (sql, params) => pool.query(sql, params);

    await writeSecurityAudit(
      {
        action: 'LOGIN_FAILURE',
        result: 'FAILURE',
        ip: '127.0.0.1',
        userAgent: 'vitest',
        detail: { phone: '13812341234', password: 'super-secret' },
      },
      { clock, query: auditQuery },
    );

    const row = await pool.query<{ result: string; detail: Record<string, unknown> }>(
      "SELECT result, detail FROM sys_audit_log WHERE action = 'LOGIN_FAILURE'",
    );
    expect(row.rows[0]?.result).toBe('FAILURE');
    expect(row.rows[0]?.detail).toEqual({ phone: '138****1234', password: '***' });
  });
});
