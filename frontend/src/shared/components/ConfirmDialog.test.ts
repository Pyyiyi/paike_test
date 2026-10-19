import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ConfirmDialog from './ConfirmDialog.vue';
import ConfirmDialogHost from './ConfirmDialogHost.vue';
import {
  CRITICAL_ACTION_SPECS,
  CRITICAL_ACTION_TYPES,
  createCriticalConfirmOptions,
  resolveConfirm,
  useConfirm,
} from '@/shared/composables/useConfirm';

async function settle(): Promise<void> {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 380));
}

describe('ConfirmDialog', () => {
  afterEach(() => {
    resolveConfirm(false);
    document.body.innerHTML = '';
  });

  it('defines impact and reversibility for all seven critical actions', () => {
    for (const action of CRITICAL_ACTION_TYPES) {
      const options = createCriticalConfirmOptions(action, '2026 秋季学期');
      expect(options.title).toBe(CRITICAL_ACTION_SPECS[action].title);
      expect(options.object).toBe('2026 秋季学期');
      expect(options.impact.length).toBeGreaterThan(10);
      expect(typeof options.reversible).toBe('boolean');
      expect(options.confirmText.length).toBeGreaterThan(2);
      expect(options.cancelText).toBe('取消');
    }
  });

  it('renders operation, object, impact, cancel, and confirm controls', async () => {
    const options = createCriticalConfirmOptions('publish', '2026 秋季正式课表');
    mount(ConfirmDialog, {
      attachTo: document.body,
      props: { modelValue: true, options },
    });
    await settle();

    const text = document.body.textContent || '';
    expect(text).toContain('发布课表');
    expect(text).toContain('2026 秋季正式课表');
    expect(text).toContain('影响范围');
    expect(text).toContain('不可撤销');
    expect(text).toContain('取消');
    expect(text).toContain('确认发布课表');
  });

  it('captures and wraps focus inside the dialog', async () => {
    const options = createCriticalConfirmOptions('archive', '2025 春季学期');
    mount(ConfirmDialog, {
      attachTo: document.body,
      props: { modelValue: true, options },
    });
    await settle();

    const cancel = document.querySelector<HTMLElement>('[data-confirm-cancel]');
    const submit = document.querySelector<HTMLElement>('[data-confirm-submit]');
    expect(cancel).not.toBeNull();
    expect(submit).not.toBeNull();
    expect(document.activeElement).toBe(cancel);

    submit?.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(cancel);

    cancel?.focus();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(submit);
  });

  it('does not run a critical action until confirmation', async () => {
    mount(ConfirmDialogHost, { attachTo: document.body });
    const confirm = useConfirm();
    const mutate = vi.fn();

    const decision = confirm(createCriticalConfirmOptions('delete', '一年级 1 班')).then((confirmed) => {
      if (confirmed) {
        mutate();
      }
    });
    await settle();
    expect(mutate).not.toHaveBeenCalled();

    document.querySelector<HTMLElement>('[data-confirm-submit]')?.click();
    await decision;
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
