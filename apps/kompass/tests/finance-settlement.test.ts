import { describe, expect, it } from 'vitest';
import { emptyForm } from '@/lib/finance/entry-form';
import { matchesDirection, settlementCandidates, suggestSettlementCents, templateSplitRows, withOpenItemTemplate, type SettlementOption } from '@/lib/finance/settlement';

describe('suggestSettlementCents', () => {
  it('suggests the open rest, capped by what the money line has left, never below zero', () => {
    expect(suggestSettlementCents({ openCents: 5000, lineCents: 10000, alreadySettledCents: 0 })).toBe(5000);
    expect(suggestSettlementCents({ openCents: 12000, lineCents: 8000, alreadySettledCents: 0 })).toBe(8000);
    expect(suggestSettlementCents({ openCents: 5000, lineCents: 8000, alreadySettledCents: 8000 })).toBe(0);
    expect(suggestSettlementCents({ openCents: 5000, lineCents: 3000, alreadySettledCents: 4000 })).toBe(0);
  });
});

describe('matchesDirection', () => {
  it('offers receivables for incoming and payables for outgoing lines', () => {
    expect(matchesDirection('receivable', 'in')).toBe(true);
    expect(matchesDirection('receivable', 'out')).toBe(false);
    expect(matchesDirection('payable', 'out')).toBe(true);
    expect(matchesDirection('payable', 'in')).toBe(false);
  });
});

const fee: SettlementOption = {
  id: 'fee-1',
  kind: 'receivable',
  label: 'Beitrag 2026 Mitglied 0001',
  contactName: 'Ida Wießner',
  openCents: 6000,
  lineTemplate: [{ categoryId: 'cat-fees', amountCents: 6000, contactId: 'c-ida', contactName: 'Ida Wießner' }],
};
const other: SettlementOption = { id: 'fee-2', kind: 'receivable', label: 'Beitrag 2026 Mitglied 0002', contactName: 'Karl Huber', openCents: 6000, lineTemplate: null };
const invoice: SettlementOption = { id: 'inv-1', kind: 'payable', label: 'RE-2026-041', contactName: 'Druckerei Wießner', openCents: 12000, lineTemplate: null };

describe('settlementCandidates: Suche über Referenz und Kontakt (Befund Joe 2026-10-18)', () => {
  const pick = (query: string, direction: 'in' | 'out' = 'in', chosen: string[] = []) => settlementCandidates([fee, other, invoice], { direction, chosenIds: new Set(chosen), query }).map((i) => i.id);

  it('„wiesner“ findet „Wießner“ über den Kontakt, nur in der passenden Richtung', () => {
    expect(pick('wiesner')).toEqual(['fee-1']);
    expect(pick('WIESSNER', 'out')).toEqual(['inv-1']);
  });

  it('sucht weiter über die Zahlungsreferenz, auch kombiniert mit dem Kontakt', () => {
    expect(pick('mitglied 0002')).toEqual(['fee-2']);
    expect(pick('beitrag huber')).toEqual(['fee-2']);
    expect(pick('')).toEqual(['fee-1', 'fee-2']);
  });

  it('lässt schon gewählte Posten weg', () => {
    expect(pick('', 'in', ['fee-1'])).toEqual(['fee-2']);
  });
});

describe('templateSplitRows', () => {
  it('eine Zeile bekommt den Ausgleichsbetrag, Kontakt mit Namen', () => {
    expect(templateSplitRows(fee.lineTemplate!, 2500, 'k')).toEqual([
      { key: 'k-1', categoryId: 'cat-fees', amountText: '25,00', contactId: 'c-ida', contactName: 'Ida Wießner', projectId: null, purposeId: null, abroad: false, addsToAssets: false },
    ]);
  });

  it('mehrere Zeilen teilen den Betrag im Verhältnis der Vorlage, das Restcent auf die erste', () => {
    const lines = [{ categoryId: 'a', amountCents: 2000 }, { categoryId: 'b', amountCents: 1000 }];
    expect(templateSplitRows(lines, 3000, 'k').map((r) => r.amountText)).toEqual(['20,00', '10,00']);
    expect(templateSplitRows(lines, 1000, 'k').map((r) => r.amountText)).toEqual(['6,67', '3,33']);
  });

  it('ohne Kategorie in der Vorlage: eine Zeile mit leerer Kategorie, Kennzeichen und Kontakt', () => {
    expect(templateSplitRows([{ taxCode: 'vat19', contactId: 'c-1', contactName: 'Druckerei' }], 12000, 'k')).toEqual([
      { key: 'k-1', categoryId: '', amountText: '120,00', taxCode: 'vat19', contactId: 'c-1', contactName: 'Druckerei', projectId: null, purposeId: null, abroad: false, addsToAssets: false },
    ]);
  });
});

describe('withOpenItemTemplate: „Wofür?“ aus der Vorlage des gewählten Postens', () => {
  it('leer → übernommen', () => {
    const next = withOpenItemTemplate(emptyForm('income', '2026-10-18'), fee, 6000);
    expect(next.splitRows).toHaveLength(1);
    expect(next.splitRows[0]).toMatchObject({ categoryId: 'cat-fees', amountText: '60,00', contactId: 'c-ida', contactName: 'Ida Wießner' });
  });

  it('eine leere Zeile zählt als leer', () => {
    const state = { ...emptyForm('income', '2026-10-18'), splitRows: [{ key: 's', categoryId: '', amountText: '', contactId: null, projectId: null, purposeId: null, abroad: false, addsToAssets: false }] };
    expect(withOpenItemTemplate(state, fee, 6000).splitRows[0]).toMatchObject({ categoryId: 'cat-fees' });
  });

  it('nur der Betrag aus dem Bankumsatz vorbelegt → übernommen (Joe 2026-10-18: „Bearbeiten“ aus der Arbeitsliste)', () => {
    const fromBank = emptyForm('income', '2026-10-18');
    const withBankAmount = { ...fromBank, splitRows: [{ ...fromBank.splitRows[0]!, amountText: '12,00' }] };
    expect(withOpenItemTemplate(withBankAmount, fee, 6000).splitRows[0]).toMatchObject({ categoryId: 'cat-fees', contactId: 'c-ida' });
  });

  it('ausgefüllt (Kategorie, Kontakt, Projekt oder Zweck) → unverändert', () => {
    const base = emptyForm('income', '2026-10-18');
    for (const field of [{ categoryId: 'x' }, { contactId: 'c-x' }, { projectId: 'p-x' }, { purposeId: 'z-x' }]) {
      const filled = { ...base, splitRows: [{ ...base.splitRows[0]!, ...field }] };
      expect(withOpenItemTemplate(filled, fee, 6000)).toBe(filled);
    }
  });

  it('Geldzeile über dem offenen Betrag: der Rest als eigene Zeile ohne Kategorie (Plan N1 E4, M16)', () => {
    const next = withOpenItemTemplate(emptyForm('income', '2026-10-18'), fee, 6000, 7500);
    expect(next.splitRows.map((r) => [r.categoryId, r.amountText])).toEqual([
      ['cat-fees', '60,00'],
      ['', '15,00'],
    ]);
    expect(next.splitRows[1]).toMatchObject({ contactId: 'c-ida', contactName: 'Ida Wießner' });
    expect(withOpenItemTemplate(emptyForm('income', '2026-10-18'), fee, 6000, 6000).splitRows).toHaveLength(1);
  });

  it('ohne Vorlage oder bei einer Umbuchung → unverändert', () => {
    const empty = emptyForm('income', '2026-10-18');
    expect(withOpenItemTemplate(empty, other, 6000)).toBe(empty);
    const transfer = emptyForm('transfer', '2026-10-18');
    expect(withOpenItemTemplate(transfer, fee, 6000)).toBe(transfer);
  });
});
