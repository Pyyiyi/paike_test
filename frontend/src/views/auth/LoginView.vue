<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionStore } from '@/shared/stores/session';
import { friendlyError } from '@/shared/text/messages';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const form = reactive({ username: '', password: '' });
const error = ref('');
const submitting = ref(false);

function targetAfterLogin(): string {
  const redirect = route.query.redirect;
  if (typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//') && redirect !== '/login') {
    return redirect;
  }
  return session.homePath;
}

async function submit(): Promise<void> {
  error.value = '';
  if (!form.username.trim()) {
    error.value = '请输入用户名';
    return;
  }
  if (!form.password) {
    error.value = '请输入密码';
    return;
  }

  submitting.value = true;
  try {
    await session.login(form.username.trim(), form.password);
    await router.replace(targetAfterLogin());
  } catch (caught) {
    error.value = friendlyError(caught);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-card" aria-labelledby="login-title">
      <div class="auth-brand">
        <span aria-hidden="true">排</span>
        <div>
          <strong>智能排课系统</strong>
          <small>教务工作台</small>
        </div>
      </div>
      <h1 id="login-title">登录工作台</h1>
      <p class="auth-intro">请使用学校分配的账号登录。</p>

      <el-alert v-if="error" type="error" :title="error" :closable="false" show-icon class="auth-alert" />

      <form @submit.prevent="submit">
        <label class="field-label" for="username">用户名</label>
        <el-input id="username" v-model="form.username" size="large" autocomplete="username" placeholder="请输入用户名" />

        <label class="field-label" for="password">密码</label>
        <el-input
          id="password"
          v-model="form.password"
          size="large"
          type="password"
          autocomplete="current-password"
          placeholder="请输入密码"
          show-password
        />

        <el-button class="login-button" type="primary" size="large" native-type="submit" :loading="submitting">
          登录系统
        </el-button>
      </form>
    </section>
  </main>
</template>

<style scoped>
.auth-page {
  display: grid;
  min-width: 1280px;
  min-height: 100vh;
  place-items: center;
  background:
    radial-gradient(circle at 18% 20%, rgb(88 135 196 / 20%), transparent 32%),
    linear-gradient(135deg, #eef3f9, #f8fafc 52%, #e8eef7);
}

.auth-card {
  width: 420px;
  padding: 34px 38px 38px;
  border: 1px solid #d7e0ec;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 24px 60px rgb(31 49 74 / 15%);
}

.auth-brand {
  display: flex;
  align-items: center;
  gap: 11px;
  margin-bottom: 28px;
}

.auth-brand > span {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 9px;
  background: #223b5c;
  color: #fff;
  font-weight: 700;
}

.auth-brand strong,
.auth-brand small {
  display: block;
}

.auth-brand strong {
  color: #22304a;
}

.auth-brand small {
  margin-top: 2px;
  color: #758196;
  font-size: 11px;
  letter-spacing: 0.08em;
}

h1 {
  margin: 0;
  color: #1e2d44;
  font-size: 25px;
}

.auth-intro {
  margin: 8px 0 24px;
  color: #68758a;
}

.auth-alert {
  margin-bottom: 16px;
}

.field-label {
  display: block;
  margin: 16px 0 7px;
  color: #3d4b61;
  font-size: 13px;
  font-weight: 600;
}

.login-button {
  width: 100%;
  margin-top: 24px;
}
</style>
