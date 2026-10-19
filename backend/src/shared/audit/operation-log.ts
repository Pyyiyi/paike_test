import type { Tx } from '../db/transaction';
import { systemClock, type Clock } from '../time/clock';

export type OperationModule =
  | 'DELETE'
  | 'PUBLISH'
  | 'OVERWRITE'
  | 'SWITCH_SEMESTER'
  | 'IMPORT'
  | 'ARCHIVE'
  | 'ADJUST'
  | 'GENERATE'
  | 'SAVE_AS'
  | 'IGNORE_ONCE'
  | 'LOCK'
  | 'UNLOCK';

export interface OperationLogInput {
  operatorId: string;
  operatorName: string;
  module: OperationModule;
  action: string;
  content: string;
  targetType: string;
  targetId: string;
  requestId?: string;
}

/** 只追加：调用方必须在业务事务内写入，表不提供更新/删除 API。 */
export async function writeOperationLog(
  tx: Tx,
  input: OperationLogInput,
  clock: Clock = systemClock,
): Promise<void> {
  await tx.query(
    `INSERT INTO operation_log
       (operator_id, operator_name, module, action, content, target_type, target_id, request_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.operatorId,
      input.operatorName,
      input.module,
      input.action,
      input.content,
      input.targetType,
      input.targetId,
      input.requestId ?? null,
      clock.now(),
    ],
  );
}

/** 验收标准别名：operationLog.write(tx, entry)。 */
export const operationLog = { write: writeOperationLog };
