<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { isApiError } from '@/shared/api/http';
import { useSessionStore } from '@/shared/stores/session';
import { AUTH_COPY, friendlyError } from '@/shared/text/messages';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const form = reactive({ username: '', password: '' });
const error = ref('');
const submitting = ref(false);
const lockedUntil = ref(0);
const clockNow = ref(Date.now());
let countdownTimer: ReturnType<typeof setInterval> | undefined;

const remainingSeconds = computed(() => Math.max(0, Math.ceil((lockedUntil.value - clockNow.value) / 1000)));
const locked = computed(() => remainingSeconds.value > 0);
const lockMinutes = computed(() => Math.max(1, Math.ceil(remainingSeconds.value / 60)));
const lockMessage = computed(() => AUTH_COPY.lockout(lockMinutes.value));

const notice = computed(() => {
  const reason = typeof route.query.reason === 'string' ? route.query.reason : '';
  if (reason === 'session-expired') {
    return AUTH_COPY.sessionExpired;
  }
  if (reason === 'password-changed') {
    return AUTH_COPY.passwordChanged;
  }
  return '';
});

function stopCountdown(): void {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = undefined;
  }
}

function startCountdown(seconds: number): void {
  stopCountdown();
  clockNow.value = Date.now();
  lockedUntil.value = clockNow.value + Math.max(1, seconds) * 1000;
  countdownTimer = setInterval(() => {
    clockNow.value = Date.now();
    if (remainingSeconds.value <= 0) {
      stopCountdown();
      lockedUntil.value = 0;
      error.value = '';
    }
  }, 1000);
}

function lockSecondsFromMessage(message: string): number {
  const matched = /请\s*(\d+)\s*分钟/.exec(message);
  return matched ? Number(matched[1]) * 60 : 15 * 60;
}

function targetAfterLogin(): string {
  if (session.mustChangePassword) {
    return '/change-password';
  }
  const redirect = route.query.redirect;
  if (typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//') && redirect !== '/login') {
    return redirect;
  }
  return session.homePath;
}

async function submit(): Promise<void> {
  if (locked.value || submitting.value) {
    return;
  }

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
    if (isApiError(caught) && caught.code === 'ACCOUNT_LOCKED') {
      startCountdown(caught.retryAfterSeconds ?? lockSecondsFromMessage(caught.message));
      error.value = '';
    } else if (isApiError(caught) && caught.code === 'UNAUTHENTICATED') {
      error.value = AUTH_COPY.credentialError;
    } else {
      error.value = friendlyError(caught);
    }
  } finally {
    submitting.value = false;
  }
}

onUnmounted(stopCountdown);
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
      <h1 id="login-title">{{ AUTH_COPY.loginTitle }}</h1>
      <p class="auth-intro">{{ AUTH_COPY.loginIntro }}</p>

      <el-alert
        v-if="notice"
        data-auth-notice
        type="warning"
        :title="notice"
        :closable="false"
        show-icon
        class="auth-alert"
      />
      <el-alert
        v-if="error"
        data-login-error
        type="error"
        :title="error"
        :closable="false"
        show-icon
        class="auth-alert"
      />
      <el-alert
        v-if="locked"
        data-lockout
        type="warning"
        :title="lockMessage"
        :closable="false"
        show-icon
        class="auth-alert"
      />

      <form autocomplete="off" @submit.prevent="submit">
        <label class="field-label" for="username">{{ AUTH_COPY.usernameLabel }}</label>
        <el-input
          id="username"
          v-model="form.username"
          name="username"
          size="large"
          autocomplete="off"
          :placeholder="AUTH_COPY.usernamePlaceholder"
        />

        <label class="field-label" for="password">{{ AUTH_COPY.passwordLabel }}</label>
        <el-input
          id="password"
          v-model="form.password"
          name="password"
          size="large"
          type="password"
          autocomplete="off"
          :placeholder="AUTH_COPY.passwordPlaceholder"
          show-password
        />

        <el-button
          class="login-button"
          type="primary"
          size="large"
          native-type="submit"
          :loading="submitting"
          :disabled="locked || submitting"
        >
          {{ AUTH_COPY.loginButton }}
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
