import type { Tx } from '../../../shared/db/transaction';
import type { SemesterProps } from './semester.domain';
import { mapSemesterRow, type SemesterRow } from './semester.mapper';

const SEMESTER_COLUMNS = `semester_id, name, academic_year, term,
  start_date::text AS start_date, end_date::text AS end_date, status,
  schedule_template_version_id, is_current, version, created_at, updated_at`;

export interface ScheduleTemplateVersionLookup {
  versionId: string;
  templateId: string;
  templateName: string;
  versionNo: number;
  versionStatus: string;
  templateStatus: string;
  templateDeleted: boolean;
}

export async function findSemesterById(
  tx: Tx,
  semesterId: string,
  forUpdate = false,
): Promise<SemesterProps | null> {
  const rows = await tx.query<SemesterRow>(
    `SELECT ${SEMESTER_COLUMNS}
       FROM semester
      WHERE semester_id = $1 AND deleted_at IS NULL
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [semesterId],
  );
  return rows[0] ? mapSemesterRow(rows[0]) : null;
}

export async function findCurrentSemester(tx: Tx): Promise<SemesterProps | null> {
  const rows = await tx.query<SemesterRow>(
    `SELECT ${SEMESTER_COLUMNS}
       FROM semester
      WHERE is_current AND deleted_at IS NULL
      LIMIT 1`,
  );
  return rows[0] ? mapSemesterRow(rows[0]) : null;
}

export async function listSemesters(tx: Tx, includeArchived: boolean): Promise<SemesterProps[]> {
  const rows = await tx.query<SemesterRow>(
    `SELECT ${SEMESTER_COLUMNS}
       FROM semester
      WHERE deleted_at IS NULL
        ${includeArchived ? '' : "AND status <> 'ARCHIVED'"}
      ORDER BY start_date DESC, created_at DESC`,
  );
  return rows.map(mapSemesterRow);
}

export interface InsertSemesterInput {
  semesterId: string;
  name: string;
  academicYear: string;
  term: string;
  startDate: string;
  endDate: string;
  scheduleTemplateVersionId: string;
}

export async function insertSemester(tx: Tx, input: InsertSemesterInput): Promise<SemesterProps> {
  const rows = await tx.query<SemesterRow>(
    `INSERT INTO semester
       (semester_id, name, academic_year, term, start_date, end_date, status,
        schedule_template_version_id, is_current, version)
     VALUES ($1, $2, $3, $4, $5, $6, 'NOT_STARTED', $7, false, 1)
     RETURNING ${SEMESTER_COLUMNS}`,
    [
      input.semesterId,
      input.name,
      input.academicYear,
      input.term,
      input.startDate,
      input.endDate,
      input.scheduleTemplateVersionId,
    ],
  );
  const row = rows[0];
  if (!row) {
    throw new Error('学期写入失败');
  }
  return mapSemesterRow(row);
}

export interface UpdateSemesterValues {
  name?: string;
  academicYear?: string;
  term?: string;
  startDate?: string;
  endDate?: string;
  scheduleTemplateVersionId?: string;
}

export async function updateSemester(
  tx: Tx,
  semesterId: string,
  expectedVersion: number,
  values: UpdateSemesterValues,
): Promise<SemesterProps | null> {
  const columns = Object.keys(values).filter((key) => values[key as keyof UpdateSemesterValues] !== undefined);
  if (columns.length === 0) {
    const current = await findSemesterById(tx, semesterId);
    return current;
  }

  const columnMap: Record<string, string> = {
    name: 'name',
    academicYear: 'academic_year',
    term: 'term',
    startDate: 'start_date',
    endDate: 'end_date',
    scheduleTemplateVersionId: 'schedule_template_version_id',
  };
  const assignments = columns.map((column, index) => `${columnMap[column]} = $${index + 1}`);
  const params: unknown[] = columns.map((column) => values[column as keyof UpdateSemesterValues]);
  params.push(expectedVersion, semesterId);

  const rows = await tx.query<SemesterRow>(
    `UPDATE semester
        SET ${assignments.join(', ')}, version = version + 1
      WHERE semester_id = $${params.length} AND version = $${params.length - 1}
        AND deleted_at IS NULL
      RETURNING ${SEMESTER_COLUMNS}`,
    params,
  );
  return rows[0] ? mapSemesterRow(rows[0]) : null;
}

export async function softDeleteSemester(
  tx: Tx,
  semesterId: string,
  expectedVersion: number,
): Promise<boolean> {
  const rows = await tx.query<{ semester_id: string }>(
    `UPDATE semester
        SET deleted_at = now(), is_current = false, version = version + 1
      WHERE semester_id = $1 AND version = $2 AND deleted_at IS NULL
      RETURNING semester_id`,
    [semesterId, expectedVersion],
  );
  return rows.length > 0;
}

export async function setSemesterStatus(
  tx: Tx,
  semesterId: string,
  status: string,
  isCurrent?: boolean,
): Promise<SemesterProps | null> {
  const rows = await tx.query<SemesterRow>(
    `UPDATE semester
        SET status = $2,
            is_current = COALESCE($3, is_current),
            version = version + 1
      WHERE semester_id = $1 AND deleted_at IS NULL
      RETURNING ${SEMESTER_COLUMNS}`,
    [semesterId, status, isCurrent ?? null],
  );
  return rows[0] ? mapSemesterRow(rows[0]) : null;
}

export async function findTemplateVersion(
  tx: Tx,
  versionId: string,
): Promise<ScheduleTemplateVersionLookup | null> {
  const rows = await tx.query<{
    version_id: string;
    template_id: string;
    template_name: string;
    version_no: number;
    version_status: string;
    template_status: string;
    deleted_at: Date | null;
  }>(
    `SELECT v.version_id, v.template_id, t.name AS template_name, v.version_no,
            v.status AS version_status, t.status AS template_status, t.deleted_at
       FROM schedule_template_version v
       JOIN schedule_template t ON t.template_id = v.template_id
      WHERE v.version_id = $1`,
    [versionId],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    versionId: row.version_id,
    templateId: row.template_id,
    templateName: row.template_name,
    versionNo: row.version_no,
    versionStatus: row.version_status,
    templateStatus: row.template_status,
    templateDeleted: row.deleted_at !== null,
  };
}

export async function isTemplateReferencedBySemester(tx: Tx, templateId: string): Promise<boolean> {
  const rows = await tx.query<{ referenced: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM semester s
         JOIN schedule_template_version v ON v.version_id = s.schedule_template_version_id
        WHERE v.template_id = $1 AND s.deleted_at IS NULL
     ) AS referenced`,
    [templateId],
  );
  return rows[0]?.referenced ?? false;
}

export async function isVersionReferencedBySemester(tx: Tx, versionId: string): Promise<boolean> {
  const rows = await tx.query<{ referenced: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM semester
        WHERE schedule_template_version_id = $1 AND deleted_at IS NULL
     ) AS referenced`,
    [versionId],
  );
  return rows[0]?.referenced ?? false;
}

async function tableExists(tx: Tx, tableName: string): Promise<boolean> {
  const rows = await tx.query<{ available: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS available`,
    [tableName],
  );
  return rows[0]?.available ?? false;
}

/** D05 落地后用于阻止删除已有排课方案的学期；表不存在时返回 false。 */
export async function hasTimetableReference(tx: Tx, semesterId: string): Promise<boolean> {
  if (!(await tableExists(tx, 'timetable_plan'))) {
    return false;
  }
  const rows = await tx.query<{ referenced: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM timetable_plan
        WHERE semester_id = $1 AND deleted_at IS NULL
     ) AS referenced`,
    [semesterId],
  );
  return rows[0]?.referenced ?? false;
}

/** D07 落地后用于阻止删除已存档快照的学期；表不存在时返回 false。 */
export async function hasArchiveReference(tx: Tx, semesterId: string): Promise<boolean> {
  if (!(await tableExists(tx, 'semester_archive'))) {
    return false;
  }
  const rows = await tx.query<{ referenced: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM semester_archive WHERE semester_id = $1) AS referenced`,
    [semesterId],
  );
  return rows[0]?.referenced ?? false;
}

/** D05 落地后用于阻止更换已排课学期的模板版本（A-08.4）。 */
export async function semesterHasTimetablePlan(tx: Tx, semesterId: string): Promise<boolean> {
  return hasTimetableReference(tx, semesterId);
}
