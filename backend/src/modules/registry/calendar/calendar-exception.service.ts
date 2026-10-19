import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { NotFoundError, ValidationError } from '../../../shared/errors/app-error';
import { withTransactionOn } from '../../../shared/db/transaction';
import { systemClock, type Clock } from '../../../shared/time/clock';
import type { CalendarExceptionInput } from '../dto/schedule-template.schema';
import { assertSemesterEditable, deriveSemesterStatus } from '../semester/semester.domain';
import { findSemesterById } from '../semester/semester.repository';
import {
  deleteCalendarException as deleteCalendarExceptionRow,
  findCalendarException,
  insertCalendarException,
  listCalendarExceptions as listCalendarExceptionRows,
  toCalendarExceptionDto,
  type CalendarExceptionDto,
} from './calendar-exception.repository';

export async function listCalendarExceptions(
  pool: Pool,
  semesterId: string,
): Promise<CalendarExceptionDto[]> {
  return withTransactionOn(pool, async (tx) => {
    const semester = await findSemesterById(tx, semesterId);
    if (!semester) {
      throw new NotFoundError('未找到该学期，可能已被删除');
    }
    const rows = await listCalendarExceptionRows(tx, semesterId);
    return rows.map(toCalendarExceptionDto);
  });
}

export async function createCalendarException(
  pool: Pool,
  semesterId: string,
  input: CalendarExceptionInput,
  clock: Clock = systemClock,
): Promise<CalendarExceptionDto> {
  return withTransactionOn(pool, async (tx) => {
    const semester = await findSemesterById(tx, semesterId, true);
    if (!semester) {
      throw new NotFoundError('未找到该学期，可能已被删除');
    }
    assertSemesterEditable(
      deriveSemesterStatus(semester.status, semester.startDate, semester.endDate, clock.today()),
    );

    if (input.startDate < semester.startDate || input.endDate > semester.endDate) {
      throw new ValidationError('保存失败，请检查校历日期', [
        { field: 'startDate', message: `校历日期必须在学期范围内（${semester.startDate} 至 ${semester.endDate}）` },
      ]);
    }

    const makeupWeekday = input.type === 'MAKEUP' ? input.makeupWeekday ?? null : null;
    if (input.type === 'MAKEUP' && makeupWeekday === null) {
      throw new ValidationError('保存失败，请检查校历日期', [
        { field: 'makeupWeekday', message: '调休上课必须选择补课星期' },
      ]);
    }

    const record = await insertCalendarException(tx, {
      exceptionId: randomUUID(),
      semesterId,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      makeupWeekday,
      note: input.note ?? null,
    });
    return toCalendarExceptionDto(record);
  });
}

export async function deleteCalendarException(
  pool: Pool,
  semesterId: string,
  exceptionId: string,
  clock: Clock = systemClock,
): Promise<void> {
  await withTransactionOn(pool, async (tx) => {
    const semester = await findSemesterById(tx, semesterId, true);
    if (!semester) {
      throw new NotFoundError('未找到该学期，可能已被删除');
    }
    assertSemesterEditable(
      deriveSemesterStatus(semester.status, semester.startDate, semester.endDate, clock.today()),
    );
    const existing = await findCalendarException(tx, semesterId, exceptionId);
    if (!existing) {
      throw new NotFoundError('未找到该校历项，可能已被删除');
    }
    await deleteCalendarExceptionRow(tx, semesterId, exceptionId);
  });
}
