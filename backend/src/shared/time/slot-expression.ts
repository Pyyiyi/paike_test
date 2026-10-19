export interface Slot {
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  period: number;
}

export type SlotExpression = string;

const MAX_PERIOD = 20;
const WEEKDAY_LABELS: Record<string, Slot['weekday']> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
};
const SLOT_PATTERN = /^(?:周|星期)([一二三四五六日天])\s*(?:第\s*)?(\d{1,2})\s*(?:-\s*(\d{1,2}))?\s*节$/u;

function assertPeriod(period: number): void {
  if (!Number.isInteger(period) || period < 1 || period > MAX_PERIOD) {
    throw new Error(`节次必须是 1-${MAX_PERIOD} 的整数`);
  }
}

export function parseSlotExpression(input: string): Slot[] {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('时段表达式不能为空');
  }

  const slots: Slot[] = [];
  const seen = new Set<string>();

  for (const rawSegment of trimmed.split(/[,，;；]/)) {
    const segment = rawSegment.trim();
    if (!segment) {
      throw new Error('时段表达式包含空片段');
    }

    const match = SLOT_PATTERN.exec(segment);
    if (!match) {
      throw new Error(`无法识别时段「${segment}」，示例：周一第1-2节,周三第3节`);
    }

    const weekday = WEEKDAY_LABELS[match[1] ?? ''];
    if (!weekday) {
      throw new Error(`无法识别星期「${match[1] ?? ''}」`);
    }

    const first = Number(match[2]);
    const last = match[3] === undefined ? first : Number(match[3]);
    assertPeriod(first);
    assertPeriod(last);
    if (last < first) {
      throw new Error(`节次范围「${first}-${last}」无效`);
    }

    for (let period = first; period <= last; period += 1) {
      const key = `${weekday}:${period}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      slots.push({ weekday, period });
    }
  }

  return slots.sort((a, b) => a.weekday - b.weekday || a.period - b.period);
}

function normalizeSlots(slots: Slot[]): Slot[] {
  const seen = new Set<string>();
  const normalized: Slot[] = [];
  for (const slot of slots) {
    if (!Number.isInteger(slot.weekday) || slot.weekday < 1 || slot.weekday > 7) {
      throw new Error('星期必须是 1-7 的整数');
    }
    assertPeriod(slot.period);
    const key = `${slot.weekday}:${slot.period}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({ weekday: slot.weekday, period: slot.period });
  }
  return normalized.sort((a, b) => a.weekday - b.weekday || a.period - b.period);
}

function weekdayLabel(weekday: Slot['weekday']): string {
  const labels: Record<Slot['weekday'], string> = {
    1: '一',
    2: '二',
    3: '三',
    4: '四',
    5: '五',
    6: '六',
    7: '日',
  };
  return `周${labels[weekday]}`;
}

export function formatSlotExpression(slots: Slot[]): string {
  const normalized = normalizeSlots(slots);
  if (normalized.length === 0) {
    return '';
  }

  const byWeekday = new Map<Slot['weekday'], number[]>();
  for (const slot of normalized) {
    const periods = byWeekday.get(slot.weekday) ?? [];
    periods.push(slot.period);
    byWeekday.set(slot.weekday, periods);
  }

  const parts: string[] = [];
  for (const [weekday, periods] of [...byWeekday.entries()].sort(([a], [b]) => a - b)) {
    let start = periods[0]!;
    let previous = start;
    for (let index = 1; index < periods.length; index += 1) {
      const period = periods[index]!;
      if (period === previous + 1) {
        previous = period;
        continue;
      }
      parts.push(formatPeriodRange(weekday, start, previous));
      start = period;
      previous = period;
    }
    parts.push(formatPeriodRange(weekday, start, previous));
  }

  return parts.join(',');
}

function formatPeriodRange(weekday: Slot['weekday'], start: number, end: number): string {
  const label = weekdayLabel(weekday);
  return start === end ? `${label}第${start}节` : `${label}第${start}-${end}节`;
}

export function overlaps(a: Slot, b: Slot): boolean {
  return a.weekday === b.weekday && a.period === b.period;
}

export function slotsOverlap(a: Slot[], b: Slot[]): boolean {
  return a.some((left) => b.some((right) => overlaps(left, right)));
}
