import { describe, expect, it } from 'vitest';
import { parityForWeekIndex, weekIndexForDate } from '../src/shared/time/academic-week';
import { deriveSemesterStatus } from '../src/modules/registry/semester/semester.domain';
import { validateTemplateContent } from '../src/modules/registry/template/schedule-template.domain';

const validContent = {
  openWeekdays: [1, 2, 3],
  periods: [
    { periodNo: 1, startTime: '08:00', endTime: '08:45' },
    { periodNo: 2, startTime: '08:55', endTime: '09:40' },
  ],
};

describe('deriveSemesterStatus (A-01)', () => {
  it('derives the first three states from dates', () => {
    expect(deriveSemesterStatus('NOT_STARTED', '2026-09-01', '2027-01-31', '2026-08-31')).toBe('NOT_STARTED');
    expect(deriveSemesterStatus('NOT_STARTED', '2026-09-01', '2027-01-31', '2026-09-01')).toBe('IN_PROGRESS');
    expect(deriveSemesterStatus('NOT_STARTED', '2026-09-01', '2027-01-31', '2027-01-31')).toBe('IN_PROGRESS');
    expect(deriveSemesterStatus('NOT_STARTED', '2026-09-01', '2027-01-31', '2027-02-01')).toBe('ENDED');
  });

  it('keeps ARCHIVED terminal regardless of dates', () => {
    expect(deriveSemesterStatus('ARCHIVED', '2026-09-01', '2027-01-31', '2026-10-01')).toBe('ARCHIVED');
    expect(deriveSemesterStatus('ARCHIVED', '2026-09-01', '2027-01-31', '2030-10-01')).toBe('ARCHIVED');
  });

  it('never returns a fifth state', () => {
    const statuses = new Set([
      deriveSemesterStatus('NOT_STARTED', '2026-09-01', '2027-01-31', '2026-01-01'),
      deriveSemesterStatus('NOT_STARTED', '2026-09-01', '2027-01-31', '2026-10-01'),
      deriveSemesterStatus('NOT_STARTED', '2026-09-01', '2027-01-31', '2028-01-01'),
      deriveSemesterStatus('ARCHIVED', '2026-09-01', '2027-01-31', '2026-10-01'),
    ]);
    expect([...statuses].sort()).toEqual(['ARCHIVED', 'ENDED', 'IN_PROGRESS', 'NOT_STARTED']);
  });
});

describe('validateTemplateContent (A-08)', () => {
  it('accepts continuous, ordered, non-overlapping periods', () => {
    expect(validateTemplateContent(validContent)).toEqual([]);
  });

  it('rejects a period-number gap', () => {
    const errors = validateTemplateContent({
      openWeekdays: [1],
      periods: [
        { periodNo: 1, startTime: '08:00', endTime: '08:45' },
        { periodNo: 3, startTime: '09:00', endTime: '09:45' },
      ],
    });
    expect(errors.some((error) => error.field === 'periods')).toBe(true);
  });

  it('rejects reversed start/end time', () => {
    const errors = validateTemplateContent({
      openWeekdays: [1],
      periods: [{ periodNo: 1, startTime: '09:00', endTime: '08:45' }],
    });
    expect(errors.some((error) => error.field === 'periods.0.endTime')).toBe(true);
  });

  it('rejects overlapping periods on the same open weekday', () => {
    const errors = validateTemplateContent({
      openWeekdays: [2],
      periods: [
        { periodNo: 1, startTime: '08:00', endTime: '09:00' },
        { periodNo: 2, startTime: '08:30', endTime: '09:30' },
      ],
    });
    expect(errors.some((error) => error.message.includes('重叠'))).toBe(true);
  });

  it('rejects empty open weekdays', () => {
    const errors = validateTemplateContent({ openWeekdays: [], periods: validContent.periods });
    expect(errors.some((error) => error.field === 'openWeekdays')).toBe(true);
  });
});

describe('stop weeks occupy the teaching-week sequence (H-05)', () => {
  it('does not shift week index or parity after a stopped week', () => {
    const start = '2026-09-07';
    const stoppedWeekDate = '2026-09-14';
    const afterStop = '2026-09-21';
    expect(weekIndexForDate(start, stoppedWeekDate)).toBe(2);
    expect(weekIndexForDate(start, afterStop)).toBe(3);
    expect(parityForWeekIndex(2)).toBe('EVEN');
    expect(parityForWeekIndex(3)).toBe('ODD');
  });
});
