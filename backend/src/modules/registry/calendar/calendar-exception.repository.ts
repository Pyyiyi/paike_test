import type { Tx } from '../../../shared/db/transaction';

export type CalendarExceptionType = 'STOP' | 'MAKEUP';

export interface CalendarExceptionRecord {
  exceptionId: string;
  semesterId: string;
  type: CalendarExceptionType;
  startDate: string;
  endDate: string;
  makeupWeekday: number | null;
  note: string | null;
  version: number;
}

export interface CalendarExceptionDto {
  exceptionId: string;
  semesterId: string;
  type: CalendarExceptionType;
  startDate: string;
  endDate: string;
  makeupWeekday: number | null;
  note: string | null;
  version: number;
}

interface CalendarExceptionRow {
  exception_id: string;
  semester_id: string;
  type: CalendarExceptionType;
  start_date: string;
  end_date: string;
  makeup_weekday: number | null;
  note: string | null;
  version: number;
}

const COLUMNS = `exception_id, semester_id, type,
  start_date::text AS start_date, end_date::text AS end_date,
  makeup_weekday, note, version`;

export function mapCalendarExceptionRow(row: CalendarExceptionRow): CalendarExceptionRecord {
  return {
    exceptionId: row.exception_id,
    semesterId: row.semester_id,
    type: row.type,
    startDate: row.start_date,
    endDate: row.end_date,
    makeupWeekday: row.makeup_weekday === null ? null : Number(row.makeup_weekday),
    note: row.note,
    version: row.version,
  };
}

export function toCalendarExceptionDto(record: CalendarExceptionRecord): CalendarExceptionDto {
  return { ...record };
}

export async function listCalendarExceptions(
  tx: Tx,
  semesterId: string,
): Promise<CalendarExceptionRecord[]> {
  const rows = await tx.query<CalendarExceptionRow>(
    `SELECT ${COLUMNS}
       FROM calendar_exception
      WHERE semester_id = $1
      ORDER BY start_date ASC, created_at ASC`,
    [semesterId],
  );
  return rows.map(mapCalendarExceptionRow);
}

export interface InsertCalendarExceptionInput {
  exceptionId: string;
  semesterId: string;
  type: CalendarExceptionType;
  startDate: string;
  endDate: string;
  makeupWeekday: number | null;
  note: string | null;
}

export async function insertCalendarException(
  tx: Tx,
  input: InsertCalendarExceptionInput,
): Promise<CalendarExceptionRecord> {
  const rows = await tx.query<CalendarExceptionRow>(
    `INSERT INTO calendar_exception
       (exception_id, semester_id, type, start_date, end_date, makeup_weekday, note, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
     RETURNING ${COLUMNS}`,
    [
      input.exceptionId,
      input.semesterId,
      input.type,
      input.startDate,
      input.endDate,
      input.makeupWeekday,
      input.note,
    ],
  );
  const row = rows[0];
  if (!row) {
    throw new Error('校历写入失败');
  }
  return mapCalendarExceptionRow(row);
}

export async function findCalendarException(
  tx: Tx,
  semesterId: string,
  exceptionId: string,
): Promise<CalendarExceptionRecord | null> {
  const rows = await tx.query<CalendarExceptionRow>(
    `SELECT ${COLUMNS}
       FROM calendar_exception
      WHERE semester_id = $1 AND exception_id = $2`,
    [semesterId, exceptionId],
  );
  return rows[0] ? mapCalendarExceptionRow(rows[0]) : null;
}

export async function deleteCalendarException(
  tx: Tx,
  semesterId: string,
  exceptionId: string,
): Promise<boolean> {
  const rows = await tx.query<{ exception_id: string }>(
    `DELETE FROM calendar_exception
      WHERE semester_id = $1 AND exception_id = $2
      RETURNING exception_id`,
    [semesterId, exceptionId],
  );
  return rows.length > 0;
}
