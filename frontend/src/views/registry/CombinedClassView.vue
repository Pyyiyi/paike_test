<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHeader from '@/shared/components/PageHeader.vue';
import DataTable, { type TableColumn, type TableRow } from '@/shared/components/DataTable.vue';
import FormDrawer from '@/shared/components/FormDrawer.vue';
import ErrorState from '@/shared/components/ErrorState.vue';
import { resourceApi, type CombinedClass, type ResourceOption, type Venue } from '@/shared/api/resource.api';
import { registryApi, type RegistryRow } from '@/shared/api/registry.api';
import { fieldErrors, friendlyError } from '@/shared/text/messages';

const rows = ref<CombinedClass[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const loadError = ref('');
const saving = ref(false);
const drawerOpen = ref(false);
const editingId = ref<string | null>(null);
const formError = ref('');
const errors = ref<Record<string, string>>({});

const classes = ref<ResourceOption[]>([]);
const teachers = ref<ResourceOption[]>([]);
const venues = ref<Venue[]>([]);
const nameOptions = ref<string[]>([]);
const weekday = ref<number | null>(null);
const periods = ref<number[]>([]);

const form = reactive({
  name: '',
  teacherId: '',
  venueId: '',
  classIds: [] as string[],
  version: 1,
});

const columns: TableColumn[] = [
  { key: 'name', label: '合班名称', minWidth: 170 },
  { key: 'classNameText', label: '参与班级', minWidth: 240 },
  { key: 'teacherName', label: '教师', minWidth: 120 },
  { key: 'venueName', label: '场地', minWidth: 120 },
  { key: 'periodText', label: '节次约束', minWidth: 150 },
  { key: 'version', label: '版本', width: 76, align: 'right' },
];

const weekdayLabels = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const periodOptions = Array.from({ length: 20 }, (_, index) => index + 1);

function optionId(item: ResourceOption): string {
  return item.id ?? item.classId ?? item.teacherId ?? item.subjectId ?? '';
}

const classOptions = computed(() =>
  classes.value.map((item) => ({ label: item.name ?? optionId(item), value: optionId(item) })),
);
const teacherOptions = computed(() =>
  teachers.value.map((item) => ({ label: item.name ?? optionId(item), value: optionId(item) })),
);
const venueOptions = computed(() => venues.value.map((item) => ({ label: item.name, value: item.venueId })));
const classNameById = computed(
  () => new Map(classOptions.value.map((option) => [option.value, option.label])),
);
const teacherNameById = computed(
  () => new Map(teacherOptions.value.map((option) => [option.value, option.label])),
);
const venueNameById = computed(() => new Map(venueOptions.value.map((option) => [option.value, option.label])));

const tableRows = computed(() =>
  rows.value.map((row) => ({
    ...row,
    classNameText: row.classIds.map((id) => classNameById.value.get(id) ?? id).join('、'),
    teacherName: teacherNameById.value.get(row.teacherId) ?? row.teacherId,
    venueName: venueNameById.value.get(row.venueId) ?? row.venueId,
    periodText: formatPeriodConstraint(row),
  })),
);

function formatPeriodConstraint(row: CombinedClass): string {
  if (row.periodConstraint.slots.length === 0) {
    return '不限';
  }
  return row.periodConstraint.slots
    .map((slot) => `${weekdayLabels[slot.weekday] ?? `周${slot.weekday}`}第${slot.period}节`)
    .join('、');
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    const result = await resourceApi.combinedClasses({ page: page.value, pageSize });
    rows.value = result.items;
    total.value = result.total;
  } catch (error) {
    loadError.value = friendlyError(error);
  } finally {
    loading.value = false;
  }
}

async function loadOptions(): Promise<void> {
  const [classResult, teacherResult, venueResult, vocabularyResult] = await Promise.allSettled([
    registryApi.classes({ page: 1, pageSize: 100 }),
    resourceApi.teachers({ page: 1, pageSize: 100 }),
    resourceApi.venues({ page: 1, pageSize: 100 }),
    resourceApi.controlledVocabulary('COMBINED_CLASS'),
  ]);
  if (classResult.status === 'fulfilled') {
    classes.value = classResult.value.items as RegistryRow[];
  }
  if (teacherResult.status === 'fulfilled') {
    teachers.value = teacherResult.value.items;
  }
  if (venueResult.status === 'fulfilled') {
    venues.value = venueResult.value.items;
  }
  nameOptions.value =
    vocabularyResult.status === 'fulfilled'
      ? vocabularyResult.value.items.map((item) => item.canonicalName)
      : Array.from(new Set(rows.value.map((unit) => unit.name)));
}

function resetForm(): void {
  Object.assign(form, { name: '', teacherId: '', venueId: '', classIds: [], version: 1 });
  weekday.value = null;
  periods.value = [];
  errors.value = {};
  formError.value = '';
}

function openCreate(): void {
  editingId.value = null;
  resetForm();
  drawerOpen.value = true;
}

function openEdit(row: TableRow): void {
  const unit = row as unknown as CombinedClass;
  editingId.value = unit.combinedClassId;
  Object.assign(form, {
    name: unit.name,
    teacherId: unit.teacherId,
    venueId: unit.venueId,
    classIds: [...unit.classIds],
    version: unit.version,
  });
  weekday.value = unit.periodConstraint.slots[0]?.weekday ?? null;
  periods.value = unit.periodConstraint.slots.map((slot) => slot.period);
  errors.value = {};
  formError.value = '';
  drawerOpen.value = true;
}

async function save(): Promise<void> {
  errors.value = {};
  formError.value = '';
  if (periods.value.length > 0 && weekday.value === null) {
    errors.value = { periodConstraint: '请选择节次约束的星期' };
    return;
  }
  const slots = periods.value.map((period) => ({ weekday: weekday.value as number, period }));
  saving.value = true;
  try {
    const payload = {
      name: form.name,
      teacherId: form.teacherId,
      venueId: form.venueId,
      classIds: form.classIds,
      periodConstraint: { slots },
    };
    if (editingId.value) {
      await resourceApi.updateCombinedClass(editingId.value, { ...payload, version: form.version });
      ElMessage.success('合班已更新');
    } else {
      await resourceApi.createCombinedClass(payload);
      ElMessage.success('合班已新增');
    }
    drawerOpen.value = false;
    await load();
    await loadOptions();
  } catch (error) {
    errors.value = fieldErrors(error);
    formError.value = friendlyError(error);
  } finally {
    saving.value = false;
  }
}

async function remove(row: TableRow): Promise<void> {
  const unit = row as unknown as CombinedClass;
  try {
    await ElMessageBox.confirm(
      `删除后合班“${unit.name}”将不再作为排课单元。此操作不可撤销。`,
      '确认删除合班',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' },
    );
    await resourceApi.deleteCombinedClass(unit.combinedClassId);
    ElMessage.success('合班已删除');
    await load();
  } catch (error) {
    if (error === 'cancel' || error === 'close') {
      return;
    }
    ElMessage.error(friendlyError(error));
  }
}

function changePage(nextPage: number): void {
  page.value = nextPage;
  void load();
}

onMounted(async () => {
  await Promise.all([load(), loadOptions()]);
});
</script>

<template>
  <section>
    <PageHeader title="合班课" description="将多个班级静态合并为一个可被排课引擎消费的排课单元。">
      <template #actions>
        <el-button type="primary" @click="openCreate">配置合班</el-button>
      </template>
    </PageHeader>

    <ErrorState v-if="loadError" :message="loadError" @retry="load" />
    <DataTable
      v-else
      :columns="columns"
      :rows="tableRows"
      :loading="loading"
      :total="total"
      :page="page"
      :page-size="pageSize"
      row-key="combinedClassId"
      empty-text="暂无合班"
      empty-description="选择至少两个班级、教师和场地后即可配置合班。"
      empty-action-text="配置合班"
      @empty-action="openCreate"
      @page-change="changePage"
    >
      <template #actions="{ row }">
        <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
        <el-button link type="danger" @click="remove(row)">删除</el-button>
      </template>
    </DataTable>

    <FormDrawer
      v-model="drawerOpen"
      :title="editingId ? '编辑合班' : '配置合班'"
      description="合班不限科目；参与班级、教师、场地和节次约束必须合法。"
      :submit-loading="saving"
      :error="formError"
      width="620px"
      @submit="save"
    >
      <el-form label-position="top">
        <el-form-item label="合班名称" :error="errors.name">
          <el-select v-model="form.name" filterable allow-create default-first-option placeholder="请选择受控合班名称">
            <el-option v-for="name in nameOptions" :key="name" :label="name" :value="name" />
          </el-select>
        </el-form-item>
        <el-form-item label="参与班级" :error="errors.classIds">
          <el-select v-model="form.classIds" multiple filterable placeholder="至少选择 2 个班级">
            <el-option v-for="option in classOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="教师" :error="errors.teacherId">
          <el-select v-model="form.teacherId" filterable placeholder="请选择教师">
            <el-option v-for="option in teacherOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="场地" :error="errors.venueId">
          <el-select v-model="form.venueId" filterable placeholder="请选择场地">
            <el-option v-for="option in venueOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="节次约束（可选）" :error="errors.periodConstraint">
          <div class="period-row">
            <el-select v-model="weekday" clearable placeholder="星期" class="period-row__weekday">
              <el-option v-for="day in 7" :key="day" :label="weekdayLabels[day]" :value="day" />
            </el-select>
            <el-select v-model="periods" multiple collapse-tags placeholder="节次" class="period-row__periods">
              <el-option v-for="period in periodOptions" :key="period" :label="`第 ${period} 节`" :value="period" />
            </el-select>
          </div>
        </el-form-item>
      </el-form>
    </FormDrawer>
  </section>
</template>

<style scoped>
.period-row {
  display: flex;
  width: 100%;
  gap: 10px;
}

.period-row__weekday {
  width: 130px;
}

.period-row__periods {
  flex: 1;
}
</style>
