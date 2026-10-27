import { newId, schema, unwrap } from '@kompass/core';
import { auditEntry, ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { deadlineOrder, listFinanceDeadlines } from '../src/closing/deadlines';
import { recordVatFiling } from '../src/reporting/vat-filing';
import { setDatedValue } from '../src/ledger/dated-values';
import { saveNotice } from '../src/donations/notices';
import { bookEntry } from '../src/ledger/finalize';
import { financeAuditAuditors, financePartnerProfiles } from '../src/schema';
import { fileAuditReportScan } from '../src/auditing/filing';
import { createAuditReportDraft, markAuditReportReadyToSign, saveAuditReportExamination, saveAuditReportResult } from '../src/auditing/report';
import { saveAssemblyResult } from '../src/closing/assembly';
import { auditFixture } from './auditing-fixture';
import { ledgerFixture, pdfBytes } from './helpers';
import { insertPaidPartnerPayment, insertPartner, insertPartnerNotice } from './partner-fixture';

const code = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : ((r.error as { code?: string; type: string }).code ?? (r.error as { type: string }).type));
const notice = { kind: 'exemptionNotice', taxOffice: 'Finanzamt Musterstadt', taxNumber: '99/999/99999', noticeDate: '2021-12-01', exemptFrom: '2019-01-01', assessmentPeriod: '2019–2020', purposesText: 'Förderung des Sports' } as const;

describe('Finanzfristen (Rechenschaft C, Finanz-Spec § 9.7)', () => {
  it('lists the expiry of the notice from six months before, sorted, overdue in the past; needs finance.overview', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    expect(unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed).toEqual([]);
    const saved = unwrap(await saveNotice(f.deps, f.ctx, notice));
    const { computed } = unwrap(await listFinanceDeadlines(f.deps, f.ctx, {}));
    expect(computed).toEqual([{ key: `noticeExpiry:${saved.id}`, kind: 'noticeExpiry', dueOn: '2026-12-01', overdue: false, params: {}, href: '/finance/donations/notices' }]);
    expect(code(await listFinanceDeadlines(f.deps, ctxWith(['finance.expensesSubmit'], f.userId), {}))).toBe('forbidden');
  });

  it('reports partner proofs overdue only after the grace days', async () => {
    const f = await ledgerFixture({ years: ['2026'] });
    const partnerId = insertPartner(f.deps.db, { contactId: f.rightDonor.id });
    // Gezahlt am 2026-06-01, übliche Frist drei Monate: fällig am 2026-09-01; Kulanz 30 Tage (Vorgabe).
    f.deps.db.update(financePartnerProfiles).set({ usualProofMonths: 3 }).run();
    await insertPaidPartnerPayment(f, partnerId, f.rightDonor.id, '2026-06-01', { number: 'PZ-2026-0001' });
    f.deps.clock.set('2026-09-15T10:00:00.000Z');
    expect(unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed.find((d) => d.kind === 'partnerProof')).toMatchObject({ dueOn: '2026-09-01', overdue: false });
    f.deps.clock.set('2026-10-02T10:00:00.000Z');
    expect(unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed.find((d) => d.kind === 'partnerProof')).toMatchObject({ dueOn: '2026-09-01', overdue: true });
  });

  it('suggests taking a copy of a new notice to the bank', async () => {
    const f = await ledgerFixture();
    expect(unwrap(await saveNotice(f.deps, f.ctx, notice)).suggestions).toEqual([{ key: 'noticeToBank' }]);
  });

  it('partner proofs and expiring notices of active partners — names only with finance.read; confirmations to correct without a date', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    const partnerId = insertPartner(f.deps.db, { contactId: f.rightDonor.id });
    // Gezahlt am 2026-01-10, übliche Frist des Partners: drei Monate.
    f.deps.db.update(financePartnerProfiles).set({ usualProofMonths: 3 }).run();
    await insertPaidPartnerPayment(f, partnerId, f.rightDonor.id, '2026-01-10', { number: 'PZ-2026-0001' });
    insertPartnerNotice(f.deps.db, partnerId, { kind: 'exemptionNotice', noticeDate: '2021-10-01', validUntil: '2026-10-01' });
    const reader = unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed;
    expect(reader.find((d) => d.kind === 'partnerProof')).toMatchObject({ dueOn: '2026-04-10', overdue: true, params: { number: 'PZ-2026-0001', partner: 'Richtigspenderin' }, href: `/finance/partners/${partnerId}` });
    expect(reader.find((d) => d.kind === 'recipientNoticeExpiry')).toMatchObject({ dueOn: '2026-10-01', overdue: false, params: { partner: 'Richtigspenderin' } });
    const overview = unwrap(await listFinanceDeadlines(f.deps, ctxWith(['finance.overview'], f.userId), {})).computed;
    expect(overview.find((d) => d.kind === 'partnerProof')!.params).toEqual({ number: 'PZ-2026-0001' });
    expect(overview.find((d) => d.kind === 'recipientNoticeExpiry')!.params).toEqual({});
    expect([...reader].sort(deadlineOrder)).toEqual(reader);
  });

  it('orders overdue first, then by date, undated last (295)', () => {
    const d = (key: string, dueOn: string | null, overdue = false) => ({ key, dueOn, overdue });
    const sorted = [d('none', null), d('later', '2026-12-01'), d('due', '2026-01-01', true), d('soon', '2026-07-01')].sort(deadlineOrder);
    expect(sorted.map((x) => x.key)).toEqual(['due', 'soon', 'later', 'none']);
  });

  it('an open auditor access after the filed report is due by the assembly day', async () => {
    const a = await auditFixture();
    const { f } = a;
    expect(unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed.filter((d) => d.kind === 'auditorAccess')).toEqual([]);
    const draft = unwrap(await createAuditReportDraft(f.deps, a.mira.ctx, { fiscalYearId: a.y2025, kind: 'report' }));
    unwrap(await saveAuditReportExamination(f.deps, a.mira.ctx, { reportId: draft.id, dates: ['2026-02-18'] }));
    unwrap(await saveAuditReportResult(f.deps, a.mira.ctx, { reportId: draft.id, result: 'clean' }));
    unwrap(await markAuditReportReadyToSign(f.deps, a.mira.ctx, { reportId: draft.id }));
    unwrap(await fileAuditReportScan(f.deps, a.mira.ctx, { reportId: draft.id, bytes: pdfBytes() }));
    expect(unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed.filter((d) => d.kind === 'auditorAccess')).toEqual([{ key: `auditorAccess:${a.y2025}`, kind: 'auditorAccess', dueOn: null, overdue: false, params: { designation: '2025', count: 1 }, href: `/finance/audit?year=${a.y2025}` }]);
    unwrap(await saveAssemblyResult(f.deps, f.ctx, { fiscalYearId: a.y2025, assemblyOn: '2026-03-14', dischargeMode: 'collective', collectiveOutcome: 'granted' }));
    expect(unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed.find((d) => d.kind === 'auditorAccess')).toMatchObject({ dueOn: '2026-03-14', overdue: true });
    f.deps.db.update(financeAuditAuditors).set({ accessEndedAt: '2026-03-15T00:00:00.000Z' }).run();
    expect(unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed.filter((d) => d.kind === 'auditorAccess')).toEqual([]);
  });

  it('VAT return after § 18 (4a) UStG: due on 31 July of the next year, gone once filed', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'], entrepreneur: true });
    const services = f.programCosts;
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-05-01', text: 'Leistung aus dem Ausland', moneyLines: [{ accountId: f.bank.id, amountCents: -10000 }], allocationLines: [{ categoryId: services.id, amountCents: -10000, taxCode: 'rc13bEu' }] }));
    const y2025 = f.years['2025']!.id;
    expect(unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed.filter((d) => d.kind === 'vatReturn')).toEqual([{ key: 'vatReturn:2025', kind: 'vatReturn', dueOn: '2026-07-31', overdue: true, params: { year: '2025' }, href: `/finance/reports/vatSummary?year=${y2025}`, fileableFrom: '2026-01-01' }]);
    expect(code(await recordVatFiling(f.deps, f.ctx, { period: '2026', filedOn: '2026-09-01' }))).toBe('vatReturnNotDue');
    expect(code(await recordVatFiling(f.deps, f.ctx, { period: '2025', filedOn: '2026-12-01' }))).toBe('validation');
    expect(code(await recordVatFiling(f.deps, ctxWith(['finance.read'], f.userId), { period: '2025', filedOn: '2026-07-20' }))).toBe('forbidden');
    unwrap(await recordVatFiling(f.deps, f.ctx, { period: '2025', filedOn: '2026-07-20' }));
    expect(JSON.parse(auditEntry(f.deps, 'finance.vatFiling.record').params!)).toEqual({ period: '2025', filedOn: '2026-07-20', amendment: false });
    expect(unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed.filter((d) => d.kind === 'vatReturn')).toEqual([]);
  });

  it('follow-ups at finance records with followUps.view, and the suggestion to plan the closing before the assembly', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    const y2025 = f.years['2025']!.id;
    const none = unwrap(await listFinanceDeadlines(f.deps, f.ctx, {}));
    expect(none.followUps).toBeNull();
    expect(none.suggestions).toEqual([{ key: 'closeBeforeAssembly', fiscalYearId: y2025, designation: '2025' }]);
    const ctx = ctxWith([...f.ctx.permissions, 'followUps.view', 'followUps.manage'], f.userId);
    f.deps.db.insert(schema.followUps).values({ id: newId(), entityType: 'financeFiscalYear', entityId: y2025, dueAt: '2026-03-01', title: 'Jahresabschluss vor der Mitgliederversammlung', createdByUserId: f.userId, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }).run();
    f.deps.db.insert(schema.followUps).values({ id: newId(), entityType: 'contact', entityId: f.donor.id, dueAt: '2026-03-01', title: 'Anrufen', createdByUserId: f.userId, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }).run();
    f.deps.db.insert(schema.followUps).values({ id: newId(), entityType: 'financeFiscalYear', entityId: y2025, dueAt: '2026-01-01', title: 'Erledigt vor langer Zeit', createdByUserId: f.userId, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', doneAt: '2026-02-01T00:00:00.000Z', doneByUserId: f.userId }).run();
    const res = unwrap(await listFinanceDeadlines(f.deps, ctx, {}));
    expect(res.followUps!.map((x) => x.title)).toEqual(['Jahresabschluss vor der Mitgliederversammlung']);
    expect(res.suggestions).toEqual([]);
  });
});

describe('Umsatzsteuer-Fristen (Plan E6a Task 6)', () => {
  const rc = (f: Awaited<ReturnType<typeof ledgerFixture>>, date: string, serviceDate?: string) =>
    bookEntry(f.deps, f.ctx, { entryDate: date, text: 'Werbung', moneyLines: [{ accountId: f.bank.id, amountCents: -20000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -20000, taxCode: 'rc13bEu', ...(serviceDate ? { serviceDate } : {}) }] }).then(unwrap);
  const vat = async (f: Awaited<ReturnType<typeof ledgerFixture>>) => unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed.filter((d) => d.kind.startsWith('vat')).map((d) => [d.key, d.dueOn]);

  it('lists advance returns, annual returns and amendments', async () => {
    const f = await ledgerFixture({ entrepreneur: true });
    f.deps.clock.set('2026-10-25T10:00:00.000Z');
    expect(await vat(f)).toEqual([]);
    await rc(f, '2026-05-12');
    const all = unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed;
    expect(all.find((d) => d.key === 'vatAdvanceReturn:2026-Q2')).toMatchObject({ kind: 'vatAdvanceReturn', dueOn: '2026-07-10', overdue: true, params: { vatPeriod: '2026-Q2' }, href: '/finance/vat?period=2026-Q2' });
    expect(await vat(f)).toEqual([['vatAdvanceReturn:2026-Q2', '2026-07-10'], ['vatReturn:2026', '2027-08-02']]);
    unwrap(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q2', filedOn: '2026-07-08' }));
    expect(await vat(f)).toEqual([['vatReturn:2026', '2027-08-02']]);
    f.deps.clock.set('2026-07-20T10:00:00.000Z');
    const late = await rc(f, '2026-07-20', '2026-05-30');
    f.deps.clock.set('2026-10-25T10:00:00.000Z');
    // Die Berichtigung steht vor allen datierten Fristen, auch vor überfälligen (Board 5a).
    expect(await vat(f)).toEqual([['vatAmendment:2026-Q2', null], ['vatReturn:2026', '2027-08-02']]);
    const keys = unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed.map((d) => d.key);
    expect(keys[0]).toBe('vatAmendment:2026-Q2');
    expect(unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed.find((d) => d.kind === 'vatAmendment')!.params).toEqual({ vatPeriod: '2026-Q2', scope: 'advance', entryNumber: late.number!, change: 'booked', changedOn: '2026-07-20', more: 0 });
  });

  it('lists every quarter under regular taxation', async () => {
    const f = await ledgerFixture();
    f.deps.clock.set('2026-10-25T10:00:00.000Z');
    unwrap(await setDatedValue(f.deps, f.ctx, { key: 'taxation', validFrom: '2026-01-01', value: 'regular' }));
    expect((await vat(f)).map(([key]) => key)).toEqual(['vatAdvanceReturn:2026-Q1', 'vatAdvanceReturn:2026-Q2', 'vatAdvanceReturn:2026-Q3', 'vatAdvanceReturn:2026-Q4', 'vatReturn:2026']);
  });
});
