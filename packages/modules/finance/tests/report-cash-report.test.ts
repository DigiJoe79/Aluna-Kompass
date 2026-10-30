import { unwrap, writeSettingInternal } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { addContactRole, createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount } from '../src/ledger/accounts';
import { createCategory } from '../src/ledger/categories';
import { requestAllocationCorrection } from '../src/ledger/corrections';
import { bookEntry } from '../src/ledger/finalize';
import { moveCash } from '../src/ledger/cash';
import { withTestReports } from '../src/reporting/catalog';
import { finalizeFinanceReport, releaseReportsForFinalizing, renderContextInternal } from '../src/reporting/finalize';
import { cashReportDefinition, computeCashReport, type CashReport } from '../src/reporting/reports/cash-report';
import { cashReportTypst } from '../src/reporting/reports/cash-report-typst';
import { financeAllocationCorrections, financeAllocationLines, financeCategories } from '../src/schema';
import { ledgerFixture } from './helpers';
import { testReport } from './reporting-fixture';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;

const category = (f: Fixture, key: string) => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get()!;
const book = (f: Fixture, o: { date: string; key: string; cents: number; accountId?: string; contactId?: string }) =>
  bookEntry(f.deps, f.ctx, { entryDate: o.date, text: o.key, moneyLines: [{ accountId: o.accountId ?? f.bank.id, amountCents: o.cents }], allocationLines: [{ categoryId: category(f, o.key).id, amountCents: o.cents, taxCode: 'none', ...(o.contactId ? { contactId: o.contactId } : {}) }] }).then(unwrap);

async function usualYear() {
  const f = await ledgerFixture({ years: ['2025', '2026'] });
  await book(f, { date: '2025-04-01', key: 'donations', cents: 20000 });
  await book(f, { date: '2025-05-01', key: 'program-costs', cents: -4000 });
  await book(f, { date: '2026-02-01', key: 'donations', cents: 35000 });
  await book(f, { date: '2026-02-02', key: 'office', cents: -1500 });
  await book(f, { date: '2026-02-03', key: 'sales', cents: 2500, accountId: f.cash.id });
  unwrap(await moveCash(f.deps, f.ctx, { fromAccountId: f.cash.id, toAccountId: f.bank.id, date: '2026-02-04', amountCents: 2000 }));
  return { f, y2025: f.years['2025']!.id, y2026: f.years['2026']!.id };
}

describe('Bericht cashReport (Rechenschaft A2 Task 4)', () => {
  it('balances the probe', async () => {
    const { f, y2026 } = await usualYear();
    const data = computeCashReport(f.deps.db, { fiscalYearId: y2026 });
    expect(data.probe).toEqual({ openingCents: 16000, openedInYearCents: 0, resultCents: 36000, transitChangeCents: 0, closingCents: 52000, differenceCents: 0 });
    expect(data.accounts.find((a) => a.accountId === f.cash.id)).toMatchObject({ kind: 'cash', openingCents: 0, closingCents: 500 });
    expect(data.income.resultCents).toBe(36000);
    expect(cashReportDefinition.finalizeBlock!(data)).toBeNull();
    expect(cashReportDefinition.finalizeBlock!({ ...data, probe: { ...data.probe, differenceCents: 1 } })).toEqual({ code: 'reportProbeFails', params: { differenceCents: 1 } });
  });

  it('starts at zero in the first year', async () => {
    const { f, y2025 } = await usualYear();
    const data = computeCashReport(f.deps.db, { fiscalYearId: y2025 });
    expect(data.income.previous).toBeNull();
    expect(data.probe).toMatchObject({ openingCents: 0, resultCents: 16000, closingCents: 16000, differenceCents: 0 });
  });

  it('counts accounts opened during the year', async () => {
    const { f, y2026 } = await usualYear();
    const savings = unwrap(await createAccount(f.deps, f.ctx, { name: 'Zweite Kasse', kind: 'cash', openingBalanceCents: 50000, openingDate: '2026-04-01' }));
    const data = computeCashReport(f.deps.db, { fiscalYearId: y2026 });
    expect(data.accounts.find((a) => a.accountId === savings.id)).toMatchObject({ openingCents: 0, openedInYearCents: 50000, closingCents: 50000 });
    expect(data.probe).toMatchObject({ openedInYearCents: 50000, closingCents: 102000, differenceCents: 0 });
  });

  it('uses the change of transit money', async () => {
    const { f, y2026 } = await usualYear();
    await book(f, { date: '2025-12-31', key: 'not-ours', cents: 10000 });
    await book(f, { date: '2026-03-01', key: 'not-ours', cents: -10000 });
    await book(f, { date: '2026-03-02', key: 'not-ours', cents: 4000 });
    const data = computeCashReport(f.deps.db, { fiscalYearId: y2026 });
    expect(data.transit).toEqual({ openingCents: 10000, inflowCents: 4000, outflowCents: 10000, closingCents: 4000 });
    expect(data.probe).toMatchObject({ openingCents: 26000, transitChangeCents: -6000, differenceCents: 0 });
  });

  it('blocks finalizing when the probe fails', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    const y2025 = f.years['2025']!.id;
    f.closeYear(y2025);
    unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'oralReport' }));
    const failing = testReport({ key: 'testProbe', finalizeBlock: () => ({ code: 'reportProbeFails', params: { differenceCents: 250 } }) });
    await withTestReports([failing], async () => {
      expect(err(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testProbe', params: { fiscalYearId: y2025 } }))).toMatchObject({ type: 'conflict', code: 'reportProbeFails' });
    });
    expect(err(await finalizeFinanceReport(f.deps, f.ctx, { report: 'cashReport', params: { fiscalYearId: y2025 } }))).toBe('ok');
  });

  it('names no people and groups the payments to organ members', async () => {
    const { f, y2026 } = await usualYear();
    const contacts = ctxWith(['contacts.manage'], f.userId);
    const anna = unwrap(await createContact(f.deps, { ...systemContext(), permissions: new Set(['contacts.manage']) }, { kind: 'person', firstName: 'Anna', lastName: 'Vorstandsfrau' }));
    const ben = unwrap(await createContact(f.deps, { ...systemContext(), permissions: new Set(['contacts.manage']) }, { kind: 'person', firstName: 'Ben', lastName: 'Kassenwart' }));
    // Die Satzung erlaubt Vergütungen an den Vorstand (Einrichtung), sonst verlangt die Buchung eine Begründung.
    f.deps.db.transaction((tx) => {
      writeSettingInternal(tx, f.deps, systemContext(), 'finance.boardRemunerationAllowed', true);
      writeSettingInternal(tx, f.deps, systemContext(), 'finance.boardRemunerationValidFrom', '2026-01-01');
    });
    for (const c of [anna, ben]) unwrap(await addContactRole(f.deps, contacts, { id: c.id, role: 'board-member', since: '2026-01-01' }));
    await book(f, { date: '2026-03-01', key: 'trainer-allowance', cents: -200000, contactId: anna.id });
    await book(f, { date: '2026-04-01', key: 'trainer-allowance', cents: -140000, contactId: anna.id });
    await book(f, { date: '2026-04-02', key: 'trainer-allowance', cents: -30000, contactId: ben.id });
    await book(f, { date: '2026-04-03', key: 'travel', cents: -5000, contactId: ben.id });
    const data = computeCashReport(f.deps.db, { fiscalYearId: y2026 });
    expect(data.organPayments).toEqual(
      expect.arrayContaining([
        { role: 'board-member', kind: 'remuneration', amountCents: 370000, personCount: 2 },
        { role: 'board-member', kind: 'other', amountCents: 5000, personCount: 1 },
      ]),
    );
    expect(data.organPersonsOverLiabilityLimit).toBe(1);
    const text = JSON.stringify(data);
    for (const name of ['Anna', 'Vorstandsfrau', 'Ben', 'Kassenwart', 'Musterspenderin']) expect(text).not.toContain(name);
  });

  it('lists prior year corrections only when present', async () => {
    const { f, y2026 } = await usualYear();
    const none = computeCashReport(f.deps.db, { fiscalYearId: y2026 });
    expect(none.priorYearCorrections).toEqual([]);
    expect(cashReportTypst(none, renderContextInternal(f.deps))).not.toContain('Korrekturen an Vorjahren');

    const entry = await book(f, { date: '2025-06-01', key: 'donations', cents: 3000, contactId: f.wrongDonor.id });
    const line = f.deps.db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entry.id)).get()!;
    unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { contactId: f.rightDonor.id }, note: 'Falsch zugeordnet' }));
    const data = computeCashReport(f.deps.db, { fiscalYearId: y2026 });
    expect(data.priorYearCorrections).toEqual([{ entryId: entry.id, entryNumber: entry.number, fiscalYearDesignation: '2025', appliedOn: '2026-09-05' }]);
    expect(cashReportTypst(data, renderContextInternal(f.deps))).toContain('Korrekturen an Vorjahren');
    // Im Jahr der Buchung selbst ist es keine Korrektur an einem Vorjahr.
    expect(computeCashReport(f.deps.db, { fiscalYearId: f.years['2025']!.id }).priorYearCorrections).toEqual([]);
  });

  it('F-B3: a correction applied on 01.01. at 00:30 Berlin time belongs to the new year', async () => {
    const f = await ledgerFixture({ years: ['2024', '2025', '2026'] });
    const entry = await book(f, { date: '2024-06-01', key: 'donations', cents: 3000, contactId: f.wrongDonor.id });
    const line = f.deps.db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entry.id)).get()!;
    unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { contactId: f.rightDonor.id }, note: 'Falsch zugeordnet' }));
    f.deps.db.update(financeAllocationCorrections).set({ approvedAt: '2025-12-31T23:30:00.000Z' }).run();
    expect(computeCashReport(f.deps.db, { fiscalYearId: f.years['2025']!.id }).priorYearCorrections).toEqual([]);
    expect(computeCashReport(f.deps.db, { fiscalYearId: f.years['2026']!.id }).priorYearCorrections).toEqual([{ entryId: entry.id, entryNumber: entry.number, fiscalYearDesignation: '2024', appliedOn: '2026-01-01' }]);
    f.deps.db.update(financeAllocationCorrections).set({ approvedAt: '2025-12-31T22:30:00.000Z' }).run();
    expect(computeCashReport(f.deps.db, { fiscalYearId: f.years['2025']!.id }).priorYearCorrections).toEqual([{ entryId: entry.id, entryNumber: entry.number, fiscalYearDesignation: '2024', appliedOn: '2025-12-31' }]);
  });

  it('folds small categories beyond 22 rows', async () => {
    const { f, y2026 } = await usualYear();
    for (let i = 1; i <= 30; i++) {
      const c = unwrap(await createCategory(f.deps, f.ctx, { key: `extra-${i}`, name: `Sammelposten ${String(i).padStart(2, '0')}`, direction: 'income', sphere: 'ideal', incomeKind: 'other' }));
      unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-05-01', text: 'x', moneyLines: [{ accountId: f.bank.id, amountCents: 100 * i }], allocationLines: [{ categoryId: c.id, amountCents: 100 * i }] }));
    }
    const data: CashReport = computeCashReport(f.deps.db, { fiscalYearId: y2026 });
    const typst = cashReportTypst(data, renderContextInternal(f.deps));
    expect(typst).toContain('Übrige');
    expect(typst).toContain('Einzeln in der Einnahmen-Überschuss-Rechnung');
    expect(typst).toContain('Sammelposten 30');
    expect(typst).not.toContain('Sammelposten 01');
    expect(data.probe.differenceCents).toBe(0);
    expect(data.income.spheres.find((s) => s.sphere === 'ideal')!.categories.length).toBeGreaterThan(30);
  });

  it('prints statute reference and optional signature line', async () => {
    const { f, y2026 } = await usualYear();
    const data = computeCashReport(f.deps.db, { fiscalYearId: y2026 });
    expect(cashReportDefinition.paperSubtitle!(renderContextInternal(f.deps))).toBe('Kassenteil des Jahresberichts, vorgelegt vom Vorstand');
    expect(cashReportTypst(data, renderContextInternal(f.deps))).not.toContain('Unterschrift');
    f.deps.db.transaction((tx) => {
      writeSettingInternal(tx, f.deps, systemContext(), 'finance.reports.statuteReference', '§ 9 Nr. 3 der Satzung');
      writeSettingInternal(tx, f.deps, systemContext(), 'finance.reports.cashReportSignature', true);
    });
    expect(cashReportDefinition.paperSubtitle!(renderContextInternal(f.deps))).toBe('Kassenteil des Jahresberichts nach § 9 Nr. 3 der Satzung, vorgelegt vom Vorstand');
    expect(cashReportTypst(data, renderContextInternal(f.deps))).toContain('Unterschrift');
  });
});

describe('Kassenbericht als Zwischenbericht bis zu einem Tag (Rechenschaft C, Amtsübergabe)', () => {
  it('computes balances and income up to the day within the year', async () => {
    const { f, y2026 } = await usualYear();
    const full = computeCashReport(f.deps.db, { fiscalYearId: y2026 });
    const interim = computeCashReport(f.deps.db, { fiscalYearId: y2026, date: '2026-02-01' });
    expect(interim.year).toMatchObject({ id: y2026, startsOn: '2026-01-01', endsOn: '2026-02-01' });
    expect(interim.income.resultCents).toBe(35000);
    expect(full.income.resultCents).toBe(36000);
    expect(interim.accounts.find((a) => a.accountId === f.bank.id)!.closingCents).toBe(16000 + 35000);
    expect(interim.probe.differenceCents).toBe(0);
  });

  it('refuses a day outside the year and keeps the hash without a day', async () => {
    const { f, y2026 } = await usualYear();
    expect(cashReportDefinition.checkParams!(f.deps.db, { fiscalYearId: y2026, date: '2025-12-31' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(cashReportDefinition.checkParams!(f.deps.db, { fiscalYearId: y2026, date: '2026-06-30' })).toBeNull();
    expect(cashReportDefinition.paramsSchema.safeParse({ fiscalYearId: y2026 }).data).toEqual({ fiscalYearId: y2026 });
    expect('interimUntil' in computeCashReport(f.deps.db, { fiscalYearId: y2026 })).toBe(false);
  });
});
