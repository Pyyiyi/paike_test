import { describe, expect, it } from 'vitest';
import {
  countPasswordClasses,
  generateInitialPassword,
  hashPassword,
  validatePasswordPolicy,
  verifyPassword,
} from '../src/shared/auth/password';

const FAST_ARGON2 = { memoryCost: 8192, timeCost: 2, parallelism: 1 };

describe('password policy', () => {
  it('accepts a password with at least three character classes', () => {
    expect(countPasswordClasses('Abcdef1!')).toBe(4);
    expect(validatePasswordPolicy('Abcdef1!')).toEqual({ ok: true });
    expect(validatePasswordPolicy('abcdef1!')).toEqual({ ok: true });
  });

  it('rejects short passwords', () => {
    const result = validatePasswordPolicy('Ab1!');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('至少 8 位');
    }
  });

  it('rejects passwords with fewer than three character classes', () => {
    const result = validatePasswordPolicy('abcdefgh');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('至少 3 类');
    }
  });

  it('generates policy-compliant initial passwords', () => {
    for (let index = 0; index < 10; index += 1) {
      const password = generateInitialPassword();
      expect(password.length).toBeGreaterThanOrEqual(16);
      expect(validatePasswordPolicy(password)).toEqual({ ok: true });
    }
  });
});

describe('argon2id hashing', () => {
  it('hashes with argon2id and verifies the plaintext', async () => {
    const hash = await hashPassword('Abcdef1!', FAST_ARGON2);
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'Abcdef1!')).toBe(true);
    expect(await verifyPassword(hash, 'wrong-password')).toBe(false);
  });

  it('returns false for malformed hashes instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'Abcdef1!')).toBe(false);
  });
});
