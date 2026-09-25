import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildOfficeInvoicePdf } from '../src/import/zugferd-fixture';

/** Die Rechnungs-PDFs der E2E sind Kopien der Bauhelfer-Ausgabe — Byte für Byte (Muster `e2e-fixtures-csv.test.ts`). */
const DIR = path.resolve(import.meta.dirname, '../../../../apps/kompass/e2e/fixtures/zugferd');

describe('E2E-Fixtures unter apps/kompass/e2e/fixtures/zugferd', () => {
  it('rechnung-buerobedarf.pdf ist buildOfficeInvoicePdf()', () => {
    expect(new Uint8Array(readFileSync(path.join(DIR, 'rechnung-buerobedarf.pdf')))).toEqual(buildOfficeInvoicePdf());
  });
});
