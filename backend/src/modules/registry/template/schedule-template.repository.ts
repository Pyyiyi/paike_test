import type { Tx } from '../../../shared/db/transaction';
import type { TemplateContent } from './schedule-template.domain';
import {
  mapTemplateRow,
  mapVersionRow,
  type ScheduleTemplateRow,
  type ScheduleTemplateVersionRow,
} from './schedule-template.mapper';
import type { ScheduleTemplateProps, ScheduleTemplateVersionProps } from './schedule-template.domain';

const TEMPLATE_COLUMNS = `template_id, name, status, latest_version_no, version, created_at, updated_at`;
const VERSION_COLUMNS = `version_id, template_id, version_no, open_weekdays, periods, status, created_at`;

export async function findTemplateById(
  tx: Tx,
  templateId: string,
  forUpdate = false,
): Promise<ScheduleTemplateProps | null> {
  const rows = await tx.query<ScheduleTemplateRow>(
    `SELECT ${TEMPLATE_COLUMNS}
       FROM schedule_template
      WHERE template_id = $1 AND deleted_at IS NULL
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [templateId],
  );
  return rows[0] ? mapTemplateRow(rows[0]) : null;
}

export async function findTemplateByName(
  tx: Tx,
  name: string,
): Promise<ScheduleTemplateProps | null> {
  const rows = await tx.query<ScheduleTemplateRow>(
    `SELECT ${TEMPLATE_COLUMNS}
       FROM schedule_template
      WHERE lower(name) = lower($1) AND deleted_at IS NULL`,
    [name],
  );
  return rows[0] ? mapTemplateRow(rows[0]) : null;
}

export interface TemplateWithLatestRow extends ScheduleTemplateRow {
  latest_version_id: string | null;
  latest_version_no_value: number | null;
  latest_open_weekdays: number[] | null;
  latest_periods: ScheduleTemplateVersionRow['periods'] | null;
  latest_status: ScheduleTemplateVersionRow['status'] | null;
  latest_created_at: Date | null;
}

export async function listTemplateRows(tx: Tx): Promise<TemplateWithLatestRow[]> {
  return tx.query<TemplateWithLatestRow>(
    `SELECT t.template_id, t.name, t.status, t.latest_version_no, t.version,
            t.created_at, t.updated_at,
            v.version_id AS latest_version_id,
            v.version_no AS latest_version_no_value,
            v.open_weekdays AS latest_open_weekdays,
            v.periods AS latest_periods,
            v.status AS latest_status,
            v.created_at AS latest_created_at
       FROM schedule_template t
       LEFT JOIN schedule_template_version v
         ON v.template_id = t.template_id AND v.version_no = t.latest_version_no
      WHERE t.deleted_at IS NULL
      ORDER BY t.name ASC`,
  );
}

export interface InsertTemplateInput {
  templateId: string;
  name: string;
}

export async function insertTemplate(tx: Tx, input: InsertTemplateInput): Promise<ScheduleTemplateProps> {
  const rows = await tx.query<ScheduleTemplateRow>(
    `INSERT INTO schedule_template (template_id, name, status, latest_version_no, version)
     VALUES ($1, $2, 'ACTIVE', 1, 1)
     RETURNING ${TEMPLATE_COLUMNS}`,
    [input.templateId, input.name],
  );
  const row = rows[0];
  if (!row) {
    throw new Error('作息模板写入失败');
  }
  return mapTemplateRow(row);
}

export async function updateTemplateLatestVersion(
  tx: Tx,
  templateId: string,
  expectedVersion: number,
  latestVersionNo: number,
): Promise<ScheduleTemplateProps | null> {
  const rows = await tx.query<ScheduleTemplateRow>(
    `UPDATE schedule_template
        SET latest_version_no = $1, version = version + 1
      WHERE template_id = $2 AND version = $3 AND deleted_at IS NULL
      RETURNING ${TEMPLATE_COLUMNS}`,
    [latestVersionNo, templateId, expectedVersion],
  );
  return rows[0] ? mapTemplateRow(rows[0]) : null;
}

export async function softDeleteTemplate(
  tx: Tx,
  templateId: string,
  expectedVersion: number,
): Promise<boolean> {
  const rows = await tx.query<{ template_id: string }>(
    `UPDATE schedule_template
        SET deleted_at = now(), version = version + 1
      WHERE template_id = $1 AND version = $2 AND deleted_at IS NULL
      RETURNING template_id`,
    [templateId, expectedVersion],
  );
  return rows.length > 0;
}

export async function listVersionRows(
  tx: Tx,
  templateId: string,
): Promise<ScheduleTemplateVersionRow[]> {
  return tx.query<ScheduleTemplateVersionRow>(
    `SELECT ${VERSION_COLUMNS}
       FROM schedule_template_version
      WHERE template_id = $1
      ORDER BY version_no DESC`,
    [templateId],
  );
}

export async function findVersionById(
  tx: Tx,
  versionId: string,
): Promise<ScheduleTemplateVersionProps | null> {
  const rows = await tx.query<ScheduleTemplateVersionRow>(
    `SELECT ${VERSION_COLUMNS}
       FROM schedule_template_version
      WHERE version_id = $1`,
    [versionId],
  );
  return rows[0] ? mapVersionRow(rows[0]) : null;
}

export async function findVersionByNo(
  tx: Tx,
  templateId: string,
  versionNo: number,
): Promise<ScheduleTemplateVersionProps | null> {
  const rows = await tx.query<ScheduleTemplateVersionRow>(
    `SELECT ${VERSION_COLUMNS}
       FROM schedule_template_version
      WHERE template_id = $1 AND version_no = $2`,
    [templateId, versionNo],
  );
  return rows[0] ? mapVersionRow(rows[0]) : null;
}

export async function maxVersionNo(tx: Tx, templateId: string): Promise<number> {
  const rows = await tx.query<{ max_no: number | null }>(
    `SELECT max(version_no)::int AS max_no
       FROM schedule_template_version
      WHERE template_id = $1`,
    [templateId],
  );
  return rows[0]?.max_no ?? 0;
}

export interface InsertVersionInput {
  versionId: string;
  templateId: string;
  versionNo: number;
  status: string;
  content: TemplateContent;
}

export async function insertVersion(
  tx: Tx,
  input: InsertVersionInput,
): Promise<ScheduleTemplateVersionProps> {
  const rows = await tx.query<ScheduleTemplateVersionRow>(
    `INSERT INTO schedule_template_version
       (version_id, template_id, version_no, open_weekdays, periods, status)
     VALUES ($1, $2, $3, $4::smallint[], $5::jsonb, $6)
     RETURNING ${VERSION_COLUMNS}`,
    [
      input.versionId,
      input.templateId,
      input.versionNo,
      input.content.openWeekdays,
      JSON.stringify(input.content.periods),
      input.status,
    ],
  );
  const row = rows[0];
  if (!row) {
    throw new Error('作息模板版本写入失败');
  }
  return mapVersionRow(row);
}

async function tableExists(tx: Tx, tableName: string): Promise<boolean> {
  const rows = await tx.query<{ available: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS available`,
    [tableName],
  );
  return rows[0]?.available ?? false;
}

/** D05 落地后：模板版本被任何课表方案引用时不得删除。 */
export async function hasTimetableReferenceForTemplate(
  tx: Tx,
  templateId: string,
): Promise<boolean> {
  if (!(await tableExists(tx, 'timetable_plan'))) {
    return false;
  }
  const rows = await tx.query<{ referenced: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM timetable_plan p
         JOIN schedule_template_version v ON v.version_id = p.schedule_template_version_id
        WHERE v.template_id = $1 AND p.deleted_at IS NULL
     ) AS referenced`,
    [templateId],
  );
  return rows[0]?.referenced ?? false;
}
