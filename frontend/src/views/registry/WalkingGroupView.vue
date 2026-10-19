<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHeader from '@/shared/components/PageHeader.vue';
import DataTable, { type TableColumn, type TableRow } from '@/shared/components/DataTable.vue';
import FormDrawer from '@/shared/components/FormDrawer.vue';
import ErrorState from '@/shared/components/ErrorState.vue';
import { resourceApi, type ResourceOption, type Venue, type WalkingGroup } from '@/shared/api/resource.api';
import { registryApi, type RegistryRow } from '@/shared/api/registry.api';
import { fieldErrors, friendlyError } from '@/shared/text/messages';

const rows = ref<WalkingGroup[]>([]);
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
const subjects = ref<RegistryRow[]>([]);
const teachers = ref<ResourceOption[]>([]);
const venues = ref<Venue[]>([]);
const nameOptions = ref<string[]>([]);

const form = reactive({
  name: '',
  subjectId: '',
  teacherId: '',
  venueId: '',
  classIds: [] as string[],
  version: 1,
});

const columns: TableColumn[] = [
  { key: 'name', label: '走班名称', minWidth: 160 },
  { key: 'subjectName', label: '科目', minWidth: 100 },
  { key: 'classNameText', label: '成员班级', minWidth: 220 },
  { key: 'teacherName', label: '教师', minWidth: 110 },
  { key: 'venueName', label: '目标场地', minWidth: 120 },
  { key: 'version', label: '版本', width: 76, align: 'right' },
];

function optionId(item: ResourceOption): string {
  return item.id ?? item.classId ?? item.teacherId ?? item.subjectId ?? '';
}

function registryId(item: RegistryRow): string {
  return String(item.classId ?? item.subjectId ?? item.id ?? '');
}

const classOptions = computed(() =>
  classes.value.map((item) => ({ label: item.name ?? optionId(item), value: optionId(item) })),
);
const subjectOptions = computed(() =>
  subjects.value.map((item) => ({ label: String(item.name ?? ''), value: registryId(item) })),
);
const teacherOptions = computed(() =>
  teachers.value.map((item) => ({ label: item.name ?? optionId(item), value: optionId(item) })),
);
const venueOptions = computed(() => venues.value.map((item) => ({ label: item.name, value: item.venueId })));
const classNameById = computed(
  () => new Map(classOptions.value.map((option) => [option.value, option.label])),
);
const subjectNameById = computed(
  () => new Map(subjectOptions.value.map((option) => [option.value, option.label])),
);
const teacherNameById = computed(
  () => new Map(teacherOptions.value.map((option) => [option.value, option.label])),
);
const venueNameById = computed(() => new Map(venueOptions.value.map((option) => [option.value, option.label])));

const tableRows = computed(() =>
  rows.value.map((row) => ({
    ...row,
    subjectName: subjectNameById.value.get(row.subjectId) ?? row.subjectId,
    classNameText: row.classIds.map((id) => classNameById.value.get(id) ?? id).join('、'),
    teacherName: teacherNameById.value.get(row.teacherId) ?? row.teacherId,
    venueName: venueNameById.value.get(row.venueId) ?? row.venueId,
  })),
);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    const result = await resourceApi.walkingGroups({ page: page.value, pageSize });
    rows.value = result.items;
    total.value = result.total;
  } catch (error) {
    loadError.value = friendlyError(error);
  } finally {
    loading.value = false;
  }
}

async function loadOptions(): Promise<void> {
  const [classResult, subjectResult, teacherResult, venueResult, vocabularyResult] = await Promise.allSettled([
    registryApi.classes({ page: 1, pageSize: 100 }),
    registryApi.subjects({ page: 1, pageSize: 100 }),
    resourceApi.teachers({ page: 1, pageSize: 100 }),
    resourceApi.venues({ page: 1, pageSize: 100 }),
    resourceApi.controlledVocabulary('WALKING_GROUP'),
  ]);
  if (classResult.status === 'fulfilled') {
    classes.value = classResult.value.items as RegistryRow[];
  }
  if (subjectResult.status === 'fulfilled') {
    subjects.value = subjectResult.value.items;
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
  Object.assign(form, {
    name: '',
    subjectId: '',
    teacherId: '',
    venueId: '',
    classIds: [],
    version: 1,
  });
  errors.value = {};
  formError.value = '';
}

function openCreate(): void {
  editingId.value = null;
  resetForm();
  drawerOpen.value = true;
}

function openEdit(row: TableRow): void {
  const unit = row as unknown as WalkingGroup;
  editingId.value = unit.walkingGroupId;
  Object.assign(form, {
    name: unit.name,
    subjectId: unit.subjectId,
    teacherId: unit.teacherId,
    venueId: unit.venueId,
    classIds: [...unit.classIds],
    version: unit.version,
  });
  errors.value = {};
  formError.value = '';
  drawerOpen.value = true;
}

async function save(): Promise<void> {
  saving.value = true;
  errors.value = {};
  formError.value = '';
  try {
    const payload = {
      name: form.name,
      subjectId: form.subjectId,
      teacherId: form.teacherId,
      venueId: form.venueId,
      classIds: form.classIds,
    };
    if (editingId.value) {
      await resourceApi.updateWalkingGroup(editingId.value, { ...payload, version: form.version });
      ElMessage.success('走班已更新');
    } else {
      await resourceApi.createWalkingGroup(payload);
      ElMessage.success('走班已新增');
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
  const unit = row as unknown as WalkingGroup;
  try {
    await ElMessageBox.confirm(
      `删除后走班“${unit.name}”将不再作为排课单元。此操作不可撤销。`,
      '确认删除走班',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' },
    );
    await resourceApi.deleteWalkingGroup(unit.walkingGroupId);
    ElMessage.success('走班已删除');
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
    <PageHeader title="走班配置" description="按科目将一组班级安排到目标场地，由指定教师授课。">
      <template #actions>
        <el-button type="primary" @click="openCreate">新增走班</el-button>
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
      row-key="walkingGroupId"
      empty-text="暂无走班"
      empty-description="选择科目、教师、目标场地和成员班级后即可新增走班。"
      empty-action-text="新增走班"
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
      :title="editingId ? '编辑走班' : '新增走班'"
      description="科目、教师、目标场地和成员班级均为必填。"
      :submit-loading="saving"
      :error="formError"
      width="620px"
      @submit="save"
    >
      <el-form label-position="top">
        <el-form-item label="走班名称" :error="errors.name">
          <el-select v-model="form.name" filterable allow-create default-first-option placeholder="请选择受控走班名称">
            <el-option v-for="name in nameOptions" :key="name" :label="name" :value="name" />
          </el-select>
        </el-form-item>
        <el-form-item label="科目" :error="errors.subjectId">
          <el-select v-model="form.subjectId" filterable placeholder="请选择科目">
            <el-option v-for="option in subjectOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="教师" :error="errors.teacherId">
          <el-select v-model="form.teacherId" filterable placeholder="请选择教师">
            <el-option v-for="option in teacherOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="目标场地" :error="errors.venueId">
          <el-select v-model="form.venueId" filterable placeholder="请选择目标场地">
            <el-option v-for="option in venueOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="成员班级" :error="errors.classIds">
          <el-select v-model="form.classIds" multiple filterable placeholder="至少选择 1 个班级">
            <el-option v-for="option in classOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </el-form-item>
      </el-form>
    </FormDrawer>
  </section>
</template>
