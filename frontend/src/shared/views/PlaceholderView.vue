<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import EmptyState from '@/shared/components/EmptyState.vue';
import PageHeader from '@/shared/components/PageHeader.vue';
import { useSessionStore } from '@/shared/stores/session';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const title = computed(() => route.meta.title || '功能页面');
const description = computed(() => route.meta.description || '页面路由与权限已经就绪。');
const actionText = computed(() => (session.isTeacher ? '返回我的课表' : '返回系统概览'));

function goHome(): void {
  void router.push(session.homePath);
}
</script>

<template>
  <section>
    <PageHeader :title="title" :description="description" />
    <div class="placeholder-card">
      <EmptyState
        title="功能页面待接入"
        description="页面入口、权限与共享组件已经就绪，具体业务内容将在对应功能卡片中补充。"
        :action-text="actionText"
        @action="goHome"
      />
    </div>
  </section>
</template>

<style scoped>
.placeholder-card {
  border: 1px solid #dfe5ee;
  border-radius: 12px;
  background: #fff;
}
</style>
