import { describe, expect, it } from 'vitest';
import { maskPhone, maskSensitiveText, redactSensitive } from '../src/shared/audit/redact';

describe('log redaction', () => {
  it('masks mainland phone numbers', () => {
    expect(maskPhone('联系 13812341234')).toBe('联系 138****1234');
    expect(maskPhone('+8613812341234')).toBe('+86138****1234');
  });

  it('masks secret assignments in free text', () => {
    expect(maskSensitiveText('password=super-secret token: abc123 phone=13812341234')).toBe(
      'password=*** token=*** phone=138****1234',
    );
  });

  it('redacts sensitive keys and nested strings', () => {
    expect(
      redactSensitive({
        password: 'secret',
        nested: { cookie: 'session', phone: '13812341234' },
        list: ['13900001111'],
      }),
    ).toEqual({
      password: '***',
      nested: { cookie: '***', phone: '138****1234' },
      list: ['139****1111'],
    });
  });
});
