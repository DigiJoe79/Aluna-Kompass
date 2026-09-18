import { randomInt } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { z } from 'zod';
import { WORDLIST } from './wordlist';

export const PASSWORD_MIN_LENGTH = 12;

export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH, 'passwordTooShort').max(200, 'passwordTooLong');

const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}

export const START_PASSWORD_PATTERN = /^[a-z]{3,8}-[a-z]{3,8}-\d{2}-[a-z]{3,8}$/;

/** Wortkette wie `wiese-kanu-73-lampe`; `random(n)` liefert eine Ganzzahl in [0, n). */
export function generateStartPassword(random: (maxExclusive: number) => number = randomInt): string {
  const pick = () => WORDLIST[random(WORDLIST.length)] as string;
  for (;;) {
    const candidate = `${pick()}-${pick()}-${10 + random(90)}-${pick()}`;
    if (candidate.length >= PASSWORD_MIN_LENGTH) return candidate;
  }
}
