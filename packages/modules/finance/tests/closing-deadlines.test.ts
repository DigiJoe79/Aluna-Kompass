import { newId, schema, unwrap, type Result } from '@kompass/core';
import { auditEntry, ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { deadlineOrder, listFinanceDeadlines, type FinanceDeadlines } from '../src/closing/deadlines';
import { FINANCE_MCP_TOOLS } from '../src/mcp-tools';
import { saveFundsUseOpening } from '../src/allocation/funds-use-openings';
import type { FundsUseReport } from '../src/reporting/reports/funds-use';
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

describe('Verwendungsfrist je Rückstand (M2 Task 3)', () => {
  async function setup() {
    const f = await ledgerFixture({ years: ['2024', '2025', '2026'] });
    const y = (d: string) => f.years[d]!.id;
    const book = (date: string, cents: number) =>
      bookEntry(f.deps, f.ctx, cents > 0
        ? { entryDate: date, text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: cents }], allocationLines: [{ categoryId: f.donations.id, amountCents: cents }] }
        : { entryDate: date, text: 'Projektkosten', moneyLines: [{ accountId: f.bank.id, amountCents: cents }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: cents }] }).then(unwrap);
    const timely = async () => unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed.filter((d) => d.kind === 'timelyUse' || d.kind === 'timelyUseLapsed');
    return { f, y, book, timely };
  }

  it('a backlog from a year above the limit becomes a deadline', async () => {
    const { f, y, book, timely } = await setup();
    await book('2024-03-01', 5_000_000);
    await book('2024-04-01', -4_900_000);
    f.closeYear(y('2024'));
    expect(await timely()).toEqual([{ key: `timelyUse:fy:${y('2024')}`, kind: 'timelyUse', dueOn: '2026-12-31', overdue: false, params: { origin: '2024', restCents: 100_000 }, href: `/finance/fund-use?year=${y('2026')}` }]);
  });

  it('it disappears when the money is used', async () => {
    const { f, y, book, timely } = await setup();
    await book('2024-03-01', 5_000_000);
    await book('2024-04-01', -4_900_000);
    f.closeYear(y('2024'));
    await book('2026-03-01', -100_000);
    expect(await timely()).toEqual([]);
  });

  it('an open year below the limit keeps the deadline; closing it leaves a note', async () => {
    const { f, y, book, timely } = await setup();
    await book('2024-03-01', 5_000_000);
    await book('2024-04-01', -4_900_000);
    f.closeYear(y('2024'));
    await book('2025-03-01', 1_000);
    expect((await timely()).map((d) => d.kind)).toEqual(['timelyUse']);
    f.closeYear(y('2025'));
    expect(await timely()).toEqual([{ key: `timelyUseLapsed:fy:${y('2024')}`, kind: 'timelyUseLapsed', dueOn: null, overdue: false, params: { origin: '2024', lapsedIn: '2025' }, href: `/finance/fund-use?year=${y('2025')}` }]);
    f.deps.clock.set('2027-02-01T10:00:00.000Z');
    f.closeYear(y('2026'));
    expect(await timely()).toEqual([]);
  });

  it('no deadline below the limit', async () => {
    const { f, y, book, timely } = await setup();
    await book('2024-03-01', 4_500_000);
    f.closeYear(y('2024'));
    expect(await timely()).toEqual([]);
  });

  it('overdue after the due day', async () => {
    const { f, y, book, timely } = await setup();
    await book('2024-03-01', 5_000_000);
    await book('2024-04-01', -4_900_000);
    await book('2025-03-01', 5_000_000);
    await book('2026-03-01', 10_000_001);
    for (const d of ['2024', '2025']) f.closeYear(y(d));
    f.deps.clock.set('2027-01-15T10:00:00.000Z');
    const due = (await timely()).find((d) => d.params.origin === '2024')!;
    expect(due).toMatchObject({ kind: 'timelyUse', dueOn: '2026-12-31', overdue: true, params: { restCents: 100_000 } });
  });

  it('finance_deadlines carries the same entries', async () => {
    const { f, y, book } = await setup();
    await book('2024-03-01', 5_000_000);
    await book('2024-04-01', -4_900_000);
    f.closeYear(y('2024'));
    const tool = FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_deadlines')!;
    const viaMcp = unwrap((await tool.handler(f.deps, f.ctx, {})) as Result<FinanceDeadlines>);
    expect(viaMcp.computed).toEqual(unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed);
    expect(viaMcp.computed.map((d) => d.kind)).toContain('timelyUse');
  });

  it('finance_report and finance_deadlines say the same for an open year not above the limit (M2, Abnahme)', async () => {
    const { f, y, book } = await setup();
    await book('2024-03-01', 5_000_000);
    await book('2024-04-01', -4_900_000);
    f.closeYear(y('2024'));
    await book('2025-03-01', 1_000);
    const tool = (name: string) => FINANCE_MCP_TOOLS.find((t) => t.name === name)!;
    const deadlines = unwrap((await tool('finance_deadlines').handler(f.deps, f.ctx, {})) as Result<FinanceDeadlines>).computed.filter((d) => d.kind === 'timelyUse');
    const fromDeadlines = deadlines.map((d) => ({ origin: d.params.origin, restCents: d.params.restCents, dueOn: d.dueOn }));
    expect(fromDeadlines).toEqual([{ origin: '2024', restCents: 100_000, dueOn: '2026-12-31' }]);
    const run = unwrap((await tool('finance_report').handler(f.deps, f.ctx, { report: 'fundsUse', params: { fiscalYearId: y('2026') } })) as Result<{ data: FundsUseReport }>);
    const fromReport = run.data.partA.buckets.filter((b) => b.originKey !== `fy:${y('2026')}` && b.originRequired && b.restCents > 0 && b.state !== 'lapsed').map((b) => ({ origin: b.originDesignation, restCents: b.restCents, dueOn: b.dueBy }));
    expect(fromReport).toEqual(fromDeadlines);
  });

  it('a backlog from an opening gets its deadline and lapses after a closed year not above the limit', async () => {
    const { f, y, book, timely } = await setup();
    f.deps.clock.set('2025-06-01T10:00:00.000Z');
    unwrap(await saveFundsUseOpening(f.deps, f.ctx, { offset: 1, designation: '2023', endsOn: '2023-12-31', revenueCents: 5_200_000, amountCents: 300_000, upload: { bytes: pdfBytes(), fileName: 'mvr-2023.pdf', documentDate: '2024-02-01' } }));
    expect(await timely()).toEqual([{ key: 'timelyUse:opening:1', kind: 'timelyUse', dueOn: '2025-12-31', overdue: false, params: { origin: '2023', restCents: 300_000 }, href: `/finance/fund-use?year=${y('2025')}` }]);
    await book('2024-03-01', 1_000);
    f.closeYear(y('2024'));
    expect(await timely()).toEqual([{ key: 'timelyUseLapsed:opening:1', kind: 'timelyUseLapsed', dueOn: null, overdue: false, params: { origin: '2023', lapsedIn: '2024' }, href: `/finance/fund-use?year=${y('2024')}` }]);
  });

  it('an opening from a year not above the limit brings no deadline', async () => {
    const { f, timely } = await setup();
    f.deps.clock.set('2025-06-01T10:00:00.000Z');
    unwrap(await saveFundsUseOpening(f.deps, f.ctx, { offset: 1, designation: '2023', endsOn: '2023-12-31', revenueCents: 4_500_000, amountCents: 300_000, upload: { bytes: pdfBytes(), fileName: 'mvr-2023.pdf', documentDate: '2024-02-01' } }));
    expect(await timely()).toEqual([]);
  });
});
