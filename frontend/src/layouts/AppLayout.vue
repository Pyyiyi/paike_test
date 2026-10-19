<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import SideNav from './SideNav.vue';
import SemesterSelector from './SemesterSelector.vue';
import UserMenu from './UserMenu.vue';
import { ADMIN_NAV, TEACHER_NAV } from '@/shared/navigation';
import { useSessionStore } from '@/shared/stores/session';

const router = useRouter();
const session = useSessionStore();
const items = computed(() => (session.isAdmin ? ADMIN_NAV : TEACHER_NAV));

async function logout(): Promise<void> {
  try {
    await session.logout();
  } finally {
    await router.replace('/login');
  }
}
</script>

<template>
  <el-container class="app-layout">
    <el-aside width="244px" class="app-layout__aside">
      <SideNav :items="items" @logout="logout" />
    </el-aside>
    <el-container class="app-layout__main">
      <el-header class="app-header">
        <div class="app-header__context">
          <SemesterSelector v-if="session.isAdmin" />
          <span v-else class="teacher-context">教师工作台</span>
        </div>
        <UserMenu @logout="logout" />
      </el-header>
      <el-main class="app-content">
        <RouterView />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.app-layout {
  min-height: 100vh;
  min-width: 1280px;
  background: #f3f5f9;
}

.app-layout__aside {
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  background: #17263b;
}

.app-layout__main {
  min-width: 0;
}

.app-header {
  display: flex;
  height: 64px;
  align-items: center;
  justify-content: space-between;
  padding: 0 26px;
  border-bottom: 1px solid #dfe5ee;
  background: #fff;
}

.app-header__context {
  display: flex;
  align-items: center;
}

.teacher-context {
  color: #46546b;
  font-size: 14px;
  font-weight: 600;
}

.app-content {
  padding: 26px;
}
</style>
