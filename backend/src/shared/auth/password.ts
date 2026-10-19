import { randomInt } from 'node:crypto';
import argon2 from 'argon2';

export interface PasswordPolicy {
  minLength: number;
  requiredClasses: number;
}

export interface Argon2Options {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

export type PasswordPolicyResult = { ok: true } | { ok: false; message: string };

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = { minLength: 8, requiredClasses: 3 };

export const DEFAULT_ARGON2_OPTIONS: Argon2Options = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};

const CLASS_PATTERNS = [
  /[A-Z]/,
  /[a-z]/,
  /[0-9]/,
  /[^A-Za-z0-9\s]/,
];

const CLASS_LABELS = ['大写字母', '小写字母', '数字', '符号'];

export function countPasswordClasses(plain: string): number {
  return CLASS_PATTERNS.reduce((count, pattern) => count + (pattern.test(plain) ? 1 : 0), 0);
}

export function validatePasswordPolicy(
  plain: string,
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
): PasswordPolicyResult {
  if (plain.length < policy.minLength) {
    return {
      ok: false,
      message: `密码至少 ${policy.minLength} 位，且需包含${CLASS_LABELS.join('、')}中的至少 ${policy.requiredClasses} 类`,
    };
  }

  if (countPasswordClasses(plain) < policy.requiredClasses) {
    return {
      ok: false,
      message: `密码至少 ${policy.minLength} 位，且需包含${CLASS_LABELS.join('、')}中的至少 ${policy.requiredClasses} 类`,
    };
  }

  return { ok: true };
}

export async function hashPassword(
  plain: string,
  options: Argon2Options = DEFAULT_ARGON2_OPTIONS,
): Promise<string> {
  return argon2.hash(plain, {
    type: argon2.argon2id,
    memoryCost: options.memoryCost,
    timeCost: options.timeCost,
    parallelism: options.parallelism,
  });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

function shuffle(values: string[]): string[] {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    const current = values[index] as string;
    values[index] = values[swapIndex] as string;
    values[swapIndex] = current;
  }
  return values;
}

export function generateInitialPassword(length = 16): string {
  const sets = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnpqrstuvwxyz',
    '23456789',
    '!@#$%^&*()-_=+',
  ];
  const minimum = Math.max(length, 16);
  const characters: string[] = [];

  for (const set of sets.slice(0, 3)) {
    characters.push(set[randomInt(set.length)] as string);
  }
  for (let index = characters.length; index < minimum; index += 1) {
    const set = sets[randomInt(sets.length)] as string;
    characters.push(set[randomInt(set.length)] as string);
  }

  return shuffle(characters).join('');
}
