<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { authApi } from '@/shared/api/auth.api';
import { useSessionStore } from '@/shared/stores/session';
import { fieldErrors, friendlyError } from '@/shared/text/messages';

const router = useRouter();
const session = useSessionStore();
const form = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' });
const errors = reactive<Record<string, string>>({});
const message = ref('');
const submitting = ref(false);

function clearErrors(): void {
  Object.keys(errors).forEach((key) => delete errors[key]);
  message.value = '';
}

async function submit(): Promise<void> {
  clearErrors();
  if (!form.currentPassword) {
    errors.currentPassword = '请输入当前密码';
  }
  if (!form.newPassword) {
    errors.newPassword = '请输入新密码';
  } else if (form.newPassword.length < 8) {
    errors.newPassword = '新密码至少需要 8 个字符';
  }
  if (form.confirmPassword !== form.newPassword) {
    errors.confirmPassword = '两次输入的新密码不一致';
  }
  if (Object.keys(errors).length > 0) {
    return;
  }

  submitting.value = true;
  try {
    await authApi.changePassword({
      currentPassword: form.currentPassword,
      newPassword: form.newPassword,
    });
    await session.fetchMe(true);
    await router.replace(session.homePath);
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
      <h1 id="change-password-title">请先修改初始密码</h1>
      <p class="auth-intro">新密码至少 8 位，并包含大写字母、小写字母、数字、符号中的至少三类。</p>

      <el-alert v-if="message" type="error" :title="message" :closable="false" show-icon class="auth-alert" />

      <form @submit.prevent="submit">
        <label class="field-label" for="current-password">当前密码</label>
        <el-input id="current-password" v-model="form.currentPassword" size="large" type="password" show-password autocomplete="current-password" />
        <p v-if="errors.currentPassword" class="field-error">{{ errors.currentPassword }}</p>

        <label class="field-label" for="new-password">新密码</label>
        <el-input id="new-password" v-model="form.newPassword" size="large" type="password" show-password autocomplete="new-password" />
        <p v-if="errors.newPassword" class="field-error">{{ errors.newPassword }}</p>

        <label class="field-label" for="confirm-password">确认新密码</label>
        <el-input id="confirm-password" v-model="form.confirmPassword" size="large" type="password" show-password autocomplete="new-password" />
        <p v-if="errors.confirmPassword" class="field-error">{{ errors.confirmPassword }}</p>

        <el-button class="login-button" type="primary" size="large" native-type="submit" :loading="submitting">
          保存新密码
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
  width: 460px;
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

.login-button {
  width: 100%;
  margin-top: 24px;
}
</style>
