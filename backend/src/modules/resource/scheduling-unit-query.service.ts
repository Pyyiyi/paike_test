import type { Pool, QueryResultRow } from 'pg';
import { asQueryable, type Queryable } from './resource.support';
import type { PeriodConstraint, SchedulingUnitSnapshot, SchedulingUnitType } from './resource.types';
import { coercePeriodConstraint } from './resource.validation';

export interface SchedulingUnitListOptions {
  teacherId?: string;
  venueId?: string;
  classId?: string;
}

interface CombinedRow extends QueryResultRow {
  unit_id: string;
  name: string;
  teacher_id: string;
  venue_id: string;
  period_constraint: unknown;
  class_ids: string[];
}

interface WalkingRow extends QueryResultRow {
  unit_id: string;
  name: string;
  subject_id: string;
  teacher_id: string;
  venue_id: string;
  class_ids: string[];
}

function mapCombined(row: CombinedRow): SchedulingUnitSnapshot {
  return {
    unitId: row.unit_id,
    unitType: 'COMBINED_CLASS',
    name: row.name,
    subjectId: null,
    teacherId: row.teacher_id,
    venueId: row.venue_id,
    classIds: row.class_ids,
    periodConstraint: safePeriodConstraint(row.period_constraint),
  };
}

function mapWalking(row: WalkingRow): SchedulingUnitSnapshot {
  return {
    unitId: row.unit_id,
    unitType: 'WALKING_GROUP',
    name: row.name,
    subjectId: row.subject_id,
    teacherId: row.teacher_id,
    venueId: row.venue_id,
    classIds: row.class_ids,
    periodConstraint: { slots: [] },
  };
}

function safePeriodConstraint(value: unknown): PeriodConstraint {
  try {
    return coercePeriodConstraint(value);
  } catch {
    return { slots: [] };
  }
}

function snapshotOrder(left: SchedulingUnitSnapshot, right: SchedulingUnitSnapshot): number {
  return (
    left.unitType.localeCompare(right.unitType) ||
    left.name.localeCompare(right.name, 'zh-CN') ||
    left.unitId.localeCompare(right.unitId)
  );
}

/** D05 read model: combined classes and walking groups as immutable scheduling units. */
export class SchedulingUnitQueryService {
  private readonly queryable: Queryable;

  constructor(source: Pool | Queryable) {
    this.queryable = asQueryable(source);
  }

  async list(options: SchedulingUnitListOptions = {}): Promise<SchedulingUnitSnapshot[]> {
    const params: unknown[] = [];
    const combinedConditions = ['c.deleted_at IS NULL'];
    const walkingConditions = ['w.deleted_at IS NULL'];
    if (options.teacherId) {
      params.push(options.teacherId);
      combinedConditions.push(`c.teacher_id = $${params.length}`);
      walkingConditions.push(`w.teacher_id = $${params.length}`);
    }
    if (options.venueId) {
      params.push(options.venueId);
      combinedConditions.push(`c.venue_id = $${params.length}`);
      walkingConditions.push(`w.venue_id = $${params.length}`);
    }
    if (options.classId) {
      params.push(options.classId);
      combinedConditions.push(
        `EXISTS (SELECT 1 FROM combined_class_member m WHERE m.combined_class_id = c.combined_class_id AND m.class_id = $${params.length})`,
      );
      walkingConditions.push(
        `EXISTS (SELECT 1 FROM walking_group_member m WHERE m.walking_group_id = w.walking_group_id AND m.class_id = $${params.length})`,
      );
    }

    const combined = await this.queryable.query<CombinedRow>(
      `SELECT c.combined_class_id AS unit_id, c.name, c.teacher_id, c.venue_id,
              c.period_constraint,
              COALESCE(array_agg(m.class_id ORDER BY m.class_id)
                FILTER (WHERE m.class_id IS NOT NULL), '{}'::uuid[]) AS class_ids
         FROM combined_class c
         LEFT JOIN combined_class_member m ON m.combined_class_id = c.combined_class_id
        WHERE ${combinedConditions.join(' AND ')}
        GROUP BY c.combined_class_id
        ORDER BY lower(c.name), c.combined_class_id`,
      params,
    );
    const walking = await this.queryable.query<WalkingRow>(
      `SELECT w.walking_group_id AS unit_id, w.name, w.subject_id, w.teacher_id, w.venue_id,
              COALESCE(array_agg(m.class_id ORDER BY m.class_id)
                FILTER (WHERE m.class_id IS NOT NULL), '{}'::uuid[]) AS class_ids
         FROM walking_group w
         LEFT JOIN walking_group_member m ON m.walking_group_id = w.walking_group_id
        WHERE ${walkingConditions.join(' AND ')}
        GROUP BY w.walking_group_id
        ORDER BY lower(w.name), w.walking_group_id`,
      params,
    );
    return [...combined.map(mapCombined), ...walking.map(mapWalking)].sort(snapshotOrder);
  }

  async getById(unitType: SchedulingUnitType, unitId: string): Promise<SchedulingUnitSnapshot | null> {
    if (unitType === 'COMBINED_CLASS') {
      const rows = await this.queryable.query<CombinedRow>(
        `SELECT c.combined_class_id AS unit_id, c.name, c.teacher_id, c.venue_id,
                c.period_constraint,
                COALESCE(array_agg(m.class_id ORDER BY m.class_id)
                  FILTER (WHERE m.class_id IS NOT NULL), '{}'::uuid[]) AS class_ids
           FROM combined_class c
           LEFT JOIN combined_class_member m ON m.combined_class_id = c.combined_class_id
          WHERE c.combined_class_id = $1 AND c.deleted_at IS NULL
          GROUP BY c.combined_class_id`,
        [unitId],
      );
      return rows[0] ? mapCombined(rows[0]) : null;
    }
    const rows = await this.queryable.query<WalkingRow>(
      `SELECT w.walking_group_id AS unit_id, w.name, w.subject_id, w.teacher_id, w.venue_id,
              COALESCE(array_agg(m.class_id ORDER BY m.class_id)
                FILTER (WHERE m.class_id IS NOT NULL), '{}'::uuid[]) AS class_ids
         FROM walking_group w
         LEFT JOIN walking_group_member m ON m.walking_group_id = w.walking_group_id
        WHERE w.walking_group_id = $1 AND w.deleted_at IS NULL
        GROUP BY w.walking_group_id`,
      [unitId],
    );
    return rows[0] ? mapWalking(rows[0]) : null;
  }
}
