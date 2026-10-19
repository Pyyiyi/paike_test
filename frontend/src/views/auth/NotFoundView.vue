<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useSessionStore } from '@/shared/stores/session';

const router = useRouter();
const session = useSessionStore();

function goBack(): void {
  if (window.history.length > 1) {
    router.back();
    return;
  }
  void router.replace(session.homePath);
}
</script>

<template>
  <main class="result-page">
    <section class="result-card" data-result="404">
      <div class="result-mark" aria-hidden="true">?</div>
      <h1>页面不存在</h1>
      <p>您访问的页面可能已移动或删除，请返回工作台继续操作。</p>
      <div class="result-actions">
        <el-button size="large" @click="goBack">返回上一页</el-button>
        <el-button type="primary" size="large" @click="router.replace(session.homePath)">返回工作台</el-button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.result-page {
  display: grid;
  min-height: 100vh;
  place-items: center;
  background: #f3f5f9;
}

.result-card {
  width: 500px;
  padding: 38px;
  border: 1px solid #dfe5ee;
  border-radius: 14px;
  background: #fff;
  text-align: center;
}

.result-mark {
  display: grid;
  width: 48px;
  height: 48px;
  margin: 0 auto 16px;
  place-items: center;
  border: 1px solid #68758a;
  border-radius: 50%;
  color: #46546b;
  font-size: 22px;
  font-weight: 700;
}

h1 {
  margin: 0;
  color: #263246;
  font-size: 23px;
}

p {
  margin: 10px 0 22px;
  color: #657187;
  line-height: 1.7;
}

.result-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
}
</style>
