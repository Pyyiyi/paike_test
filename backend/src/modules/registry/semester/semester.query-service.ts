import type { Pool } from 'pg';
import { getPool } from '../../../shared/db/pool';
import { systemClock, type Clock } from '../../../shared/time/clock';
import { parityForWeekIndex, weeksInSemester } from '../../../shared/time/academic-week';
import { listCalendarExceptions } from '../calendar/calendar-exception.repository';
import type { CalendarExceptionDto } from '../calendar/calendar-exception.repository';
import { deriveSemesterStatus } from './semester.domain';
import { toSemesterDto, type SemesterDto } from './semester.mapper';
import {
  findCurrentSemester,
  findSemesterById,
  listSemesters as listSemesterRows,
} from './semester.repository';
import { withTransactionOn } from '../../../shared/db/transaction';

export interface AcademicWeek {
  weekIndex: number;
  weekStart: string;
  weekEnd: string;
  parity: 'ODD' | 'EVEN';
  stopped: boolean;
  stopExceptionIds: string[];
  makeupWeekdays: number[];
}

export interface SemesterQueryService {
  getSemester(semesterId: string): Promise<SemesterDto | null>;
  getCurrentSemester(): Promise<SemesterDto | null>;
  listSemesters(includeArchived?: boolean): Promise<SemesterDto[]>;
  getCalendarExceptions(semesterId: string): Promise<CalendarExceptionDto[]>;
  getAcademicCalendar(semesterId: string): Promise<AcademicWeek[]>;
  isArchived(semesterId: string): Promise<boolean>;
}

const DAY_MS = 86_400_000;

function parseIso(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}

function formatIso(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function startOfWeekIso(date: string): string {
  const timestamp = parseIso(date);
  const weekday = new Date(timestamp).getUTCDay();
  const offset = (weekday + 6) % 7;
  return formatIso(timestamp - offset * DAY_MS);
}

function addDays(iso: string, days: number): string {
  return formatIso(parseIso(iso) + days * DAY_MS);
}

export function createSemesterQueryService(pool: Pool, clock: Clock = systemClock): SemesterQueryService {
  return {
    async getSemester(semesterId) {
      return withTransactionOn(pool, async (tx) => {
        const props = await findSemesterById(tx, semesterId);
        return props
          ? toSemesterDto(
              props,
              deriveSemesterStatus(props.status, props.startDate, props.endDate, clock.today()),
            )
          : null;
      });
    },

    async getCurrentSemester() {
      return withTransactionOn(pool, async (tx) => {
        const props = await findCurrentSemester(tx);
        return props
          ? toSemesterDto(
              props,
              deriveSemesterStatus(props.status, props.startDate, props.endDate, clock.today()),
            )
          : null;
      });
    },

    async listSemesters(includeArchived = false) {
      return withTransactionOn(pool, async (tx) => {
        const today = clock.today();
        const rows = await listSemesterRows(tx, includeArchived);
        return rows.map((props) =>
          toSemesterDto(props, deriveSemesterStatus(props.status, props.startDate, props.endDate, today)),
        );
      });
    },

    async getCalendarExceptions(semesterId) {
      return withTransactionOn(pool, (tx) => listCalendarExceptions(tx, semesterId));
    },

    async getAcademicCalendar(semesterId) {
      return withTransactionOn(pool, async (tx) => {
        const semester = await findSemesterById(tx, semesterId);
        if (!semester) {
          return [];
        }
        const exceptions = await listCalendarExceptions(tx, semesterId);
        const totalWeeks = weeksInSemester(semester.startDate, semester.endDate);
        const firstMonday = startOfWeekIso(semester.startDate);
        const weeks: AcademicWeek[] = [];
        for (let weekIndex = 1; weekIndex <= totalWeeks; weekIndex += 1) {
          const weekStart = addDays(firstMonday, (weekIndex - 1) * 7);
          const weekEnd = addDays(weekStart, 6);
          const intersected = exceptions.filter(
            (exception) => exception.startDate <= weekEnd && exception.endDate >= weekStart,
          );
          weeks.push({
            weekIndex,
            weekStart,
            weekEnd,
            parity: parityForWeekIndex(weekIndex),
            stopped: intersected.some((exception) => exception.type === 'STOP'),
            stopExceptionIds: intersected
              .filter((exception) => exception.type === 'STOP')
              .map((exception) => exception.exceptionId),
            makeupWeekdays: intersected
              .filter((exception) => exception.type === 'MAKEUP' && exception.makeupWeekday !== null)
              .map((exception) => exception.makeupWeekday as number),
          });
        }
        return weeks;
      });
    },

    async isArchived(semesterId) {
      return withTransactionOn(pool, async (tx) => {
        const props = await findSemesterById(tx, semesterId);
        return props ? props.status === 'ARCHIVED' : false;
      });
    },
  };
}

export const semesterQueryService: SemesterQueryService = {
  getSemester: (id) => createSemesterQueryService(getPool()).getSemester(id),
  getCurrentSemester: () => createSemesterQueryService(getPool()).getCurrentSemester(),
  listSemesters: (includeArchived) => createSemesterQueryService(getPool()).listSemesters(includeArchived),
  getCalendarExceptions: (id) => createSemesterQueryService(getPool()).getCalendarExceptions(id),
  getAcademicCalendar: (id) => createSemesterQueryService(getPool()).getAcademicCalendar(id),
  isArchived: (id) => createSemesterQueryService(getPool()).isArchived(id),
};
