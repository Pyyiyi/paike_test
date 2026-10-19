<script setup lang="ts">
import { computed } from 'vue';
import { useSessionStore } from '@/shared/stores/session';
import { ROLE_LABELS } from '@/shared/text/messages';

const emit = defineEmits<{
  logout: [];
}>();

const session = useSessionStore();
const initials = computed(() => session.user?.displayName.slice(0, 1) || '用');
const roleLabel = computed(() => (session.user ? ROLE_LABELS[session.user.role] : ''));
</script>

<template>
  <el-dropdown trigger="click">
    <button type="button" class="user-trigger" aria-label="打开用户菜单">
      <span class="user-avatar" aria-hidden="true">{{ initials }}</span>
      <span class="user-copy">
        <strong>{{ session.user?.displayName }}</strong>
        <small>{{ roleLabel }}</small>
      </span>
      <span class="caret" aria-hidden="true">⌄</span>
    </button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item @click="emit('logout')">退出登录</el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<style scoped>
.user-trigger {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 5px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: #2f3c52;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.user-trigger:hover,
.user-trigger:focus-visible {
  border-color: #b8c6da;
  background: #f6f8fb;
  outline: 2px solid #c4d4ea;
  outline-offset: 1px;
}

.user-avatar {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 1px solid #afbdd1;
  border-radius: 50%;
  background: #e8eef7;
  color: #264366;
  font-weight: 700;
}

.user-copy {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.user-copy strong {
  font-size: 13px;
}

.user-copy small {
  color: #657187;
  font-size: 11px;
}

.caret {
  color: #64748b;
  font-size: 14px;
}
</style>
