import { describe, expect, it } from 'vitest';
import { buildCamt053, buildCamt053Bytes } from '../src/import/camt-fixture';
import { parseCamt053 } from '../src/import/camt';

/**
 * `buildCamt053` (F4 Task 8 — Vorbereitung): eine Hilfsfunktion, die gültiges
 * CAMT.053 baut, für den Seed und, davon abgeleitet, die E2E-Fixtures. Sie
 * muss vom eigenen Leser akzeptiert werden — sonst wäre sie für beide
 * Zwecke wertlos.
 */
describe('buildCamt053', () => {
  it('builds a statement that parseCamt053 reads back with the given lines and balances', () => {
    const xml = buildCamt053({
      iban: 'DE60999999990201051234',
      from: '2026-07-01',
      to: '2026-07-31',
      openingCents: 50000,
      lines: [
        { bookingDate: '2026-07-05', amountCents: 12000, counterpartyName: 'Erika Beispiel', counterpartyIban: 'DE66999999991234567890', purpose: 'Spende', bankReference: 'FIX-0001' },
        { bookingDate: '2026-07-10', amountCents: -3400, counterpartyName: 'Buerobedarf Muster GmbH', purpose: 'Bueromaterial', bankReference: 'FIX-0002' },
      ],
    });
    const res = parseCamt053(new TextEncoder().encode(xml), { maxBytes: 1_000_000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.statements).toHaveLength(1);
    const stmt = res.statements[0]!;
    expect(stmt).toMatchObject({ iban: 'DE60999999990201051234', from: '2026-07-01', to: '2026-07-31', openingCents: 50000, closingCents: 58600 });
    expect(stmt.lines.map((l) => l.amountCents)).toEqual([12000, -3400]);
    expect(stmt.lines[0]).toMatchObject({ counterpartyName: 'Erika Beispiel', counterpartyIban: 'DE66999999991234567890', purpose: 'Spende', bankReference: 'FIX-0001' });
  });

  it('lets closingCents be set explicitly, for a fixture that should mismatch on purpose', () => {
    const bytes = buildCamt053Bytes({ iban: 'DE60999999990201051234', from: '2026-08-01', to: '2026-08-31', openingCents: 0, closingCents: 999, lines: [{ bookingDate: '2026-08-05', amountCents: 100 }] });
    const res = parseCamt053(bytes, { maxBytes: 1_000_000 });
    expect(res).toMatchObject({ ok: false, error: { code: 'sumMismatch' } });
  });

  it('marks a pending entry and leaves it out of the closing balance probe', () => {
    const bytes = buildCamt053Bytes({
      iban: 'DE60999999990201051234',
      from: '2026-09-01',
      to: '2026-09-30',
      openingCents: 1000,
      lines: [{ bookingDate: '2026-09-05', amountCents: 500, pending: true }],
    });
    const res = parseCamt053(bytes, { maxBytes: 1_000_000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.statements[0]!.closingCents).toBe(1000);
    expect(res.statements[0]!.lines[0]!.pending).toBe(true);
  });
});
