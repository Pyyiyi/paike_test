import { reactive, readonly } from 'vue';
import { MESSAGES } from '@/shared/text/messages';

const state = reactive<{ visible: boolean; message: string }>({
  visible: false,
  message: MESSAGES.VERSION_CONFLICT,
});

export function showVersionConflict(message?: string): void {
  state.message = message || MESSAGES.VERSION_CONFLICT;
  state.visible = true;
}

export function dismissVersionConflict(): void {
  state.visible = false;
}

export function resetVersionConflict(): void {
  state.visible = false;
  state.message = MESSAGES.VERSION_CONFLICT;
}

export function useVersionConflict() {
  return {
    state: readonly(state),
    dismiss: dismissVersionConflict,
    reset: resetVersionConflict,
  };
}
