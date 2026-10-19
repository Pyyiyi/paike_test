<script setup lang="ts">
import { useVersionConflict } from '@/shared/composables/useVersionConflict';

const { state, dismiss } = useVersionConflict();

function refreshPage(): void {
  window.location.reload();
}
</script>

<template>
  <div v-if="state.visible" class="version-conflict" role="alert" aria-live="assertive">
    <div class="version-conflict__icon" aria-hidden="true">!</div>
    <div class="version-conflict__body">
      <strong>页面数据已更新</strong>
      <span>{{ state.message }}</span>
    </div>
    <div class="version-conflict__actions">
      <el-button size="small" @click="dismiss">稍后处理</el-button>
      <el-button size="small" type="primary" @click="refreshPage">刷新页面</el-button>
    </div>
  </div>
</template>

<style scoped>
.version-conflict {
  position: fixed;
  z-index: 3000;
  top: 18px;
  right: 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  width: min(620px, calc(100vw - 48px));
  padding: 14px 16px;
  border: 1px solid #d89b32;
  border-radius: 10px;
  background: #fffaf0;
  box-shadow: 0 10px 30px rgb(15 23 42 / 15%);
}

.version-conflict__icon {
  display: grid;
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 1px solid #9a6205;
  border-radius: 50%;
  color: #7c4d00;
  font-weight: 700;
}

.version-conflict__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
  color: #573800;
}

.version-conflict__actions {
  display: flex;
  gap: 8px;
}
</style>
