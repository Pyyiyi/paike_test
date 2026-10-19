<script setup lang="ts">
import ConfirmDialog from './ConfirmDialog.vue';
import { resolveConfirm, useConfirmState } from '@/shared/composables/useConfirm';

const state = useConfirmState();
</script>

<template>
  <ConfirmDialog
    :model-value="state.visible"
    :options="state.options"
    @update:model-value="!$event && resolveConfirm(false)"
    @cancel="resolveConfirm(false)"
    @confirm="resolveConfirm(true)"
  />
</template>
