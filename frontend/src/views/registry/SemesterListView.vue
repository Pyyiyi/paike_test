<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import DataTable, { type TableColumn, type TableRow } from '@/shared/components/DataTable.vue';
import ErrorState from '@/shared/components/ErrorState.vue';
import FormDrawer from '@/shared/components/FormDrawer.vue';
import PageHeader from '@/shared/components/PageHeader.vue';
import { createCriticalConfirmOptions, useConfirm } from '@/shared/composables/useConfirm';
import { semesterApi, type SemesterWriteInput } from '@/shared/api/semester.api';
import { scheduleTemplateApi } from '@/shared/api/schedule-template.api';
import type {
  CalendarException,
  ScheduleTemplate,
  ScheduleTemplateVersion,
  SemesterSummary,
  SemesterStatus,
} from '@/shared/api/types';
import {
  CALENDAR_EXCEPTION_LABELS,
  SEMESTER_STATUS_LABELS,
  TERM_LABELS,
  WEEKDAY_LABELS,
  fieldErrors,
  friendlyError,
} from '@/shared/text/messages';

const confirm = useConfirm();

const semesters = ref<SemesterSummary[]>([]);
const templates = ref<ScheduleTemplate[]>([]);
const versionsByTemplate = ref<Record<string, ScheduleTemplateVersion[]>>({});
const loading = ref(false);
const error = ref('');
const includeArchived = ref(false);

const drawerVisible = ref(false);
const editing = ref<SemesterSummary | null>(null);
const submitting = ref(false);
const formError = ref('');
const formErrors = ref<Record<string, string>>({});
const form = reactive({
  name: '',
  academicYear: '',
  term: 'FALL' as 'FALL' | 'SPRING',
  startDate: '',
  endDate: '',
  scheduleTemplateVersionId: '',
});

const calendarVisible = ref(false);
const calendarSemester = ref<SemesterSummary | null>(null);
const calendarExceptions = ref<CalendarException[]>([]);
const calendarLoading = ref(false);
const calendarError = ref('');
const calendarFormError = ref('');
const calendarSubmitting = ref(false);
const calendarForm = reactive({
  type: 'STOP' as 'STOP' | 'MAKEUP',
  startDate: '',
  endDate: '',
  makeupWeekday: null as number | null,
  note: '',
});

const columns: TableColumn[] = [
  { key: 'name', label: '学期', minWidth: 160 },
  { key: 'academicYear', label: '学年', width: 130 },
  { key: 'dateRange', label: '起止日期', minWidth: 200, slot: 'dateRange' },
  { key: 'scheduleTemplateVersionId', label: '引用作息模板', minWidth: 200, slot: 'template' },
  { key: 'status', label: '状态', width: 110, slot: 'status' },
];

const calendarColumns: TableColumn[] = [
  { key: 'type', label: '类型', width: 110, slot: 'type' },
  { key: 'dateRange', label: '日期', minWidth: 190, slot: 'dateRange' },
  { key: 'makeupWeekday', label: '补课星期', width: 110, slot: 'makeupWeekday' },
  { key: 'note', label: '备注', minWidth: 140 },
];

const versionOptions = computed(() => {
  const options: Array<{ value: string; label: string }> = [];
  for (const template of templates.value) {
    const versions = versionsByTemplate.value[template.templateId] ?? [];
    for (const version of versions) {
      options.push({
        value: version.versionId,
        label: `${template.name} · v${version.versionNo}`,
      });
    }
  }
  return options;
});

const versionLabelById = computed(() => {
  const map = new Map<string, string>();
  for (const option of versionOptions.value) {
    map.set(option.value, option.label);
  }
  return map;
});

const termOptions = (Object.keys(TERM_LABELS) as Array<'FALL' | 'SPRING'>).map((value) => ({
  value,
  label: TERM_LABELS[value],
}));

const weekdayOptions = [1, 2, 3, 4, 5, 6, 7].map((value) => ({
  value,
  label: WEEKDAY_LABELS[value],
}));

const calendarReadOnly = computed(() => calendarSemester.value?.status === 'ARCHIVED');

function statusType(status: SemesterStatus): 'success' | 'info' | 'warning' {
  if (status === 'IN_PROGRESS') return 'success';
  if (status === 'ENDED') return 'warning';
  return 'info';
}

function templateLabel(versionId: string): string {
  return versionLabelById.value.get(versionId) ?? '未找到模板版本';
}

function resetForm(): void {
  form.name = '';
  form.academicYear = '';
  form.term = 'FALL';
  form.startDate = '';
  form.endDate = '';
  form.scheduleTemplateVersionId = '';
  formError.value = '';
  formErrors.value = {};
}

async function loadSemesters(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    semesters.value = await semesterApi.list(includeArchived.value);
  } catch (caught) {
    error.value = friendlyError(caught);
  } finally {
    loading.value = false;
  }
}

async function loadTemplates(): Promise<void> {
  try {
    templates.value = await scheduleTemplateApi.list();
    const loaded = await Promise.all(
      templates.value.map(async (template) => {
        const versions = await scheduleTemplateApi.listVersions(template.templateId);
        return [template.templateId, versions] as const;
      }),
    );
    const map: Record<string, ScheduleTemplateVersion[]> = {};
    for (const [templateId, versions] of loaded) {
      map[templateId] = versions;
    }
    versionsByTemplate.value = map;
  } catch (caught) {
    ElMessage.error(friendlyError(caught));
  }
}

function openCreate(): void {
  editing.value = null;
  resetForm();
  drawerVisible.value = true;
}

function openEdit(row: SemesterSummary): void {
  editing.value = row;
  resetForm();
  form.name = row.name;
  form.academicYear = row.academicYear;
  form.term = row.term;
  form.startDate = row.startDate;
  form.endDate = row.endDate;
  form.scheduleTemplateVersionId = row.scheduleTemplateVersionId;
  drawerVisible.value = true;
}

async function submitSemester(): Promise<void> {
  formErrors.value = {};
  formError.value = '';
  if (!form.scheduleTemplateVersionId) {
    formErrors.value.scheduleTemplateVersionId = '请选择作息模板';
    return;
  }
  submitting.value = true;
  try {
    const input: SemesterWriteInput = {
      name: form.name,
      academicYear: form.academicYear,
      term: form.term,
      startDate: form.startDate,
      endDate: form.endDate,
      scheduleTemplateVersionId: form.scheduleTemplateVersionId,
    };
    if (editing.value) {
      await semesterApi.update(editing.value.semesterId, { ...input, version: editing.value.version });
      ElMessage.success('学期已保存');
    } else {
      await semesterApi.create(input);
      ElMessage.success('学期已创建');
    }
    drawerVisible.value = false;
    await loadSemesters();
    await loadTemplates();
  } catch (caught) {
    formErrors.value = fieldErrors(caught);
    formError.value = friendlyError(caught);
  } finally {
    submitting.value = false;
  }
}

async function confirmDelete(row: SemesterSummary): Promise<void> {
  if (row.status === 'ARCHIVED') {
    return;
  }
  const confirmed = await confirm(createCriticalConfirmOptions('delete', `学期「${row.name}」`));
  if (!confirmed) {
    return;
  }
  try {
    await semesterApi.remove(row.semesterId, row.version);
    ElMessage.success('学期已删除');
    await loadSemesters();
  } catch (caught) {
    ElMessage.error(friendlyError(caught));
  }
}

function resetCalendarForm(): void {
  calendarForm.type = 'STOP';
  calendarForm.startDate = calendarSemester.value?.startDate ?? '';
  calendarForm.endDate = calendarSemester.value?.startDate ?? '';
  calendarForm.makeupWeekday = null;
  calendarForm.note = '';
  calendarFormError.value = '';
}

async function openCalendar(row: SemesterSummary): Promise<void> {
  calendarSemester.value = row;
  calendarVisible.value = true;
  resetCalendarForm();
  await loadCalendar();
}

async function loadCalendar(): Promise<void> {
  if (!calendarSemester.value) {
    return;
  }
  calendarLoading.value = true;
  calendarError.value = '';
  try {
    calendarExceptions.value = await semesterApi.listCalendarExceptions(calendarSemester.value.semesterId);
  } catch (caught) {
    calendarError.value = friendlyError(caught);
  } finally {
    calendarLoading.value = false;
  }
}

async function addCalendarException(): Promise<void> {
  if (!calendarSemester.value) {
    return;
  }
  calendarFormError.value = '';
  if (!calendarForm.startDate || !calendarForm.endDate) {
    calendarFormError.value = '请选择停课或调休日期';
    return;
  }
  if (calendarForm.type === 'MAKEUP' && !calendarForm.makeupWeekday) {
    calendarFormError.value = '调休上课必须选择补课星期';
    return;
  }
  calendarSubmitting.value = true;
  try {
    await semesterApi.createCalendarException(calendarSemester.value.semesterId, {
      type: calendarForm.type,
      startDate: calendarForm.startDate,
      endDate: calendarForm.endDate,
      makeupWeekday: calendarForm.type === 'MAKEUP' ? calendarForm.makeupWeekday : null,
      note: calendarForm.note || null,
    });
    ElMessage.success('校历项已保存');
    resetCalendarForm();
    await loadCalendar();
  } catch (caught) {
    calendarFormError.value = friendlyError(caught);
  } finally {
    calendarSubmitting.value = false;
  }
}

async function removeCalendarException(row: CalendarException): Promise<void> {
  if (!calendarSemester.value) {
    return;
  }
  const confirmed = await confirm(
    createCriticalConfirmOptions('delete', `校历项「${CALENDAR_EXCEPTION_LABELS[row.type]} ${row.startDate}」`),
  );
  if (!confirmed) {
    return;
  }
  try {
    await semesterApi.removeCalendarException(calendarSemester.value.semesterId, row.exceptionId);
    ElMessage.success('校历项已删除');
    await loadCalendar();
  } catch (caught) {
    ElMessage.error(friendlyError(caught));
  }
}

function statusLabel(row: TableRow): string {
  return SEMESTER_STATUS_LABELS[(row as unknown as SemesterSummary).status];
}

function calendarTypeLabel(row: TableRow): string {
  return CALENDAR_EXCEPTION_LABELS[(row as unknown as CalendarException).type];
}

function editFromRow(row: TableRow): void {
  openEdit(row as unknown as SemesterSummary);
}

function calendarFromRow(row: TableRow): void {
  void openCalendar(row as unknown as SemesterSummary);
}

function deleteFromRow(row: TableRow): void {
  void confirmDelete(row as unknown as SemesterSummary);
}

function removeCalendarFromRow(row: TableRow): void {
  void removeCalendarException(row as unknown as CalendarException);
}

onMounted(async () => {
  await loadTemplates();
  await loadSemesters();
});
</script>

<template>
  <div class="semester-page">
    <PageHeader title="学期管理" description="维护学期时间范围、引用作息模板与校历；已存档学期只读。">
      <template #actions>
        <el-checkbox v-model="includeArchived" @change="loadSemesters">显示已存档</el-checkbox>
        <el-button @click="loadSemesters">刷新</el-button>
        <el-button type="primary" @click="openCreate">新增学期</el-button>
      </template>
    </PageHeader>

    <ErrorState v-if="error" :message="error" @retry="loadSemesters" />

    <DataTable
      v-else
      :columns="columns"
      :rows="semesters"
      :loading="loading"
      row-key="semesterId"
      empty-text="还没有学期"
      empty-description="点击「新增学期」并选择一个作息模板后开始配置。"
      empty-action-text="新增学期"
      @empty-action="openCreate"
    >
      <template #dateRange="{ row }">{{ row.startDate }} 至 {{ row.endDate }}</template>
      <template #template="{ row }">{{ templateLabel(row.scheduleTemplateVersionId) }}</template>
      <template #status="{ row }">
        <el-tag :type="statusType(row.status)" disable-transitions>
          {{ statusLabel(row) }}
        </el-tag>
      </template>
      <template #actions="{ row }">
        <el-button link :disabled="row.status === 'ARCHIVED'" @click="editFromRow(row)">编辑</el-button>
        <el-button link @click="calendarFromRow(row)">校历</el-button>
        <el-button link type="danger" :disabled="row.status === 'ARCHIVED'" @click="deleteFromRow(row)">
          删除
        </el-button>
      </template>
    </DataTable>

    <FormDrawer
      v-model="drawerVisible"
      :title="editing ? '编辑学期' : '新增学期'"
      :description="editing ? '修改学期信息；已存档学期不可编辑。' : '新增学期必须选择一个作息模板版本。'"
      :submit-text="editing ? '保存学期' : '创建学期'"
      :submit-loading="submitting"
      :error="formError"
      @submit="submitSemester"
      @cancel="drawerVisible = false"
    >
      <el-form label-position="top" class="semester-form">
        <el-form-item label="学期名称" required :error="formErrors.name">
          <el-input v-model="form.name" maxlength="100" placeholder="例如：2026 秋季学期" />
        </el-form-item>
        <el-form-item label="学年" required :error="formErrors.academicYear">
          <el-input v-model="form.academicYear" maxlength="9" placeholder="例如：2026-2027" />
        </el-form-item>
        <el-form-item label="学期类型" required :error="formErrors.term">
          <el-select v-model="form.term" style="width: 100%">
            <el-option v-for="option in termOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="开始日期" required :error="formErrors.startDate">
          <el-date-picker v-model="form.startDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="结束日期" required :error="formErrors.endDate">
          <el-date-picker v-model="form.endDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="引用作息模板" required :error="formErrors.scheduleTemplateVersionId">
          <el-select
            v-model="form.scheduleTemplateVersionId"
            filterable
            placeholder="请选择作息模板"
            style="width: 100%"
          >
            <el-option v-for="option in versionOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
          <p v-if="versionOptions.length === 0" class="form-hint">
            还没有可用的作息模板，请先在「作息模板」页面创建并保存版本。
          </p>
        </el-form-item>
      </el-form>
    </FormDrawer>

    <el-drawer v-model="calendarVisible" :title="`校历 · ${calendarSemester?.name ?? ''}`" size="760px">
      <el-alert
        v-if="calendarReadOnly"
        type="info"
        :closable="false"
        show-icon
        title="该学期已存档，校历只能查看或导出。"
      />
      <ErrorState v-if="calendarError" :message="calendarError" @retry="loadCalendar" />
      <DataTable
        v-else
        :columns="calendarColumns"
        :rows="calendarExceptions"
        :loading="calendarLoading"
        row-key="exceptionId"
        empty-text="还没有校历项"
        empty-description="停课与调休上课会按日期显示在这里。"
      >
        <template #type="{ row }">{{ calendarTypeLabel(row) }}</template>
        <template #dateRange="{ row }">{{ row.startDate }} 至 {{ row.endDate }}</template>
        <template #makeupWeekday="{ row }">
          {{ row.makeupWeekday ? WEEKDAY_LABELS[row.makeupWeekday] : '—' }}
        </template>
        <template #actions="{ row }">
          <el-button v-if="!calendarReadOnly" link type="danger" @click="removeCalendarFromRow(row)">
            删除
          </el-button>
        </template>
      </DataTable>

      <section v-if="!calendarReadOnly" class="calendar-form">
        <h3>新增停课 / 调休</h3>
        <p class="form-hint">停课周仍占用教学周序号，单双周不会顺延；调休需选择按周几课表上课。</p>
        <el-alert v-if="calendarFormError" type="error" :closable="false" :title="calendarFormError" show-icon />
        <el-form label-position="top">
          <el-form-item label="类型" required>
            <el-radio-group v-model="calendarForm.type">
              <el-radio-button value="STOP">停课</el-radio-button>
              <el-radio-button value="MAKEUP">调休上课</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="开始日期" required>
            <el-date-picker v-model="calendarForm.startDate" type="date" value-format="YYYY-MM-DD" />
          </el-form-item>
          <el-form-item label="结束日期" required>
            <el-date-picker v-model="calendarForm.endDate" type="date" value-format="YYYY-MM-DD" />
          </el-form-item>
          <el-form-item v-if="calendarForm.type === 'MAKEUP'" label="按周几课表上课" required>
            <el-select v-model="calendarForm.makeupWeekday" placeholder="请选择补课星期">
              <el-option v-for="option in weekdayOptions" :key="option.value" :label="option.label" :value="option.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="calendarForm.note" maxlength="200" placeholder="例如：校运会停课" />
          </el-form-item>
          <el-button type="primary" :loading="calendarSubmitting" @click="addCalendarException">
            保存校历项
          </el-button>
        </el-form>
      </section>
    </el-drawer>
  </div>
</template>

<style scoped>
.semester-page {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.semester-form :deep(.el-form-item) {
  margin-bottom: 18px;
}

.form-hint {
  margin: 6px 0 0;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.5;
}

.calendar-form {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid #e5e7eb;
}

.calendar-form h3 {
  margin: 0 0 6px;
  color: #1f2937;
  font-size: 16px;
}
</style>
