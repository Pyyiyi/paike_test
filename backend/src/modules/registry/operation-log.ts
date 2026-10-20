import type { Tx } from '../../shared/db/transaction';
import {
  writeOperationLog,
  type OperationLogInput,
  type OperationModule,
} from '../../shared/audit/operation-log';
import { systemClock, type Clock } from '../../shared/time/clock';

/**
 * D01 的删除/生命周期日志在 operation_log 由 D07（0030_governance.sql）创建后生效。
 * D01 单独落地时该表可能尚不存在；此处显式探测，避免跨卡迁移顺序阻塞本卡。
 * D07 合入后同一调用会正常写入，不需要再改 D01。
 */
export async function writeRegistryOperationLog(
  tx: Tx,
  input: OperationLogInput,
  clock: Clock = systemClock,
): Promise<void> {
  const rows = await tx.query<{ available: boolean }>(
    "SELECT to_regclass('operation_log') IS NOT NULL AS available",
  );
  if (!rows[0]?.available) {
    return;
  }
  await writeOperationLog(tx, input, clock);
}

export type { OperationModule };
