<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    description: string;
    actionText?: string;
    actionDisabled?: boolean;
  }>(),
  { actionText: '', actionDisabled: false },
);

defineEmits<{
  action: [];
}>();
</script>

<template>
  <section class="empty-state" role="status" aria-live="polite">
    <div class="empty-state__mark" aria-hidden="true">○</div>
    <h2>{{ title }}</h2>
    <p>{{ description }}</p>
    <el-button v-if="actionText" type="primary" plain :disabled="actionDisabled" @click="$emit('action')">
      {{ actionText }}
    </el-button>
  </section>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 220px;
  padding: 32px;
  text-align: center;
}

.empty-state__mark {
  display: grid;
  width: 48px;
  height: 48px;
  margin-bottom: 12px;
  place-items: center;
  border: 1px solid #cbd5e1;
  border-radius: 50%;
  color: #64748b;
  font-size: 26px;
}

.empty-state h2 {
  margin: 0;
  color: #253047;
  font-size: 18px;
}

.empty-state p {
  max-width: 560px;
  margin: 8px 0 18px;
  color: #5b6475;
  line-height: 1.7;
}
</style>
