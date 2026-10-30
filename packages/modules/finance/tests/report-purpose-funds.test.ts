import { unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { requestAllocationCorrection } from '../src/ledger/corrections';
import { bookEntry } from '../src/ledger/finalize';
import { purposeBalancesAt } from '../src/ledger/queries';
import { createPurpose, dissolvePurpose } from '../src/ledger/purposes';
import { renderContextInternal } from '../src/reporting/finalize';
import { computePurposeFundsReport, purposeFundsReport, purposeFundsTypst, type PurposeFundsReport } from '../src/reporting/reports/purpose-funds';
import { financeAllocationLines, financePurposes } from '../src/schema';
import { ledgerFixture } from './helpers';

type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;

const book = (f: Fixture, o: { date: string; cents: number; purposeId: string }) =>
  bookEntry(f.deps, f.ctx, {
    entryDate: o.date,
    text: 'Zweckbuchung',
    moneyLines: [{ accountId: f.bank.id, amountCents: o.cents }],
    allocationLines: [{ categoryId: (o.cents > 0 ? f.donations : f.programCosts).id, amountCents: o.cents, taxCode: 'none', purposeId: o.purposeId }],
  }).then(unwrap);

async function twoPurposes() {
  const f = await ledgerFixture({ years: ['2025', '2026'] });
  const a = unwrap(await createPurpose(f.deps, f.ctx, { name: 'Zweck A' }));
  const b = unwrap(await createPurpose(f.deps, f.ctx, { name: 'Zweck B' }));
  await book(f, { date: '2025-03-01', cents: 10000, purposeId: a.id });
  await book(f, { date: '2025-03-02', cents: 10000, purposeId: b.id });
  const expense = await book(f, { date: '2025-04-01', cents: -4000, purposeId: a.id });
  await book(f, { date: '2026-02-01', cents: 3000, purposeId: a.id });
  await book(f, { date: '2026-02-02', cents: -1000, purposeId: b.id });
  return { f, a, b, expense, y2025: f.years['2025']!.id, y2026: f.years['2026']!.id };
}

const balance = (r: PurposeFundsReport['purposes'][number]) => r.carryForwardCents + r.correctionsCents + r.inflowCents - r.usedCents + r.transfersInCents - r.transfersOutCents;

describe('Bericht purposeFunds (Rechenschaft B1 Task 2)', () => {
  it('closes each purpose at its balance and the columns add up', async () => {
    const { f, a, b, y2026 } = await twoPurposes();
    const data = computePurposeFundsReport(f.deps.db, { fiscalYearId: y2026 });
    const balances = new Map(purposeBalancesAt(f.deps.db, '2026-12-31').map((p) => [p.purposeId, p.balanceCents]));
    for (const row of data.purposes) {
      expect(row.closingCents).toBe(balances.get(row.purposeId));
      expect(balance(row)).toBe(row.closingCents);
    }
    expect(data.purposes.find((r) => r.purposeId === a.id)).toMatchObject({ carryForwardCents: 6000, inflowCents: 3000, usedCents: 0, closingCents: 9000, correctionsCents: 0 });
    expect(data.purposes.find((r) => r.purposeId === b.id)).toMatchObject({ carryForwardCents: 10000, usedCents: 1000, closingCents: 9000 });
    expect(data.totals.closingCents).toBe(18000);
  });

  it('shows a correction of a prior year line apart, so the carry forward matches last year', async () => {
    const { f, a, b, expense, y2025, y2026 } = await twoPurposes();
    const previous = computePurposeFundsReport(f.deps.db, { fiscalYearId: y2025 });
    const line = f.deps.db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, expense.id)).get()!;
    // Die Uhr der Tests steht im Jahr 2026: die Korrektur gilt dort, an einer Buchung von 2025.
    unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { purposeId: b.id }, note: 'Falscher Zweck' }));
    const data = computePurposeFundsReport(f.deps.db, { fiscalYearId: y2026 });
    for (const id of [a.id, b.id]) {
      const row = data.purposes.find((r) => r.purposeId === id)!;
      expect(row.carryForwardCents).toBe(previous.purposes.find((r) => r.purposeId === id)!.closingCents);
      expect(balance(row)).toBe(row.closingCents);
    }
    expect(data.purposes.find((r) => r.purposeId === a.id)!.correctionsCents).toBe(4000);
    expect(data.purposes.find((r) => r.purposeId === b.id)!.correctionsCents).toBe(-4000);
    expect(purposeFundsTypst(data, renderContextInternal(f.deps))).toContain('Korrekturen');
    expect(purposeFundsTypst(computePurposeFundsReport(f.deps.db, { fiscalYearId: y2025 }), renderContextInternal(f.deps))).not.toContain('Korrekturen');
  });

  it('leaves out a purpose dissolved before the year without balance', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    // Angelegt vor der Auflösung: Einen Zweck, den es am Jahresende noch nicht gab, zeigt der Bericht nicht.
    f.deps.clock.set('2025-02-01T10:00:00.000Z');
    const gone = unwrap(await createPurpose(f.deps, f.ctx, { name: 'Erledigt' }));
    f.deps.clock.set('2025-06-01T10:00:00.000Z');
    unwrap(await dissolvePurpose(f.deps, f.ctx, { id: gone.id }));
    f.deps.clock.set('2026-09-05T10:00:00.000Z');
    const data = computePurposeFundsReport(f.deps.db, { fiscalYearId: f.years['2026']!.id });
    expect(data.purposes.map((r) => r.purposeId)).not.toContain(gone.id);
    expect(computePurposeFundsReport(f.deps.db, { fiscalYearId: f.years['2025']!.id }).purposes.find((r) => r.purposeId === gone.id)).toMatchObject({ state: 'dissolved' });
  });

  it('leaves out a purpose created after the year end without movement: a released year does not change (Designer Runde 6, 260)', async () => {
    const { f, y2025 } = await twoPurposes();
    const before = computePurposeFundsReport(f.deps.db, { fiscalYearId: y2025 });
    const later = unwrap(await createPurpose(f.deps, f.ctx, { name: 'Später angelegt' }));
    f.deps.db.update(financePurposes).set({ createdAt: '2026-03-01T10:00:00.000Z' }).where(eq(financePurposes.id, later.id)).run();
    expect(computePurposeFundsReport(f.deps.db, { fiscalYearId: y2025 })).toEqual(before);
  });

  it('F-B3: a purpose created on 01.01. at 00:30 Berlin time belongs to the new year, one at 23:30 on 31.12. to the old', async () => {
    const { f, y2025 } = await twoPurposes();
    const newYear = unwrap(await createPurpose(f.deps, f.ctx, { name: 'Neujahr 00:30' }));
    const newYearsEve = unwrap(await createPurpose(f.deps, f.ctx, { name: 'Silvester 23:30' }));
    f.deps.db.update(financePurposes).set({ createdAt: '2025-12-31T23:30:00.000Z' }).where(eq(financePurposes.id, newYear.id)).run();
    f.deps.db.update(financePurposes).set({ createdAt: '2025-12-31T22:30:00.000Z' }).where(eq(financePurposes.id, newYearsEve.id)).run();
    const ids = computePurposeFundsReport(f.deps.db, { fiscalYearId: y2025 }).purposes.map((r) => r.purposeId);
    expect(ids).not.toContain(newYear.id);
    expect(ids).toContain(newYearsEve.id);
  });

  it('names lines for inflow and use per purpose', async () => {
    const { f, a, y2026 } = await twoPurposes();
    const data = computePurposeFundsReport(f.deps.db, { fiscalYearId: y2026 });
    const filters = purposeFundsReport.linesFilter!(data, { fiscalYearId: y2026 });
    expect(filters[`${a.id}.inflow`]).toEqual({ fiscalYearId: y2026, purposeId: a.id, direction: 'income' });
    expect(filters[`${a.id}.used`]).toEqual({ fiscalYearId: y2026, purposeId: a.id, direction: 'expense' });
  });

  it('marks a purpose in the red on paper', async () => {
    const { f, b, y2026 } = await twoPurposes();
    const data = computePurposeFundsReport(f.deps.db, { fiscalYearId: y2026 });
    const red = { ...data, purposes: data.purposes.map((r) => (r.purposeId === b.id ? { ...r, closingCents: -100, negative: true } : r)) };
    expect(purposeFundsTypst(red, renderContextInternal(f.deps))).toContain('Zweck B (im Minus)');
    expect(purposeFundsTypst(data, renderContextInternal(f.deps))).not.toContain('im Minus');
  });

  it('leaves out purposes with only zeros and counts them below; no doubled „Ausland“', async () => {
    const { f, a, y2026 } = await twoPurposes();
    unwrap(await createPurpose(f.deps, f.ctx, { name: 'Ruhender Zweck' }));
    unwrap(await createPurpose(f.deps, f.ctx, { name: 'Noch einer' }));
    const data = computePurposeFundsReport(f.deps.db, { fiscalYearId: y2026 });
    const typst = purposeFundsTypst(data, renderContextInternal(f.deps));
    expect(typst).not.toContain('Ruhender Zweck');
    expect(typst).not.toContain('Noch einer');
    const idle = data.purposes.filter((r) => r.closingCents === 0 && r.inflowCents === 0 && r.usedCents === 0 && r.carryForwardCents === 0).length;
    expect(idle).toBeGreaterThanOrEqual(2);
    expect(typst).toContain(`Weitere ${idle} Zwecke ohne Bewegung.`);
    expect(typst).toContain('Zweck A');
    const one = { ...data, purposes: data.purposes.filter((r) => r.closingCents !== 0 || r.inflowCents !== 0).concat(data.purposes.filter((r) => r.closingCents === 0 && r.inflowCents === 0).slice(0, 1)) };
    expect(purposeFundsTypst(one, renderContextInternal(f.deps))).toContain('Ein weiterer Zweck ohne Bewegung.');
    const abroad = { ...data, purposes: data.purposes.map((r) => ({ ...r, abroad: true })) };
    const ctx = renderContextInternal(f.deps);
    const named = { ...ctx, labels: { ...ctx.labels, [`purpose.${a.id}`]: 'Partnerprojekt Ausland' } };
    const paper = purposeFundsTypst(abroad, named);
    expect(paper).toContain('Partnerprojekt Ausland');
    expect(paper).not.toContain('Partnerprojekt Ausland (Ausland');
    expect(paper).toContain('Zweck B (Ausland)');
  });
});
