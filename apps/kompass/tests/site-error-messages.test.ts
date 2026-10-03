import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { conflict, type ServiceError } from '@kompass/core';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { conflictMessage } from '@/lib/error-text';
import messages from '../messages/de.json';

/**
 * Regel 7: Jeder Konfliktcode der Webseite hat einen Satz in de.json. Ohne ihn
 * zeigt die Oberfläche „Der Vorgang ist nicht möglich: <deutscher Diensttext>“
 * (Durchsicht 2026-10-02, U1: 19 Codes ohne Text).
 */
type ConflictError = Extract<ServiceError, { type: 'conflict' }>;
const SITE_SRC = path.resolve(import.meta.dirname, '../../../packages/modules/site/src');
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : []; });
const source = files(SITE_SRC).map((f) => readFileSync(f, 'utf8')).join('\n');
const t = createTranslator({ locale: 'de', messages, timeZone: 'Europe/Berlin' }) as unknown as Parameters<typeof conflictMessage>[1];
/** `conflict(\`${kind}Failed\`, …)` in pipeline/jobs.ts, je Art aus SITE_JOB_KINDS. */
const DYNAMIC = ['previewFailed', 'deployCheckFailed', 'publishFailed'];
const plain = [...new Set([...source.matchAll(/\bconflict\(\s*'(\w+)'/g)].map((m) => m[1]!))];
const localized = [...source.matchAll(/localizedConflict\(\s*'(\w+)',\s*'([\w.]+)'/g)].map((m) => ({ code: m[1]!, key: m[2]! }));
const textOf = (code: string, message = 'Technisch: Einzelheit') => conflictMessage(conflict(code, message).error as ConflictError, t);
const has = (key: string) => key.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], messages) !== undefined;

describe('Konfliktcodes der Webseite', () => {
  it('jeder Code hat einen Satz', () => {
    expect(plain.length).toBeGreaterThan(15);
    expect([...plain, ...DYNAMIC].filter((code) => textOf(code) === null)).toEqual([]);
  });
  it('jeder übersetzte Konflikt hat Grund und Abhilfe', () => {
    expect(localized.length).toBeGreaterThanOrEqual(5);
    expect(localized.flatMap(({ key }) => [`${key}.reason`, `${key}.remedy`]).filter((k) => !has(k))).toEqual([]);
  });
  it('ein technisches Detail steht im Satz (Review Focus 5)', () => {
    expect(textOf('deployCheckFailed', 'rsync: exit 23')).toContain('exit 23');
    expect(textOf('templateUnreadable', 'Cannot find module x')).toContain('Cannot find module x');
  });
});
