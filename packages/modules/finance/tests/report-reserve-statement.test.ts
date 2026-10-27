import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { recordReserveCarryForward, recordReserveMovement, saveReserve } from '../src/allocation/reserves';
import { bookEntry } from '../src/ledger/finalize';
import { reserveBalancesAt } from '../src/ledger/reserve-balances';
import { renderContextInternal } from '../src/reporting/finalize';
import { computeReserveStatementReport, reserveStatementTypst } from '../src/reporting/reports/reserve-statement';
import { runFinanceReport } from '../src/reporting/service';
import { ledgerFixture, pdfBytes } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
const upload = (date: string) => ({ bytes: pdfBytes(), fileName: 'beschluss.pdf', documentDate: date });

async function withReserves() {
  const f = await ledgerFixture({ years: ['2024', '2025', '2026'] });
  await bookEntry(f.deps, f.ctx, { entryDate: '2025-02-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 50000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 50000, taxCode: 'none' }] }).then(unwrap);
  const created = unwrap(await saveReserve(f.deps, f.ctx, { kind: 'replacement', name: 'Rücklage Fahrzeug', purposeText: 'Ersatz des Vereinsbusses', resolutionUpload: upload('2024-12-15') }));
  const replacement = unwrap(await recordReserveCarryForward(f.deps, f.ctx, { id: created.id, expectedVersion: created.updatedAt, carryForwardCents: 5000, carryForwardDate: '2025-01-01', upload: upload('2024-12-31') }));
  unwrap(await recordReserveMovement(f.deps, f.ctx, { reserveId: replacement.id, kind: 'allocate', movementDate: '2025-06-30', amountCents: 10000, resolutionUpload: upload('2025-06-28') }));
  unwrap(await recordReserveMovement(f.deps, f.ctx, { reserveId: replacement.id, kind: 'withdraw', movementDate: '2026-02-01', amountCents: 3000, resolutionUpload: upload('2026-01-30') }));
  const free = unwrap(await saveReserve(f.deps, f.ctx, { kind: 'free', name: 'Freie Rücklage', resolutionUpload: upload('2025-01-10') }));
  unwrap(await recordReserveMovement(f.deps, f.ctx, { reserveId: free.id, kind: 'allocate', movementDate: '2026-03-01', amountCents: 6000, forFiscalYearId: f.years['2025']!.id, capReason: 'Beschluss der Mitgliederversammlung', resolutionUpload: upload('2026-02-27') }));
  return { f, replacement, free, y2024: f.years['2024']!.id, y2025: f.years['2025']!.id, y2026: f.years['2026']!.id };
}

describe('Bericht reserveStatement (Rechenschaft B1 Task 4)', () => {
  it('rolls each reserve forward per year and closes at its balance', async () => {
    const { f, replacement, y2025, y2026 } = await withReserves();
    const data = computeReserveStatementReport(f.deps.db, { fiscalYearIds: [y2025, y2026] });
    expect(data.years.map((y) => y.id)).toEqual([y2025, y2026]);
    for (const reserve of data.reserves) {
      for (const y of reserve.perYear) {
        expect(y.openingCents + y.allocatedCents - y.withdrawnCents - y.dissolvedCents).toBe(y.closingCents);
        const endsOn = data.years.find((x) => x.id === y.fiscalYearId)!.endsOn;
        expect(y.closingCents).toBe(reserveBalancesAt(f.deps.db, endsOn).find((b) => b.reserveId === reserve.reserveId)!.balanceCents);
      }
    }
    const fahrzeug = data.reserves.find((r) => r.reserveId === replacement.id)!;
    // Der Vortrag gilt ab dem 01.01.2025: Er ist der Anfang des Jahres 2025.
    expect(fahrzeug.perYear[0]).toMatchObject({ openingCents: 5000, allocatedCents: 10000, closingCents: 15000 });
    expect(fahrzeug.perYear[1]).toMatchObject({ openingCents: 15000, withdrawnCents: 3000, closingCents: 12000 });
    expect(fahrzeug.kind).toBe('replacement');
  });

  it('names reference year and resolution of an allocation', async () => {
    const { f, free, y2025, y2026 } = await withReserves();
    const data = computeReserveStatementReport(f.deps.db, { fiscalYearId: y2026 });
    const movement = data.reserves.find((r) => r.reserveId === free.id)!.movements[0]!;
    expect(movement).toMatchObject({ kind: 'allocate', movementDate: '2026-03-01', amountCents: 6000, forFiscalYearId: y2025, resolutionDate: '2026-02-27' });
    expect(movement.resolutionNumber).toEqual(expect.any(String));
  });

  it('warns when allocations for a year exceed the cap of the free reserve', async () => {
    const { f, y2025, y2026 } = await withReserves();
    const data = computeReserveStatementReport(f.deps.db, { fiscalYearIds: [y2025, y2026] });
    expect(data.freeReserveCap.find((c) => c.fiscalYearId === y2025)).toMatchObject({ capCents: 5000, allocatedForYearCents: 6000, exceeded: true });
    expect(data.warnings).toEqual(['freeReserveCapExceeded']);
    expect(reserveStatementTypst(data, renderContextInternal(f.deps))).toContain('Höchstbetrag');
  });

  it('accepts one to three consecutive years only', async () => {
    const { f, y2024, y2025, y2026 } = await withReserves();
    expect(err(await runFinanceReport(f.deps, f.ctx, { report: 'reserveStatement', params: { fiscalYearIds: [y2024, y2026] } }))).toMatchObject({ type: 'validation' });
    expect(err(await runFinanceReport(f.deps, f.ctx, { report: 'reserveStatement', params: { fiscalYearIds: [y2026, y2025] } }))).toMatchObject({ type: 'validation' });
    expect(err(await runFinanceReport(f.deps, f.ctx, { report: 'reserveStatement', params: { fiscalYearIds: ['nope'] } }))).toMatchObject({ type: 'notFound' });
    expect(err(await runFinanceReport(f.deps, f.ctx, { report: 'reserveStatement', params: { fiscalYearId: y2026 } }))).toBe('ok');
    f.closeYear(y2024);
    f.closeYear(y2025);
    const three = { report: 'reserveStatement', params: { fiscalYearIds: [y2024, y2025, y2026] } };
    expect(unwrap(await runFinanceReport(f.deps, f.ctx, three)).stage).toBe('preliminary');
    f.closeYear(y2026);
    expect(unwrap(await runFinanceReport(f.deps, f.ctx, three)).stage).toBe('review');
  });
});
