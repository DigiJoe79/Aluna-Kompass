import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const FILE = path.resolve(import.meta.dirname, '../src/allocation/evidence-rules.ts');

/**
 * `evidence-rules.ts` ist rein (F7 Task 1, Muster `suggest-purity.test.ts`):
 * kein `@kompass/*`, kein relativer Import — sie läuft im Dienst
 * (`allocation/evidence.ts`) wie im Client-Formular
 * (`src/lib/finance/partners.ts`, Unterpfad-Export `./evidence-rules`).
 */
describe('evidence-rules purity', () => {
  it('imports nothing at all', () => {
    const offenders = [...readFileSync(FILE, 'utf8').matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map((m) => m[1]);
    expect(offenders).toEqual([]);
  });

  it('re-exports every evidence kind it names as required', () => {
    const src = readFileSync(FILE, 'utf8');
    expect(src).toMatch(/export function requiredEvidenceKinds\(/);
    expect(src).toMatch(/export function missingEvidence\(/);
    expect(src).toMatch(/export function evidenceCoverage\(/);
    expect(src).toMatch(/export function paymentProofSatisfied\(/);
  });
});

const RESERVE_RULES_FILE = path.resolve(import.meta.dirname, '../src/allocation/reserve-rules.ts');

/**
 * `reserve-rules.ts` ist ebenso rein (F8b Annahme 17, Task 1): kein
 * `@kompass/*`, kein relativer Import — sie läuft im Dienst
 * (`allocation/reserves.ts`) wie im Client-Formular
 * (`src/lib/finance/reserves.ts`, Unterpfad-Export `./reserve-rules`).
 */
describe('reserve-rules purity', () => {
  it('imports nothing at all', () => {
    const offenders = [...readFileSync(RESERVE_RULES_FILE, 'utf8').matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map((m) => m[1]);
    expect(offenders).toEqual([]);
  });

  it('exports the free-reserve cap calculation, without a limit-state word (that is LimitProgress’s job)', () => {
    const src = readFileSync(RESERVE_RULES_FILE, 'utf8');
    expect(src).toMatch(/export function freeReserveCapCents\(/);
    expect(src).not.toMatch(/limitState/);
  });
});
