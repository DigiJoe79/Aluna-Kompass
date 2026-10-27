import { newId, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { bookEntry } from '../src/ledger/finalize';
import { justifyUndocumentedEntry } from '../src/ledger/period';
import { listVouchersWithoutEntry, uploadVoucher } from '../src/ledger/vouchers';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { renderContextInternal } from '../src/reporting/finalize';
import { voucherCheckTypst, type VoucherCheckReport } from '../src/reporting/reports/voucher-check';
import { runFinanceReport } from '../src/reporting/service';
import { financeEntryDocuments } from '../src/schema';
import { insertDocument, ledgerFixture, pdfBytes } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

async function withVouchers() {
  const f = await ledgerFixture();
  const book = (date: string, cents: number) =>
    bookEntry(f.deps, f.ctx, { entryDate: date, text: 'Ausgabe', moneyLines: [{ accountId: f.bank.id, amountCents: cents }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: cents, taxCode: 'none' }] }).then(unwrap);
  const without = await book('2026-02-01', -20000);
  const justified = await book('2026-02-02', -30000);
  unwrap(await justifyUndocumentedEntry(f.deps, f.ctx, { entryId: justified.id, note: 'Beleg beim Partner verloren' }));
  const a = await book('2026-03-01', -1000);
  const b = await book('2026-03-02', -1000);
  const voucher = unwrap(await uploadVoucher(f.deps, f.ctx, { entryId: a.id, bytes: pdfBytes(), typeKey: 'voucher-invoice', documentDate: '2026-03-01' }));
  f.deps.db.insert(financeEntryDocuments).values({ id: newId(), entryId: b.id, documentId: voucher.documentId, documentNumber: voucher.documentNumber, documentChecksum: null, addedAt: '2026-03-02T10:00:00.000Z', addedByUserId: f.userId }).run();
  const loose = insertDocument(f, { subject: 'Rechnung Futter' });
  return { f, without, justified, a, b, loose };
}

describe('Bericht voucherCheck (Rechenschaft B1 Task 8)', () => {
  it('lists entries without voucher, vouchers without entry and reused evidence', async () => {
    const { f, without, justified, a, b, loose } = await withVouchers();
    const data = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'voucherCheck', params: { fiscalYearId: f.year.id } })).data as VoucherCheckReport;
    expect(data.withoutVoucher.map((e) => [e.entryId, e.justification])).toEqual([[without.id, null], [justified.id, 'Beleg beim Partner verloren']]);
    expect(data.withoutVoucher[0]).toMatchObject({ entryNumber: without.number, entryDate: '2026-02-01', amountCents: -20000 });
    expect(data.reusedEvidence.map((g) => g.uses.map((u) => u.refId))).toEqual([[a.id, b.id]]);

    const reader = ctxWith([...FINANCE_PERMISSIONS, 'dms.view'], f.userId);
    const listed = unwrap(await listVouchersWithoutEntry(f.deps, reader, {})).documents.filter((d) => d.documentDate >= '2026-01-01' && d.documentDate <= '2026-12-31');
    expect(data.vouchersWithoutEntry.map((d) => d.documentId).sort()).toEqual(listed.map((d) => d.id).sort());
    expect(data.vouchersWithoutEntry).toEqual([{ documentId: loose, number: expect.stringMatching(/^DOC-/), documentDate: '2026-03-01', typeKey: 'voucher-invoice', subject: 'Rechnung Futter' }]);
    const typst = voucherCheckTypst(data, renderContextInternal(f.deps));
    expect(typst).toContain('Mehrfach verwendete Nachweise');
  });

  it('is refused to overview readers', async () => {
    const { f } = await withVouchers();
    expect(err(await runFinanceReport(f.deps, ctxWith(['finance.overview'], f.userId), { report: 'voucherCheck', params: { fiscalYearId: f.year.id } }))).toEqual({ type: 'forbidden', permission: 'finance.read' });
  });

  it('groups reused evidence per proof with its number as head row; „Vorgang“ only when kinds differ', () => {
    const use = (kind: 'voucher' | 'partnerEvidence', refNumber: string, date: string, documentNumber: string) => ({ kind, refId: refNumber, refNumber, date, documentId: documentNumber, documentNumber });
    const year = { id: 'y', designation: '2025', startsOn: '2025-01-01', endsOn: '2025-12-31' } as VoucherCheckReport['year'];
    const base: VoucherCheckReport = { year, withoutVoucher: [], vouchersWithoutEntry: [], reusedEvidence: [{ key: 'a', checksum: null, uses: [use('voucher', '2025-0002', '2025-04-15', 'QTG-2026-001'), use('voucher', '2026-0004', '2026-02-20', 'QTG-2026-001')] }] };
    const paper = voucherCheckTypst(base);
    expect(paper).toContain('table.cell(colspan: 2)[*#"QTG-2026-001"');
    expect(paper).not.toContain('#"Vorgang"');
    expect(paper).not.toContain('—');
    const mixed = voucherCheckTypst({ ...base, reusedEvidence: [{ key: 'b', checksum: 'x', uses: [use('partnerEvidence', 'PZ-1', '2025-04-15', 'NW-1'), use('partnerEvidence', 'PZ-2', '2025-05-15', 'NW-2'), use('voucher', '2025-0009', '2025-06-01', 'NW-2')] }] });
    expect(mixed).toContain('#"Vorgang"');
    expect(mixed).toContain('table.cell(colspan: 3)[*#"NW-1 · NW-2');
  });
});
