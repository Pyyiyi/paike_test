<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    description?: string;
  }>(),
  { description: '' },
);
</script>

<template>
  <header class="page-header">
    <div>
      <h1>{{ title }}</h1>
      <p v-if="description">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 20px;
}

.page-header h1 {
  margin: 0;
  color: #1f2937;
  font-size: 24px;
  line-height: 1.3;
}

.page-header p {
  margin: 8px 0 0;
  color: #5b6475;
  font-size: 14px;
}

.page-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
