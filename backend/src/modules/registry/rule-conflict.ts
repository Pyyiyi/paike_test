import type { ErrorDetail } from '../../shared/errors/app-error';
import type { ConsecutivePreference, Slot, TimeSlotPreference } from './registry.types';

/** 固定时段按上午 1-4 节、下午 5-8 节划分；D05 可结合模板扩展。 */
export const MORNING_PERIODS = [1, 2, 3, 4] as const;
export const AFTERNOON_PERIODS = [5, 6, 7, 8] as const;
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export interface RuleConflict {
  code: 'FIXED_SLOT_WITHOUT_BAND' | 'FORBIDDEN_COVERS_FIXED_BAND' | 'FORBIDDEN_ALL_SLOTS' | 'CONSECUTIVE_WITHOUT_PAIR';
  message: string;
  details: ErrorDetail[];
}

export interface RuleConflictInput {
  weeklyPeriods: number;
  consecutivePreference: ConsecutivePreference;
  forbiddenSlots: Slot[];
  timeSlotPreference: TimeSlotPreference;
  fixedSlotRuleEnabled: boolean;
}

function slotKey(slot: Slot): string {
  return `${slot.weekday}:${slot.period}`;
}

/**
 * D02 规则守卫：只检测配置自身可判定的冲突，不实现排课逻辑。
 * 返回 null 表示无冲突；否则调用方必须明确返回 409，禁止静默忽略。
 */
export function detectRuleConflict(input: RuleConflictInput): RuleConflict | null {
  const forbidden = new Set(input.forbiddenSlots.map(slotKey));

  if (input.fixedSlotRuleEnabled) {
    if (input.timeSlotPreference === 'NONE') {
      return {
        code: 'FIXED_SLOT_WITHOUT_BAND',
        message: '固定时段规则已启用，但未选择上午或下午时段',
        details: [
          {
            field: 'timeSlotPreference',
            message: '启用固定时段规则时必须选择「上午优先」或「下午优先」作为固定时段',
          },
        ],
      };
    }

    const band =
      input.timeSlotPreference === 'MORNING' ? MORNING_PERIODS : AFTERNOON_PERIODS;
    const bandLabel = input.timeSlotPreference === 'MORNING' ? '上午（1-4 节）' : '下午（5-8 节）';
    const coveredEverywhere = WEEKDAYS.every((weekday) =>
      band.every((period) => forbidden.has(`${weekday}:${period}`)),
    );
    if (coveredEverywhere) {
      return {
        code: 'FORBIDDEN_COVERS_FIXED_BAND',
        message: `禁排时段已覆盖固定时段（${bandLabel}）的全部时段，规则无法生效`,
        details: [
          {
            field: 'forbiddenSlots',
            message: `固定时段为${bandLabel}，但该时段在周一至周日全部被禁排`,
          },
          {
            field: 'timeSlotPreference',
            message: '请缩小禁排范围，或关闭固定时段规则',
          },
        ],
      };
    }
  }

  const allSlots = WEEKDAYS.every((weekday) =>
    Array.from({ length: 20 }, (_unused, index) => index + 1).every((period) =>
      forbidden.has(`${weekday}:${period}`),
    ),
  );
  if (allSlots) {
    return {
      code: 'FORBIDDEN_ALL_SLOTS',
      message: '禁排时段覆盖了全部可用时段，科目将无法排课',
      details: [{ field: 'forbiddenSlots', message: '请至少保留一个可排课时段' }],
    };
  }

  if (input.consecutivePreference === 'REQUIRED' && input.weeklyPeriods < 2) {
    return {
      code: 'CONSECUTIVE_WITHOUT_PAIR',
      message: '连堂偏好为「必须连堂」，但周课时少于 2 节，无法组成连堂',
      details: [
        { field: 'consecutivePreference', message: '必须连堂时周课时至少为 2' },
        { field: 'weeklyPeriods', message: '当前周课时为 ' + String(input.weeklyPeriods) },
      ],
    };
  }

  return null;
}
