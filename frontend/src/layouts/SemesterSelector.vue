<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { createCriticalConfirmOptions, useConfirm } from '@/shared/composables/useConfirm';
import { useSemesterStore } from '@/shared/stores/semester';
import { SEMESTER_STATUS_LABELS } from '@/shared/text/messages';

const semesterStore = useSemesterStore();
const confirm = useConfirm();

const selectedId = computed(() => semesterStore.current?.semesterId || '');

onMounted(() => {
  if (!semesterStore.loaded) {
    void semesterStore.fetch();
  }
});

async function changeSemester(value: string): Promise<void> {
  const target = semesterStore.list.find((semester) => semester.semesterId === value);
  if (!target || target.semesterId === semesterStore.current?.semesterId) {
    return;
  }
  const confirmed = await confirm(createCriticalConfirmOptions('switch', target.name));
  if (confirmed) {
    await semesterStore.switchTo(target.semesterId);
  }
}
</script>

<template>
  <div class="semester-selector">
    <label for="semester-select">当前学期</label>
    <el-select
      id="semester-select"
      :model-value="selectedId"
      :loading="semesterStore.loading"
      :disabled="!semesterStore.hasSemesters"
      placeholder="暂无可选学期"
      class="semester-select"
      @change="changeSemester"
    >
      <el-option
        v-for="semester in semesterStore.list"
        :key="semester.semesterId"
        :label="`${semester.name}（${SEMESTER_STATUS_LABELS[semester.status]}）`"
        :value="semester.semesterId"
      />
    </el-select>
    <span v-if="semesterStore.error" class="semester-selector__error">暂时无法加载学期，请稍后重试</span>
  </div>
</template>

<style scoped>
.semester-selector {
  display: flex;
  align-items: center;
  gap: 9px;
  color: #46546b;
  font-size: 13px;
}

.semester-selector label {
  font-weight: 600;
  white-space: nowrap;
}

.semester-select {
  width: 260px;
}

.semester-selector__error {
  color: #8b3c31;
}
</style>
