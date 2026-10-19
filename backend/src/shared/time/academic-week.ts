export type LessonParity = 'ALL' | 'ODD' | 'EVEN';
export type WeekParity = 'ODD' | 'EVEN';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIsoDate(value: string, label: string): number {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) {
    throw new Error(`${label}必须是 YYYY-MM-DD 格式`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${label}不是有效日期`);
  }
  return timestamp;
}

/** 以周一为周首，返回该日期所在自然周的周一 00:00 UTC 时间戳。 */
function startOfWeekMs(timestamp: number): number {
  const weekday = new Date(timestamp).getUTCDay(); // 0 = 周日
  const offset = (weekday + 6) % 7; // 周一 = 0
  return timestamp - offset * DAY_MS;
}

/** 第 1 教学周 = 学期开始日期所在自然周（周一对齐）。停课周不跳过，仍占序号。 */
export function weekIndexForDate(semesterStart: string, date: string): number {
  const startMs = parseIsoDate(semesterStart, '学期开始日期');
  const dateMs = parseIsoDate(date, '日期');
  const weekIndex = Math.round((startOfWeekMs(dateMs) - startOfWeekMs(startMs)) / WEEK_MS) + 1;

  if (weekIndex < 1) {
    throw new Error('日期早于学期第 1 周');
  }
  return weekIndex;
}

export function parityForWeekIndex(weekIndex: number): WeekParity {
  if (!Number.isInteger(weekIndex) || weekIndex < 1) {
    throw new Error('教学周序号必须是正整数');
  }
  return weekIndex % 2 === 1 ? 'ODD' : 'EVEN';
}

export function weeksInSemester(semesterStart: string, semesterEnd: string): number {
  if (parseIsoDate(semesterEnd, '学期结束日期') < parseIsoDate(semesterStart, '学期开始日期')) {
    throw new Error('学期结束日期不能早于开始日期');
  }
  return weekIndexForDate(semesterStart, semesterEnd);
}

export function resolveWeekParity(weekIndex: number, lessonParity: LessonParity): boolean {
  if (lessonParity === 'ALL') {
    return true;
  }
  return parityForWeekIndex(weekIndex) === lessonParity;
}
