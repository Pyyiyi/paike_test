import { describe, expect, it } from 'vitest';
import {
  formatSlotExpression,
  overlaps,
  parseSlotExpression,
  slotsOverlap,
} from '../src/shared/time/slot-expression';

describe('slot expression', () => {
  it('parses weekday, period ranges and multiple segments', () => {
    expect(parseSlotExpression('周一第1-2节,周三第3节')).toEqual([
      { weekday: 1, period: 1 },
      { weekday: 1, period: 2 },
      { weekday: 3, period: 3 },
    ]);
    expect(parseSlotExpression('星期三第 4 节，星期五第 8-9 节')).toEqual([
      { weekday: 3, period: 4 },
      { weekday: 5, period: 8 },
      { weekday: 5, period: 9 },
    ]);
  });

  it('deduplicates and sorts slots deterministically', () => {
    expect(parseSlotExpression('周三第3节,周一第2节,周一第1节,周一第1节')).toEqual([
      { weekday: 1, period: 1 },
      { weekday: 1, period: 2 },
      { weekday: 3, period: 3 },
    ]);
  });

  it('formats consecutive periods into ranges and round-trips', () => {
    const expression = '周一第1-2节,周三第3节';
    const slots = parseSlotExpression(expression);
    expect(formatSlotExpression(slots)).toBe(expression);
    expect(formatSlotExpression([])).toBe('');
  });

  it('detects overlaps', () => {
    expect(overlaps({ weekday: 1, period: 1 }, { weekday: 1, period: 1 })).toBe(true);
    expect(overlaps({ weekday: 1, period: 1 }, { weekday: 2, period: 1 })).toBe(false);
    expect(
      slotsOverlap(
        [
          { weekday: 1, period: 1 },
          { weekday: 2, period: 2 },
        ],
        [{ weekday: 2, period: 2 }],
      ),
    ).toBe(true);
    expect(slotsOverlap([{ weekday: 1, period: 1 }], [{ weekday: 1, period: 2 }])).toBe(false);
  });

  it('rejects malformed expressions and invalid ranges', () => {
    expect(() => parseSlotExpression('')).toThrow('不能为空');
    expect(() => parseSlotExpression('周一')).toThrow('无法识别时段');
    expect(() => parseSlotExpression('周八第1节')).toThrow('无法识别时段');
    expect(() => parseSlotExpression('周一第0节')).toThrow('节次必须是 1-20');
    expect(() => parseSlotExpression('周一第3-1节')).toThrow('无效');
    expect(() => parseSlotExpression('周一第1节,')).toThrow('空片段');
  });
});
