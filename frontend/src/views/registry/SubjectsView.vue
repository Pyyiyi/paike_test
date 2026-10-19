<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHeader from '@/shared/components/PageHeader.vue';
import {
  registryApi,
  type ConsecutivePreference,
  type ControlledVocabulary,
  type Slot,
  type Subject,
  type TimeSlotPreference,
} from '@/shared/api/registry.api';
import { friendlyError } from '@/shared/text/messages';

const CONSECUTIVE_LABELS: Record<ConsecutivePreference, string> = {
  NONE: '无偏好',
  PREFERRED: '尽量连堂',
  REQUIRED: '必须连堂',
};
const TIME_SLOT_LABELS: Record<TimeSlotPreference, string> = {
  NONE: '无',
  MORNING: '上午优先',
  AFTERNOON: '下午优先',
};
const WEEKDAY_LABELS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const PERIODS = Array.from({ length: 8 }, (_unused, index) => index + 1);

const subjects = ref<Subject[]>([]);
const subjectVocabulary = ref<ControlledVocabulary[]>([]);
const loading = ref(false);
const subjectError = ref('');
const ruleError = ref('');

const subjectDrawerOpen = ref(false);
const subjectMode = ref<'create' | 'edit'>('create');
const subjectForm = reactive({ subjectId: '', name: '', version: 1 });

const ruleDrawerOpen = ref(false);
const currentSubject = ref<Subject | null>(null);
const ruleForm = reactive({
  weeklyPeriods: 0,
  consecutivePreference: 'NONE' as ConsecutivePreference,
  timeSlotPreference: 'NONE' as TimeSlotPreference,
  forbiddenSlots: [] as Slot[],
  periodBalanceEnabled: false,
  amPmBalanceEnabled: false,
  fixedSlotRuleEnabled: false,
  version: undefined as number | undefined,
});
const slotForm = reactive({ weekday: 1, period: 1 });

const subjectOptions = computed(() => {
  const used = new Set(subjects.value.map((subject) => subject.name));
  return subjectVocabulary.value.filter((item) => {
    if (subjectMode.value === 'edit' && item.name === subjectForm.name) {
      return true;
    }
    return !used.has(item.name);
  });
});

function ruleOf(row: unknown) {
  return (row as Subject).periodRule;
}

function consecutiveText(row: unknown): string {
  const rule = (row as Subject).periodRule;
  return rule ? CONSECUTIVE_LABELS[rule.consecutivePreference] : '—';
}

function timeSlotText(row: unknown): string {
  const rule = (row as Subject).periodRule;
  return rule ? TIME_SLOT_LABELS[rule.timeSlotPreference] : '—';
}

function switchFlag(
  row: unknown,
  key: 'periodBalanceEnabled' | 'amPmBalanceEnabled' | 'fixedSlotRuleEnabled',
): boolean {
  return Boolean((row as Subject).periodRule?.[key]);
}

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const [subjectResponse, vocabularyResponse] = await Promise.all([
      registryApi.subjects({ pageSize: 100 }),
      registryApi.controlledVocabularies('SUBJECT'),
    ]);
    subjects.value = subjectResponse.items;
    subjectVocabulary.value = vocabularyResponse.items;
  } catch (error) {
    ElMessage.error(friendlyError(error));
  } finally {
    loading.value = false;
  }
}

function openCreateSubject(): void {
  subjectMode.value = 'create';
  subjectError.value = '';
  subjectForm.subjectId = '';
  subjectForm.name = subjectOptions.value[0]?.name ?? '';
  subjectForm.version = 1;
  subjectDrawerOpen.value = true;
}

function openRenameSubject(row: unknown): void {
  const subject = row as Subject;
  subjectMode.value = 'edit';
  subjectError.value = '';
  subjectForm.subjectId = subject.subjectId;
  subjectForm.name = subject.name;
  subjectForm.version = subject.version;
  subjectDrawerOpen.value = true;
}

async function saveSubject(): Promise<void> {
  subjectError.value = '';
  if (!subjectForm.name) {
    subjectError.value = '请选择受控科目名称';
    return;
  }
  try {
    if (subjectMode.value === 'create') {
      await registryApi.createSubject(subjectForm.name);
      ElMessage.success('科目已新增');
    } else {
      await registryApi.updateSubject(subjectForm.subjectId, subjectForm.name, subjectForm.version);
      ElMessage.success('科目已重命名');
    }
    subjectDrawerOpen.value = false;
    await refresh();
  } catch (error) {
    subjectError.value = friendlyError(error);
  }
}

async function removeSubject(row: unknown): Promise<void> {
  const subject = row as Subject;
  try {
    await ElMessageBox.confirm(`确认删除科目「${subject.name}」？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
    await registryApi.deleteSubject(subject.subjectId);
    ElMessage.success('科目已删除');
    await refresh();
  } catch (error) {
    if (error === 'cancel' || error === 'close') {
      return;
    }
    ElMessage.error(friendlyError(error));
  }
}

function openRule(row: unknown): void {
  const subject = row as Subject;
  currentSubject.value = subject;
  ruleError.value = '';
  const rule = subject.periodRule;
  ruleForm.weeklyPeriods = rule?.weeklyPeriods ?? 0;
  ruleForm.consecutivePreference = rule?.consecutivePreference ?? 'NONE';
  ruleForm.timeSlotPreference = rule?.timeSlotPreference ?? 'NONE';
  ruleForm.forbiddenSlots = (rule?.forbiddenSlots ?? []).map((slot) => ({ ...slot }));
  ruleForm.periodBalanceEnabled = rule?.periodBalanceEnabled ?? false;
  ruleForm.amPmBalanceEnabled = rule?.amPmBalanceEnabled ?? false;
  ruleForm.fixedSlotRuleEnabled = rule?.fixedSlotRuleEnabled ?? false;
  ruleForm.version = rule?.version;
  slotForm.weekday = 1;
  slotForm.period = 1;
  ruleDrawerOpen.value = true;
}

function addSlot(): void {
  const exists = ruleForm.forbiddenSlots.some(
    (slot) => slot.weekday === slotForm.weekday && slot.period === slotForm.period,
  );
  if (!exists) {
    ruleForm.forbiddenSlots.push({ weekday: slotForm.weekday, period: slotForm.period });
  }
}

function removeSlot(slot: Slot): void {
  ruleForm.forbiddenSlots = ruleForm.forbiddenSlots.filter(
    (item) => item.weekday !== slot.weekday || item.period !== slot.period,
  );
}

function slotText(slot: Slot): string {
  return `${WEEKDAY_LABELS[slot.weekday] ?? ''}第 ${slot.period} 节`;
}

function errorWithDetails(error: unknown): string {
  const base = friendlyError(error);
  if (error && typeof error === 'object' && Array.isArray((error as { details?: unknown }).details)) {
    const details = (error as { details: Array<{ message?: string }> }).details
      .map((detail) => detail.message)
      .filter((message): message is string => Boolean(message));
    if (details.length > 0) {
      return `${base}：${details.join('；')}`;
    }
  }
  return base;
}

async function saveRule(): Promise<void> {
  if (!currentSubject.value) {
    return;
  }
  ruleError.value = '';
  if (!Number.isInteger(ruleForm.weeklyPeriods) || ruleForm.weeklyPeriods < 0) {
    ruleError.value = '周课时须为不小于 0 的整数';
    return;
  }
  try {
    const payload = {
      weeklyPeriods: ruleForm.weeklyPeriods,
      consecutivePreference: ruleForm.consecutivePreference,
      timeSlotPreference: ruleForm.timeSlotPreference,
      forbiddenSlots: ruleForm.forbiddenSlots.map((slot) => ({ ...slot })),
      periodBalanceEnabled: ruleForm.periodBalanceEnabled,
      amPmBalanceEnabled: ruleForm.amPmBalanceEnabled,
      fixedSlotRuleEnabled: ruleForm.fixedSlotRuleEnabled,
      ...(ruleForm.version === undefined ? {} : { version: ruleForm.version }),
    };
    await registryApi.saveSubjectRule(currentSubject.value.subjectId, payload);
    ElMessage.success('课时规则已保存');
    ruleDrawerOpen.value = false;
    await refresh();
  } catch (error) {
    ruleError.value = errorWithDetails(error);
  }
}

onMounted(refresh);
</script>

<template>
  <div class="registry-page">
    <PageHeader
      title="科目与课时规则"
      description="科目名称从受控词表选择；同义词会被拒绝。三开关默认关闭，保存规则时如与禁排/固定时段冲突会明确提示。"
    >
      <template #actions>
        <el-button type="primary" @click="openCreateSubject">新增科目</el-button>
      </template>
    </PageHeader>

    <el-card shadow="never" class="registry-card">
      <el-table v-loading="loading" :data="subjects" row-key="subjectId" border stripe>
        <el-table-column prop="name" label="科目名称" min-width="140" />
        <el-table-column label="周课时" width="90" align="center">
          <template #default="scope">{{ ruleOf(scope.row)?.weeklyPeriods ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="连堂偏好" width="110" align="center">
          <template #default="scope">
            {{ consecutiveText(scope.row) }}
          </template>
        </el-table-column>
        <el-table-column label="禁排时段" width="100" align="center">
          <template #default="scope">{{ ruleOf(scope.row)?.forbiddenSlots.length ?? 0 }}</template>
        </el-table-column>
        <el-table-column label="时段优先" width="110" align="center">
          <template #default="scope">
            {{ timeSlotText(scope.row) }}
          </template>
        </el-table-column>
        <el-table-column label="三开关" min-width="220">
          <template #default="scope">
            <div v-if="ruleOf(scope.row)" class="switch-tags">
              <el-tag :type="switchFlag(scope.row, 'periodBalanceEnabled') ? 'success' : 'info'">课时均衡</el-tag>
              <el-tag :type="switchFlag(scope.row, 'amPmBalanceEnabled') ? 'success' : 'info'">上下午均衡</el-tag>
              <el-tag :type="switchFlag(scope.row, 'fixedSlotRuleEnabled') ? 'success' : 'info'">固定时段</el-tag>
            </div>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="openRule(scope.row)">课时规则</el-button>
            <el-button link type="primary" @click="openRenameSubject(scope.row)">重命名</el-button>
            <el-button link type="danger" @click="removeSubject(scope.row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty><el-empty description="暂无科目" /></template>
      </el-table>
    </el-card>

    <el-drawer v-model="subjectDrawerOpen" :title="subjectMode === 'create' ? '新增科目' : '重命名科目'" size="460px" destroy-on-close>
      <el-alert v-if="subjectError" type="error" :title="subjectError" :closable="false" show-icon />
      <el-form label-position="top" class="drawer-form">
        <el-form-item label="科目名称（受控）" required>
          <el-select v-model="subjectForm.name" filterable placeholder="请选择受控科目名称">
            <el-option v-for="item in subjectOptions" :key="item.vocabId" :label="item.name" :value="item.name" />
          </el-select>
          <p class="form-hint">只能选择受控词表中的科目；同义名称（如「语」）会被服务端拒绝。</p>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="subjectDrawerOpen = false">取消</el-button>
        <el-button type="primary" @click="saveSubject">保存</el-button>
      </template>
    </el-drawer>

    <el-drawer v-model="ruleDrawerOpen" :title="`课时规则 · ${currentSubject?.name ?? ''}`" size="560px" destroy-on-close>
      <el-alert v-if="ruleError" type="error" :title="ruleError" :closable="false" show-icon />
      <el-form label-position="top" class="drawer-form">
        <div class="form-row">
          <el-form-item label="每周课时">
            <el-input-number v-model="ruleForm.weeklyPeriods" :min="0" :max="99" :step="1" :precision="0" />
          </el-form-item>
          <el-form-item label="连堂偏好">
            <el-select v-model="ruleForm.consecutivePreference" style="width: 160px">
              <el-option label="无偏好" value="NONE" />
              <el-option label="尽量连堂" value="PREFERRED" />
              <el-option label="必须连堂" value="REQUIRED" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="时段优先">
          <el-select v-model="ruleForm.timeSlotPreference" style="width: 180px">
            <el-option label="无" value="NONE" />
            <el-option label="上午优先" value="MORNING" />
            <el-option label="下午优先" value="AFTERNOON" />
          </el-select>
        </el-form-item>
        <el-form-item label="禁排时段">
          <div class="slot-editor">
            <el-select v-model="slotForm.weekday" style="width: 110px">
              <el-option v-for="weekday in 7" :key="weekday" :label="WEEKDAY_LABELS[weekday]" :value="weekday" />
            </el-select>
            <el-select v-model="slotForm.period" style="width: 110px">
              <el-option v-for="period in PERIODS" :key="period" :label="`第 ${period} 节`" :value="period" />
            </el-select>
            <el-button @click="addSlot">添加禁排</el-button>
          </div>
          <div class="slot-tags">
            <el-tag v-for="slot in ruleForm.forbiddenSlots" :key="`${slot.weekday}-${slot.period}`" closable @close="removeSlot(slot)">
              {{ slotText(slot) }}
            </el-tag>
            <span v-if="ruleForm.forbiddenSlots.length === 0" class="form-hint">暂无禁排时段</span>
          </div>
        </el-form-item>
        <el-divider content-position="left">三类可配约束（默认关闭，独立启停）</el-divider>
        <div class="switch-list">
          <label><el-switch v-model="ruleForm.periodBalanceEnabled" /><span>课时均衡</span></label>
          <label><el-switch v-model="ruleForm.amPmBalanceEnabled" /><span>上下午均衡</span></label>
          <label><el-switch v-model="ruleForm.fixedSlotRuleEnabled" /><span>固定时段强制空课</span></label>
        </div>
        <p class="form-hint">启用固定时段规则时须选择上午或下午；若禁排覆盖固定时段全部时段，保存会返回冲突提示。</p>
      </el-form>
      <template #footer>
        <el-button @click="ruleDrawerOpen = false">取消</el-button>
        <el-button type="primary" @click="saveRule">保存规则</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.registry-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.registry-card {
  border: 1px solid #dfe5ee;
  border-radius: 10px;
}

.switch-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.drawer-form {
  margin-top: 16px;
}

.form-row {
  display: flex;
  gap: 18px;
}

.slot-editor {
  display: flex;
  align-items: center;
  gap: 10px;
}

.slot-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.switch-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.switch-list label {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #374151;
}

.form-hint {
  margin: 6px 0 0;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.5;
}
</style>
