<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHeader from '@/shared/components/PageHeader.vue';
import DataTable, { type TableColumn, type TableRow } from '@/shared/components/DataTable.vue';
import FormDrawer from '@/shared/components/FormDrawer.vue';
import ErrorState from '@/shared/components/ErrorState.vue';
import { resourceApi, type Venue, type VenuePayload } from '@/shared/api/resource.api';
import { fieldErrors, friendlyError } from '@/shared/text/messages';

const rows = ref<Venue[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const loadError = ref('');
const keyword = ref('');
const nameOptions = ref<string[]>([]);

const drawerOpen = ref(false);
const editingId = ref<string | null>(null);
const saving = ref(false);
const formError = ref('');
const errors = ref<Record<string, string>>({});
const form = reactive<VenuePayload & { version: number }>({
  name: '',
  type: 'CLASSROOM',
  capacity: 1,
  status: 'AVAILABLE',
  version: 1,
});

const columns: TableColumn[] = [
  { key: 'name', label: '场地名称', minWidth: 160 },
  { key: 'typeLabel', label: '类型', width: 110 },
  { key: 'capacity', label: '容量', width: 90, align: 'right' },
  { key: 'statusLabel', label: '状态', width: 100 },
  { key: 'version', label: '版本', width: 80, align: 'right' },
];

const typeLabels = { CLASSROOM: '教室', FUNCTION_ROOM: '功能室' } as const;
const statusLabels = { AVAILABLE: '可用', UNAVAILABLE: '停用' } as const;
const tableRows = computed(() =>
  rows.value.map((venue) => ({
    ...venue,
    typeLabel: typeLabels[venue.type],
    statusLabel: statusLabels[venue.status],
  })),
);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    const result = await resourceApi.venues({ page: page.value, pageSize, q: keyword.value || undefined });
    rows.value = result.items;
    total.value = result.total;
  } catch (error) {
    loadError.value = friendlyError(error);
  } finally {
    loading.value = false;
  }
}

async function loadNameOptions(): Promise<void> {
  try {
    const result = await resourceApi.controlledVocabulary('VENUE');
    nameOptions.value = result.items.map((item) => item.canonicalName);
  } catch {
    nameOptions.value = Array.from(new Set(rows.value.map((venue) => venue.name)));
  }
}

function resetForm(): void {
  Object.assign(form, { name: '', type: 'CLASSROOM', capacity: 1, status: 'AVAILABLE', version: 1 });
  errors.value = {};
  formError.value = '';
}

function openCreate(): void {
  editingId.value = null;
  resetForm();
  drawerOpen.value = true;
}

function openEdit(row: TableRow): void {
  const venue = row as unknown as Venue;
  editingId.value = venue.venueId;
  Object.assign(form, {
    name: venue.name,
    type: venue.type,
    capacity: venue.capacity,
    status: venue.status,
    version: venue.version,
  });
  errors.value = {};
  formError.value = '';
  drawerOpen.value = true;
}

async function save(): Promise<void> {
  saving.value = true;
  errors.value = {};
  formError.value = '';
  const payload: VenuePayload = {
    name: form.name,
    type: form.type,
    capacity: form.capacity,
    status: form.status,
  };
  try {
    if (editingId.value) {
      await resourceApi.updateVenue(editingId.value, { ...payload, version: form.version });
      ElMessage.success('场地已更新');
    } else {
      await resourceApi.createVenue(payload);
      ElMessage.success('场地已新增');
    }
    drawerOpen.value = false;
    await load();
    await loadNameOptions();
  } catch (error) {
    errors.value = fieldErrors(error);
    formError.value = friendlyError(error);
  } finally {
    saving.value = false;
  }
}

async function remove(row: TableRow): Promise<void> {
  const venue = row as unknown as Venue;
  try {
    await ElMessageBox.confirm(
      `删除后场地“${venue.name}”将不再参与排课。此操作不可撤销。`,
      '确认删除场地',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' },
    );
    await resourceApi.deleteVenue(venue.venueId);
    ElMessage.success('场地已删除');
    await load();
    await loadNameOptions();
  } catch (error) {
    if (error === 'cancel' || error === 'close') {
      return;
    }
    ElMessage.error(friendlyError(error));
  }
}

function search(): void {
  page.value = 1;
  void load();
}

function changePage(nextPage: number): void {
  page.value = nextPage;
  void load();
}

onMounted(async () => {
  await load();
  await loadNameOptions();
});
</script>

<template>
  <section>
    <PageHeader title="场地与功能室" description="维护教室与功能室的受控名称、类型、容量和可用状态。">
      <template #actions>
        <el-button type="primary" @click="openCreate">新增场地</el-button>
      </template>
    </PageHeader>

    <div class="toolbar">
      <el-input
        v-model="keyword"
        clearable
        placeholder="按名称搜索"
        class="toolbar__search"
        @keyup.enter="search"
        @clear="search"
      />
      <el-button @click="search">查询</el-button>
    </div>

    <ErrorState v-if="loadError" :message="loadError" @retry="load" />
    <DataTable
      v-else
      :columns="columns"
      :rows="tableRows"
      :loading="loading"
      :total="total"
      :page="page"
      :page-size="pageSize"
      row-key="venueId"
      empty-text="暂无场地"
      empty-description="新增教室或功能室后即可参与排课配置。"
      empty-action-text="新增场地"
      @empty-action="openCreate"
      @page-change="changePage"
    >
      <template #statusLabel="{ row }">
        <el-tag :type="row.status === 'AVAILABLE' ? 'success' : 'info'">
          {{ row.statusLabel }}
        </el-tag>
      </template>
      <template #actions="{ row }">
        <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
        <el-button link type="danger" @click="remove(row)">删除</el-button>
      </template>
    </DataTable>

    <FormDrawer
      v-model="drawerOpen"
      :title="editingId ? '编辑场地' : '新增场地'"
      description="类型仅支持教室或功能室；容量至少为 1。"
      :submit-loading="saving"
      :error="formError"
      @submit="save"
    >
      <el-form label-position="top">
        <el-form-item label="场地名称" :error="errors.name">
          <el-select
            v-model="form.name"
            filterable
            allow-create
            default-first-option
            placeholder="请选择受控场地名称"
            style="width: 100%"
          >
            <el-option v-for="name in nameOptions" :key="name" :label="name" :value="name" />
          </el-select>
        </el-form-item>
        <el-form-item label="类型" :error="errors.type">
          <el-radio-group v-model="form.type">
            <el-radio-button value="CLASSROOM">教室</el-radio-button>
            <el-radio-button value="FUNCTION_ROOM">功能室</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="容量" :error="errors.capacity">
          <el-input-number v-model="form.capacity" :min="1" :max="9999" />
        </el-form-item>
        <el-form-item label="状态" :error="errors.status">
          <el-radio-group v-model="form.status">
            <el-radio value="AVAILABLE">可用</el-radio>
            <el-radio value="UNAVAILABLE">停用</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
    </FormDrawer>
  </section>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
}

.toolbar__search {
  width: 280px;
}
</style>
