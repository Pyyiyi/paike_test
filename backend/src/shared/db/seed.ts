import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool, QueryResultRow } from 'pg';
import {
  generateInitialPassword,
  hashPassword,
  validatePasswordPolicy,
  type Argon2Options,
  type PasswordPolicy,
} from '../auth/password';
import { executeTransaction } from './transaction';

const ADMIN_USERNAME = 'admin';
const ADMIN_USER_ID = '00000000-0000-4000-8000-000000000100';
const BOOTSTRAP_PASSWORD_PLACEHOLDER = '__BOOTSTRAP_ADMIN_PASSWORD__';

export const SEEDED_VOCABULARY_IDS = [
  '00000000-0000-4000-8000-000000000120',
  '00000000-0000-4000-8000-000000000121',
  '00000000-0000-4000-8000-000000000122',
  '00000000-0000-4000-8000-000000000130',
  '00000000-0000-4000-8000-000000000131',
  '00000000-0000-4000-8000-000000000132',
  '00000000-0000-4000-8000-000000000133',
  '00000000-0000-4000-8000-000000000134',
  '00000000-0000-4000-8000-000000000135',
  '00000000-0000-4000-8000-000000000136',
  '00000000-0000-4000-8000-000000000137',
  '00000000-0000-4000-8000-000000000138',
  '00000000-0000-4000-8000-000000000140',
  '00000000-0000-4000-8000-000000000141',
  '00000000-0000-4000-8000-000000000142',
  '00000000-0000-4000-8000-000000000143',
  '00000000-0000-4000-8000-000000000144',
  '00000000-0000-4000-8000-000000000145',
  '00000000-0000-4000-8000-000000000150',
  '00000000-0000-4000-8000-000000000151',
  '00000000-0000-4000-8000-000000000152',
  '00000000-0000-4000-8000-000000000153',
  '00000000-0000-4000-8000-000000000154',
] as const;

export interface RunSeedOptions {
  pool: Pool;
  initialPassword?: string;
  passwordPolicy: PasswordPolicy;
  argon2Options: Argon2Options;
  anchorsPath?: string;
}

export interface SeedResult {
  durationMs: number;
  adminCreated: boolean;
  adminPasswordInitialized: boolean;
  generatedPassword?: string;
  controlledVocabularyCount: number;
  d15AnchorsApplied: boolean;
}

export class SeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedError';
  }
}

interface AdminRow extends QueryResultRow {
  user_id: string;
  password_hash: string;
}

interface CountRow extends QueryResultRow {
  count: number;
}

interface DomainAvailabilityRow extends QueryResultRow {
  available: boolean;
}

function validateInitialPassword(plain: string, policy: PasswordPolicy): void {
  const validation = validatePasswordPolicy(plain, policy);
  if (!validation.ok) {
    throw new SeedError(`管理员初始密码不符合密码策略：${validation.message}`);
  }
}

export async function runSeed(options: RunSeedOptions): Promise<SeedResult> {
  const startedAt = performance.now();
  const anchorsPath = options.anchorsPath ?? path.resolve(process.cwd(), 'seed-anchors.sql');
  const anchorsSql = await readFile(anchorsPath, 'utf8');
  if (!anchorsSql.includes(BOOTSTRAP_PASSWORD_PLACEHOLDER)) {
    throw new SeedError(`Seed 锚点文件缺少密码占位符：${anchorsPath}`);
  }

  const client = await options.pool.connect();
  let generatedPassword: string | undefined;
  let adminCreated = false;
  let adminPasswordInitialized = false;
  let controlledVocabularyCount = 0;
  let d15AnchorsApplied = false;

  try {
    const outcome = await executeTransaction(client, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('paike_seed', 0))");

      const admins = await tx.query<AdminRow>(
        `SELECT user_id, password_hash
           FROM sys_user
          WHERE username = $1
          FOR UPDATE`,
        [ADMIN_USERNAME],
      );
      const existingAdmin = admins[0];
      const needsPassword =
        !existingAdmin || existingAdmin.password_hash === BOOTSTRAP_PASSWORD_PLACEHOLDER;
      let effectivePasswordHash = existingAdmin?.password_hash ?? '';
      let candidateGeneratedPassword: string | undefined;

      if (needsPassword) {
        const plain = options.initialPassword ?? generateInitialPassword();
        if (!options.initialPassword) {
          candidateGeneratedPassword = plain;
        }
        validateInitialPassword(plain, options.passwordPolicy);
        effectivePasswordHash = await hashPassword(plain, options.argon2Options);

        if (!existingAdmin) {
          await tx.query(
            `INSERT INTO sys_user
               (user_id, username, display_name, password_hash, role, status, must_change_password)
             VALUES ($1, $2, '教务管理员', $3, 'ADMIN', 'ENABLED', true)`,
            [ADMIN_USER_ID, ADMIN_USERNAME, effectivePasswordHash],
          );
          adminCreated = true;
        } else {
          await tx.query(
            `UPDATE sys_user
                SET display_name = '教务管理员',
                    password_hash = $2,
                    role = 'ADMIN',
                    status = 'ENABLED',
                    must_change_password = true,
                    password_changed_at = NULL,
                    teacher_id = NULL,
                    version = version + 1
              WHERE username = $1`,
            [ADMIN_USERNAME, effectivePasswordHash],
          );
        }
        adminPasswordInitialized = true;
      } else if (existingAdmin) {
        await tx.query(
          `UPDATE sys_user
              SET display_name = '教务管理员',
                  role = 'ADMIN',
                  status = 'ENABLED',
                  teacher_id = NULL
            WHERE username = $1`,
          [ADMIN_USERNAME],
        );
      }

      const seededAnchorsSql = anchorsSql
        .split(BOOTSTRAP_PASSWORD_PLACEHOLDER)
        .join(effectivePasswordHash);
      if (seededAnchorsSql.includes(BOOTSTRAP_PASSWORD_PLACEHOLDER)) {
        throw new SeedError('管理员密码占位符替换失败');
      }
      await tx.query(seededAnchorsSql);

      const vocabularyCount = await tx.queryOne<CountRow>(
        `SELECT count(*)::int AS count
           FROM sys_controlled_vocabulary
          WHERE vocabulary_id = ANY($1::uuid[])`,
        [SEEDED_VOCABULARY_IDS],
      );
      controlledVocabularyCount = vocabularyCount?.count ?? 0;

      const domainAvailability = await tx.queryOne<DomainAvailabilityRow>(
        "SELECT to_regclass('schedule_template') IS NOT NULL AS available",
      );
      if (domainAvailability?.available) {
        const anchorPresence = await tx.queryOne<{ applied: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM schedule_template
              WHERE template_id = '00000000-0000-4000-8000-000000000101'
           ) AS applied`,
        );
        d15AnchorsApplied = anchorPresence?.applied ?? false;
      } else {
        d15AnchorsApplied = false;
      }

      return { candidateGeneratedPassword };
    });

    generatedPassword = outcome.candidateGeneratedPassword;
  } finally {
    client.release();
  }

  return {
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    adminCreated,
    adminPasswordInitialized,
    generatedPassword,
    controlledVocabularyCount,
    d15AnchorsApplied,
  };
}

export type SeedOutputWriter = (line: string) => void;

export function reportSeedResult(result: SeedResult, writeLine: SeedOutputWriter): void {
  if (result.generatedPassword) {
    writeLine(`管理员初始密码（仅显示一次）：${result.generatedPassword}`);
  }

  const adminStatus = result.adminCreated
    ? '已创建'
    : result.adminPasswordInitialized
      ? '已初始化密码'
      : '已存在，保留当前密码';
  const d15Status = result.d15AnchorsApplied ? '已写入' : '领域表未创建，已跳过';
  writeLine(
    `Seed 完成：管理员${adminStatus}，受控词表 ${result.controlledVocabularyCount} 条，` +
      `D15 ${d15Status}，耗时 ${result.durationMs}ms。`,
  );
}
