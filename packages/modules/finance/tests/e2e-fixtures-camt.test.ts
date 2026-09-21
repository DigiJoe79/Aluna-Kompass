import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCamt053 } from '../src/import/camt';

/**
 * Ein schneller Wächter für die CAMT-Fixtures der Kontoauszug-E2E
 * (`apps/kompass/e2e/fixtures/camt/`, F4 Task 7): Sie müssen `parseCamt053`
 * genauso durchlaufen, wie `finance-import.spec.ts` es erwartet — bevor ein
 * Playwright-Lauf das erst über Umwege zeigt.
 */
const E2E_FIXTURES = path.resolve(import.meta.dirname, '../../../../apps/kompass/e2e/fixtures/camt');
const bytes = (name: string) => new Uint8Array(readFileSync(path.join(E2E_FIXTURES, name)));
const IMPORTKONTO_IBAN = 'DE60999999990201051234';

describe('E2E-Fixtures unter apps/kompass/e2e/fixtures/camt', () => {
  it('neuer-auszug.xml: eine bekannte Referenz, eine zurückgehaltene Dublette und eine neue Zeile', () => {
    const res = parseCamt053(bytes('neuer-auszug.xml'), { maxBytes: 1_000_000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.statements).toHaveLength(1);
    const stmt = res.statements[0]!;
    expect(stmt).toMatchObject({ iban: IMPORTKONTO_IBAN, from: '2026-07-01', to: '2026-07-31', openingCents: 139000, closingCents: 159900 });
    expect(stmt.lines).toHaveLength(3);
    expect(stmt.lines.find((l) => l.bankReference === 'IMP-0001')).toBeTruthy();
    expect(stmt.lines.find((l) => l.bankReference === null && l.amountCents === -3500)).toBeTruthy();
    expect(stmt.lines.find((l) => l.bankReference === 'E2E-NEU-0001')).toBeTruthy();
  });

  it('duplikat.xml: eine einzelne, gültige Zeile', () => {
    const res = parseCamt053(bytes('duplikat.xml'), { maxBytes: 1_000_000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.statements[0]).toMatchObject({ iban: IMPORTKONTO_IBAN, openingCents: 139000, closingCents: 140000 });
  });

  it('fremde-iban.xml: liest sich, trägt aber nicht die IBAN des Importkontos', () => {
    const res = parseCamt053(bytes('fremde-iban.xml'), { maxBytes: 1_000_000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.statements[0]!.iban).not.toBe(IMPORTKONTO_IBAN);
  });

  it('kaputte-zeile.xml: die zweite Zeile ist nicht lesbar', () => {
    const res = parseCamt053(bytes('kaputte-zeile.xml'), { maxBytes: 1_000_000 });
    expect(res).toMatchObject({ ok: false, error: { code: 'lineUnreadable', line: 2 } });
  });

  it('mehrere-a.xml und mehrere-b.xml lesen sich je für sich', () => {
    for (const name of ['mehrere-a.xml', 'mehrere-b.xml']) {
      const res = parseCamt053(bytes(name), { maxBytes: 1_000_000 });
      expect(res.ok, name).toBe(true);
    }
  });

  it('luecke-neu.xml: Anfangsbestand weicht bewusst vom letzten Importkonto-Endsaldo ab', () => {
    const res = parseCamt053(bytes('luecke-neu.xml'), { maxBytes: 1_000_000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.statements[0]!.openingCents).toBe(200000);
  });

  it('formatwechsel.xml: liest sich, mit der IBAN der Spendenplattform (Seed, Format csv)', () => {
    const res = parseCamt053(bytes('formatwechsel.xml'), { maxBytes: 1_000_000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.statements[0]!.iban).toBe('DE32999999990301059999');
  });

  it('doctype.xml wird schon vor dem Parsen abgewiesen', () => {
    const res = parseCamt053(bytes('doctype.xml'), { maxBytes: 1_000_000 });
    expect(res).toMatchObject({ ok: false, error: { code: 'doctypeRefused' } });
  });
});
