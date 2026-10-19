import type { QueryResultRow } from 'pg';
import { maskSensitiveText } from '../audit/redact';
import { withTransaction, type Tx } from '../db/transaction';
import { systemClock, type Clock } from '../time/clock';

export interface OutboxEvent {
  eventId: string;
  eventName: string;
  schemaVersion: number;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  occurredBy: string | null;
  publishedAt: Date | null;
  attemptCount: number;
  lastError: string | null;
}

export interface AppendEventInput {
  eventName: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  occurredBy?: string;
  schemaVersion?: number;
  occurredAt?: Date | string;
}

export type OutboxEventHandler = (event: OutboxEvent) => Promise<void>;
export type OutboxTransactionRunner = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export interface DispatchOutboxOptions {
  clock?: Clock;
  runner?: OutboxTransactionRunner;
}

interface OutboxRow extends QueryResultRow {
  event_id: string;
  event_name: string;
  schema_version: number;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
  occurred_by: string | null;
  published_at: Date | null;
  attempt_count: number;
  last_error: string | null;
}

const handlers = new Map<string, OutboxEventHandler[]>();
const MAX_BATCH_SIZE = 1_000;

function mapRow(row: OutboxRow): OutboxEvent {
  return {
    eventId: row.event_id,
    eventName: row.event_name,
    schemaVersion: row.schema_version,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    payload: row.payload,
    occurredAt: row.occurred_at,
    occurredBy: row.occurred_by,
    publishedAt: row.published_at,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
  };
}

/** 与业务写入同事务：tx 回滚时事件不会落库。 */
export async function appendEvent(
  tx: Tx,
  input: AppendEventInput,
  clock: Clock = systemClock,
): Promise<void> {
  const occurredAt = input.occurredAt ?? clock.now();
  await tx.query(
    `INSERT INTO sys_outbox_event
       (event_name, schema_version, aggregate_type, aggregate_id, payload, occurred_at, occurred_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.eventName,
      input.schemaVersion ?? 1,
      input.aggregateType,
      input.aggregateId,
      JSON.stringify(input.payload),
      occurredAt,
      input.occurredBy ?? null,
    ],
  );
}

/** 验收标准中的别名：outbox.enqueue(tx, event)。 */
export const enqueue = appendEvent;

export function registerEventHandler(eventName: string, handler: OutboxEventHandler): void {
  if (!eventName) {
    throw new Error('事件名不能为空');
  }
  const registered = handlers.get(eventName) ?? [];
  if (!registered.includes(handler)) {
    registered.push(handler);
  }
  handlers.set(eventName, registered);
}

/** 测试与热重载使用；业务代码不应在运行期清空处理器。 */
export function clearEventHandlers(): void {
  handlers.clear();
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return maskSensitiveText(message).slice(0, 1_000);
}

/**
 * 至少一次投递：锁定一批未发布事件，逐条调用已注册处理器，成功后标记 published_at；
 * 失败则累加 attempt_count 并保留未发布状态，下一轮继续投递。
 */
export async function dispatchPendingEvents(
  batchSize = 100,
  options: DispatchOutboxOptions = {},
): Promise<number> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`batchSize 必须是 1-${MAX_BATCH_SIZE} 的整数`);
  }

  const clock = options.clock ?? systemClock;
  const runner = options.runner ?? withTransaction;

  return runner(async (tx) => {
    const rows = await tx.query<OutboxRow>(
      `SELECT event_id, event_name, schema_version, aggregate_type, aggregate_id, payload,
              occurred_at, occurred_by, published_at, attempt_count, last_error
         FROM sys_outbox_event
        WHERE published_at IS NULL
        ORDER BY occurred_at, event_id
        FOR UPDATE SKIP LOCKED
        LIMIT $1`,
      [batchSize],
    );

    let delivered = 0;
    for (const row of rows) {
      const event = mapRow(row);
      const eventHandlers = handlers.get(event.eventName) ?? [];
      try {
        for (const handler of eventHandlers) {
          await handler(event);
        }
        await tx.query(
          `UPDATE sys_outbox_event SET published_at = $1, last_error = NULL WHERE event_id = $2`,
          [clock.now(), event.eventId],
        );
        delivered += 1;
      } catch (error) {
        await tx.query(
          `UPDATE sys_outbox_event SET attempt_count = attempt_count + 1, last_error = $1 WHERE event_id = $2`,
          [errorMessage(error), event.eventId],
        );
      }
    }
    return delivered;
  });
}
