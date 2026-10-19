import { describe, expect, it, vi } from 'vitest';
import { appendEvent, enqueue } from '../src/shared/events/outbox';
import type { Tx } from '../src/shared/db/transaction';
import { fixedClock } from '../src/shared/time/clock';

const AGGREGATE_ID = '11111111-1111-4111-8111-111111111111';

describe('outbox enqueue', () => {
  it('inserts the event through the supplied transaction', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const tx = { query, queryOne: vi.fn(), queryMany: vi.fn() } as unknown as Tx;
    const clock = fixedClock('2026-09-01T00:00:00.000Z');

    await appendEvent(
      tx,
      {
        eventName: 'bc.registry.semester.created',
        aggregateType: 'semester',
        aggregateId: AGGREGATE_ID,
        payload: { name: '2026 秋季' },
        occurredBy: AGGREGATE_ID,
      },
      clock,
    );

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO sys_outbox_event');
    expect(params).toEqual([
      'bc.registry.semester.created',
      1,
      'semester',
      AGGREGATE_ID,
      JSON.stringify({ name: '2026 秋季' }),
      clock.now(),
      AGGREGATE_ID,
    ]);
  });

  it('exposes enqueue as the acceptance-criteria alias', () => {
    expect(enqueue).toBe(appendEvent);
  });
});
