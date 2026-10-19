export { createRegistryRouter } from './registry.router';
export {
  createSemesterQueryService,
  semesterQueryService,
  type AcademicWeek,
  type SemesterQueryService,
} from './semester/semester.query-service';
export {
  createTemplateQueryService,
  templateQueryService,
  type ScheduleTemplateVersionSnapshot,
  type TemplateQueryService,
} from './template/schedule-template.query-service';
export {
  createSemesterLifecycleService,
  semesterLifecycleService,
  type SemesterLifecycleService,
} from './semester/semester.lifecycle';
export {
  deriveSemesterStatus,
  type SemesterStatus,
} from './semester/semester.domain';
export { validateTemplateContent } from './template/schedule-template.domain';
export const contextName = 'registry';
