import type {
  PeriodInput,
  ScheduleTemplateProps,
  ScheduleTemplateVersionProps,
  TemplateStatus,
} from './schedule-template.domain';

export interface PeriodDto {
  periodNo: number;
  startTime: string;
  endTime: string;
  label?: string | null;
}

export interface ScheduleTemplateVersionDto {
  versionId: string;
  templateId: string;
  versionNo: number;
  openWeekdays: number[];
  periods: PeriodDto[];
  status: TemplateStatus;
  createdAt: string;
}

export interface ScheduleTemplateDto {
  templateId: string;
  name: string;
  status: TemplateStatus;
  latestVersionNo: number;
  latestVersion?: ScheduleTemplateVersionDto;
  version: number;
}

export interface ScheduleTemplateRow {
  template_id: string;
  name: string;
  status: TemplateStatus;
  latest_version_no: number;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface ScheduleTemplateVersionRow {
  version_id: string;
  template_id: string;
  version_no: number;
  open_weekdays: number[];
  periods: PeriodInput[];
  status: TemplateStatus;
  created_at: Date;
}

export function mapTemplateRow(row: ScheduleTemplateRow): ScheduleTemplateProps {
  return {
    templateId: row.template_id,
    name: row.name,
    status: row.status,
    latestVersionNo: row.latest_version_no,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapVersionRow(row: ScheduleTemplateVersionRow): ScheduleTemplateVersionProps {
  return {
    versionId: row.version_id,
    templateId: row.template_id,
    versionNo: row.version_no,
    openWeekdays: row.open_weekdays.map((weekday) => Number(weekday)),
    periods: row.periods.map((period) => ({
      periodNo: Number(period.periodNo),
      startTime: period.startTime,
      endTime: period.endTime,
      label: period.label ?? null,
    })),
    status: row.status,
    createdAt: row.created_at,
  };
}

export function toVersionDto(props: ScheduleTemplateVersionProps): ScheduleTemplateVersionDto {
  return {
    versionId: props.versionId,
    templateId: props.templateId,
    versionNo: props.versionNo,
    openWeekdays: [...props.openWeekdays],
    periods: props.periods.map((period) => ({
      periodNo: period.periodNo,
      startTime: period.startTime,
      endTime: period.endTime,
      label: period.label ?? null,
    })),
    status: props.status,
    createdAt: props.createdAt.toISOString(),
  };
}

export function toTemplateDto(
  props: ScheduleTemplateProps,
  latestVersion?: ScheduleTemplateVersionProps,
): ScheduleTemplateDto {
  return {
    templateId: props.templateId,
    name: props.name,
    status: props.status,
    latestVersionNo: props.latestVersionNo,
    latestVersion: latestVersion ? toVersionDto(latestVersion) : undefined,
    version: props.version,
  };
}
