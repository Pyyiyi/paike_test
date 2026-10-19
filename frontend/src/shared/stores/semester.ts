import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { semesterApi } from '@/shared/api/semester.api';
import type { SemesterSummary } from '@/shared/api/types';
import { friendlyError } from '@/shared/text/messages';

export const SEMESTER_CHANGED_EVENT = 'paike:semester-changed';
const STORAGE_KEY = 'paike.currentSemesterId';

export const useSemesterStore = defineStore('semester', () => {
  const list = ref<SemesterSummary[]>([]);
  const current = ref<SemesterSummary | null>(null);
  const loading = ref(false);
  const loaded = ref(false);
  const error = ref<string | null>(null);

  const hasSemesters = computed(() => list.value.length > 0);

  function selectFromList(semesterId?: string | null): SemesterSummary | null {
    const stored = semesterId ?? localStorage.getItem(STORAGE_KEY);
    return list.value.find((semester) => semester.semesterId === stored) ?? list.value[0] ?? null;
  }

  async function fetch(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      list.value = await semesterApi.list();
      current.value = selectFromList(current.value?.semesterId);
      if (current.value) {
        localStorage.setItem(STORAGE_KEY, current.value.semesterId);
      }
    } catch (caught) {
      error.value = friendlyError(caught);
    } finally {
      loading.value = false;
      loaded.value = true;
    }
  }

  async function switchTo(semesterId: string): Promise<void> {
    const semester = list.value.find((item) => item.semesterId === semesterId) ?? null;
    if (!semester) {
      return;
    }
    current.value = semester;
    localStorage.setItem(STORAGE_KEY, semester.semesterId);
    window.dispatchEvent(
      new CustomEvent(SEMESTER_CHANGED_EVENT, { detail: { semesterId: semester.semesterId } }),
    );
  }

  return { list, current, loading, loaded, error, hasSemesters, fetch, switchTo };
});
