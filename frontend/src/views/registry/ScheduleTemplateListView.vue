<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import DataTable, { type TableColumn, type TableRow } from '@/shared/components/DataTable.vue';
import ErrorState from '@/shared/components/ErrorState.vue';
import FormDrawer from '@/shared/components/FormDrawer.vue';
import PageHeader from '@/shared/components/PageHeader.vue';
import { createCriticalConfirmOptions, useConfirm } from '@/shared/composables/useConfirm';
import { scheduleTemplateApi } from '@/shared/api/schedule-template.api';
import { isApiError } from '@/shared/api/http';
import type { ErrorDetail, ScheduleTemplate, ScheduleTemplateVersion } from '@/shared/api/types';
import { TEMPLATE_STATUS_LABELS, WEEKDAY_LABELS, fieldErrors, friendlyError } from '@/shared/text/messages';

interface PeriodForm {
  startTime: string;
  endTime: string;
  label: string;
}

const confirm = useConfirm();

const templates = ref<ScheduleTemplate[]>([]);
const loading = ref(false);
const error = ref('');

const drawerVisible = ref(false);
const editingTemplateId = ref<string | null>(null);
const baseVersionId = ref<string | undefined>(undefined);
const editingVersionNo = ref<number | null>(null);
const submitting = ref(false);
const formError = ref('');
const formDetails = ref<ErrorDetail[]>([]);
const formErrors = ref<Record<string, string>>({});
const form = reactive({
  name: '',
  openWeekdays: [1, 2, 3, 4, 5] as number[],
  periods: [] as PeriodForm[],
});

const versionDrawerVisible = ref(false);
const activeTemplate = ref<ScheduleTemplate | null>(null);
const versions = ref<ScheduleTemplateVersion[]>([]);
const versionsLoading = ref(false);
const versionsError = ref('');

const columns: TableColumn[] = [
  { key: 'name', label: '模板名称', minWidth: 180 },
  { key: 'latestVersionNo', label: '最新版本', width: 100, slot: 'latestVersion' },
  { key: 'openWeekdays', label: '开放星期', minWidth: 160, slot: 'openWeekdays' },
  { key: 'periods', label: '节次', minWidth: 200, slot: 'periods' },
  { key: 'status', label: '状态', width: 90, slot: 'status' },
];

const versionColumns: TableColumn[] = [
  { key: 'versionNo', label: '版本', width: 80, slot: 'versionNo' },
  { key: 'openWeekdays', label: '开放星期', minWidth: 150, slot: 'openWeekdays' },
  { key: 'periods', label: '节次时间', minWidth: 260, slot: 'periods' },
  { key: 'status', label: '状态', width: 90, slot: 'status' },
  { key: 'createdAt', label: '创建时间', minWidth: 160, slot: 'createdAt' },
];

const weekdayOptions = [1, 2, 3, 4, 5, 6, 7].map((value) => ({ value, label: WEEKDAY_LABELS[value] }));

function periodsSummary(version?: ScheduleTemplateVersion): string {
  if (!version || version.periods.length === 0) {
    return '—';
  }
  const first = version.periods[0];
  const last = version.periods[version.periods.length - 1];
  return `${version.periods.length} 节 · ${first?.startTime ?? ''}-${last?.endTime ?? ''}`;
}

function weekdaysLabel(weekdays: number[]): string {
  return weekdays.map((weekday) => WEEKDAY_LABELS[weekday]).join('、');
}

function formattedTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function makeEmptyPeriod(index: number): PeriodForm {
  return { startTime: '08:00', endTime: '08:45', label: `第 ${index + 1} 节` };
}

function resetForm(): void {
  editingTemplateId.value = null;
  baseVersionId.value = undefined;
  editingVersionNo.value = null;
  form.name = '';
  form.openWeekdays = [1, 2, 3, 4, 5];
  form.periods = [makeEmptyPeriod(0), makeEmptyPeriod(1)];
  form.periods[1] = { startTime: '08:55', endTime: '09:40', label: '第 2 节' };
  formError.value = '';
  formDetails.value = [];
  formErrors.value = {};
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    templates.value = await scheduleTemplateApi.list();
  } catch (caught) {
    error.value = friendlyError(caught);
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  resetForm();
  drawerVisible.value = true;
}

async function openEdit(template: ScheduleTemplate, preferred?: ScheduleTemplateVersion): Promise<void> {
  try {
    const list = await scheduleTemplateApi.listVersions(template.templateId);
    const version =
      preferred ?? list.find((item) => item.versionNo === template.latestVersionNo) ?? list[0];
    if (!version) {
      ElMessage.error('该模板还没有可用版本');
      return;
    }
    resetForm();
    editingTemplateId.value = template.templateId;
    baseVersionId.value = version.versionId;
    editingVersionNo.value = version.versionNo;
    form.name = template.name;
    form.openWeekdays = [...version.openWeekdays];
    form.periods = version.periods.map((period) => ({
      startTime: period.startTime,
      endTime: period.endTime,
      label: period.label ?? `第 ${period.periodNo} 节`,
    }));
    drawerVisible.value = true;
    versionDrawerVisible.value = false;
  } catch (caught) {
    ElMessage.error(friendlyError(caught));
  }
}

function addPeriod(): void {
  form.periods.push(makeEmptyPeriod(form.periods.length));
}

function removePeriod(index: number): void {
  form.periods.splice(index, 1);
  form.periods.forEach((period, position) => {
    if (!period.label || period.label.startsWith('第 ')) {
      period.label = `第 ${position + 1} 节`;
    }
  });
}

async function submitTemplate(): Promise<void> {
  formErrors.value = {};
  formError.value = '';
  formDetails.value = [];
  if (!form.name.trim()) {
    formErrors.value.name = '请输入模板名称';
    return;
  }
  if (form.openWeekdays.length === 0) {
    formErrors.value.openWeekdays = '请至少选择一个开放星期';
    return;
  }
  if (form.periods.length === 0) {
    formErrors.value.periods = '请至少配置一个节次';
    return;
  }

  submitting.value = true;
  try {
    const content = {
      openWeekdays: [...form.openWeekdays].sort((left, right) => left - right),
      periods: form.periods.map((period, index) => ({
        periodNo: index + 1,
        startTime: period.startTime,
        endTime: period.endTime,
        label: period.label || `第 ${index + 1} 节`,
      })),
    };

    if (editingTemplateId.value) {
      const created = await scheduleTemplateApi.createVersion(editingTemplateId.value, {
        baseVersionId: baseVersionId.value,
        ...content,
      });
      ElMessage.success(`已保存为 v${created.versionNo}，历史版本保持不变`);
    } else {
      await scheduleTemplateApi.create({ name: form.name.trim(), ...content });
      ElMessage.success('作息模板已创建（v1）');
    }
    drawerVisible.value = false;
    await load();
  } catch (caught) {
    formErrors.value = fieldErrors(caught);
    formError.value = friendlyError(caught);
    formDetails.value = isApiError(caught) ? caught.details : [];
  } finally {
    submitting.value = false;
  }
}

async function confirmDelete(template: ScheduleTemplate): Promise<void> {
  const confirmed = await confirm(
    createCriticalConfirmOptions('delete', `作息模板「${template.name}」`),
  );
  if (!confirmed) {
    return;
  }
  try {
    await scheduleTemplateApi.remove(template.templateId, template.version);
    ElMessage.success('作息模板已删除');
    await load();
  } catch (caught) {
    ElMessage.error(friendlyError(caught));
  }
}

async function openVersions(template: ScheduleTemplate): Promise<void> {
  activeTemplate.value = template;
  versionDrawerVisible.value = true;
  await loadVersions();
}

async function loadVersions(): Promise<void> {
  if (!activeTemplate.value) {
    return;
  }
  versionsLoading.value = true;
  versionsError.value = '';
  try {
    versions.value = await scheduleTemplateApi.listVersions(activeTemplate.value.templateId);
  } catch (caught) {
    versionsError.value = friendlyError(caught);
  } finally {
    versionsLoading.value = false;
  }
}

async function validate(version: ScheduleTemplateVersion): Promise<void> {
  try {
    const result = await scheduleTemplateApi.validateVersion(version.versionId);
    if (result.valid) {
      ElMessage.success(`v${version.versionNo} 节次校验通过`);
    } else {
      ElMessage.error(result.errors.map((item) => item.message).join('；'));
    }
  } catch (caught) {
    ElMessage.error(friendlyError(caught));
  }
}

function statusLabel(row: TableRow): string {
  return TEMPLATE_STATUS_LABELS[(row as unknown as ScheduleTemplate).status];
}

function periodsLabel(row: TableRow): string {
  const periods = (row as unknown as ScheduleTemplateVersion).periods;
  return periods.map((period) => `第${period.periodNo}节 ${period.startTime}-${period.endTime}`).join('；');
}

function versionsFromRow(row: TableRow): void {
  void openVersions(row as unknown as ScheduleTemplate);
}

function templateEditFromRow(row: TableRow): void {
  void openEdit(row as unknown as ScheduleTemplate);
}

function templateDeleteFromRow(row: TableRow): void {
  void confirmDelete(row as unknown as ScheduleTemplate);
}

function validateFromRow(row: TableRow): void {
  void validate(row as unknown as ScheduleTemplateVersion);
}

function editVersionFromRow(row: TableRow): void {
  if (activeTemplate.value) {
    void openEdit(activeTemplate.value, row as unknown as ScheduleTemplateVersion);
  }
}

onMounted(load);
</script>

<template>
  <div class="template-page">
    <PageHeader
      title="作息模板"
      description="维护开放星期与节次时间；保存编辑会生成新版本，历史版本不可变。"
    >
      <template #actions>
        <el-button @click="load">刷新</el-button>
        <el-button type="primary" @click="openCreate">新建作息模板</el-button>
      </template>
    </PageHeader>

    <ErrorState v-if="error" :message="error" @retry="load" />

    <DataTable
      v-else
      :columns="columns"
      :rows="templates"
      :loading="loading"
      row-key="templateId"
      empty-text="还没有作息模板"
      empty-description="点击「新建作息模板」配置开放星期与节次时间。"
      empty-action-text="新建作息模板"
      @empty-action="openCreate"
    >
      <template #latestVersion="{ row }">v{{ row.latestVersionNo }}</template>
      <template #openWeekdays="{ row }">{{ weekdaysLabel(row.latestVersion?.openWeekdays ?? []) }}</template>
      <template #periods="{ row }">{{ periodsSummary(row.latestVersion) }}</template>
      <template #status="{ row }">
        <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'" disable-transitions>
          {{ statusLabel(row) }}
        </el-tag>
      </template>
      <template #actions="{ row }">
        <el-button link @click="versionsFromRow(row)">版本记录</el-button>
        <el-button link @click="templateEditFromRow(row)">编辑</el-button>
        <el-button link type="danger" @click="templateDeleteFromRow(row)">删除</el-button>
      </template>
    </DataTable>

    <FormDrawer
      v-model="drawerVisible"
      width="720px"
      :title="editingTemplateId ? `编辑模板（保存为 v${(editingVersionNo ?? 0) + 1}）` : '新建作息模板'"
      :description="editingTemplateId
        ? '保存后会追加一个新版本，历史版本逐字段保持不变；引用旧版本的学期仍读取旧版本。'
        : '创建模板时同时生成 v1；同一模板可被多个学期引用。'"
      :submit-text="editingTemplateId ? '保存为新版本' : '创建模板'"
      :submit-loading="submitting"
      :error="formError"
      @submit="submitTemplate"
      @cancel="drawerVisible = false"
    >
      <el-form label-position="top" class="template-form">
        <el-form-item label="模板名称" required :error="formErrors.name">
          <el-input
            v-model="form.name"
            maxlength="100"
            placeholder="例如：默认作息模板"
            :disabled="Boolean(editingTemplateId)"
          />
          <p v-if="editingTemplateId" class="form-hint">模板名称在创建后不可修改；保存只会追加新的节次版本。</p>
        </el-form-item>
        <el-form-item label="开放排课星期" required :error="formErrors.openWeekdays">
          <el-checkbox-group v-model="form.openWeekdays">
            <el-checkbox v-for="option in weekdayOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="节次时间表" required :error="formErrors.periods">
          <div class="period-list">
            <div v-for="(period, index) in form.periods" :key="index" class="period-row">
              <span class="period-no">第 {{ index + 1 }} 节</span>
              <el-time-picker
                v-model="period.startTime"
                format="HH:mm"
                value-format="HH:mm"
                placeholder="开始时间"
              />
              <span class="period-separator">至</span>
              <el-time-picker
                v-model="period.endTime"
                format="HH:mm"
                value-format="HH:mm"
                placeholder="结束时间"
              />
              <el-input v-model="period.label" maxlength="40" placeholder="节次名称" />
              <el-button
                link
                type="danger"
                :disabled="form.periods.length <= 1"
                @click="removePeriod(index)"
              >
                删除
              </el-button>
            </div>
          </div>
          <el-button class="period-add" plain @click="addPeriod">新增节次</el-button>
          <p class="form-hint">节次编号从 1 连续；单节结束时间必须晚于开始时间；同一开放星期内不允许重叠。</p>
        </el-form-item>
        <el-alert
          v-if="formDetails.length > 0"
          type="error"
          :closable="false"
          title="以下节次需要修正"
          show-icon
        >
          <ul class="error-details">
            <li v-for="(detail, index) in formDetails" :key="index">
              <span v-if="detail.field" class="error-field">{{ detail.field }}</span>
              {{ detail.message }}
            </li>
          </ul>
        </el-alert>
      </el-form>
    </FormDrawer>

    <el-drawer
      v-model="versionDrawerVisible"
      :title="`版本记录 · ${activeTemplate?.name ?? ''}`"
      size="880px"
    >
      <p class="form-hint">历史版本不可变；编辑保存只会追加新版本。</p>
      <ErrorState v-if="versionsError" :message="versionsError" @retry="loadVersions" />
      <DataTable
        v-else
        :columns="versionColumns"
        :rows="versions"
        :loading="versionsLoading"
        row-key="versionId"
        empty-text="还没有版本"
        empty-description="保存模板后会生成第一个版本。"
      >
        <template #versionNo="{ row }"><strong>v{{ row.versionNo }}</strong></template>
        <template #openWeekdays="{ row }">{{ weekdaysLabel(row.openWeekdays) }}</template>
        <template #periods="{ row }">
          <span>{{ periodsLabel(row) }}</span>
        </template>
        <template #status="{ row }">
          <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'" disable-transitions>
            {{ statusLabel(row) }}
          </el-tag>
        </template>
        <template #createdAt="{ row }">{{ formattedTime(row.createdAt) }}</template>
        <template #actions="{ row }">
          <el-button link @click="validateFromRow(row)">校验</el-button>
          <el-button v-if="activeTemplate" link @click="editVersionFromRow(row)">基于此版本编辑</el-button>
        </template>
      </DataTable>
    </el-drawer>
  </div>
</template>

<style scoped>
.template-page {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.template-form :deep(.el-form-item) {
  margin-bottom: 18px;
}

.period-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}

.period-row {
  display: grid;
  grid-template-columns: 56px 128px 20px 128px minmax(100px, 1fr) 44px;
  align-items: center;
  gap: 8px;
}

.period-no {
  color: #374151;
  font-weight: 600;
}

.period-separator {
  color: #6b7280;
  text-align: center;
}

.period-add {
  margin-top: 12px;
}

.form-hint {
  margin: 6px 0 0;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.5;
}

.error-details {
  margin: 8px 0 0;
  padding-left: 18px;
  line-height: 1.7;
}

.error-field {
  display: inline-block;
  margin-right: 6px;
  padding: 0 4px;
  border-radius: 4px;
  background: #fef3c7;
  color: #92400e;
  font-family: monospace;
  font-size: 12px;
}
</style>
