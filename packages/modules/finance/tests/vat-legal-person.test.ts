import { unwrap } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { listFinanceDeadlines } from '../src/closing/deadlines';
import { checkReverseCharge } from '../src/import/reverse-charge-check';
import { bookEntry } from '../src/ledger/finalize';
import { taxCodeOptionsInternal, vatProfileAt } from '../src/ledger/vat-settings';
import { FINANCE_PERMISSIONS, financeModule } from '../src/manifest';
import { runFinanceReport } from '../src/reporting/service';
import type { VatAdvanceReturnData } from '../src/reporting/reports/vat-advance-return';
import { ledgerFixture } from './helpers';

/**
 * Plan E13 Task 4 (Befund 37): Ein Verein ohne Unternehmereigenschaft und ohne USt-IdNr. lässt einen Handwerker aus den
 * Niederlanden am Vereinsheim arbeiten — Ort am Grundstück (§ 3a Abs. 3 Nr. 1 UStG), Steuerschuldner der Verein als
 * juristische Person (§ 13b Abs. 2 Nr. 1, Abs. 5 S. 1). Daraus: Prüffrage, Kennzeichen `rc13bOther`, Voranmeldung des
 * Quartals mit Kz 84/85 (§ 18 Abs. 4a), Frist und Menüeintrag „Umsatzsteuer“.
 */
describe('VAT of a legal person that is not an entrepreneur', () => {
  it('asks, books section 13b (2) no. 1, files the quarter and shows its deadline and the menu entry', async () => {
    const f = await ledgerFixture();
    f.deps.clock.set('2026-10-25T09:00:00.000Z');
    expect(vatProfileAt(f.deps.db, '2026-10-25')).toMatchObject({ entrepreneur: false, vatId: null, obligations: 'section18_4aLegalPerson' });
    const nav = () => (financeModule.navigationFor?.(f.deps) ?? []).map((n) => n.key);
    expect(nav()).not.toContain('finance.vat');

    const craftsman = unwrap(await createContact(f.deps, { ...systemContext(), permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Dakwerken Test B.V.', country: 'NL' }));
    const lines = [{ amountCents: -150000, taxCode: null, categoryId: f.programCosts.id }];
    const prompt = unwrap(await checkReverseCharge(f.deps, ctxWith([...FINANCE_PERMISSIONS], f.userId), { contactId: craftsman.id, lines })).prompt;
    expect(prompt).toMatchObject({ trigger: 'foreignNoTax', suggestedCode: 'rc13bOther', lineIndexes: [0] });
    expect(taxCodeOptionsInternal(f.deps.db, '2026-10-25')).toContain(prompt!.suggestedCode);

    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-08-14', text: 'Dachreparatur Vereinsheim', moneyLines: [{ accountId: f.bank.id, amountCents: -150000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -150000, taxCode: prompt!.suggestedCode, contactId: craftsman.id }] }));

    const data = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'vatAdvanceReturn', params: { vatPeriod: '2026-Q3' } })).data as VatAdvanceReturnData;
    const cents = Object.fromEntries(data.values.map((v) => [v.source, v.cents]));
    expect(cents).toMatchObject({ rc13bOtherBase: 150000, rc13bOtherTax: 28500, rc13bEuTax: 0, smallBusinessTurnover: 0 });

    const vat = unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed.filter((d) => d.kind.startsWith('vat')).map((d) => [d.key, d.dueOn]);
    expect(vat).toEqual([['vatAdvanceReturn:2026-Q3', '2026-10-12'], ['vatReturn:2026', '2027-08-02']]);
    expect(nav()).toContain('finance.vat');
  });
});
