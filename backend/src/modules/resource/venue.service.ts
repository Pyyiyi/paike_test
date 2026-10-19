import type { Pool } from 'pg';
import { ConflictError, NotFoundError, ValidationError, VersionConflictError } from '../../shared/errors/app-error';
import { appendEvent } from '../../shared/events/outbox';
import { VenueQueryService, mapVenue, type VenueRow } from './venue-query.service';
import { assertControlledName, assertNameAvailable, hasReference, nameDuplicateError, withResourceTransaction } from './resource.support';
import type { CreateVenueInput, UpdateVenueInput } from './resource.validation';
import type { Venue } from './resource.types';

export class VenueService {
  readonly queries: VenueQueryService;

  constructor(private readonly pool: Pool) {
    this.queries = new VenueQueryService(pool);
  }

  async create(input: CreateVenueInput, actorId?: string): Promise<Venue> {
    try {
      return await withResourceTransaction(this.pool, async (tx) => {
        await assertControlledName(tx, 'VENUE', input.name);
        await assertNameAvailable(tx, 'venue', 'venue_id', input.name);
        const rows = await tx.query<VenueRow>(
          `INSERT INTO venue (name, type, capacity, status)
           VALUES ($1, $2::venue_type, $3, $4::venue_status)
           RETURNING venue_id, name, type, capacity, status, version`,
          [input.name, input.type, input.capacity, input.status ?? 'AVAILABLE'],
        );
        const row = rows[0];
        if (!row) {
          throw new Error('创建场地后未返回记录');
        }
        const venue = mapVenue(row);
        await appendEvent(tx, {
          eventName: 'bc.resource.venue.created',
          aggregateType: 'Venue',
          aggregateId: venue.venueId,
          payload: { venueId: venue.venueId, name: venue.name, type: venue.type },
          occurredBy: actorId,
        });
        return venue;
      });
    } catch (error) {
      nameDuplicateError(error);
    }
  }

  async update(venueId: string, input: UpdateVenueInput, actorId?: string): Promise<Venue> {
    try {
      return await withResourceTransaction(this.pool, async (tx) => {
        const currentRows = await tx.query<VenueRow>(
          `SELECT venue_id, name, type, capacity, status, version
             FROM venue
            WHERE venue_id = $1 AND deleted_at IS NULL
            FOR UPDATE`,
          [venueId],
        );
        const current = currentRows[0];
        if (!current) {
          throw new NotFoundError('场地不存在或已删除');
        }
        if (current.version !== input.version) {
          throw new VersionConflictError();
        }
        if (input.name && input.name !== current.name) {
          await assertControlledName(tx, 'VENUE', input.name);
          await assertNameAvailable(tx, 'venue', 'venue_id', input.name, venueId);
        }
        const rows = await tx.query<VenueRow>(
          `UPDATE venue
              SET name = COALESCE($1, name),
                  type = COALESCE($2::venue_type, type),
                  capacity = COALESCE($3, capacity),
                  status = COALESCE($4::venue_status, status),
                  version = version + 1
            WHERE venue_id = $5 AND version = $6 AND deleted_at IS NULL
            RETURNING venue_id, name, type, capacity, status, version`,
          [input.name ?? null, input.type ?? null, input.capacity ?? null, input.status ?? null, venueId, input.version],
        );
        const row = rows[0];
        if (!row) {
          throw new VersionConflictError();
        }
        await appendEvent(tx, {
          eventName: 'bc.resource.venue.created',
          aggregateType: 'Venue',
          aggregateId: venueId,
          payload: { venueId, name: row.name, type: row.type },
          occurredBy: actorId,
        });
        return mapVenue(row);
      });
    } catch (error) {
      nameDuplicateError(error);
    }
  }

  async delete(venueId: string, _actorId?: string): Promise<void> {
    await withResourceTransaction(this.pool, async (tx) => {
      const rows = await tx.query<VenueRow>(
        `SELECT venue_id, name, type, capacity, status, version
           FROM venue
          WHERE venue_id = $1 AND deleted_at IS NULL
          FOR UPDATE`,
        [venueId],
      );
      if (!rows[0]) {
        throw new NotFoundError('场地不存在或已删除');
      }

      const references: string[] = [];
      if (await hasReference(tx, 'combined_class', 'venue_id', venueId, 'deleted_at')) {
        references.push('合班课');
      }
      if (await hasReference(tx, 'walking_group', 'venue_id', venueId, 'deleted_at')) {
        references.push('走班配置');
      }
      if (await hasReference(tx, 'teaching_assignment', 'venue_id', venueId, 'deleted_at')) {
        references.push('任课配置');
      }
      if (await hasReference(tx, 'lesson', 'venue_id', venueId)) {
        references.push('排课课次');
      }
      if (references.length > 0) {
        throw new ConflictError('REFERENCE_PROTECTED', '该场地正被使用，暂时无法删除', [
          { field: 'venueId', message: `被${references.join('、')}引用` },
        ]);
      }

      await tx.query(
        'UPDATE venue SET deleted_at = now(), version = version + 1 WHERE venue_id = $1',
        [venueId],
      );
    });
  }

  async validateCapacityForClasses(venueId: string, studentCounts: number[]): Promise<void> {
    const capacity = await this.queries.getCapacity(venueId);
    if (capacity === null) {
      throw new ValidationError('场地不存在', [{ field: 'venueId', message: '请选择有效场地' }]);
    }
    if (studentCounts.some((count) => count > capacity)) {
      throw new ValidationError('班级人数超过场地容量', [
        { field: 'venueId', message: `目标场地容量为 ${capacity}，请更换场地` },
      ]);
    }
  }
}
