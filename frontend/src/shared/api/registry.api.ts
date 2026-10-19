import { http } from './http';
import type { PageData } from './types';

export type RegistryRow = Record<string, unknown>;

function list(path: string, params?: Record<string, unknown>): Promise<PageData<RegistryRow>> {
  return http.get<PageData<RegistryRow>>(path, params);
}

export const registryApi = {
  scheduleTemplates: (params?: Record<string, unknown>) => list('/schedule-templates', params),
  gradesClasses: (params?: Record<string, unknown>) => list('/grades-classes', params),
  subjects: (params?: Record<string, unknown>) => list('/subjects', params),
  combinedClasses: (params?: Record<string, unknown>) => list('/combined-classes', params),
  walkingGroups: (params?: Record<string, unknown>) => list('/walking-groups', params),
};
