<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { ConfirmOptions } from '@/shared/composables/useConfirm';

const props = defineProps<{
  modelValue: boolean;
  options: ConfirmOptions | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  confirm: [];
  cancel: [];
  closed: [];
}>();

const panel = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;
let listening = false;

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

function focusableElements(): HTMLElement[] {
  if (!panel.value) {
    return [];
  }
  return Array.from(
    panel.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

function focusDialog(): void {
  const cancelButton = panel.value?.querySelector<HTMLElement>('[data-confirm-cancel]');
  (cancelButton ?? focusableElements()[0] ?? panel.value)?.focus();
}

function focusDialogIfSafe(): void {
  const submitButton = panel.value?.querySelector<HTMLElement>('[data-confirm-submit]');
  if (document.activeElement === submitButton) {
    return;
  }
  focusDialog();
}

function handleKeydown(event: KeyboardEvent): void {
  if (!props.modelValue) {
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    cancel();
    return;
  }
  if (event.key !== 'Tab') {
    return;
  }

  const items = focusableElements();
  if (items.length === 0) {
    event.preventDefault();
    panel.value?.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

function startListening(): void {
  if (listening) {
    return;
  }
  document.addEventListener('keydown', handleKeydown, true);
  listening = true;
}

function stopListening(): void {
  if (!listening) {
    return;
  }
  document.removeEventListener('keydown', handleKeydown, true);
  listening = false;
}

function cancel(): void {
  emit('cancel');
  visible.value = false;
}

function confirm(): void {
  emit('confirm');
  visible.value = false;
}

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      await nextTick();
      window.setTimeout(focusDialogIfSafe, 0);
      startListening();
    } else {
      stopListening();
      previousFocus?.focus();
      previousFocus = null;
    }
  },
  { immediate: true },
);

onBeforeUnmount(stopListening);
</script>

<template>
  <el-dialog
    v-model="visible"
    class="confirm-dialog"
    width="560px"
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    append-to-body
    @opened="focusDialogIfSafe"
    @closed="emit('closed')"
  >
    <section
      v-if="options"
      ref="panel"
      class="confirm-panel"
      role="document"
      tabindex="-1"
      aria-describedby="confirm-impact"
    >
      <div class="confirm-heading">
        <span class="confirm-heading__icon" :class="{ 'confirm-heading__icon--danger': options.danger }" aria-hidden="true">
          {{ options.danger ? '!' : 'i' }}
        </span>
        <div>
          <h2>{{ options.title }}</h2>
          <p>{{ options.description || '请核对下面的操作信息。' }}</p>
        </div>
      </div>

      <dl class="confirm-details">
        <div>
          <dt>操作名称</dt>
          <dd>{{ options.title }}</dd>
        </div>
        <div>
          <dt>操作对象</dt>
          <dd>{{ options.object || '未指定对象' }}</dd>
        </div>
        <div id="confirm-impact">
          <dt>影响范围</dt>
          <dd>{{ options.impact }}</dd>
        </div>
        <div>
          <dt>可撤销性</dt>
          <dd>{{ options.reversible ? '此操作可撤销。' : '此操作不可撤销。' }}</dd>
        </div>
      </dl>

      <footer class="confirm-actions">
        <el-button data-confirm-cancel @click="cancel">{{ options.cancelText || '取消' }}</el-button>
        <el-button :type="options.danger ? 'danger' : 'primary'" data-confirm-submit @click="confirm">
          {{ options.confirmText }}
        </el-button>
      </footer>
    </section>
  </el-dialog>
</template>

<style scoped>
.confirm-panel:focus {
  outline: none;
}

.confirm-heading {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}

.confirm-heading__icon {
  display: grid;
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid #64748b;
  border-radius: 50%;
  color: #334155;
  font-weight: 700;
}

.confirm-heading__icon--danger {
  border-color: #b42318;
  color: #912018;
  background: #fff4f2;
}

.confirm-heading h2 {
  margin: 0;
  color: #1f2937;
  font-size: 20px;
}

.confirm-heading p {
  margin: 6px 0 0;
  color: #5b6475;
  line-height: 1.6;
}

.confirm-details {
  display: grid;
  gap: 10px;
  margin: 20px 0 0;
}

.confirm-details div {
  display: grid;
  grid-template-columns: 92px 1fr;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.confirm-details dt {
  color: #596579;
  font-weight: 600;
}

.confirm-details dd {
  margin: 0;
  color: #263246;
  line-height: 1.6;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 22px;
}
</style>
