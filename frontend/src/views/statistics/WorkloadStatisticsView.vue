<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import PageHeader from '@/shared/components/PageHeader.vue';
import DataTable, { type TableColumn, type TableRow } from '@/shared/components/DataTable.vue';
import ErrorState from '@/shared/components/ErrorState.vue';
import {
  statisticsApi,
  type WorkloadResult,
  type WorkloadScope,
} from '@/shared/api/statistics.api';
import { SEMESTER_CHANGED_EVENT, useSemesterStore } from '@/shared/stores/semester';
import { friendlyError } from '@/shared/text/messages';

const semesterStore = useSemesterStore();
const scope = ref<WorkloadScope>('SEMESTER');
const weekIndex = ref(1);
const result = ref<WorkloadResult | null>(null);
const loading = ref(false);
const loadError = ref('');
let requestToken = 0;

const columns = computed<TableColumn[]>(() => [
  { key: 'teacherName', label: '教师', minWidth: 160 },
  { key: 'regular', label: '常规', width: 100, align: 'right' },
  { key: 'consecutive', label: '连堂', width: 100, align: 'right' },
  { key: 'combined', label: '合班', width: 100, align: 'right' },
  { key: 'overtime', label: '加班', width: 170, align: 'right', slot: 'overtime' },
  {
    key: 'total',
    label: scope.value === 'WEEK' ? `第 ${weekIndex.value} 周合计` : '学期合计',
    width: 130,
    align: 'right',
  },
]);

const rows = computed<TableRow[]>(() => result.value?.items ?? []);
const weekOptions = computed(() =>
  Array.from({ length: result.value?.weekCount ?? 0 }, (_, index) => ({
    value: index + 1,
    label: `第 ${index + 1} 周`,
  })),
);
const emptyTitle = computed(() =>
  result.value?.message === '请先发布课表' ? '请先发布课表' : '当前口径暂无课时',
);
const emptyDescription = computed(() =>
  result.value?.message === '请先发布课表'
    ? '工作量只统计当前学期已发布的正式课表。发布课表后返回本页刷新。'
    : '当前教师或教学周没有可统计的课次。',
);

async function load(): Promise<void> {
  const semesterId = semesterStore.current?.semesterId;
  if (!semesterId) {
    result.value = null;
    return;
  }

  const token = ++requestToken;
  loading.value = true;
  loadError.value = '';
  try {
    const data = await statisticsApi.workload({
      semesterId,
      scope: scope.value,
      weekIndex: scope.value === 'WEEK' ? weekIndex.value : undefined,
    });
    if (token !== requestToken) {
      return;
    }
    result.value = data;
    if (data.weekCount > 0 && weekIndex.value > data.weekCount) {
      weekIndex.value = data.weekCount;
    }
  } catch (error) {
    if (token === requestToken) {
      loadError.value = friendlyError(error);
    }
  } finally {
    if (token === requestToken) {
      loading.value = false;
    }
  }
}

function overtimeLabel(value: unknown): string {
  return `${String(value ?? 0)}（细则 V1.1）`;
}

function onSemesterChanged(): void {
  void load();
}

watch(scope, () => {
  void load();
});
watch(weekIndex, () => {
  if (scope.value === 'WEEK') {
    void load();
  }
});

onMounted(async () => {
  window.addEventListener(SEMESTER_CHANGED_EVENT, onSemesterChanged);
  if (!semesterStore.loaded) {
    await semesterStore.fetch();
  }
  await load();
});

onBeforeUnmount(() => {
  window.removeEventListener(SEMESTER_CHANGED_EVENT, onSemesterChanged);
});
</script>

<template>
  <section>
    <PageHeader
      title="教师工作量统计"
      description="按教学周或学期统计常规、连堂、合班与加班课时；每条课次只计入一类。"
    />

    <el-card shadow="never" class="workload-card">
      <div class="workload-toolbar">
        <div class="workload-filters">
          <span class="workload-label">统计口径</span>
          <el-radio-group v-model="scope" aria-label="统计口径">
            <el-radio-button value="SEMESTER">学期口径</el-radio-button>
            <el-radio-button value="WEEK">周口径</el-radio-button>
          </el-radio-group>
          <el-select
            v-model="weekIndex"
            class="week-select"
            aria-label="教学周"
            :disabled="scope !== 'WEEK' || weekOptions.length === 0"
          >
            <el-option
              v-for="option in weekOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </div>
        <div class="workload-hint">
          <el-tag type="info" effect="plain">
            {{ scope === 'WEEK' ? `第 ${weekIndex} 周` : '全部教学周' }}
          </el-tag>
        </div>
      </div>

      <el-alert
        v-if="result?.message"
        :title="result.message"
        type="warning"
        :closable="false"
        show-icon
        class="workload-alert"
      />

      <ErrorState v-if="loadError" :message="loadError" @retry="load" />
      <DataTable
        v-else
        :columns="columns"
        :rows="rows"
        :loading="loading"
        row-key="teacherId"
        :empty-text="emptyTitle"
        :empty-description="emptyDescription"
      >
        <template #overtime="{ row }">
          <span class="overtime-placeholder">{{ overtimeLabel(row.overtime) }}</span>
        </template>
      </DataTable>

      <p class="workload-note">
        加班课时在 V1.0 恒为 0，仅展示字段占位；判定细则 V1.1 落地。连堂按实际节次计，合班按 1 节计。
      </p>
    </el-card>
  </section>
</template>

<style scoped>
.workload-card {
  border: 1px solid #dfe5ee;
}

.workload-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 18px;
}

.workload-filters {
  display: flex;
  align-items: center;
  gap: 12px;
}

.workload-label {
  color: #46546b;
  font-size: 13px;
  font-weight: 600;
}

.week-select {
  width: 140px;
}

.workload-hint {
  color: #5b6475;
  font-size: 13px;
}

.workload-alert {
  margin-bottom: 16px;
}

.overtime-placeholder {
  color: #7a8496;
  font-size: 12px;
}

.workload-note {
  margin: 16px 0 0;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.6;
}
</style>
