import type { Pool, QueryResultRow } from 'pg';
import type { Tx } from '../../shared/db/transaction';
import { ConflictError, NotFoundError, VersionConflictError } from '../../shared/errors/app-error';
import { appendEvent } from '../../shared/events/outbox';
import {
  assertActiveClasses,
  assertActiveTeacher,
  assertActiveVenue,
  assertControlledName,
  assertNameAvailable,
  hasSchedulingUnitReference,
  nameDuplicateError,
  withResourceTransaction,
} from './resource.support';
import type { CreateCombinedClassInput, UpdateCombinedClassInput } from './resource.validation';
import { coercePeriodConstraint } from './resource.validation';
import type { CombinedClass, PeriodConstraint } from './resource.types';
import { SchedulingUnitQueryService } from './scheduling-unit-query.service';

interface CombinedRow extends QueryResultRow {
  combined_class_id: string;
  name: string;
  teacher_id: string;
  venue_id: string;
  period_constraint: unknown;
  version: number;
}

interface MemberRow extends QueryResultRow {
  class_id: string;
}

function mapCombined(row: CombinedRow, classIds: string[]): CombinedClass {
  let periodConstraint: PeriodConstraint = { slots: [] };
  try {
    periodConstraint = coercePeriodConstraint(row.period_constraint);
  } catch {
    periodConstraint = { slots: [] };
  }
  return {
    combinedClassId: row.combined_class_id,
    name: row.name,
    teacherId: row.teacher_id,
    venueId: row.venue_id,
    classIds,
    periodConstraint,
    version: row.version,
  };
}

export class CombinedClassService {
  readonly queries: SchedulingUnitQueryService;

  constructor(private readonly pool: Pool) {
    this.queries = new SchedulingUnitQueryService(pool);
  }

  async list(): Promise<CombinedClass[]> {
    return withResourceTransaction(this.pool, async (tx) => {
      const rows = await tx.query<CombinedRow>(
        `SELECT combined_class_id, name, teacher_id, venue_id, period_constraint, version
           FROM combined_class
          WHERE deleted_at IS NULL
          ORDER BY lower(name), combined_class_id`,
      );
      const result: CombinedClass[] = [];
      for (const row of rows) {
        result.push(mapCombined(row, await this.loadMemberIds(tx, row.combined_class_id)));
      }
      return result;
    });
  }

  async create(input: CreateCombinedClassInput, actorId?: string): Promise<CombinedClass> {
    try {
      return await withResourceTransaction(this.pool, async (tx) => {
        await assertControlledName(tx, 'COMBINED_CLASS', input.name);
        await assertNameAvailable(tx, 'combined_class', 'combined_class_id', input.name);
        await assertActiveClasses(tx, input.classIds);
        await assertActiveTeacher(tx, input.teacherId);
        await assertActiveVenue(tx, input.venueId);
        const periodConstraint = input.periodConstraint ?? { slots: [] };
        const rows = await tx.query<CombinedRow>(
          `INSERT INTO combined_class (name, teacher_id, venue_id, period_constraint)
           VALUES ($1, $2, $3, $4::jsonb)
           RETURNING combined_class_id, name, teacher_id, venue_id, period_constraint, version`,
          [input.name, input.teacherId, input.venueId, JSON.stringify(periodConstraint)],
        );
        const row = rows[0];
        if (!row) {
          throw new Error('创建合班后未返回记录');
        }
        await this.insertMembers(tx, row.combined_class_id, input.classIds);
        await appendEvent(tx, {
          eventName: 'bc.resource.combined-class.configured',
          aggregateType: 'CombinedClass',
          aggregateId: row.combined_class_id,
          payload: {
            combinedClassId: row.combined_class_id,
            teacherId: row.teacher_id,
            venueId: row.venue_id,
            classIds: input.classIds,
            periodConstraint,
          },
          occurredBy: actorId,
        });
        return mapCombined(row, input.classIds);
      });
    } catch (error) {
      nameDuplicateError(error);
    }
  }

  async update(combinedClassId: string, input: UpdateCombinedClassInput, actorId?: string): Promise<CombinedClass> {
    try {
      return await withResourceTransaction(this.pool, async (tx) => {
        const currentRows = await tx.query<CombinedRow>(
          `SELECT combined_class_id, name, teacher_id, venue_id, period_constraint, version
             FROM combined_class
            WHERE combined_class_id = $1 AND deleted_at IS NULL
            FOR UPDATE`,
          [combinedClassId],
        );
        const current = currentRows[0];
        if (!current) {
          throw new NotFoundError('合班不存在或已删除');
        }
        if (current.version !== input.version) {
          throw new VersionConflictError();
        }
        const classIds = input.classIds ?? (await this.loadMemberIds(tx, combinedClassId));
        const teacherId = input.teacherId ?? current.teacher_id;
        const venueId = input.venueId ?? current.venue_id;
        const periodConstraint = input.periodConstraint ?? coercePeriodConstraint(current.period_constraint);
        const name = input.name ?? current.name;

        await assertControlledName(tx, 'COMBINED_CLASS', name);
        await assertNameAvailable(tx, 'combined_class', 'combined_class_id', name, combinedClassId);
        await assertActiveClasses(tx, classIds);
        await assertActiveTeacher(tx, teacherId);
        await assertActiveVenue(tx, venueId);

        const rows = await tx.query<CombinedRow>(
          `UPDATE combined_class
              SET name = $1,
                  teacher_id = $2,
                  venue_id = $3,
                  period_constraint = $4::jsonb,
                  version = version + 1
            WHERE combined_class_id = $5 AND version = $6 AND deleted_at IS NULL
            RETURNING combined_class_id, name, teacher_id, venue_id, period_constraint, version`,
          [name, teacherId, venueId, JSON.stringify(periodConstraint), combinedClassId, input.version],
        );
        const row = rows[0];
        if (!row) {
          throw new VersionConflictError();
        }
        await this.replaceMembers(tx, combinedClassId, classIds);
        await appendEvent(tx, {
          eventName: 'bc.resource.combined-class.configured',
          aggregateType: 'CombinedClass',
          aggregateId: combinedClassId,
          payload: { combinedClassId, teacherId, venueId, classIds, periodConstraint },
          occurredBy: actorId,
        });
        return mapCombined(row, classIds);
      });
    } catch (error) {
      nameDuplicateError(error);
    }
  }

  async delete(combinedClassId: string, _actorId?: string): Promise<void> {
    await withResourceTransaction(this.pool, async (tx) => {
      const rows = await tx.query<CombinedRow>(
        `SELECT combined_class_id, name, teacher_id, venue_id, period_constraint, version
           FROM combined_class
          WHERE combined_class_id = $1 AND deleted_at IS NULL
          FOR UPDATE`,
        [combinedClassId],
      );
      if (!rows[0]) {
        throw new NotFoundError('合班不存在或已删除');
      }
      if (await hasSchedulingUnitReference(tx, 'COMBINED_CLASS', combinedClassId)) {
        throw new ConflictError('REFERENCE_PROTECTED', '该合班正被排课方案使用，暂时无法删除', [
          { field: 'combinedClassId', message: '排课方案中存在引用此合班的课次' },
        ]);
      }
      await tx.query(
        'UPDATE combined_class SET deleted_at = now(), version = version + 1 WHERE combined_class_id = $1',
        [combinedClassId],
      );
    });
  }

  private async loadMemberIds(queryable: Tx, combinedClassId: string): Promise<string[]> {
    const rows = await queryable.query<MemberRow>(
      `SELECT class_id FROM combined_class_member
        WHERE combined_class_id = $1 ORDER BY class_id`,
      [combinedClassId],
    );
    return rows.map((row) => row.class_id);
  }

  private async insertMembers(
    tx: Tx,
    combinedClassId: string,
    classIds: string[],
  ): Promise<void> {
    await tx.query(
      `INSERT INTO combined_class_member (combined_class_id, class_id)
       SELECT $1, unnest($2::uuid[])`,
      [combinedClassId, classIds],
    );
  }

  private async replaceMembers(
    tx: Tx,
    combinedClassId: string,
    classIds: string[],
  ): Promise<void> {
    await tx.query('DELETE FROM combined_class_member WHERE combined_class_id = $1', [combinedClassId]);
    await this.insertMembers(tx, combinedClassId, classIds);
  }
}
