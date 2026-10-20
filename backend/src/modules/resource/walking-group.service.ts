import type { Pool, QueryResultRow } from 'pg';
import { ConflictError, NotFoundError, VersionConflictError } from '../../shared/errors/app-error';
import { appendEvent } from '../../shared/events/outbox';
import type { Tx } from '../../shared/db/transaction';
import {
  assertActiveClasses,
  assertActiveSubject,
  assertActiveTeacher,
  assertActiveVenue,
  assertControlledName,
  assertNameAvailable,
  hasSchedulingUnitReference,
  nameDuplicateError,
  withResourceTransaction,
} from './resource.support';
import type { CreateWalkingGroupInput, UpdateWalkingGroupInput } from './resource.validation';
import type { WalkingGroup } from './resource.types';
import { SchedulingUnitQueryService } from './scheduling-unit-query.service';

interface WalkingRow extends QueryResultRow {
  walking_group_id: string;
  name: string;
  subject_id: string;
  teacher_id: string;
  venue_id: string;
  version: number;
}

interface MemberRow extends QueryResultRow {
  class_id: string;
}

function mapWalkingGroup(row: WalkingRow, classIds: string[]): WalkingGroup {
  return {
    walkingGroupId: row.walking_group_id,
    name: row.name,
    subjectId: row.subject_id,
    teacherId: row.teacher_id,
    venueId: row.venue_id,
    classIds,
    version: row.version,
  };
}

export class WalkingGroupService {
  readonly queries: SchedulingUnitQueryService;

  constructor(private readonly pool: Pool) {
    this.queries = new SchedulingUnitQueryService(pool);
  }

  async list(): Promise<WalkingGroup[]> {
    return withResourceTransaction(this.pool, async (tx) => {
      const rows = await tx.query<WalkingRow>(
        `SELECT walking_group_id, name, subject_id, teacher_id, venue_id, version
           FROM walking_group
          WHERE deleted_at IS NULL
          ORDER BY lower(name), walking_group_id`,
      );
      const result: WalkingGroup[] = [];
      for (const row of rows) {
        result.push(mapWalkingGroup(row, await this.loadMemberIds(tx, row.walking_group_id)));
      }
      return result;
    });
  }

  async create(input: CreateWalkingGroupInput, actorId?: string): Promise<WalkingGroup> {
    try {
      return await withResourceTransaction(this.pool, async (tx) => {
        await assertControlledName(tx, 'WALKING_GROUP', input.name);
        await assertNameAvailable(tx, 'walking_group', 'walking_group_id', input.name);
        await assertActiveSubject(tx, input.subjectId);
        await assertActiveTeacher(tx, input.teacherId);
        await assertActiveVenue(tx, input.venueId);
        await assertActiveClasses(tx, input.classIds);
        const rows = await tx.query<WalkingRow>(
          `INSERT INTO walking_group (name, subject_id, teacher_id, venue_id)
           VALUES ($1, $2, $3, $4)
           RETURNING walking_group_id, name, subject_id, teacher_id, venue_id, version`,
          [input.name, input.subjectId, input.teacherId, input.venueId],
        );
        const row = rows[0];
        if (!row) {
          throw new Error('创建走班后未返回记录');
        }
        await this.insertMembers(tx, row.walking_group_id, input.classIds);
        await appendEvent(tx, {
          eventName: 'bc.resource.walking-group.configured',
          aggregateType: 'WalkingGroup',
          aggregateId: row.walking_group_id,
          payload: {
            walkingGroupId: row.walking_group_id,
            subjectId: row.subject_id,
            teacherId: row.teacher_id,
            venueId: row.venue_id,
            classIds: input.classIds,
          },
          occurredBy: actorId,
        });
        return mapWalkingGroup(row, input.classIds);
      });
    } catch (error) {
      nameDuplicateError(error);
    }
  }

  async update(walkingGroupId: string, input: UpdateWalkingGroupInput, actorId?: string): Promise<WalkingGroup> {
    try {
      return await withResourceTransaction(this.pool, async (tx) => {
        const currentRows = await tx.query<WalkingRow>(
          `SELECT walking_group_id, name, subject_id, teacher_id, venue_id, version
             FROM walking_group
            WHERE walking_group_id = $1 AND deleted_at IS NULL
            FOR UPDATE`,
          [walkingGroupId],
        );
        const current = currentRows[0];
        if (!current) {
          throw new NotFoundError('走班不存在或已删除');
        }
        if (current.version !== input.version) {
          throw new VersionConflictError();
        }
        const name = input.name ?? current.name;
        const subjectId = input.subjectId ?? current.subject_id;
        const teacherId = input.teacherId ?? current.teacher_id;
        const venueId = input.venueId ?? current.venue_id;
        const classIds = input.classIds ?? (await this.loadMemberIds(tx, walkingGroupId));

        await assertControlledName(tx, 'WALKING_GROUP', name);
        await assertNameAvailable(tx, 'walking_group', 'walking_group_id', name, walkingGroupId);
        await assertActiveSubject(tx, subjectId);
        await assertActiveTeacher(tx, teacherId);
        await assertActiveVenue(tx, venueId);
        await assertActiveClasses(tx, classIds);

        const rows = await tx.query<WalkingRow>(
          `UPDATE walking_group
              SET name = $1,
                  subject_id = $2,
                  teacher_id = $3,
                  venue_id = $4,
                  version = version + 1
            WHERE walking_group_id = $5 AND version = $6 AND deleted_at IS NULL
            RETURNING walking_group_id, name, subject_id, teacher_id, venue_id, version`,
          [name, subjectId, teacherId, venueId, walkingGroupId, input.version],
        );
        const row = rows[0];
        if (!row) {
          throw new VersionConflictError();
        }
        await this.replaceMembers(tx, walkingGroupId, classIds);
        await appendEvent(tx, {
          eventName: 'bc.resource.walking-group.configured',
          aggregateType: 'WalkingGroup',
          aggregateId: walkingGroupId,
          payload: { walkingGroupId, subjectId, teacherId, venueId, classIds },
          occurredBy: actorId,
        });
        return mapWalkingGroup(row, classIds);
      });
    } catch (error) {
      nameDuplicateError(error);
    }
  }

  async delete(walkingGroupId: string, _actorId?: string): Promise<void> {
    await withResourceTransaction(this.pool, async (tx) => {
      const rows = await tx.query<WalkingRow>(
        `SELECT walking_group_id, name, subject_id, teacher_id, venue_id, version
           FROM walking_group
          WHERE walking_group_id = $1 AND deleted_at IS NULL
          FOR UPDATE`,
        [walkingGroupId],
      );
      if (!rows[0]) {
        throw new NotFoundError('走班不存在或已删除');
      }
      if (await hasSchedulingUnitReference(tx, 'WALKING_GROUP', walkingGroupId)) {
        throw new ConflictError('REFERENCE_PROTECTED', '该走班正被排课方案使用，暂时无法删除', [
          { field: 'walkingGroupId', message: '排课方案中存在引用此走班的课次' },
        ]);
      }
      await tx.query(
        'UPDATE walking_group SET deleted_at = now(), version = version + 1 WHERE walking_group_id = $1',
        [walkingGroupId],
      );
    });
  }

  private async loadMemberIds(tx: Tx, walkingGroupId: string): Promise<string[]> {
    const rows = await tx.query<MemberRow>(
      'SELECT class_id FROM walking_group_member WHERE walking_group_id = $1 ORDER BY class_id',
      [walkingGroupId],
    );
    return rows.map((row) => row.class_id);
  }

  private async insertMembers(tx: Tx, walkingGroupId: string, classIds: string[]): Promise<void> {
    await tx.query(
      `INSERT INTO walking_group_member (walking_group_id, class_id)
       SELECT $1, unnest($2::uuid[])`,
      [walkingGroupId, classIds],
    );
  }

  private async replaceMembers(tx: Tx, walkingGroupId: string, classIds: string[]): Promise<void> {
    await tx.query('DELETE FROM walking_group_member WHERE walking_group_id = $1', [walkingGroupId]);
    await this.insertMembers(tx, walkingGroupId, classIds);
  }
}
