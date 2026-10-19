import { describe, expect, it } from 'vitest';
import {
  parityForWeekIndex,
  resolveWeekParity,
  weekIndexForDate,
  weeksInSemester,
} from '../src/shared/time/academic-week';

// 2026-09-01 is a Tuesday. Its natural week starts Monday 2026-08-31.
const SEMESTER_START = '2026-09-01';

describe('academic week calculation', () => {
  it('treats the week containing the semester start as week 1 (ODD)', () => {
    expect(weekIndexForDate(SEMESTER_START, '2026-08-31')).toBe(1);
    expect(weekIndexForDate(SEMESTER_START, '2026-09-01')).toBe(1);
    expect(weekIndexForDate(SEMESTER_START, '2026-09-06')).toBe(1);
    expect(parityForWeekIndex(1)).toBe('ODD');
  });

  it('keeps holiday weeks numbered and advances parity', () => {
    // Week 2 is treated as a holiday week; it still occupies index 2.
    expect(weekIndexForDate(SEMESTER_START, '2026-09-07')).toBe(2);
    expect(parityForWeekIndex(2)).toBe('EVEN');
    expect(weekIndexForDate(SEMESTER_START, '2026-09-13')).toBe(2);

    expect(weekIndexForDate(SEMESTER_START, '2026-09-14')).toBe(3);
    expect(parityForWeekIndex(3)).toBe('ODD');
    expect(weekIndexForDate(SEMESTER_START, '2026-09-21')).toBe(4);
    expect(parityForWeekIndex(4)).toBe('EVEN');
  });

  it('counts weeks in a semester from the start week', () => {
    expect(weeksInSemester(SEMESTER_START, '2026-09-06')).toBe(1);
    expect(weeksInSemester(SEMESTER_START, '2026-09-14')).toBe(3);
    expect(weeksInSemester(SEMESTER_START, '2027-01-10')).toBe(19);
  });

  it('resolves ALL/ODD/EVEN lesson parity', () => {
    expect(resolveWeekParity(1, 'ALL')).toBe(true);
    expect(resolveWeekParity(1, 'ODD')).toBe(true);
    expect(resolveWeekParity(1, 'EVEN')).toBe(false);
    expect(resolveWeekParity(2, 'ODD')).toBe(false);
    expect(resolveWeekParity(2, 'EVEN')).toBe(true);
    expect(resolveWeekParity(3, 'ODD')).toBe(true);
  });

  it('rejects invalid input instead of silently clamping', () => {
    expect(() => weekIndexForDate(SEMESTER_START, '2026-08-30')).toThrow('早于学期第 1 周');
    expect(() => weekIndexForDate('2026-02-30', '2026-03-01')).toThrow('不是有效日期');
    expect(() => parityForWeekIndex(0)).toThrow('正整数');
    expect(() => parityForWeekIndex(1.5)).toThrow('正整数');
    expect(() => weeksInSemester('2026-09-10', '2026-09-01')).toThrow('不能早于');
  });
});
