import { ConflictError, ValidationError } from '../../../shared/errors/app-error';

export type SemesterStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'ENDED' | 'ARCHIVED';
export type Term = 'FALL' | 'SPRING';

export interface SemesterProps {
  semesterId: string;
  name: string;
  academicYear: string;
  term: Term;
  startDate: string;
  endDate: string;
  status: SemesterStatus;
  scheduleTemplateVersionId: string;
  isCurrent: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 学期对外状态永远四值（A-01）。
 * 存储只用 ARCHIVED 表示存档终态；其余三值按日期实时推导，不持久化。
 */
export function deriveSemesterStatus(
  storedStatus: SemesterStatus,
  startDate: string,
  endDate: string,
  today: string,
): SemesterStatus {
  if (storedStatus === 'ARCHIVED') {
    return 'ARCHIVED';
  }
  if (today < startDate) {
    return 'NOT_STARTED';
  }
  if (today > endDate) {
    return 'ENDED';
  }
  return 'IN_PROGRESS';
}

export function isEditable(status: SemesterStatus): boolean {
  return status !== 'ARCHIVED';
}

export function assertSemesterEditable(status: SemesterStatus): void {
  if (!isEditable(status)) {
    throw new ConflictError('STATE_CONFLICT', '该学期已存档，只能查看或导出');
  }
}

export function assertDateRange(startDate: string, endDate: string): void {
  if (endDate < startDate) {
    throw new ValidationError('保存失败，请检查输入内容', [
      { field: 'endDate', message: '结束日期不能早于开始日期' },
    ]);
  }
}
