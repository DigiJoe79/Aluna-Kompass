import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { FINANCE_DASHBOARD_TILES } from '../src/dashboard';
import { saveNotice } from '../src/donations/notices';
import { bookEntry } from '../src/ledger/finalize';
import { financeCategories } from '../src/schema';
import { ledgerFixture } from './helpers';

const tile = () => FINANCE_DASHBOARD_TILES.find((t) => t.key === 'deadlines')!;
const notice = { kind: 'exemptionNotice', taxOffice: 'Finanzamt Musterstadt', taxNumber: '99/999/99999', noticeDate: '2021-10-20', exemptFrom: '2019-01-01', assessmentPeriod: '2019–2020', purposesText: 'Förderung des Sports' } as const;

describe('Kachel Finanzfristen · Schwellen (Board 7a)', () => {
  it('is a list under finance.overview, on by default, quiet without anything due', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    expect(tile()).toMatchObject({ permission: 'finance.overview', kind: 'list', defaultOn: true });
    expect(await tile().load(f.deps, f.ctx, {})).toEqual({ kind: 'list', lines: [], total: 0, href: '/finance/deadlines' });
  });

  it('shows deadlines within 60 days or overdue and approaching or exceeded thresholds, without names, at most five', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    unwrap(await saveNotice(f.deps, f.ctx, notice)); // läuft am 20.10.2026 ab — binnen 60 Tagen
    const sales = f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'sales')).get()!;
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Verkauf', moneyLines: [{ accountId: f.bank.id, amountCents: 4500000 }], allocationLines: [{ categoryId: sales.id, amountCents: 4500000, taxCode: 'standard' }] }));
    const content = await tile().load(f.deps, ctxWith(['finance.overview'], f.userId), {});
    expect(content.kind === 'list' && content.lines).toEqual([
      { titleKey: 'noticeExpiry', values: { dueOn: '2026-10-20' }, href: '/finance/donations/notices' },
      { titleKey: 'thresholdApproaching', values: { threshold: 'business', designation: '2026' }, href: '/finance/deadlines' },
      { titleKey: 'thresholdApproaching', values: { threshold: 'businessCombined', designation: '2026' }, href: '/finance/deadlines' },
    ]);
    for (const line of content.kind === 'list' ? content.lines : []) expect(tile().messageKeys).toContain(line.titleKey);
  });

  it('leaves out deadlines further than 60 days ahead', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    unwrap(await saveNotice(f.deps, f.ctx, { ...notice, noticeDate: '2022-02-01' })); // 01.02.2027, binnen sechs Monaten, nicht binnen 60 Tagen
    expect(await tile().load(f.deps, f.ctx, {})).toMatchObject({ lines: [], total: 0 });
  });

  it('shows the VAT deadlines on the tile, in the order of the deadlines', async () => {
    const f = await ledgerFixture({ years: ['2026'], entrepreneur: true });
    f.deps.clock.set('2026-10-25T10:00:00.000Z');
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-08-12', text: 'Werbung', moneyLines: [{ accountId: f.bank.id, amountCents: -20000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -20000, taxCode: 'rc13bEu' }] }));
    const content = await tile().load(f.deps, ctxWith(['finance.overview'], f.userId), {});
    expect(content.kind === 'list' && content.lines.map((l) => [l.titleKey, l.values])).toEqual([['vatAdvanceReturn', { dueOn: '2026-10-12', vatPeriod: '2026-Q3' }]]);
    expect(tile().messageKeys).toEqual(expect.arrayContaining(['vatAdvanceReturn', 'vatReturn', 'vatAmendment']));
  });
});
