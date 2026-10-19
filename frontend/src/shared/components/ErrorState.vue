<script setup lang="ts">
withDefaults(
  defineProps<{
    message: string;
    title?: string;
    retryable?: boolean;
    retryText?: string;
  }>(),
  {
    title: '数据加载失败',
    retryable: true,
    retryText: '重新加载',
  },
);

defineEmits<{
  retry: [];
}>();
</script>

<template>
  <section class="error-state" role="alert">
    <div class="error-state__icon" aria-hidden="true">!</div>
    <div>
      <h2>{{ title }}</h2>
      <p>{{ message }}</p>
      <el-button v-if="retryable" type="primary" plain @click="$emit('retry')">{{ retryText }}</el-button>
    </div>
  </section>
</template>

<style scoped>
.error-state {
  display: flex;
  gap: 14px;
  padding: 20px;
  border: 1px solid #f0b4b4;
  border-radius: 10px;
  background: #fff7f7;
}

.error-state__icon {
  display: grid;
  flex: 0 0 30px;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid #c24141;
  border-radius: 50%;
  color: #9f2525;
  font-weight: 700;
}

.error-state h2 {
  margin: 0 0 6px;
  color: #742020;
  font-size: 17px;
}

.error-state p {
  margin: 0 0 14px;
  color: #663838;
  line-height: 1.6;
}
</style>
