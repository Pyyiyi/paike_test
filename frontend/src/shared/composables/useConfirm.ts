import { reactive, readonly } from 'vue';

export interface ConfirmOptions {
  title: string;
  object?: string;
  description?: string;
  impact: string;
  reversible: boolean;
  confirmText: string;
  cancelText?: string;
  danger?: boolean;
}

export type ConfirmHandler = (options: ConfirmOptions) => Promise<boolean>;

export const CRITICAL_ACTION_TYPES = [
  'delete',
  'publish',
  'overwrite',
  'switch',
  'import',
  'archive',
  'adjust',
] as const;

export type CriticalActionType = (typeof CRITICAL_ACTION_TYPES)[number];

export interface CriticalActionSpec {
  title: string;
  impact: string;
  reversible: boolean;
  danger: boolean;
}

export const CRITICAL_ACTION_SPECS: Record<CriticalActionType, CriticalActionSpec> = {
  delete: {
    title: '删除数据',
    impact: '删除后关联页面将不再显示该数据；存在引用时系统会阻止删除。',
    reversible: false,
    danger: true,
  },
  publish: {
    title: '发布课表',
    impact: '发布后教师与班级将看到正式课表，原正式版本会被替换。',
    reversible: false,
    danger: true,
  },
  overwrite: {
    title: '覆盖课表',
    impact: '现有草稿内容将被新结果替换，已有锁定课程仍会保留。',
    reversible: false,
    danger: true,
  },
  switch: {
    title: '切换学期',
    impact: '页面数据将切换到所选学期，尚未保存的表单内容会保留在确认前状态。',
    reversible: true,
    danger: false,
  },
  import: {
    title: '导入数据',
    impact: '校验通过的行会写入系统，校验失败的行不会导入。',
    reversible: false,
    danger: true,
  },
  archive: {
    title: '存档学期',
    impact: '存档后该学期进入只读状态，后续调整需要先恢复或新建学期。',
    reversible: false,
    danger: true,
  },
  adjust: {
    title: '保存调课',
    impact: '调课结果会写入正式课表并记录操作日志。',
    reversible: true,
    danger: false,
  },
};

interface ConfirmState {
  visible: boolean;
  options: ConfirmOptions | null;
  resolve: ((confirmed: boolean) => void) | null;
}

const state = reactive<ConfirmState>({
  visible: false,
  options: null,
  resolve: null,
});

export function createCriticalConfirmOptions(
  action: CriticalActionType,
  object: string,
  overrides: Partial<ConfirmOptions> = {},
): ConfirmOptions {
  const spec = CRITICAL_ACTION_SPECS[action];
  return {
    title: spec.title,
    object,
    description: '请核对操作对象与影响范围。',
    impact: spec.impact,
    reversible: spec.reversible,
    confirmText: `确认${spec.title.replace('数据', '')}`,
    cancelText: '取消',
    danger: spec.danger,
    ...overrides,
  };
}

export function useConfirm(): ConfirmHandler {
  return (options) =>
    new Promise<boolean>((resolve) => {
      state.resolve?.(false);
      state.options = options;
      state.resolve = resolve;
      state.visible = true;
    });
}

export function resolveConfirm(confirmed: boolean): void {
  state.visible = false;
  state.resolve?.(confirmed);
  state.resolve = null;
  state.options = null;
}

export function useConfirmState() {
  return readonly(state);
}
