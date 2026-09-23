import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPaymentServiceCsv, buildSecondBankCsv } from '../src/import/csv-fixture';

/** Die CSV-Dateien der E2E sind Kopien der Bauhelfer-Ausgabe — Byte für Byte (Muster `e2e-fixtures-camt.test.ts`). */
const DIR = path.resolve(import.meta.dirname, '../../../../apps/kompass/e2e/fixtures/csv');

describe('E2E-Fixtures unter apps/kompass/e2e/fixtures/csv', () => {
  it('zahlungsdienst.csv ist buildPaymentServiceCsv()', () => {
    expect(new Uint8Array(readFileSync(path.join(DIR, 'zahlungsdienst.csv')))).toEqual(buildPaymentServiceCsv());
  });
  it('zweitbank.csv ist buildSecondBankCsv()', () => {
    expect(new Uint8Array(readFileSync(path.join(DIR, 'zweitbank.csv')))).toEqual(buildSecondBankCsv());
  });
});
