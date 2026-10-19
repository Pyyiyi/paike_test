import type { QueryResultRow } from 'pg';
import type { Queryable } from './resource.support';
import type { ControlledResourceNameType } from './resource.types';

/** A-05 normalization: trim, full-width to half-width, collapse internal whitespace. */
export function normalizeControlledName(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\u3000/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizedNameKey(value: string): string {
  return normalizeControlledName(value).toLocaleLowerCase('zh-CN');
}

interface VocabularyRow extends QueryResultRow {
  canonical_name: string;
}

export async function listControlledNames(
  queryable: Queryable,
  type: ControlledResourceNameType,
): Promise<string[]> {
  const rows = await queryable.query<VocabularyRow>(
    `SELECT canonical_name
       FROM sys_controlled_vocabulary
      WHERE vocab_type = $1
        AND is_active = true
      ORDER BY sort_order, canonical_name`,
    [type],
  );
  return rows.map((row) => row.canonical_name);
}

export async function isControlledName(
  queryable: Queryable,
  type: ControlledResourceNameType,
  name: string,
): Promise<boolean> {
  const rows = await queryable.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM sys_controlled_vocabulary
        WHERE vocab_type = $1
          AND is_active = true
          AND lower(canonical_name) = lower($2)
     ) AS exists`,
    [type, name],
  );
  return rows[0]?.exists === true;
}
