import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { ConflictError, ValidationError } from '../../shared/errors/app-error';
import { executeTransaction, type Tx } from '../../shared/db/transaction';

export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<T[]>;
}

export function asQueryable(source: Pool | Queryable): Queryable {
  if (typeof (source as Pool).connect === 'function') {
    const pool = source as Pool;
    return {
      query: async <T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) =>
        (await pool.query<T>(text, values)).rows,
    };
  }
  return source as Queryable;
}

export async function withResourceTransaction<T>(
  pool: Pool,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const client: PoolClient = await pool.connect();
  try {
    return await executeTransaction(client, fn);
  } finally {
    client.release();
  }
}

export async function tableExists(queryable: Queryable, table: string): Promise<boolean> {
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) {
    throw new Error(`非法表名：${table}`);
  }
  const rows = await queryable.query<{ exists: boolean }>(
    'SELECT to_regclass($1) IS NOT NULL AS exists',
    [table],
  );
  return rows[0]?.exists === true;
}

export async function assertControlledName(
  queryable: Queryable,
  type: 'VENUE' | 'COMBINED_CLASS' | 'WALKING_GROUP',
  name: string,
  field = 'name',
): Promise<void> {
  const rows = await queryable.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM sys_controlled_vocabulary
        WHERE vocab_type = $1
          AND is_active = true
          AND lower(canonical_name) = lower($2)
     ) AS exists`,
    [type, name],
  );
  if (rows[0]?.exists !== true) {
    throw new ValidationError('名称不符合受控词表要求', [
      { field, message: '请选择受控词表中的名称' },
    ]);
  }
}

export async function assertActiveTeacher(queryable: Queryable, teacherId: string): Promise<void> {
  const rows = await queryable.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM teacher
        WHERE teacher_id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL
     ) AS exists`,
    [teacherId],
  );
  if (rows[0]?.exists !== true) {
    throw new ValidationError('教师不存在或已退校', [
      { field: 'teacherId', message: '请选择在职教师' },
    ]);
  }
}

export async function assertActiveSubject(queryable: Queryable, subjectId: string): Promise<void> {
  const rows = await queryable.query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM subject WHERE subject_id = $1 AND deleted_at IS NULL) AS exists',
    [subjectId],
  );
  if (rows[0]?.exists !== true) {
    throw new ValidationError('科目不存在', [{ field: 'subjectId', message: '请选择有效科目' }]);
  }
}

export async function assertActiveVenue(
  queryable: Queryable,
  venueId: string,
  field = 'venueId',
): Promise<void> {
  const rows = await queryable.query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM venue WHERE venue_id = $1 AND deleted_at IS NULL) AS exists',
    [venueId],
  );
  if (rows[0]?.exists !== true) {
    throw new ValidationError('场地不存在', [{ field, message: '请选择有效场地' }]);
  }
}

export async function assertActiveClasses(queryable: Queryable, classIds: string[]): Promise<void> {
  const rows = await queryable.query<{ class_id: string }>(
    `SELECT class_id
       FROM class
      WHERE class_id = ANY($1::uuid[])
        AND deleted_at IS NULL`,
    [classIds],
  );
  const found = new Set(rows.map((row) => row.class_id));
  const missing = classIds.filter((classId) => !found.has(classId));
  if (missing.length > 0) {
    throw new ValidationError('部分班级不存在或已删除', [
      { field: 'classIds', message: `无效班级：${missing.join(', ')}` },
    ]);
  }
}

export async function assertNameAvailable(
  queryable: Queryable,
  table: 'venue' | 'combined_class' | 'walking_group',
  idColumn: 'venue_id' | 'combined_class_id' | 'walking_group_id',
  name: string,
  excludeId?: string,
): Promise<void> {
  const rows = await queryable.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM ${table}
        WHERE lower(name) = lower($1)
          AND deleted_at IS NULL
          AND ($2::uuid IS NULL OR ${idColumn} <> $2::uuid)
     ) AS exists`,
    [name, excludeId ?? null],
  );
  if (rows[0]?.exists === true) {
    throw new ConflictError('DUPLICATE', '该名称已存在，请更换后重试', [
      { field: 'name', message: '名称与现有记录重复' },
    ]);
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === '23505',
  );
}

export function nameDuplicateError(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw new ConflictError('DUPLICATE', '该名称已存在，请更换后重试', [
      { field: 'name', message: '名称与现有记录重复' },
    ]);
  }
  throw error;
}

export async function hasReference(
  queryable: Queryable,
  table: string,
  column: string,
  id: string,
  activeColumn?: 'deleted_at',
): Promise<boolean> {
  if (!(await tableExists(queryable, table))) {
    return false;
  }
  if (!/^[a-z_][a-z0-9_]*$/.test(column)) {
    throw new Error(`非法列名：${column}`);
  }
  const deletedFilter = activeColumn ? ` AND ${activeColumn} IS NULL` : '';
  const rows = await queryable.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM ${table} WHERE ${column} = $1${deletedFilter}) AS exists`,
    [id],
  );
  return rows[0]?.exists === true;
}

export async function hasSchedulingUnitReference(
  queryable: Queryable,
  unitType: 'COMBINED_CLASS' | 'WALKING_GROUP',
  unitId: string,
): Promise<boolean> {
  for (const table of ['lesson', 'unscheduled_lesson']) {
    if (!(await tableExists(queryable, table))) {
      continue;
    }
    const rows = await queryable.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM ${table}
          WHERE unit_type = $1::scheduling_unit_type
            AND unit_id = $2
       ) AS exists`,
      [unitType, unitId],
    );
    if (rows[0]?.exists === true) {
      return true;
    }
  }
  return false;
}
