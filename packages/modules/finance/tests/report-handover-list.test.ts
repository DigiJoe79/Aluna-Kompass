import { unwrap } from '@kompass/core';
import { ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { saveNotice } from '../src/donations/notices';
import { saveDraft } from '../src/ledger/entries';
import { createOpenItem } from '../src/ledger/open-items';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { renderContextInternal } from '../src/reporting/finalize';
import { handoverListTypst, type HandoverListReport } from '../src/reporting/reports/handover-list';
import { runFinanceReport } from '../src/reporting/service';
import { ledgerFixture } from './helpers';
import { insertPaidPartnerPayment, insertPartner } from './partner-fixture';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

async function handover() {
  const f = await ledgerFixture();
  const anna = insertUser(f.deps, { name: 'Anna Amtsträgerin', email: 'anna@kompass.local' });
  const draft = unwrap(await saveDraft(f.deps, ctxWith(FINANCE_PERMISSIONS, anna), { entryDate: '2026-05-01', text: 'Offen', moneyLines: [{ accountId: f.bank.id, amountCents: -2500 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -2500 }] }));
  const item = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-04-01', contactId: f.donor.id, amountCents: 7000, dueOn: '2026-04-30' }));
  const partnerId = insertPartner(f.deps.db, { contactId: f.donor.id });
  await insertPaidPartnerPayment(f, partnerId, f.donor.id, '2026-01-01', { number: 'PZ-2026-998', proofMonths: 1 });
  const notice = unwrap(await saveNotice(f.deps, f.ctx, { kind: 'exemptionNotice', taxOffice: 'Finanzamt Musterstadt', taxNumber: '99/999/99999', noticeDate: '2026-01-05', exemptFrom: '2026-01-01', assessmentPeriod: '2025', purposesText: 'Förderung des Tierschutzes' }));
  return { f, anna, draft, item, notice };
}

const run = async (f: Awaited<ReturnType<typeof handover>>['f'], date: string) => unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'handoverList', params: { date } })).data as HandoverListReport;

describe('Bericht handoverList (Rechenschaft B1 Task 10)', () => {
  it('puts what someone started at that person and the rest at the association', async () => {
    const { f, anna, draft, item, notice } = await handover();
    const data = await run(f, '2026-06-30');
    expect(data.date).toBe('2026-06-30');
    expect(data.groups.at(-1)!.userId).toBeNull();
    const own = data.groups.find((g) => g.userId === anna)!;
    expect(own.items).toEqual([expect.objectContaining({ kind: 'draftEntry', refId: draft.id, amountCents: -2500 })]);
    const association = data.groups.find((g) => g.userId === null)!;
    expect(association.items.find((i) => i.kind === 'openItem')).toMatchObject({ refId: item.id, contactName: expect.stringContaining('Musterspenderin'), dueOn: '2026-04-30', overdue: true, amountCents: 7000 });
    expect(association.items.find((i) => i.kind === 'partnerProof')).toMatchObject({ refNumber: 'PZ-2026-998', dueOn: '2026-02-01', overdue: true });
    expect(association.items.find((i) => i.kind === 'noticeValidity')).toMatchObject({ refId: notice.id, dueOn: expect.stringMatching(/^20\d\d-01-05$/), overdue: false });
  });

  it('judges overdue by the chosen day', async () => {
    const { f } = await handover();
    const early = await run(f, '2026-04-15');
    const association = early.groups.find((g) => g.userId === null)!;
    expect(association.items.find((i) => i.kind === 'openItem')).toMatchObject({ overdue: false });
  });

  it('names people on paper, the association last', async () => {
    const { f } = await handover();
    const typst = handoverListTypst(await run(f, '2026-06-30'), renderContextInternal(f.deps));
    expect(typst.indexOf('Anna Amtsträgerin')).toBeGreaterThan(-1);
    expect(typst.indexOf('Anna Amtsträgerin')).toBeLessThan(typst.indexOf('Verein'));
  });

  it('refuses a day outside every fiscal year', async () => {
    const { f } = await handover();
    expect(err(await runFinanceReport(f.deps, f.ctx, { report: 'handoverList', params: { date: '2030-01-01' } }))).toMatchObject({ type: 'notFound' });
    expect(err(await runFinanceReport(f.deps, f.ctx, { report: 'handoverList', params: { fiscalYearId: f.year.id } }))).toMatchObject({ type: 'validation' });
  });

  it('names the text of a draft and sums the rates of one person in one row (Designer Runde 7, 268)', async () => {
    const { f, anna } = await handover();
    for (const [itemDate, dueOn] of [['2026-01-01', '2026-01-15'], ['2026-02-01', '2026-02-15'], ['2026-06-01', '2026-07-15']]) {
      unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate, contactId: f.wrongDonor.id, amountCents: 500, dueOn, originType: 'testRates', originId: itemDate }));
    }
    const data = await run(f, '2026-06-30');
    expect(data.groups.find((g) => g.userId === anna)!.items[0]).toMatchObject({ kind: 'draftEntry', text: 'Offen' });
    const rows = data.groups.find((g) => g.userId === null)!.items.filter((i) => i.kind === 'openItem' && i.count);
    expect(rows).toEqual([expect.objectContaining({ count: 3, overdueCount: 2, amountCents: 1500, dueOn: '2026-01-15', overdue: true })]);
    const typst = handoverListTypst(data, renderContextInternal(f.deps));
    expect(typst).toContain('3 Raten, davon 2 überfällig');
    expect(typst).toContain('Offen');
  });
});
