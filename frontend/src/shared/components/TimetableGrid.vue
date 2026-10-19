<script setup lang="ts">
import { computed } from 'vue';
import type { SelectOption, TimetableCell, TimetableGridCoord } from '@/shared/api/types';
import { WEEK_PARITY_LABELS } from '@/shared/text/messages';

const props = withDefaults(
  defineProps<{
    weekdays: SelectOption<number>[];
    periods: SelectOption<number>[];
    cells?: Record<string, TimetableCell>;
    loading?: boolean;
    caption?: string;
    emptyText?: string;
  }>(),
  {
    cells: () => ({}),
    loading: false,
    caption: '课表网格',
    emptyText: '当前学期还没有已发布课表，请先完成排课并发布。',
  },
);

const emit = defineEmits<{
  'cell-click': [cell: TimetableCell | null, coord: TimetableGridCoord];
}>();

const hasCells = computed(() => Object.keys(props.cells).length > 0);

function cellKey(weekday: number, period: number): string {
  return `${weekday}:${period}`;
}

function cellFor(weekday: number, period: number): TimetableCell | null {
  return props.cells[cellKey(weekday, period)] ?? null;
}
</script>

<template>
  <section class="timetable-shell" :aria-busy="props.loading">
    <div v-if="props.loading" class="timetable-loading" role="status">
      正在加载课表，请稍候。
    </div>
    <div class="timetable-scroll">
      <table class="timetable-grid" role="grid" :aria-label="props.caption">
        <caption>{{ props.caption }}</caption>
        <thead>
          <tr>
            <th scope="col" class="period-heading">节次</th>
            <th v-for="weekday in props.weekdays" :key="weekday.value" scope="col">
              {{ weekday.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="period in props.periods" :key="period.value">
            <th scope="row" class="period-heading">{{ period.label }}</th>
            <td v-for="weekday in props.weekdays" :key="cellKey(weekday.value, period.value)">
              <button
                type="button"
                class="lesson-cell"
                :class="{ 'lesson-cell--empty': !cellFor(weekday.value, period.value) }"
                :aria-label="cellFor(weekday.value, period.value)?.subjectName || `${weekday.label}${period.label}无课程`"
                @click="emit('cell-click', cellFor(weekday.value, period.value), { weekday: weekday.value, period: period.value })"
              >
                <template v-if="cellFor(weekday.value, period.value)">
                  <strong>{{ cellFor(weekday.value, period.value)?.subjectName }}</strong>
                  <span v-if="cellFor(weekday.value, period.value)?.className">
                    {{ cellFor(weekday.value, period.value)?.className }}
                  </span>
                  <span v-if="cellFor(weekday.value, period.value)?.teacherName">
                    {{ cellFor(weekday.value, period.value)?.teacherName }}
                  </span>
                  <span v-if="cellFor(weekday.value, period.value)?.venueName">
                    {{ cellFor(weekday.value, period.value)?.venueName }}
                  </span>
                  <span
                    v-if="cellFor(weekday.value, period.value)?.weekParity"
                    class="lesson-badge"
                  >
                    {{ WEEK_PARITY_LABELS[cellFor(weekday.value, period.value)?.weekParity || 'ALL'] }}
                  </span>
                  <span
                    v-if="cellFor(weekday.value, period.value)?.conflict"
                    class="lesson-badge lesson-badge--conflict"
                  >
                    <span aria-hidden="true">⚠</span>
                    {{ cellFor(weekday.value, period.value)?.conflictText || '存在冲突' }}
                  </span>
                  <span v-if="cellFor(weekday.value, period.value)?.locked" class="lesson-badge lesson-badge--locked">
                    <span aria-hidden="true">锁</span>
                    已锁定
                  </span>
                </template>
                <span v-else class="empty-label">无课</span>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!hasCells && !props.loading" class="grid-empty">{{ props.emptyText }}</p>
  </section>
</template>

<style scoped>
.timetable-shell {
  position: relative;
}

.timetable-loading {
  position: absolute;
  z-index: 2;
  inset: 0;
  display: grid;
  place-items: center;
  min-height: 120px;
  border-radius: 10px;
  background: rgb(255 255 255 / 80%);
  color: #40506a;
}

.timetable-scroll {
  overflow: auto;
  border: 1px solid #d8e0eb;
  border-radius: 10px;
}

.timetable-grid {
  width: 100%;
  min-width: 980px;
  border-collapse: collapse;
  table-layout: fixed;
  background: #fff;
}

.timetable-grid caption {
  padding: 12px 14px;
  color: #40506a;
  font-weight: 600;
  text-align: left;
}

.timetable-grid th,
.timetable-grid td {
  border-right: 1px solid #e2e8f0;
  border-bottom: 1px solid #e2e8f0;
  padding: 6px;
  vertical-align: top;
}

.timetable-grid thead th {
  background: #f5f7fb;
  color: #35435a;
  font-weight: 600;
  text-align: center;
}

.period-heading {
  width: 86px;
  color: #4a5870;
  font-size: 13px;
  text-align: center;
  vertical-align: middle !important;
}

.lesson-cell {
  display: flex;
  width: 100%;
  min-height: 92px;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: #eef4ff;
  color: #22324c;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.lesson-cell:hover,
.lesson-cell:focus-visible {
  border-color: #315ea8;
  outline: 2px solid #b7c9e8;
  outline-offset: 1px;
}

.lesson-cell--empty {
  align-items: center;
  justify-content: center;
  background: #fafbfd;
  color: #7a8597;
  cursor: default;
}

.lesson-cell strong {
  font-size: 14px;
}

.lesson-cell span {
  color: #55647b;
  font-size: 12px;
  line-height: 1.4;
}

.lesson-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border: 1px solid #b8c4d8;
  border-radius: 999px;
  background: #fff;
  color: #36445b !important;
}

.lesson-badge--conflict {
  border-color: #c85a4b;
  background: #fff1ee;
  color: #842a20 !important;
}

.lesson-badge--locked {
  border-color: #5d6b84;
  background: #edf0f5;
  color: #303e55 !important;
}

.empty-label {
  color: #7a8597 !important;
}

.grid-empty {
  margin: 12px 0 0;
  color: #5b6475;
}
</style>
