import { newId, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { getAuditSection } from '../src/auditing/sections';
import { getAuditStatus } from '../src/auditing/status';
import { bookEntry } from '../src/ledger/finalize';
import { justifyUndocumentedEntry } from '../src/ledger/period';
import { confirmAccountForYear, fileAccountStatementDocument } from '../src/ledger/statement-documents';
import { revokeVoucher, uploadVoucher } from '../src/ledger/vouchers';
import { financeImportCandidates, financePartnerPayments, financePartnerProfiles } from '../src/schema';
import { auditFixture } from './auditing-fixture';
import { insertDocument, insertRaw, insertRun, pdfBytes } from './helpers';

const rowsOf = async (f: Awaited<ReturnType<typeof auditFixture>>['f'], ctx: Parameters<typeof getAuditSection>[1], fiscalYearId: string, section: string) => unwrap(await getAuditSection(f.deps, ctx, { fiscalYearId, section, limit: 200 })).rows;

async function prepared() {
  const a = await auditFixture({ close: false });
  const { f } = a;
  const book = async (date: string, cents: number, opts: { contactId?: string; categoryId?: string; purposeId?: string } = {}) =>
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: date, text: 'Buchung', moneyLines: [{ accountId: f.bank.id, amountCents: cents }], allocationLines: [{ categoryId: opts.categoryId ?? f.donations.id, amountCents: cents, ...(opts.contactId ? { contactId: opts.contactId } : {}), ...(opts.purposeId ? { purposeId: opts.purposeId } : {}) }] }));
  const donation = await book('2025-02-01', 5000, { contactId: f.donor.id });
  const missing = await book('2025-03-01', -1200, { categoryId: f.programCosts.id });
  const justified = await book('2025-03-02', -900, { categoryId: f.programCosts.id });
  unwrap(await justifyUndocumentedEntry(f.deps, f.ctx, { entryId: justified.id, note: 'Quittung verloren' }));
  const own = await book('2025-04-01', -500, { categoryId: f.programCosts.id });
  unwrap(await uploadVoucher(f.deps, f.ctx, { entryId: own.id, bytes: pdfBytes(), typeKey: 'voucher-own', documentDate: '2025-04-01' }));
  const revoked = await book('2025-05-01', -700, { categoryId: f.programCosts.id });
  const voucher = unwrap(await uploadVoucher(f.deps, f.ctx, { entryId: revoked.id, bytes: pdfBytes(), typeKey: 'voucher-invoice', documentDate: '2025-05-01' }));
  unwrap(await uploadVoucher(f.deps, f.ctx, { entryId: revoked.id, bytes: pdfBytes(), typeKey: 'voucher-invoice', documentDate: '2025-05-02' }));
  unwrap(await revokeVoucher(f.deps, f.ctx, { linkId: voucher.linkId, note: 'Doppelt' }));
  const loose = insertDocument(f, { subject: 'Rechnung ohne Buchung' });
  f.deps.sqlite.prepare("update documents set document_date = '2025-06-01' where id = ?").run(loose);
  const purposed = await book('2025-06-10', 3000, { purposeId: f.abroadPurpose.id, contactId: f.donor.id });
  // Importabgleich: eine Dubletten-Entscheidung, ein offener Umsatz.
  const runId = insertRun(f, f.bank.id);
  f.deps.db.insert(financeImportCandidates).values({ id: newId(), runId, accountId: f.bank.id, line: JSON.stringify({ bookingDate: '2025-07-01', amountCents: 4200, counterpartyName: 'Erika Beispiel', purpose: 'Spende' }), dedupKey: 'k1', decision: 'same', decidedAt: '2025-07-02T00:00:00.000Z', decidedByUserId: f.userId }).run();
  insertRaw(f, runId, { accountId: f.bank.id, amountCents: 1500, date: '2025-08-01' });
  // Partnerzahlung, im Jahr freigegeben, Nachweis offen.
  const partnerId = newId();
  f.deps.db.insert(financePartnerProfiles).values({ id: partnerId, contactId: f.rightDonor.id, status: 'taxExemptBody', createdAt: 'x', createdByUserId: f.userId, updatedAt: 'x' }).run();
  f.deps.sqlite.pragma('foreign_keys = OFF');
  f.deps.db.insert(financePartnerPayments).values({ id: newId(), number: 'PZ-2025-0001', partnerId, basis: 'transfer58', state: 'approved', approvedAt: '2025-09-01T10:00:00.000Z', approvedByUserId: f.userId, proofDueOn: '2025-10-01', createdByUserId: f.userId, createdAt: 'x', updatedAt: 'x' } as never).run();
  f.deps.sqlite.pragma('foreign_keys = ON');
  f.closeYear(a.y2025);
  return { ...a, donation, missing, justified, own, revoked, loose, purposed };
}

describe('getAuditSection', () => {
  it('reconciliation names the statement pdf of a bank account: covers, missing or justified with its reason', async () => {
    const { f, mira, y2025 } = await prepared();
    const bankRow = async () => (await rowsOf(f, mira.ctx, y2025, 'reconciliation')).find((r) => r.labelParams.accountName === 'Vereinskonto')!;
    expect((await bankRow()).labelParams).toMatchObject({ statement: 'missing' });
    expect((await rowsOf(f, mira.ctx, y2025, 'reconciliation')).find((r) => r.labelParams.accountName === 'Barkasse')!.labelParams.statement).toBeUndefined();
    unwrap(await confirmAccountForYear(f.deps, f.ctx, { fiscalYearId: y2025, accountId: f.bank.id, kind: 'missingJustified', note: 'Bank schickt nur Papier' }));
    expect((await bankRow()).labelParams).toMatchObject({ statement: 'justified', justification: 'Bank schickt nur Papier' });
    unwrap(await fileAccountStatementDocument(f.deps, f.ctx, { accountId: f.bank.id, periodTo: '2025-12-31', bytes: pdfBytes() }));
    expect((await bankRow()).labelParams.statement).toBe('covers');
  });

  it('journal: the final entries of the year with number, text, category or purpose, account and state', async () => {
    const { f, mira, y2025, donation, purposed } = await prepared();
    const rows = await rowsOf(f, mira.ctx, y2025, 'journal');
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ kind: 'entry', entryId: donation.id, date: '2025-02-01', amountCents: 5000, labelParams: { number: donation.number, text: 'Buchung', purposeOrCategory: f.donations.name, accountName: 'Vereinskonto', state: 'final' }, remarksOpen: 0 });
    expect(rows.find((r) => r.entryId === purposed.id)!.labelParams.purposeOrCategory).toBe('Partnerprojekt Ausland');
    const paged = unwrap(await getAuditSection(f.deps, mira.ctx, { fiscalYearId: y2025, section: 'journal', limit: 2, offset: 2 }));
    expect(paged).toMatchObject({ total: 6, reviewedBy: [] });
    expect(paged.rows).toHaveLength(2);
  });

  it('reconciliation, vouchers, imports, purposes, donations, partner payments', async () => {
    const { f, mira, y2025, missing, justified, own, revoked, loose } = await prepared();
    expect((await rowsOf(f, mira.ctx, y2025, 'reconciliation')).map((r) => r.labelParams.accountName).sort()).toEqual(['Barkasse', 'Vereinskonto']);

    const vouchers = await rowsOf(f, mira.ctx, y2025, 'vouchers');
    const reason = (entryOrDoc: string) => vouchers.filter((r) => r.entryId === entryOrDoc || r.documentId === entryOrDoc).map((r) => r.labelParams.reason).sort();
    expect(reason(missing.id)).toEqual(['missing']);
    expect(reason(justified.id)).toEqual(['missingJustified']);
    expect(reason(own.id)).toEqual(['own']);
    expect(reason(revoked.id)).toEqual(['revoked']);
    expect(reason(loose)).toEqual(['withoutEntry']);

    const imports = await rowsOf(f, mira.ctx, y2025, 'imports');
    expect(imports.map((r) => r.labelParams.kind)).toEqual(['decision', 'open']);
    expect(imports[0]).toMatchObject({ amountCents: 4200, labelParams: { decision: 'same', counterparty: 'Erika Beispiel' } });

    const purposes = await rowsOf(f, mira.ctx, y2025, 'purposesReserves');
    expect(purposes).toEqual([expect.objectContaining({ kind: 'purpose', labelParams: expect.objectContaining({ name: 'Partnerprojekt Ausland', inflowCents: 3000, closingCents: 3000 }) })]);

    const donations = await rowsOf(f, mira.ctx, y2025, 'donations');
    expect(donations.map((r) => [r.labelParams.kind, r.labelParams.count, r.amountCents])).toEqual([['total', 2, 8000], ['withoutConfirmation', 2, 8000], ['toCorrect', 0, null]]);

    const partner = await rowsOf(f, mira.ctx, y2025, 'partnerPayments');
    expect(partner).toEqual([expect.objectContaining({ labelParams: expect.objectContaining({ number: 'PZ-2025-0001', partnerName: 'Richtigspenderin', proofState: 'overdue' }) })]);
  });

  it('reads with finance.read or finance.audit, nothing else', async () => {
    const { f, y2025 } = await prepared();
    expect((await getAuditSection(f.deps, ctxWith(['finance.audit']), { fiscalYearId: y2025, section: 'journal' })).ok).toBe(true);
    expect(await getAuditSection(f.deps, ctxWith(['finance.overview']), { fiscalYearId: y2025, section: 'journal' })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await getAuditSection(f.deps, ctxWith(['finance.read']), { fiscalYearId: y2025, section: 'nope' })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });
});

describe('getAuditStatus', () => {
  it('puts baseline, changes, access and the caller together', async () => {
    const { f, mira, y2025, miraAuditor } = await auditFixture();
    const status = unwrap(await getAuditStatus(f.deps, mira.ctx, { fiscalYearId: y2025 }));
    expect(status).toMatchObject({ fiscalYearId: y2025, yearStatus: 'closed', baseline: { kind: 'initial' }, changedEntryIds: [], auditorsWithOpenAccess: 1, me: { auditorId: miraAuditor.id, canEditReport: true }, cashKeepers: [] });
    expect(status.referenceBaselineId).toBe(status.baseline!.id);
    expect(unwrap(await getAuditStatus(f.deps, f.ctx, { fiscalYearId: y2025 })).me).toEqual({ auditorId: null, canEditReport: false });
    expect(await getAuditStatus(f.deps, ctxWith(['finance.overview']), { fiscalYearId: y2025 })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });
});

describe('die Marke an der Zeile trägt den Zustand des Vermerks (Designer Runde 7, 274/275)', () => {
  it('an answered remark is no longer open at its row; the count of unresolved remarks stays the same', async () => {
    const { f, y2025, mira } = await auditFixture({ close: false });
    const entryId = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-04-01', text: 'Buchung', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000 }] })).id;
    f.closeYear(y2025);
    const { createAuditRemark, answerAuditRemark } = await import('../src/auditing/remarks');
    const remark = unwrap(await createAuditRemark(f.deps, mira.ctx, { fiscalYearId: y2025, targetType: 'entry', targetId: entryId, kind: 'question', text: 'Wofür?' }));
    expect((await rowsOf(f, mira.ctx, y2025, 'journal')).find((r) => r.entryId === entryId)).toMatchObject({ remarksOpen: 1, remarksAnswered: 0 });
    unwrap(await answerAuditRemark(f.deps, f.ctx, { remarkId: remark.id, text: 'Für das Fest.' }));
    expect((await rowsOf(f, mira.ctx, y2025, 'journal')).find((r) => r.entryId === entryId)).toMatchObject({ remarksOpen: 0, remarksAnswered: 1 });
    expect(unwrap(await getAuditStatus(f.deps, f.ctx, { fiscalYearId: y2025 })).remarksUnresolved).toBe(1);
  });
});
