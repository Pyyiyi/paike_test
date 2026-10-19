<script setup lang="ts">
import EmptyState from './EmptyState.vue';

export interface TableColumn {
  key: string;
  label: string;
  width?: number | string;
  minWidth?: number | string;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  slot?: string;
  formatter?: (row: TableRow) => string;
}

export type TableRow = Record<string, unknown>;

const props = withDefaults(
  defineProps<{
    columns: TableColumn[];
    rows: TableRow[];
    loading?: boolean;
    emptyText?: string;
    emptyDescription?: string;
    emptyActionText?: string;
    total?: number;
    page?: number;
    pageSize?: number;
    rowKey?: string;
    selectable?: boolean;
  }>(),
  {
    loading: false,
    emptyText: '暂无数据',
    emptyDescription: '完成相关配置后，数据会显示在这里。',
    emptyActionText: '',
    total: 0,
    page: 1,
    pageSize: 20,
    rowKey: 'id',
    selectable: false,
  },
);

const emit = defineEmits<{
  'page-change': [page: number];
  'sort-change': [payload: { prop: string | null; order: 'ascending' | 'descending' | null }];
  'selection-change': [rows: TableRow[]];
  'empty-action': [];
}>();

function displayValue(row: TableRow, column: TableColumn): string {
  if (column.formatter) {
    return column.formatter(row);
  }
  const value = row[column.key];
  return value === undefined || value === null || value === '' ? '—' : String(value);
}
</script>

<template>
  <div class="data-table" :aria-busy="props.loading">
    <el-table
      v-loading="props.loading"
      :data="props.rows"
      :row-key="props.rowKey"
      border
      stripe
      @sort-change="emit('sort-change', { prop: $event.prop, order: $event.order })"
      @selection-change="emit('selection-change', $event as TableRow[])"
    >
      <el-table-column v-if="props.selectable" type="selection" width="48" />
      <el-table-column
        v-for="column in props.columns"
        :key="column.key"
        :prop="column.key"
        :label="column.label"
        :width="column.width"
        :min-width="column.minWidth"
        :align="column.align || 'left'"
        :sortable="column.sortable ? 'custom' : false"
      >
        <template #default="scope">
          <slot :name="column.slot || column.key" :row="scope.row" :value="scope.row[column.key]" :index="scope.$index">
            {{ displayValue(scope.row, column) }}
          </slot>
        </template>
      </el-table-column>
      <el-table-column v-if="$slots.actions" label="操作" width="180" fixed="right">
        <template #default="scope">
          <slot name="actions" :row="scope.row" :index="scope.$index" />
        </template>
      </el-table-column>
      <template #empty>
        <EmptyState
          :title="props.emptyText"
          :description="props.emptyDescription"
          :action-text="props.emptyActionText"
          @action="emit('empty-action')"
        />
      </template>
    </el-table>

    <div v-if="props.total > props.pageSize" class="data-table__pagination">
      <span>共 {{ props.total }} 条</span>
      <el-pagination
        :current-page="props.page"
        :page-size="props.pageSize"
        :total="props.total"
        layout="prev, pager, next"
        background
        @current-change="emit('page-change', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.data-table {
  width: 100%;
}

.data-table__pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16px;
  color: #5b6475;
}
</style>
