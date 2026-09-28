import type { DocumentRenderContext } from '@kompass/core';
import { DEFAULT_THEME } from '@kompass/core/themes';
import { describe, expect, it } from 'vitest';
import { cashCountTemplate } from '../src/ledger/cash-count-template';

/** Nachtrag Rest 0.2.0, Task 7f (M28 Rest) und AG: Zählprotokoll mit Datum im Vereinsformat, Spendendose mit eigenem Protokoll. */
const ctx: DocumentRenderContext = { number: 'KZP-2026-005', issuedAt: '2026-09-05T12:00:00.000Z', organization: { 'organization.name': 'Musterverein e.V.' }, theme: DEFAULT_THEME, logo: null };

function build(data: unknown) {
  const parsed = cashCountTemplate.schema.safeParse(data);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  const built = cashCountTemplate.build(parsed.data, ctx);
  return { slots: built.slots, text: 'markdown' in built.body ? built.body.markdown : '' };
}

const cashCount = {
  accountName: 'Handkasse',
  countedOn: '2026-03-10',
  bookAmount: '10,00 €',
  countedAmount: '12,00 €',
  differenceAmount: '2,00 €',
  kind: 'surplus',
  note: null,
  denominations: null,
  counterOneName: 'Anna Beispiel',
  counterTwoName: 'Bernd Muster',
};

describe('cash count template', () => {
  it('prints the counting date in the association format, in the table and the subtitle (M28 Rest)', () => {
    const { slots, text } = build(cashCount);
    expect(text).toContain('| Datum | 10.03.2026 |');
    expect(text).not.toContain('2026-03-10');
    expect(slots).toMatchObject({ subtitle: '10.03.2026' });
  });

  it('keeps book amount and difference for a real cash count', () => {
    const { text } = build(cashCount);
    expect(text).toContain('| Buchbestand | 10,00 € |');
    expect(text).toContain('| Kassendifferenz (Mehr) | 2,00 € |');
  });

  it('gives an emptied donation box its own protocol, without book amount and difference (AG)', () => {
    const { slots, text } = build({
      variant: 'donationBox',
      accountName: 'Handkasse',
      boxLabel: 'Sammeldose Empfang',
      countedOn: '2026-03-10',
      amount: '87,40 €',
      categoryName: 'Spenden',
      counterOneName: 'Anna Beispiel',
      counterTwoName: 'Bernd Muster',
    });
    expect(slots).toMatchObject({ title: 'Leerung Sammeldose Empfang', subtitle: '10.03.2026' });
    expect(text).toContain('| Inhalt der Spendendose | 87,40 € |');
    expect(text).toContain('| Datum | 10.03.2026 |');
    expect(text).toContain('| Eingezahlt in | Handkasse |');
    expect(text).toContain('Gebucht als Spende (Spenden)');
    expect(text).toContain('Anna Beispiel  Bernd Muster');
    expect(text).not.toMatch(/Buchbestand|Kassendifferenz|Unterschied/);
    expect(text).not.toContain('2026-03-10');
  });
});
