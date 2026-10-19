import type { Pool } from 'pg';

export type AuditResult = 'SUCCESS' | 'FAILURE' | 'DENIED';

export interface SecurityAuditInput {
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  result: AuditResult;
  ip?: string | null;
  userAgent?: string | null;
  detail?: Record<string, unknown>;
}

export async function writeSecurityAudit(pool: Pool, input: SecurityAuditInput): Promise<void> {
  await pool.query(
    `INSERT INTO sys_audit_log
       (actor_id, actor_name, action, target_type, target_id, result, ip_address, user_agent, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      input.actorId ?? null,
      input.actorName ?? null,
      input.action,
      input.targetType ?? null,
      input.targetId ?? null,
      input.result,
      input.ip ?? null,
      input.userAgent ?? null,
      JSON.stringify(input.detail ?? {}),
    ],
  );
}
