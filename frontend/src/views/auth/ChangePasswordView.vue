<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { authApi } from '@/shared/api/auth.api';
import { resetCsrfToken } from '@/shared/api/http';
import { useSessionStore } from '@/shared/stores/session';
import {
  AUTH_COPY,
  PASSWORD_POLICY_COPY,
  evaluatePasswordPolicy,
  fieldErrors,
  friendlyError,
} from '@/shared/text/messages';

const router = useRouter();
const session = useSessionStore();
const form = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' });
const errors = reactive<Record<string, string>>({});
const message = ref('');
const submitting = ref(false);

const forced = computed(() => session.mustChangePassword);
const title = computed(() => (forced.value ? AUTH_COPY.forcedPasswordTitle : AUTH_COPY.voluntaryPasswordTitle));
const intro = computed(() => (forced.value ? AUTH_COPY.forcedPasswordIntro : AUTH_COPY.voluntaryPasswordIntro));
const policy = computed(() =>
  evaluatePasswordPolicy(form.newPassword, form.currentPassword, form.confirmPassword),
);

function clearErrors(): void {
  Object.keys(errors).forEach((key) => delete errors[key]);
  message.value = '';
}

function validate(): boolean {
  if (!form.currentPassword) {
    errors.currentPassword = PASSWORD_POLICY_COPY.currentPasswordRequired;
  }
  if (!form.newPassword) {
    errors.newPassword = PASSWORD_POLICY_COPY.newPasswordRequired;
  } else if (!policy.value.length) {
    errors.newPassword = PASSWORD_POLICY_COPY.minLength;
  } else if (!policy.value.classes) {
    errors.newPassword = PASSWORD_POLICY_COPY.characterClasses;
  } else if (!policy.value.different) {
    errors.newPassword = PASSWORD_POLICY_COPY.sameAsCurrent;
  }

  if (!form.confirmPassword) {
    errors.confirmPassword = PASSWORD_POLICY_COPY.confirmPasswordRequired;
  } else if (!policy.value.matches) {
    errors.confirmPassword = PASSWORD_POLICY_COPY.confirmationMismatch;
  }

  return Object.keys(errors).length === 0;
}

function backToWorkspace(): void {
  void router.push(session.homePath);
}

async function submit(): Promise<void> {
  clearErrors();
  if (!validate()) {
    return;
  }

  submitting.value = true;
  try {
    await authApi.changePassword({
      currentPassword: form.currentPassword,
      newPassword: form.newPassword,
    });
    session.clear();
    session.loaded = true;
    resetCsrfToken();
    await router.replace({ name: 'login', query: { reason: 'password-changed' } });
  } catch (caught) {
    message.value = friendlyError(caught);
    Object.assign(errors, fieldErrors(caught));
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-card" aria-labelledby="change-password-title">
      <div class="auth-brand">
        <span aria-hidden="true">排</span>
        <div>
          <strong>智能排课系统</strong>
          <small>账号安全</small>
        </div>
      </div>
      <h1 id="change-password-title">{{ title }}</h1>
      <p class="auth-intro">{{ intro }}</p>

      <el-alert v-if="message" type="error" :title="message" :closable="false" show-icon class="auth-alert" />

      <form autocomplete="off" @submit.prevent="submit">
        <label class="field-label" for="current-password">{{ AUTH_COPY.currentPasswordLabel }}</label>
        <el-input
          id="current-password"
          v-model="form.currentPassword"
          name="current-password"
          size="large"
          type="password"
          autocomplete="off"
          show-password
        />
        <p v-if="errors.currentPassword" class="field-error">{{ errors.currentPassword }}</p>

        <label class="field-label" for="new-password">{{ AUTH_COPY.newPasswordLabel }}</label>
        <el-input
          id="new-password"
          v-model="form.newPassword"
          name="new-password"
          size="large"
          type="password"
          autocomplete="off"
          show-password
        />
        <p v-if="errors.newPassword" class="field-error">{{ errors.newPassword }}</p>

        <section class="policy-panel" data-password-policy aria-label="密码策略">
          <strong>{{ PASSWORD_POLICY_COPY.title }}</strong>
          <ul>
            <li data-policy="length" :class="{ passed: policy.length }">
              <span aria-hidden="true">{{ policy.length ? '✓' : '○' }}</span>
              {{ PASSWORD_POLICY_COPY.minLength }}
            </li>
            <li data-policy="classes" :class="{ passed: policy.classes }">
              <span aria-hidden="true">{{ policy.classes ? '✓' : '○' }}</span>
              {{ PASSWORD_POLICY_COPY.characterClasses }}（当前 {{ policy.classCount }} 类）
            </li>
            <li data-policy="different" :class="{ passed: policy.different }">
              <span aria-hidden="true">{{ policy.different ? '✓' : '○' }}</span>
              {{ PASSWORD_POLICY_COPY.differentFromCurrent }}
            </li>
            <li data-policy="matches" :class="{ passed: policy.matches }">
              <span aria-hidden="true">{{ policy.matches ? '✓' : '○' }}</span>
              {{ PASSWORD_POLICY_COPY.confirmationMatches }}
            </li>
          </ul>
        </section>

        <label class="field-label" for="confirm-password">{{ AUTH_COPY.confirmPasswordLabel }}</label>
        <el-input
          id="confirm-password"
          v-model="form.confirmPassword"
          name="confirm-password"
          size="large"
          type="password"
          autocomplete="off"
          show-password
        />
        <p v-if="errors.confirmPassword" class="field-error">{{ errors.confirmPassword }}</p>

        <el-button class="change-password-button" type="primary" size="large" native-type="submit" :loading="submitting">
          {{ AUTH_COPY.changePasswordButton }}
        </el-button>
        <el-button v-if="!forced" class="back-button" size="large" @click="backToWorkspace">
          {{ AUTH_COPY.backToWorkspace }}
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
  background: linear-gradient(135deg, #eef3f9, #f8fafc 52%, #e8eef7);
}

.auth-card {
  width: 500px;
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
  line-height: 1.7;
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

.field-error {
  margin: 5px 0 0;
  color: #a33127;
  font-size: 12px;
}

.policy-panel {
  margin: 14px 0 4px;
  padding: 12px 14px;
  border: 1px solid #dce5ef;
  border-radius: 9px;
  background: #f7f9fc;
}

.policy-panel strong {
  color: #3d4b61;
  font-size: 12px;
}

.policy-panel ul {
  display: grid;
  gap: 5px;
  margin: 9px 0 0;
  padding: 0;
  color: #7b8798;
  font-size: 12px;
  list-style: none;
}

.policy-panel li.passed {
  color: #1f7a49;
}

.change-password-button {
  width: 100%;
  margin-top: 24px;
}

.back-button {
  width: 100%;
  margin: 10px 0 0;
}
</style>
