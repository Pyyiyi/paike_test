/**
 * 全后端时间源。业务代码不得直接 new Date()/Date.now()，必须注入 Clock。
 */
export interface Clock {
  now(): Date;
  today(): string;
}

const SCHOOL_TIME_ZONE = 'Asia/Shanghai';
const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: SCHOOL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function formatSchoolDate(date: Date): string {
  const parts = DATE_FORMATTER.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new Error('无法格式化学校本地日期');
  }
  return `${year}-${month}-${day}`;
}

export const systemClock: Clock = {
  now: () => new Date(),
  today: () => formatSchoolDate(new Date()),
};

export function fixedClock(iso: string): Clock {
  const fixed = new Date(iso);
  if (Number.isNaN(fixed.getTime())) {
    throw new Error('固定时钟时间无效');
  }
  return {
    now: () => new Date(fixed.getTime()),
    today: () => formatSchoolDate(fixed),
  };
}
