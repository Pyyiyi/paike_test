import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { authApi } from '@/shared/api/auth.api';
import type { CurrentUser } from '@/shared/api/types';
import { friendlyError } from '@/shared/text/messages';

export const useSessionStore = defineStore('session', () => {
  const user = ref<CurrentUser | null>(null);
  const loaded = ref(false);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const isAuthenticated = computed(() => user.value !== null);
  const isAdmin = computed(() => user.value?.role === 'ADMIN');
  const isTeacher = computed(() => user.value?.role === 'TEACHER');
  const mustChangePassword = computed(() => user.value?.mustChangePassword === true);
  const homePath = computed(() => (isTeacher.value ? '/me/timetable' : '/'));

  function clear(): void {
    user.value = null;
    error.value = null;
  }

  async function fetchMe(force = false): Promise<CurrentUser | null> {
    if (loaded.value && !force) {
      return user.value;
    }
    loading.value = true;
    error.value = null;
    try {
      user.value = await authApi.me();
      return user.value;
    } catch (caught) {
      user.value = null;
      error.value = friendlyError(caught);
      return null;
    } finally {
      loading.value = false;
      loaded.value = true;
    }
  }

  async function login(username: string, password: string): Promise<CurrentUser> {
    loading.value = true;
    error.value = null;
    try {
      user.value = await authApi.login({ username, password });
      loaded.value = true;
      return user.value;
    } catch (caught) {
      error.value = friendlyError(caught);
      throw caught;
    } finally {
      loading.value = false;
    }
  }

  async function logout(): Promise<void> {
    try {
      await authApi.logout();
    } finally {
      clear();
      loaded.value = true;
    }
  }

  return {
    user,
    loaded,
    loading,
    error,
    isAuthenticated,
    isAdmin,
    isTeacher,
    mustChangePassword,
    homePath,
    clear,
    fetchMe,
    login,
    logout,
  };
});
