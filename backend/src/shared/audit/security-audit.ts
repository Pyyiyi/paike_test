import { query } from '../db/pool';
import { systemClock, type Clock } from '../time/clock';
import { redactSensitive } from './redact';

export interface SecurityAuditInput {
  actorId?: string;
  actorName?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  result: 'SUCCESS' | 'FAILURE' | 'DENIED';
  ip?: string;
  userAgent?: string;
  detail?: Record<string, unknown>;
}

export type AuditQuery = (sql: string, params?: unknown[]) => Promise<unknown>;

export interface SecurityAuditOptions {
  clock?: Clock;
  query?: AuditQuery;
}

/** 记录认证、锁定、改密、角色变更与越权事件；detail 自动脱敏。 */
export async function writeSecurityAudit(
  input: SecurityAuditInput,
  options: SecurityAuditOptions = {},
): Promise<void> {
  const runQuery = options.query ?? query;
  const clock = options.clock ?? systemClock;
  const detail = redactSensitive(input.detail ?? {}) as Record<string, unknown>;

  await runQuery(
    `INSERT INTO sys_audit_log
       (actor_id, actor_name, action, target_type, target_id, result, ip_address, user_agent, detail, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      input.actorId ?? null,
      input.actorName ?? null,
      input.action,
      input.targetType ?? null,
      input.targetId ?? null,
      input.result,
      input.ip || null,
      input.userAgent || null,
      JSON.stringify(detail),
      clock.now(),
    ],
  );
}

/** 验收标准别名：securityAudit.write(input)。 */
export const securityAudit = { write: writeSecurityAudit };
