import type { SemesterProps, SemesterStatus, Term } from './semester.domain';

export interface SemesterRow {
  semester_id: string;
  name: string;
  academic_year: string;
  term: Term;
  start_date: string;
  end_date: string;
  status: SemesterStatus;
  schedule_template_version_id: string;
  is_current: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface SemesterDto {
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
  createdAt: string;
  updatedAt: string;
}

export function mapSemesterRow(row: SemesterRow): SemesterProps {
  return {
    semesterId: row.semester_id,
    name: row.name,
    academicYear: row.academic_year,
    term: row.term,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    scheduleTemplateVersionId: row.schedule_template_version_id,
    isCurrent: row.is_current,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toSemesterDto(props: SemesterProps, derivedStatus: SemesterStatus): SemesterDto {
  return {
    semesterId: props.semesterId,
    name: props.name,
    academicYear: props.academicYear,
    term: props.term,
    startDate: props.startDate,
    endDate: props.endDate,
    status: derivedStatus,
    scheduleTemplateVersionId: props.scheduleTemplateVersionId,
    isCurrent: props.isCurrent,
    version: props.version,
    createdAt: props.createdAt.toISOString(),
    updatedAt: props.updatedAt.toISOString(),
  };
}
