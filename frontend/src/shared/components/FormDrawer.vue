<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    description?: string;
    submitText?: string;
    cancelText?: string;
    submitLoading?: boolean;
    error?: string;
    width?: string;
  }>(),
  {
    description: '',
    submitText: '保存',
    cancelText: '取消',
    submitLoading: false,
    error: '',
    width: '560px',
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  submit: [];
  cancel: [];
  closed: [];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

function cancel(): void {
  emit('cancel');
  visible.value = false;
}
</script>

<template>
  <el-drawer
    v-model="visible"
    :title="props.title"
    :size="props.width"
    :close-on-click-modal="false"
    destroy-on-close
    @closed="emit('closed')"
  >
    <p v-if="props.description" class="drawer-description">{{ props.description }}</p>
    <el-alert v-if="props.error" type="error" :closable="false" :title="props.error" show-icon />
    <div class="drawer-body">
      <slot />
    </div>
    <template #footer>
      <div class="drawer-actions">
        <el-button :disabled="props.submitLoading" @click="cancel">{{ props.cancelText }}</el-button>
        <el-button type="primary" :loading="props.submitLoading" @click="emit('submit')">
          {{ props.submitText }}
        </el-button>
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
.drawer-description {
  margin: 0 0 16px;
  color: #5b6475;
  line-height: 1.6;
}

.drawer-body {
  padding-top: 16px;
}

.drawer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
