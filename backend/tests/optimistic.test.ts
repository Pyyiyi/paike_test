import { describe, expect, it, vi } from 'vitest';
import { VersionConflictError } from '../src/shared/errors/app-error';
import {
  assertVersionMatches,
  guardVersion,
  updateWithVersion,
} from '../src/shared/db/optimistic';
import type { Tx } from '../src/shared/db/transaction';

const ID = '11111111-1111-4111-8111-111111111111';

describe('optimistic version guard', () => {
  it('throws VERSION_CONFLICT before calling the repository on mismatch', () => {
    const repository = { update: vi.fn() };
    const entity = { version: 2, name: '旧名称' };

    expect(() => guardVersion(entity, 3)).toThrow(VersionConflictError);
    expect(repository.update).not.toHaveBeenCalled();

    try {
      assertVersionMatches(2, 3);
    } catch (error) {
      expect((error as VersionConflictError).code).toBe('VERSION_CONFLICT');
      expect((error as VersionConflictError).httpStatus).toBe(409);
    }
  });

  it('returns the entity when versions match', () => {
    const entity = { version: 3, name: '课程表' };
    expect(guardVersion(entity, 3)).toBe(entity);
    expect(assertVersionMatches(3, 3)).toBeUndefined();
  });

  it('guarded SQL update throws VERSION_CONFLICT and reports 0 rows', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const tx = { query, queryOne: vi.fn(), queryMany: vi.fn() } as unknown as Tx;

    await expect(
      updateWithVersion(tx, {
        table: 'demo_item',
        id: ID,
        expectedVersion: 2,
        values: { name: '新名称' },
      }),
    ).rejects.toBeInstanceOf(VersionConflictError);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE id = $3');
    expect(sql).toContain('AND version = $2');
    expect(sql).toContain('version = version + 1');
    expect(params).toEqual(['新名称', 2, ID]);
  });

  it('returns the updated row when the guarded SQL affects one row', async () => {
    const updated = { id: ID, name: '新名称', version: 3 };
    const query = vi.fn().mockResolvedValue([updated]);
    const tx = { query, queryOne: vi.fn(), queryMany: vi.fn() } as unknown as Tx;

    await expect(
      updateWithVersion(tx, {
        table: 'demo_item',
        id: ID,
        expectedVersion: 2,
        values: { name: '新名称' },
      }),
    ).resolves.toEqual(updated);
  });

  it('rejects unsafe identifiers and empty updates', async () => {
    const query = vi.fn();
    const tx = { query, queryOne: vi.fn(), queryMany: vi.fn() } as unknown as Tx;

    await expect(
      updateWithVersion(tx, {
        table: 'demo; DROP TABLE sys_user',
        id: ID,
        expectedVersion: 1,
        values: { name: 'x' },
      }),
    ).rejects.toThrow('标识符');
    await expect(
      updateWithVersion(tx, { table: 'demo_item', id: ID, expectedVersion: 1, values: {} }),
    ).rejects.toThrow('至少需要一个');
    expect(query).not.toHaveBeenCalled();
  });
});
