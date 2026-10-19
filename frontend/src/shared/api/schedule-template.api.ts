import { http } from './http';
import type { PageData, Period, ScheduleTemplate, ScheduleTemplateVersion } from './types';

export interface TemplateWriteInput {
  name: string;
  openWeekdays: number[];
  periods: Period[];
}

export interface TemplateVersionWriteInput {
  baseVersionId?: string;
  openWeekdays: number[];
  periods: Period[];
}

export interface TemplateValidationResult {
  valid: boolean;
  errors: Array<{ field?: string; message: string }>;
}

export const scheduleTemplateApi = {
  async list(): Promise<ScheduleTemplate[]> {
    const data = await http.get<ScheduleTemplate[] | PageData<ScheduleTemplate>>('/schedule-templates');
    return Array.isArray(data) ? data : data.items;
  },
  create(input: TemplateWriteInput): Promise<ScheduleTemplate> {
    return http.post<ScheduleTemplate>('/schedule-templates', input);
  },
  remove(templateId: string, version?: number): Promise<void> {
    const suffix = version ? `?version=${version}` : '';
    return http.delete<void>(`/schedule-templates/${templateId}${suffix}`);
  },
  async listVersions(templateId: string): Promise<ScheduleTemplateVersion[]> {
    const data = await http.get<ScheduleTemplateVersion[] | PageData<ScheduleTemplateVersion>>(
      `/schedule-templates/${templateId}/versions`,
    );
    return Array.isArray(data) ? data : data.items;
  },
  createVersion(templateId: string, input: TemplateVersionWriteInput): Promise<ScheduleTemplateVersion> {
    return http.post<ScheduleTemplateVersion>(`/schedule-templates/${templateId}/versions`, input);
  },
  getVersion(versionId: string): Promise<ScheduleTemplateVersion> {
    return http.get<ScheduleTemplateVersion>(`/schedule-templates/versions/${versionId}`);
  },
  validateVersion(versionId: string): Promise<TemplateValidationResult> {
    return http.post<TemplateValidationResult>(`/schedule-templates/versions/${versionId}/validate`, {});
  },
};
