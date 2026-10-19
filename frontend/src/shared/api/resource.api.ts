import { http } from './http';
import type { PageData } from './types';

export type ResourceRow = Record<string, unknown>;

function list(path: string, params?: Record<string, unknown>): Promise<PageData<ResourceRow>> {
  return http.get<PageData<ResourceRow>>(path, params);
}

export const resourceApi = {
  teachers: (params?: Record<string, unknown>) => list('/teachers', params),
  venues: (params?: Record<string, unknown>) => list('/venues', params),
};
