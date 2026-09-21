import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { createProject } from '@kompass/module-projects';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { updateAccount } from '../src/ledger/accounts';
import { saveDraft } from '../src/ledger/entries';
import { bookEntry } from '../src/ledger/finalize';
import { createOpenItem } from '../src/ledger/open-items';
import { createPurpose } from '../src/ledger/purposes';
import { accountBalancesAt, assetOverviewAt, incomeStatement, projectBalances, purposeBalancesAt, standing } from '../src/ledger/queries';
import { reverseEntry } from '../src/ledger/reverse';
import { financeCategories } from '../src/schema';
import { ledgerFixture } from './helpers';

function categoryByKey(deps: Awaited<ReturnType<typeof ledgerFixture>>['deps'], key: string) {
  const row = deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get();
  if (!row) throw new Error(`Startplan-Kategorie fehlt: ${key}`);
  return row;
}

/** Ein Projekt anlegen, ohne dass `f.ctx` `projects.manage` braucht (Muster corrections.test.ts). */
async function seedProject(deps: Awaited<ReturnType<typeof ledgerFixture>>['deps'], userId: string, slug: string) {
  const manager = ctxWith(['projects.manage'], userId);
  return unwrap(await createProject(deps, manager, { slug, name: { de: 'Testprojekt' }, type: 'ongoing' as const, summary: { de: '' }, body: { de: '' } }));
}

/**
 * Das gemeinsame Szenario aus dem Plan: Anfangsbestand Bank 1.000,00 zum
 * 01.01., Spende 250,00 mit Zweck A und Projekt P, Bankgebühr −4,90, Abhebung
 * Bank→Kasse 200,00, Bar-Ausgabe −35,00 Zweck A, eine stornierte Spende
 * 100,00 samt Storno (gleicher Tag), ein Entwurf 999,00, ein offener Posten
 * (Verbindlichkeit 238,00 vom 18.12. des Vorjahres) — dazu ein Zweck C, der
 * nur einen Vortrag trägt, ohne je eine Zeile zu sehen.
 */
async function buildMainScenario() {
  const f = await ledgerFixture();
  const bank = unwrap(await updateAccount(f.deps, f.ctx, { id: f.bank.id, expectedVersion: f.bank.updatedAt, openingBalanceCents: 100000, openingDate: '2026-01-01' }));
  const project = await seedProject(f.deps, f.userId, 'testprojekt');
  const purposeA = unwrap(await createPurpose(f.deps, f.ctx, { name: 'Zweck A' }));
  const purposeC = unwrap(await createPurpose(f.deps, f.ctx, { name: 'Zweck C', carryForwardCents: 10000, carryForwardDate: '2026-01-01' }));
  const donations = categoryByKey(f.deps, 'donations');
  const bankFees = categoryByKey(f.deps, 'bank-fees');
  const programCosts = categoryByKey(f.deps, 'program-costs');

  const donation = unwrap(
    await bookEntry(f.deps, f.ctx, {
      entryDate: '2026-02-01',
      text: 'Spende',
      moneyLines: [{ accountId: bank.id, amountCents: 25000 }],
      allocationLines: [{ categoryId: donations.id, amountCents: 25000, purposeId: purposeA.id, projectId: project.id }],
    }),
  );
  unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-02', text: 'Bankgebühr', moneyLines: [{ accountId: bank.id, amountCents: -490 }], allocationLines: [{ categoryId: bankFees.id, amountCents: -490 }] }));
  unwrap(
    await bookEntry(f.deps, f.ctx, {
      entryDate: '2026-02-03',
      text: 'Abhebung',
      moneyLines: [
        { accountId: bank.id, amountCents: -20000 },
        { accountId: f.cash.id, amountCents: 20000 },
      ],
      allocationLines: [],
    }),
  );
  unwrap(
    await bookEntry(f.deps, f.ctx, {
      entryDate: '2026-02-04',
      text: 'Bar-Ausgabe',
      moneyLines: [{ accountId: f.cash.id, amountCents: -3500 }],
      allocationLines: [{ categoryId: programCosts.id, amountCents: -3500, purposeId: purposeA.id }],
    }),
  );
  const stornierteSpende = unwrap(
    await bookEntry(f.deps, f.ctx, {
      entryDate: '2026-02-05',
      text: 'Spende (irrtümlich)',
      moneyLines: [{ accountId: bank.id, amountCents: 10000 }],
      allocationLines: [{ categoryId: donations.id, amountCents: 10000 }],
    }),
  );
  unwrap(await reverseEntry(f.deps, f.ctx, { id: stornierteSpende.id }));

  unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-02-06', text: 'Entwurf', moneyLines: [{ accountId: bank.id, amountCents: 99900 }], allocationLines: [{ categoryId: donations.id, amountCents: 99900 }] }));

  const payable = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2025-12-18', amountCents: 23800 }));

  return { f, bank, cash: f.cash, project, purposeA, purposeC, payable, donations, bankFees, programCosts };
}

describe('queries', () => {
  it('account balances: opening plus finalized money lines up to the date — drafts do not count', async () => {
    const { f, bank, cash } = await buildMainScenario();
    const balances = accountBalancesAt(f.deps.db, '2026-03-01');
    expect(balances).toEqual(
      expect.arrayContaining([
        { accountId: bank.id, kind: 'bank', balanceCents: 104510 },
        { accountId: cash.id, kind: 'cash', balanceCents: 16500 },
      ]),
    );
  });

  it('Prüfstein 1: a transfer between accounts does not appear in the income statement', async () => {
    const { f } = await buildMainScenario();
    const statement = incomeStatement(f.deps.db, { from: '2026-01-01', to: '2026-12-31' });
    expect(statement.totalIncomeCents).toBe(25000);
    expect(statement.totalExpenseCents).toBe(3990);
    expect(statement.resultCents).toBe(25000 - 3990);
  });

  it('a reversed entry and its reversal cancel out — in the same period', async () => {
    const { f, donations } = await buildMainScenario();
    const statement = incomeStatement(f.deps.db, { from: '2026-01-01', to: '2026-12-31' });
    const sphere = statement.spheres.find((s) => s.sphere === 'ideal')!;
    const donationRow = sphere.categories.find((c) => c.categoryId === donations.id)!;
    // Die Spende (25.000), die stornierte Spende (10.000) und ihr Storno (−10.000): Summe bleibt 25.000, aber drei Zeilen.
    expect(donationRow.sumCents).toBe(25000);
    expect(donationRow.lineCount).toBe(3);
  });

  it('Prüfstein 7: reversed in a closed year, the original stays in its year and the reversal lands in the current one', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    const donations = categoryByKey(f.deps, 'donations');
    const donation = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-06-01', text: 'Spende 2025', moneyLines: [{ accountId: f.bank.id, amountCents: 10000 }], allocationLines: [{ categoryId: donations.id, amountCents: 10000 }] }));
    f.closeYear(f.years['2025']!.id);
    unwrap(await reverseEntry(f.deps, f.ctx, { id: donation.id }));

    const statement2025 = incomeStatement(f.deps.db, { from: '2025-01-01', to: '2025-12-31' });
    const sphere2025 = statement2025.spheres.find((s) => s.sphere === 'ideal')!;
    expect(sphere2025.categories.find((c) => c.categoryId === donations.id)!.sumCents).toBe(10000);

    const statement2026 = incomeStatement(f.deps.db, { from: '2026-01-01', to: '2026-12-31' });
    const sphere2026 = statement2026.spheres.find((s) => s.sphere === 'ideal')!;
    expect(sphere2026.categories.find((c) => c.categoryId === donations.id)!.sumCents).toBe(-10000);
  });

  it('a returned donation reduces income, it is not an expense', async () => {
    const { f } = await buildMainScenario();
    const statement = incomeStatement(f.deps.db, { from: '2026-01-01', to: '2026-12-31' });
    // Die stornierte Spende steht als negative Zeile in `donations` (Einnahme), nicht in einer Ausgabenkategorie.
    expect(statement.totalExpenseCents).toBe(3990);
  });

  it('groups by sphere and keeps transit apart', async () => {
    const f = await ledgerFixture();
    const donations = categoryByKey(f.deps, 'donations');
    const purposeIncome = categoryByKey(f.deps, 'purpose-income');
    const notOurs = categoryByKey(f.deps, 'not-ours');
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: donations.id, amountCents: 5000 }] }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-02', text: 'Entgelt Zweckbetrieb', moneyLines: [{ accountId: f.bank.id, amountCents: 3000 }], allocationLines: [{ categoryId: purposeIncome.id, amountCents: 3000 }] }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-03', text: 'Fremdes Geld', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: notOurs.id, amountCents: 1000 }] }));

    const statement = incomeStatement(f.deps.db, { from: '2026-01-01', to: '2026-12-31' });
    expect(statement.spheres.map((s) => s.sphere).sort()).toEqual(['ideal', 'purposeOperation']);
    expect(statement.transit).toEqual([{ categoryId: notOurs.id, key: 'not-ours', sumCents: 1000, lineCount: 1 }]);
    expect(statement.totalIncomeCents).toBe(8000);
  });

  it('purpose balance: carry-forward plus lines; project result over a period', async () => {
    const { f, project, purposeA, purposeC } = await buildMainScenario();
    const purposes = purposeBalancesAt(f.deps.db, '2026-03-01');
    expect(purposes.find((p) => p.purposeId === purposeA.id)).toEqual({ purposeId: purposeA.id, carryForwardCents: 0, inflowCents: 25000, outflowCents: 3500, balanceCents: 21500 });
    expect(purposes.find((p) => p.purposeId === purposeC.id)).toEqual({ purposeId: purposeC.id, carryForwardCents: 10000, inflowCents: 0, outflowCents: 0, balanceCents: 10000 });

    const projects = projectBalances(f.deps.db, { from: '2026-01-01', to: '2026-12-31' });
    expect(projects).toEqual([{ projectId: project.id, incomeCents: 25000, expenseCents: 0, resultCents: 25000 }]);
  });

  it('asset overview: accounts plus receivables minus payables; earmarked is the sum of positive purpose balances', async () => {
    const { f, bank, cash, payable } = await buildMainScenario();
    void payable;
    const overview = assetOverviewAt(f.deps.db, '2026-03-01');
    expect(overview.accounts).toEqual(expect.arrayContaining([{ accountId: bank.id, balanceCents: 104510 }, { accountId: cash.id, balanceCents: 16500 }]));
    expect(overview.receivablesCents).toBe(0);
    expect(overview.payablesCents).toBe(23800);
    expect(overview.netAssetsCents).toBe(104510 + 16500 + 0 - 23800);
    expect(overview.earmarkedCents).toBe(21500 + 10000);
    expect(overview.freeCents).toBe(overview.netAssetsCents - overview.earmarkedCents);
  });

  it('a purpose in the red binds nothing', async () => {
    const { f, purposeA, programCosts } = await buildMainScenario();
    const purposeB = unwrap(await createPurpose(f.deps, f.ctx, { name: 'Zweck B' }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-07', text: 'Ausgabe ohne Deckung', moneyLines: [{ accountId: f.cash.id, amountCents: -2000 }], allocationLines: [{ categoryId: programCosts.id, amountCents: -2000, purposeId: purposeB.id }] }));

    const purposes = purposeBalancesAt(f.deps.db, '2026-03-01');
    expect(purposes.find((p) => p.purposeId === purposeB.id)?.balanceCents).toBe(-2000);

    const overview = assetOverviewAt(f.deps.db, '2026-03-01');
    // Zweck B bleibt außen vor — nur die positiven Zweckbestände (A: 21.500, C: 10.000) zählen.
    expect(overview.earmarkedCents).toBe(21500 + 10000);
    void purposeA;
  });

  it('standing: finalized through the latest entry date, and how many drafts wait', async () => {
    const { f } = await buildMainScenario();
    const s = standing(f.deps.db);
    expect(s).toEqual({ finalizedThrough: '2026-02-05', draftCount: 1, reviewedDraftCount: 0 });
  });

  it('everything is computed: changing nothing but the date changes the answer', async () => {
    const { f, bank, cash } = await buildMainScenario();
    // Stichtag vor der Abhebung (2026-02-03): die Gebühr zählt schon, die Abhebung noch nicht.
    const before = accountBalancesAt(f.deps.db, '2026-02-02');
    expect(before.find((a) => a.accountId === bank.id)?.balanceCents).toBe(100000 + 25000 - 490);
    expect(before.find((a) => a.accountId === cash.id)?.balanceCents).toBe(0);
  });
});
