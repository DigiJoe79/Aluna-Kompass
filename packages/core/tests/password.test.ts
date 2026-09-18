import { describe, expect, it } from 'vitest';
import {
  generateStartPassword,
  hashPassword,
  PASSWORD_MIN_LENGTH,
  passwordSchema,
  START_PASSWORD_PATTERN,
  verifyPassword,
} from '../src/auth/password';
import { WORDLIST } from '../src/auth/wordlist';

describe('password', () => {
  it('hashes with argon2id and verifies only the right password', async () => {
    const hash = await hashPassword('wiese-kanu-73-lampe');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'wiese-kanu-73-lampe')).toBe(true);
    expect(await verifyPassword(hash, 'wiese-kanu-73-lampf')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });

  it('enforces the 12-character minimum and nothing else', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(passwordSchema.safeParse('elf zeichen').success).toBe(false);
    expect(passwordSchema.safeParse('zwoelfzeichen').success).toBe(true);
    expect(passwordSchema.safeParse('nur kleinbuchstaben und leerzeichen').success).toBe(true);
  });

  it('generates speakable word chains that satisfy the policy', () => {
    for (let i = 0; i < 50; i += 1) {
      const pw = generateStartPassword();
      expect(pw).toMatch(START_PASSWORD_PATTERN);
      expect(pw.length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
      expect(passwordSchema.safeParse(pw).success).toBe(true);
    }
  });

  it('is deterministic given an injected random source', () => {
    const random = () => 0;
    expect(generateStartPassword(random)).toBe(`${WORDLIST[0]}-${WORDLIST[0]}-10-${WORDLIST[0]}`);
  });

  it('uses a wordlist of lowercase ascii words without umlauts', () => {
    expect(WORDLIST.length).toBeGreaterThanOrEqual(80);
    for (const word of WORDLIST) expect(word).toMatch(/^[a-z]{3,8}$/);
    expect(new Set(WORDLIST).size).toBe(WORDLIST.length);
  });
});
