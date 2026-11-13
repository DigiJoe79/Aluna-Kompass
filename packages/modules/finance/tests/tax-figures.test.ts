import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { recordReserveMovement, saveReserve } from '../src/allocation/reserves';
import { bookEntry } from '../src/ledger/finalize';
import { reverseEntry } from '../src/ledger/reverse';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { taxFiguresDiffer, taxFiguresInternal, taxFiguresJsonInternal } from '../src/reporting/tax-figures';
import { createTaxPeriod, saveTaxPeriodAnswers } from '../src/ledger/tax-periods';
import { financeCategories } from '../src/schema';
import { insertDocument, ledgerFixture } from './helpers';

const COMPLETE = { churchPurposes: false, charitablePurposes: false, statuteDate: '2022-03-01', statuteSubmission: 'onFile', feeResolution: 'none', welfare: false, hospital: false, sport: false, gratuitousBenefits: false } as const;

async function setup() {
  const f = await ledgerFixture({ years: ['2024', '2025', '2026'] });
  const y = (d: string) => f.years[d]!.id;
  const cat = (key: string) => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get()!.id;
  const book = (date: string, key: string, cents: number) => bookEntry(f.deps, f.ctx, { entryDate: date, text: key, moneyLines: [{ accountId: f.cash.id, amountCents: cents }], allocationLines: [{ categoryId: cat(key), amountCents: cents }] }).then(unwrap);
  const period = unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y('2024'), lastFiscalYearId: y('2025'), withTaxAdvisor: false, dueOn: '2026-07-31' }));
  unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: period.id, answers: COMPLETE }));
  const figures = () => taxFiguresInternal(f.deps, f.deps.db, period.id)!;
  return { f, y, cat, book, period, figures };
}

describe('Abbild der Steuererklärung (B9, Spec 0.5.2 § 4.1)', () => {
  it('finds no cause for equal values', async () => {
    const { book, figures } = await setup();
    await book('2025-03-01', 'donations', 10_000);
    expect(taxFiguresDiffer(figures(), figures())).toEqual([]);
  });

  it('compares the Gem lines in whole euros: a cent change moves only the attachment', async () => {
    const { book, figures } = await setup();
    await book('2025-03-01', 'donations', 10_000);
    const before = figures();
    await book('2025-03-02', 'donations', 20);
    const causes = taxFiguresDiffer(before, figures());
    expect(causes.filter((c) => c.kind === 'line')).toEqual([]);
    expect(causes).toContainEqual({ kind: 'attachment', report: 'taxReturnIncomeStatement', year: '2025' });
    await book('2025-03-03', 'donations', 100);
    expect(taxFiguresDiffer(before, figures())).toContainEqual({ kind: 'line', line: '9', year: '2025' });
  });

  it('keeps free text only as a hash, and a changed text is a cause', async () => {
    const { f, period, figures } = await setup();
    unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: period.id, answers: { ...COMPLETE, gratuitousBenefits: true, gratuitousBenefitList: [{ reason: 'Blumenstrauß zum Jubiläum', amountCents: 4_000 }] } }));
    const before = figures();
    expect(taxFiguresJsonInternal(f.deps, f.deps.db, period.id)).not.toContain('Blumenstrauß');
    unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: period.id, answers: { ...COMPLETE, gratuitousBenefits: true, gratuitousBenefitList: [{ reason: 'Präsentkorb zum Jubiläum', amountCents: 4_000 }] } }));
    expect(taxFiguresDiffer(before, figures())).toEqual([{ kind: 'line', line: '75' }]);
  });

  it('sees a move between spheres in the income statement, while the Gem lines stay', async () => {
    const { f, book, figures } = await setup();
    const donation = await book('2025-03-01', 'donations', 10_000);
    await book('2025-03-02', 'interest', 5_000);
    const before = figures();
    // Dieselbe Einnahme in der Vermögensverwaltung statt im ideellen Bereich: Zeile 9 bleibt, die EÜR nicht.
    unwrap(await reverseEntry(f.deps, f.ctx, { id: donation.id }));
    await book('2025-03-04', 'interest', 10_000);
    expect(taxFiguresDiffer(before, figures())).toEqual([{ kind: 'attachment', report: 'taxReturnIncomeStatement', year: '2025' }]);
  });

  it('ignores a renamed category', async () => {
    const { f, cat, book, figures } = await setup();
    await book('2025-03-01', 'donations', 10_000);
    const before = figures();
    f.deps.db.update(financeCategories).set({ name: 'Geldspenden (umbenannt)' }).where(eq(financeCategories.id, cat('donations'))).run();
    expect(taxFiguresDiffer(before, figures())).toEqual([]);
  });

  it('sees an allocation to a reserve in the reserve statement', async () => {
    const { f, book, figures } = await setup();
    await book('2025-03-01', 'donations', 100_000);
    const minutes = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const withDms = ctxWith([...FINANCE_PERMISSIONS, 'dms.view'], f.userId);
    const reserve = unwrap(await saveReserve(f.deps, withDms, { kind: 'projectFunds', name: 'Neues Gehege', purposeText: 'Bau eines Geheges', resolutionDocumentId: minutes }));
    const before = figures();
    unwrap(await recordReserveMovement(f.deps, withDms, { reserveId: reserve.id, kind: 'allocate', movementDate: '2025-06-01', amountCents: 10_000, resolutionDocumentId: minutes }));
    const causes = taxFiguresDiffer(before, figures());
    expect(causes).toContainEqual({ kind: 'attachment', report: 'reserveStatement', year: '2025' });
  });
});
