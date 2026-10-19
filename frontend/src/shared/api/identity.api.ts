import { http } from './http';
import type { PageData } from './types';

export type UserRow = Record<string, unknown>;

export const identityApi = {
  users: (params?: Record<string, unknown>) => http.get<PageData<UserRow>>('/users', params),
  resetPassword: (userId: string) => http.post<{ initialPassword: string }>(`/users/${userId}/reset-password`),
};
