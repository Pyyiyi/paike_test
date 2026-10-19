import { ValidationError, type ErrorDetail } from '../../../shared/errors/app-error';

export type TemplateStatus = 'ACTIVE' | 'RETIRED';

export interface PeriodInput {
  periodNo: number;
  startTime: string;
  endTime: string;
  label?: string | null;
}

export interface TemplateContent {
  openWeekdays: number[];
  periods: PeriodInput[];
}

export interface ScheduleTemplateVersionProps {
  versionId: string;
  templateId: string;
  versionNo: number;
  openWeekdays: number[];
  periods: PeriodInput[];
  status: TemplateStatus;
  createdAt: Date;
}

export interface ScheduleTemplateProps {
  templateId: string;
  name: string;
  status: TemplateStatus;
  latestVersionNo: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizeWeekdays(openWeekdays: number[]): number[] {
  return [...new Set(openWeekdays)].sort((left, right) => left - right);
}

/**
 * A-08 最小节次规则：编号从 1 连续、单节 start<end、同日不重叠、开放星期非空。
 * periods 对每个开放星期生效，因此任意两节时间重叠即视为同日重叠。
 */
export function validateTemplateContent(content: TemplateContent): ErrorDetail[] {
  const errors: ErrorDetail[] = [];
  const weekdays = normalizeWeekdays(content.openWeekdays ?? []);

  if (weekdays.length === 0) {
    errors.push({ field: 'openWeekdays', message: '请至少选择一个开放星期' });
  }
  if (weekdays.some((weekday) => !Number.isInteger(weekday) || weekday < 1 || weekday > 7)) {
    errors.push({ field: 'openWeekdays', message: '开放星期必须是 1-7 的整数' });
  }

  const periods = content.periods ?? [];
  if (periods.length === 0) {
    errors.push({ field: 'periods', message: '请至少配置一个节次' });
  }

  const seenNumbers = new Set<number>();
  periods.forEach((period, index) => {
    const prefix = `periods.${index}`;
    if (!Number.isInteger(period.periodNo) || period.periodNo < 1) {
      errors.push({ field: `${prefix}.periodNo`, message: '节次编号必须是大于 0 的整数' });
    } else if (seenNumbers.has(period.periodNo)) {
      errors.push({ field: `${prefix}.periodNo`, message: '节次编号不能重复' });
    }
    seenNumbers.add(period.periodNo);

    if (!TIME_PATTERN.test(period.startTime)) {
      errors.push({ field: `${prefix}.startTime`, message: '开始时间必须是 HH:mm（00:00-23:59）' });
    }
    if (!TIME_PATTERN.test(period.endTime)) {
      errors.push({ field: `${prefix}.endTime`, message: '结束时间必须是 HH:mm（00:00-23:59）' });
    }
    if (TIME_PATTERN.test(period.startTime) && TIME_PATTERN.test(period.endTime)) {
      if (period.startTime >= period.endTime) {
        errors.push({ field: `${prefix}.endTime`, message: '结束时间必须晚于开始时间' });
      }
    }
  });

  if (periods.length > 0) {
    const sorted = [...periods].sort((left, right) => left.periodNo - right.periodNo);
    const expected = Array.from({ length: sorted.length }, (_value, index) => index + 1);
    if (sorted.some((period, index) => period.periodNo !== expected[index])) {
      errors.push({ field: 'periods', message: '节次编号必须从 1 开始连续，不允许跳号或重复' });
    }
  }

  for (let left = 0; left < periods.length; left += 1) {
    for (let right = left + 1; right < periods.length; right += 1) {
      const a = periods[left];
      const b = periods[right];
      if (!a || !b) {
        continue;
      }
      if (a.startTime < b.endTime && b.startTime < a.endTime) {
        errors.push({ field: `periods.${right}.startTime`, message: '同一开放星期内节次时间不能重叠' });
      }
    }
  }

  return errors;
}

export function assertTemplateContent(content: TemplateContent): void {
  const errors = validateTemplateContent(content);
  if (errors.length > 0) {
    throw new ValidationError('保存失败，请检查节次与开放星期', errors);
  }
}

export function normalizeTemplateContent(content: TemplateContent): TemplateContent {
  return {
    openWeekdays: normalizeWeekdays(content.openWeekdays),
    periods: content.periods.map((period) => ({
      periodNo: period.periodNo,
      startTime: period.startTime,
      endTime: period.endTime,
      label: period.label ?? null,
    })),
  };
}
