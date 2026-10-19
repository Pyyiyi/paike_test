<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useSessionStore } from '@/shared/stores/session';

const router = useRouter();
const session = useSessionStore();
</script>

<template>
  <main class="result-page">
    <section class="result-card">
      <div class="result-mark" aria-hidden="true">?</div>
      <h1>页面不存在</h1>
      <p>您访问的页面可能已移动或删除，请返回工作台继续操作。</p>
      <el-button type="primary" @click="router.replace(session.homePath)">返回工作台</el-button>
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
</style>
