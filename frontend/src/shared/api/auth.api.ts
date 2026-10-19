import { http } from './http';
import type { CurrentUser } from './types';

export interface LoginInput {
  username: string;
  password: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export const authApi = {
  async csrf(): Promise<{ csrfToken: string }> {
    return http.get<{ csrfToken: string }>('/auth/csrf');
  },
  async login(input: LoginInput): Promise<CurrentUser> {
    const data = await http.post<{ user: CurrentUser }>('/auth/login', input);
    return data.user;
  },
  async me(): Promise<CurrentUser> {
    const data = await http.get<{ user: CurrentUser }>('/auth/me');
    return data.user;
  },
  async logout(): Promise<void> {
    await http.post<{ ok: boolean }>('/auth/logout');
  },
  async changePassword(input: ChangePasswordInput): Promise<void> {
    await http.post<{ ok: boolean }>('/auth/change-password', input);
  },
};
