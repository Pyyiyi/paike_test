<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHeader from '@/shared/components/PageHeader.vue';
import {
  registryApi,
  type ClassItem,
  type ControlledVocabulary,
  type Grade,
} from '@/shared/api/registry.api';
import { friendlyError } from '@/shared/text/messages';

const grades = ref<Grade[]>([]);
const classes = ref<ClassItem[]>([]);
const gradeVocabulary = ref<ControlledVocabulary[]>([]);
const loading = ref(false);
const filterGradeId = ref('');
const gradeError = ref('');
const classError = ref('');

const gradeDrawerOpen = ref(false);
const gradeMode = ref<'create' | 'edit'>('create');
const gradeForm = reactive({ gradeId: '', name: '', sortOrder: 0, version: 1 });

const classDrawerOpen = ref(false);
const classMode = ref<'create' | 'edit'>('create');
const classForm = reactive({ classId: '', gradeId: '', serialNo: 1, studentCount: 40, version: 1 });

const gradeNameById = computed(() => {
  const map = new Map<string, string>();
  for (const grade of grades.value) {
    map.set(grade.gradeId, grade.name);
  }
  return map;
});

const gradeOptions = computed(() => {
  const used = new Set(grades.value.map((grade) => grade.name));
  return gradeVocabulary.value.filter((item) => {
    if (gradeMode.value === 'edit' && item.name === gradeForm.name) {
      return true;
    }
    return !used.has(item.name);
  });
});

const editableClassGrades = computed(() => grades.value);

const classPreview = computed(() => {
  const gradeName = gradeNameById.value.get(classForm.gradeId) ?? '';
  return gradeName ? `${gradeName}（${classForm.serialNo}）班` : '请选择年级';
});

function nextSerialNo(gradeId: string): number {
  const used = classes.value
    .filter((item) => item.gradeId === gradeId)
    .map((item) => item.serialNo);
  const max = used.length > 0 ? Math.max(...used) : 0;
  return Math.min(99, max + 1);
}

async function loadGrades(): Promise<void> {
  const response = await registryApi.grades({ pageSize: 100 });
  grades.value = response.items;
}

async function loadClasses(): Promise<void> {
  const response = await registryApi.classes({
    pageSize: 100,
    gradeId: filterGradeId.value || undefined,
  });
  classes.value = response.items;
}

async function loadVocabulary(): Promise<void> {
  const response = await registryApi.controlledVocabularies('GRADE');
  gradeVocabulary.value = response.items;
}

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    await Promise.all([loadGrades(), loadClasses(), loadVocabulary()]);
  } catch (error) {
    ElMessage.error(friendlyError(error));
  } finally {
    loading.value = false;
  }
}

function openCreateGrade(): void {
  gradeMode.value = 'create';
  gradeError.value = '';
  gradeForm.gradeId = '';
  gradeForm.name = gradeOptions.value[0]?.name ?? '';
  gradeForm.sortOrder = 0;
  gradeForm.version = 1;
  gradeDrawerOpen.value = true;
}

function openEditGrade(row: unknown): void {
  const grade = row as Grade;
  gradeMode.value = 'edit';
  gradeError.value = '';
  gradeForm.gradeId = grade.gradeId;
  gradeForm.name = grade.name;
  gradeForm.sortOrder = grade.sortOrder;
  gradeForm.version = grade.version;
  gradeDrawerOpen.value = true;
}

async function saveGrade(): Promise<void> {
  gradeError.value = '';
  if (!gradeForm.name) {
    gradeError.value = '请选择受控年级名称';
    return;
  }
  try {
    if (gradeMode.value === 'create') {
      await registryApi.createGrade({ name: gradeForm.name, sortOrder: gradeForm.sortOrder });
      ElMessage.success('年级已新增');
    } else {
      await registryApi.updateGrade(gradeForm.gradeId, {
        name: gradeForm.name,
        sortOrder: gradeForm.sortOrder,
        version: gradeForm.version,
      });
      ElMessage.success('年级已更新，班级名称已同步');
    }
    gradeDrawerOpen.value = false;
    await refresh();
  } catch (error) {
    gradeError.value = friendlyError(error);
  }
}

async function removeGrade(row: unknown): Promise<void> {
  const grade = row as Grade;
  try {
    await ElMessageBox.confirm(`确认删除年级「${grade.name}」？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
    await registryApi.deleteGrade(grade.gradeId);
    ElMessage.success('年级已删除');
    await refresh();
  } catch (error) {
    if (error === 'cancel' || error === 'close') {
      return;
    }
    ElMessage.error(friendlyError(error));
  }
}

function openCreateClass(): void {
  classMode.value = 'create';
  classError.value = '';
  classForm.classId = '';
  classForm.gradeId = filterGradeId.value || grades.value[0]?.gradeId || '';
  classForm.serialNo = classForm.gradeId ? nextSerialNo(classForm.gradeId) : 1;
  classForm.studentCount = 40;
  classForm.version = 1;
  classDrawerOpen.value = true;
}

function openEditClass(row: unknown): void {
  const item = row as ClassItem;
  classMode.value = 'edit';
  classError.value = '';
  classForm.classId = item.classId;
  classForm.gradeId = item.gradeId;
  classForm.serialNo = item.serialNo;
  classForm.studentCount = item.studentCount;
  classForm.version = item.version;
  classDrawerOpen.value = true;
}

async function saveClass(): Promise<void> {
  classError.value = '';
  if (!classForm.gradeId) {
    classError.value = '请选择年级';
    return;
  }
  if (!Number.isInteger(classForm.serialNo) || classForm.serialNo < 1 || classForm.serialNo > 99) {
    classError.value = '须为 1-99 整数';
    return;
  }
  try {
    if (classMode.value === 'create') {
      await registryApi.createClass({
        gradeId: classForm.gradeId,
        serialNo: classForm.serialNo,
        studentCount: classForm.studentCount,
      });
      ElMessage.success(`班级已生成：${classPreview.value}`);
    } else {
      await registryApi.updateClass(classForm.classId, {
        serialNo: classForm.serialNo,
        studentCount: classForm.studentCount,
        version: classForm.version,
      });
      ElMessage.success('班级已更新');
    }
    classDrawerOpen.value = false;
    await refresh();
  } catch (error) {
    classError.value = friendlyError(error);
  }
}

async function removeClass(row: unknown): Promise<void> {
  const item = row as ClassItem;
  try {
    await ElMessageBox.confirm(`确认删除班级「${item.name}」？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
    await registryApi.deleteClass(item.classId);
    ElMessage.success('班级已删除');
    await refresh();
  } catch (error) {
    if (error === 'cancel' || error === 'close') {
      return;
    }
    ElMessage.error(friendlyError(error));
  }
}

onMounted(refresh);
</script>

<template>
  <div class="registry-page">
    <PageHeader
      title="年级与班级"
      description="年级名称来自受控词表；班级名称由系统按「年级（序号）班」自动生成，页面不提供自由文本入口。"
    />

    <el-card class="registry-card" shadow="never">
      <template #header>
        <div class="card-header">
          <div>
            <strong>年级</strong>
            <span>被班级引用的年级不可删除</span>
          </div>
          <el-button type="primary" @click="openCreateGrade">新增年级</el-button>
        </div>
      </template>
      <el-table v-loading="loading" :data="grades" row-key="gradeId" border stripe>
        <el-table-column prop="name" label="年级名称" min-width="160" />
        <el-table-column prop="classCount" label="班级数" width="100" align="center" />
        <el-table-column prop="sortOrder" label="排序" width="100" align="center" />
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="openEditGrade(scope.row)">重命名</el-button>
            <el-button link type="danger" @click="removeGrade(scope.row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty><el-empty description="暂无年级，请先从受控词表新增年级" /></template>
      </el-table>
    </el-card>

    <el-card class="registry-card" shadow="never">
      <template #header>
        <div class="card-header">
          <div>
            <strong>班级</strong>
            <span>序号须为 1-99 整数，班级名称由服务端生成</span>
          </div>
          <div class="card-actions">
            <el-select v-model="filterGradeId" placeholder="全部年级" clearable style="width: 180px" @change="loadClasses">
              <el-option v-for="grade in grades" :key="grade.gradeId" :label="grade.name" :value="grade.gradeId" />
            </el-select>
            <el-button type="primary" @click="openCreateClass">新增班级</el-button>
          </div>
        </div>
      </template>
      <el-table v-loading="loading" :data="classes" row-key="classId" border stripe>
        <el-table-column prop="name" label="班级名称（系统生成）" min-width="200" />
        <el-table-column label="所属年级" min-width="140">
          <template #default="scope">{{ gradeNameById.get(scope.row.gradeId) ?? '—' }}</template>
        </el-table-column>
        <el-table-column prop="serialNo" label="序号" width="90" align="center" />
        <el-table-column prop="studentCount" label="学生人数" width="110" align="center" />
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="openEditClass(scope.row)">编辑</el-button>
            <el-button link type="danger" @click="removeClass(scope.row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty><el-empty description="暂无班级" /></template>
      </el-table>
    </el-card>

    <el-drawer v-model="gradeDrawerOpen" :title="gradeMode === 'create' ? '新增年级' : '重命名年级'" size="460px" destroy-on-close>
      <el-alert v-if="gradeError" type="error" :title="gradeError" :closable="false" show-icon />
      <el-form label-position="top" class="drawer-form">
        <el-form-item label="年级名称（受控）" required>
          <el-select v-model="gradeForm.name" filterable placeholder="请选择受控年级名称">
            <el-option v-for="item in gradeOptions" :key="item.vocabId" :label="item.name" :value="item.name" />
          </el-select>
          <p class="form-hint">只能选择受控词表中的年级，不能输入自由文本。</p>
        </el-form-item>
        <el-form-item label="排序号">
          <el-input-number v-model="gradeForm.sortOrder" :min="0" :max="9999" :step="10" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="gradeDrawerOpen = false">取消</el-button>
        <el-button type="primary" @click="saveGrade">保存</el-button>
      </template>
    </el-drawer>

    <el-drawer v-model="classDrawerOpen" :title="classMode === 'create' ? '新增班级' : '编辑班级'" size="480px" destroy-on-close>
      <el-alert v-if="classError" type="error" :title="classError" :closable="false" show-icon />
      <el-form label-position="top" class="drawer-form">
        <el-form-item label="年级" required>
          <el-select v-model="classForm.gradeId" :disabled="classMode === 'edit'" placeholder="请选择年级" @change="classForm.serialNo = nextSerialNo(classForm.gradeId)">
            <el-option v-for="grade in editableClassGrades" :key="grade.gradeId" :label="grade.name" :value="grade.gradeId" />
          </el-select>
        </el-form-item>
        <el-form-item label="班级序号（1-99 整数）" required>
          <el-input-number v-model="classForm.serialNo" :min="1" :max="99" :step="1" :precision="0" />
        </el-form-item>
        <el-form-item label="学生人数">
          <el-input-number v-model="classForm.studentCount" :min="0" :max="9999" :step="1" :precision="0" />
        </el-form-item>
        <el-form-item label="生成后的班级名称">
          <el-input :model-value="classPreview" readonly />
          <p class="form-hint">名称由服务端生成，前端不提交班级名称。</p>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="classDrawerOpen = false">取消</el-button>
        <el-button type="primary" @click="saveClass">保存</el-button>
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

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.card-header strong {
  display: block;
  color: #1f2937;
  font-size: 16px;
}

.card-header span {
  color: #6b7280;
  font-size: 13px;
}

.card-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.drawer-form {
  margin-top: 16px;
}

.form-hint {
  margin: 6px 0 0;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.5;
}
</style>
