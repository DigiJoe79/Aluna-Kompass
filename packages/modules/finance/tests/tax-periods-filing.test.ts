import { unwrap } from '@kompass/core';
import { auditEntry, ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { confirmClosingStep } from '../src/closing/confirmations';
import { listFinanceDeadlines } from '../src/closing/deadlines';
import { getClosingStatus } from '../src/closing/status';
import { saveNotice, voidNotice } from '../src/donations/notices';
import { FINANCE_MCP_TOOLS } from '../src/mcp-tools';
import { createTaxPeriod, linkTaxPeriodNotice, listTaxPeriods, saveTaxPeriodAnswers, updateTaxPeriod } from '../src/ledger/tax-periods';
import { finalizeFinanceReport } from '../src/reporting/finalize';
import { recordVatFiling } from '../src/reporting/vat-filing';
import { bookEntry } from '../src/ledger/finalize';
import { ledgerFixture } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
const fields = (r: { ok: boolean; error?: unknown }) => (r.ok ? [] : ((r.error as { issues?: { path: string; message: string }[] }).issues ?? []).map((i) => `${i.path}:${i.message}`));
const COMPLETE = { churchPurposes: false, charitablePurposes: false, statuteDate: '2022-03-01', statuteSubmission: 'onFile', feeResolution: 'none', welfare: false, hospital: false, sport: false, gratuitousBenefits: false } as const;
const exemption = { kind: 'exemptionNotice', taxOffice: 'Finanzamt Musterstadt', taxNumber: '99/999/99999', noticeDate: '2026-08-01', exemptFrom: '2025-01-01', assessmentPeriod: '2025', purposesText: 'Förderung des Tierschutzes' } as const;

async function setup() {
  const f = await ledgerFixture({ years: ['2024', '2025', '2026'], entrepreneur: true });
  const y = (d: string) => f.years[d]!.id;
  let tick = 0;
  const later = () => f.deps.clock.set(`2026-09-05T09:${String(++tick).padStart(2, '0')}:00.000Z`);
  return { f, y, later };
}

describe('Abgabe der Steuererklärung und Bescheid (Rechenschaft D2 Task 7)', () => {
  it('files only a final version', async () => {
    const { f, y, later } = await setup();
    const period = unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y('2025'), lastFiscalYearId: y('2025'), requestedOn: '2026-01-12', withTaxAdvisor: false, dueOn: '2026-07-31' }));
    expect(err(await updateTaxPeriod(f.deps, f.ctx, { id: period.id, filedOn: '2026-05-31' }))).toMatchObject({ code: 'taxReturnNotFinal', params: { period: '2025' } });
    later();
    unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: period.id, answers: COMPLETE }));
    f.closeYear(y('2025'));
    const version = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'taxReturnGem', params: { taxPeriodId: period.id } }));
    expect(fields(await updateTaxPeriod(f.deps, f.ctx, { id: period.id, filedOn: '2026-12-01' }))).toEqual(['filedOn:inFuture']);
    expect(fields(await updateTaxPeriod(f.deps, f.ctx, { id: period.id, filedOn: '2026-01-01' }))).toEqual(['filedOn:beforeRequested']);
    later();
    const filed = unwrap(await updateTaxPeriod(f.deps, f.ctx, { id: period.id, filedOn: '2026-05-31' }));
    expect(filed).toMatchObject({ filedOn: '2026-05-31', filedReportId: version.reportId, filedReportVoided: false, state: 'filed' });
    expect(JSON.parse(auditEntry(f.deps, 'finance.taxPeriod.filed').params!)).toEqual({ period: '2025', filedOn: '2026-05-31' });
    later();
    const back = unwrap(await updateTaxPeriod(f.deps, f.ctx, { id: period.id, filedOn: null }));
    expect(back).toMatchObject({ filedOn: null, filedReportId: null, state: 'open' });
  });

  it('locks the answers while the return is filed, over the screen and MCP alike (Befund 18c)', async () => {
    const { f, y, later } = await setup();
    const period = unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y('2025'), lastFiscalYearId: y('2025'), withTaxAdvisor: false, dueOn: '2026-07-31' }));
    unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: period.id, answers: COMPLETE }));
    f.closeYear(y('2025'));
    unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'taxReturnGem', params: { taxPeriodId: period.id } }));
    later();
    unwrap(await updateTaxPeriod(f.deps, f.ctx, { id: period.id, filedOn: '2026-05-31' }));
    const changed = { ...COMPLETE, memberCounts: { [y('2025')]: 12 } };
    expect(err(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: period.id, answers: changed }))).toMatchObject({ code: 'taxPeriodFiled', params: { period: '2025' } });
    const tool = FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_tax_period_answers_save')!;
    expect(err(await tool.handler(f.deps, { ...f.ctx, channel: 'mcp' }, { id: period.id, answers: changed }))).toMatchObject({ code: 'taxPeriodFiled' });
    // Die festgeschriebene Fassung bleibt die abgegebene.
    const [listed] = unwrap(await listTaxPeriods(f.deps, f.ctx, {}));
    expect(listed!.answers.memberCounts).toBeUndefined();
    later();
    unwrap(await updateTaxPeriod(f.deps, f.ctx, { id: period.id, filedOn: null }));
    later();
    expect(unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: period.id, answers: changed })).answers.memberCounts).toEqual({ [y('2025')]: 12 });
  });

  it('links the notice after filing', async () => {
    const { f, y, later } = await setup();
    const period = unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y('2025'), lastFiscalYearId: y('2025'), withTaxAdvisor: false, dueOn: '2026-07-31' }));
    const notice = unwrap(await saveNotice(f.deps, f.ctx, exemption));
    expect(err(await linkTaxPeriodNotice(f.deps, f.ctx, { id: period.id, noticeId: notice.id }))).toMatchObject({ code: 'taxPeriodNotFiled' });
    unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: period.id, answers: COMPLETE }));
    f.closeYear(y('2025'));
    unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'taxReturnGem', params: { taxPeriodId: period.id } }));
    later();
    unwrap(await updateTaxPeriod(f.deps, f.ctx, { id: period.id, filedOn: '2026-05-31' }));
    const section60a = unwrap(await saveNotice(f.deps, f.ctx, { kind: 'section60a', taxOffice: 'Finanzamt Musterstadt', taxNumber: '99/999/99999', noticeDate: '2024-02-01', exemptFrom: '2024-02-01', purposesText: 'Förderung des Tierschutzes', purposesTextAccusative: 'den Tierschutz' }));
    expect(fields(await linkTaxPeriodNotice(f.deps, f.ctx, { id: period.id, noticeId: section60a.id }))).toEqual(['noticeId:wrongKind']);
    later();
    const assessed = unwrap(await linkTaxPeriodNotice(f.deps, f.ctx, { id: period.id, noticeId: notice.id }));
    expect(assessed).toMatchObject({ noticeId: notice.id, state: 'assessed' });
    expect(JSON.parse(auditEntry(f.deps, 'finance.taxPeriod.noticeLink').params!)).toEqual({ period: '2025' });
    expect(err(await linkTaxPeriodNotice(f.deps, f.ctx, { id: period.id, noticeId: notice.id, expectedVersion: 'stale' }))).toMatchObject({ code: 'staleVersion' });
    // Die Abgabe lässt sich nicht hinter den Bescheid zurücknehmen (Befund 16 c); andere Angaben bleiben änderbar.
    expect(err(await updateTaxPeriod(f.deps, f.ctx, { id: period.id, filedOn: null }))).toMatchObject({ code: 'taxPeriodNoticeLinked', params: { period: '2025' } });
    const tool = FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_tax_period_update')!;
    expect(err(await tool.handler(f.deps, { ...f.ctx, channel: 'mcp' }, { id: period.id, filedOn: null }))).toMatchObject({ code: 'taxPeriodNoticeLinked' });
    expect(unwrap(await updateTaxPeriod(f.deps, f.ctx, { id: period.id, withTaxAdvisor: true }))).toMatchObject({ filedOn: '2026-05-31', state: 'assessed', withTaxAdvisor: true });
    expect(err(await linkTaxPeriodNotice(f.deps, ctxWith(['finance.read'], f.userId), { id: period.id, noticeId: notice.id }))).toMatchObject({ type: 'forbidden' });
  });

  it('a voided notice does not hold the filing (Befund 17 a)', async () => {
    const { f, y, later } = await setup();
    const period = unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y('2025'), lastFiscalYearId: y('2025'), withTaxAdvisor: false, dueOn: '2026-07-31' }));
    const notice = unwrap(await saveNotice(f.deps, f.ctx, exemption));
    unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: period.id, answers: COMPLETE }));
    f.closeYear(y('2025'));
    unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'taxReturnGem', params: { taxPeriodId: period.id } }));
    later();
    unwrap(await updateTaxPeriod(f.deps, f.ctx, { id: period.id, filedOn: '2026-05-31' }));
    later();
    unwrap(await linkTaxPeriodNotice(f.deps, f.ctx, { id: period.id, noticeId: notice.id }));
    later();
    unwrap(await voidNotice(f.deps, f.ctx, { id: notice.id, note: 'Irrtümlich erfasst' }));
    // Ein stornierter Bescheid trug nie: Der Zeitraum wartet wieder auf den Bescheid, die Abgabe lässt sich zurücknehmen.
    expect(unwrap(await listTaxPeriods(f.deps, f.ctx, {}))[0]).toMatchObject({ state: 'filed' });
    later();
    const tool = FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_tax_period_update')!;
    const back = unwrap(await tool.handler(f.deps, { ...f.ctx, channel: 'mcp' }, { id: period.id, filedOn: null }));
    expect(back).toMatchObject({ filedOn: null, filedReportId: null, noticeId: null, state: 'open' });
  });

  it('shows the deadline of an open period until it is filed', async () => {
    const { f, y, later } = await setup();
    const period = unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y('2024'), lastFiscalYearId: y('2025'), withTaxAdvisor: false, dueOn: '2026-07-31' }));
    const open = unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed.find((d) => d.kind === 'taxReturn');
    expect(open).toEqual({ key: `taxReturn:${period.id}`, kind: 'taxReturn', dueOn: '2026-07-31', overdue: true, params: { period: '2024–2025' }, href: `/finance/tax?period=${period.id}` });
    unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: period.id, answers: COMPLETE }));
    f.closeYear(y('2024'));
    f.closeYear(y('2025'));
    unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'taxReturnGem', params: { taxPeriodId: period.id } }));
    later();
    unwrap(await updateTaxPeriod(f.deps, f.ctx, { id: period.id, filedOn: '2026-07-20' }));
    expect(unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed.filter((d) => d.kind === 'taxReturn')).toEqual([]);
  });
});

describe('Schritt 12 mit dem Erklärungszeitraum (Rechenschaft D2 Task 7)', () => {
  const step12 = async (f: Awaited<ReturnType<typeof setup>>['f'], fiscalYearId: string) => unwrap(await getClosingStatus(f.deps, f.ctx, { fiscalYearId })).steps.find((s) => s.key === 'taxReturn')!;

  it('without a period: confirmable as before', async () => {
    const { f, y } = await setup();
    expect(await step12(f, y('2025'))).toMatchObject({ done: false, confirmable: true, facts: { key: 'taxReturn', period: null } });
    unwrap(await confirmClosingStep(f.deps, f.ctx, { fiscalYearId: y('2025'), step: 'taxReturn', note: 'Erklärung für dieses Jahr nicht fällig' }));
    expect(await step12(f, y('2025'))).toMatchObject({ done: true });
  });

  it('a year of an open period that is not its last is done without confirmation', async () => {
    const { f, y } = await setup();
    const period = unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y('2024'), lastFiscalYearId: y('2025'), withTaxAdvisor: false, dueOn: '2026-07-31' }));
    expect(await step12(f, y('2024'))).toMatchObject({ done: true, confirmable: false, confirmation: null, facts: { period: { id: period.id, label: '2024–2025', dueOn: '2026-07-31', filedOn: null, lastYear: false, last: '2025', overdue: true, notice: null } } });
  });

  it('the last year of an open period waits for the filing and cannot be confirmed', async () => {
    const { f, y } = await setup();
    unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y('2024'), lastFiscalYearId: y('2025'), withTaxAdvisor: false, dueOn: '2026-07-31' }));
    expect(await step12(f, y('2025'))).toMatchObject({ done: false, confirmable: false, facts: { period: { lastYear: true, filedOn: null } } });
    expect(err(await confirmClosingStep(f.deps, f.ctx, { fiscalYearId: y('2025'), step: 'taxReturn', note: 'nicht fällig' }))).toMatchObject({ code: 'closingStepNotConfirmable', params: { step: 12 } });
  });

  it('a year in a filed period is done', async () => {
    const { f, y, later } = await setup();
    const period = unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y('2025'), lastFiscalYearId: y('2025'), withTaxAdvisor: false, dueOn: '2026-07-31' }));
    unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: period.id, answers: COMPLETE }));
    f.closeYear(y('2025'));
    unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'taxReturnGem', params: { taxPeriodId: period.id } }));
    later();
    unwrap(await updateTaxPeriod(f.deps, f.ctx, { id: period.id, filedOn: '2026-05-31' }));
    expect(await step12(f, y('2025'))).toMatchObject({ done: true, confirmable: false, facts: { period: { filedOn: '2026-05-31', lastYear: true, overdue: false, notice: null } } });
    // Mit Bescheid nennt der Schritt Tag und Dokument (Board 15h D).
    const notice = unwrap(await saveNotice(f.deps, f.ctx, exemption));
    later();
    unwrap(await linkTaxPeriodNotice(f.deps, f.ctx, { id: period.id, noticeId: notice.id }));
    expect((await step12(f, y('2025'))).facts).toMatchObject({ period: { notice: { noticeOn: '2026-08-01', documentId: null } } });
  });

  // E11 (Befund 34 a): Eine fällige USt-Jahreserklärung des Kalenderjahres gehört zur Erledigung von Schritt 12.
  const rc13b = async (f: Awaited<ReturnType<typeof setup>>['f']) => {
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-10-01', text: 'Spende', moneyLines: [{ accountId: f.cash.id, amountCents: 15000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 15000 }] }));
    return bookEntry(f.deps, f.ctx, { entryDate: '2025-10-14', text: 'Werbung', moneyLines: [{ accountId: f.cash.id, amountCents: -15000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -15000, taxCode: 'rc13bEu' }] }).then(unwrap);
  };

  it('stays open while a required annual VAT return is not filed, although the tax return is', async () => {
    const { f, y, later } = await setup();
    await rc13b(f);
    const period = unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y('2025'), lastFiscalYearId: y('2025'), withTaxAdvisor: false, dueOn: '2026-07-31' }));
    unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: period.id, answers: COMPLETE }));
    f.closeYear(y('2025'));
    unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'taxReturnGem', params: { taxPeriodId: period.id } }));
    later();
    unwrap(await updateTaxPeriod(f.deps, f.ctx, { id: period.id, filedOn: '2026-05-31' }));
    expect(await step12(f, y('2025'))).toMatchObject({ done: false, confirmable: false, facts: { period: { filedOn: '2026-05-31' }, vat: { calendarYear: 2025, filedOn: null } } });
    later();
    unwrap(await recordVatFiling(f.deps, f.ctx, { period: '2025', filedOn: '2026-09-01' }));
    expect(await step12(f, y('2025'))).toMatchObject({ done: true, facts: { vat: { filedOn: '2026-09-01' } } });
  });

  it('without a period: the confirmation alone does not finish the step while the annual VAT return is due', async () => {
    const { f, y, later } = await setup();
    await rc13b(f);
    unwrap(await confirmClosingStep(f.deps, f.ctx, { fiscalYearId: y('2025'), step: 'taxReturn', note: 'Erklärung für dieses Jahr nicht fällig' }));
    expect(await step12(f, y('2025'))).toMatchObject({ done: false, confirmation: { note: 'Erklärung für dieses Jahr nicht fällig' } });
    later();
    unwrap(await recordVatFiling(f.deps, f.ctx, { period: '2025', filedOn: '2026-09-01' }));
    expect(await step12(f, y('2025'))).toMatchObject({ done: true });
  });

  it('a year that is not the last of an open period still waits for its annual VAT return', async () => {
    const { f, y } = await setup();
    await rc13b(f);
    unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y('2025'), lastFiscalYearId: y('2026'), withTaxAdvisor: false, dueOn: '2027-07-31' }));
    expect(await step12(f, y('2025'))).toMatchObject({ done: false, facts: { period: { lastYear: false }, vat: { calendarYear: 2025 } } });
  });
});

describe('Abgegeben, Fassung zurückgenommen (Designer Runde 7, 318)', () => {
  it('names the filed version once reopening voided it, and forgets it when a new one is finalized', async () => {
    const { f, y, later } = await setup();
    const { getTaxReturn } = await import('../src/reporting/tax-return');
    const { reopenInternal, closeInternal } = await import('../src/ledger/period');
    const { financeFiscalYears } = await import('../src/schema');
    const { eq } = await import('drizzle-orm');
    const period = unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y('2025'), lastFiscalYearId: y('2025'), withTaxAdvisor: false, dueOn: '2026-07-31' }));
    unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: period.id, answers: COMPLETE }));
    f.closeYear(y('2025'));
    const version = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'taxReturnGem', params: { taxPeriodId: period.id } }));
    later();
    unwrap(await updateTaxPeriod(f.deps, f.ctx, { id: period.id, filedOn: '2026-05-31' }));
    expect(unwrap(await getTaxReturn(f.deps, f.ctx, { taxPeriodId: period.id })).retracted).toBeNull();
    later();
    unwrap(f.deps.db.transaction((tx) => reopenInternal(tx, f.deps, f.ctx, { id: y('2025'), note: 'Buchung falsch' })));
    const view = unwrap(await getTaxReturn(f.deps, f.ctx, { taxPeriodId: period.id }));
    expect(view.retracted).toMatchObject({ reportId: version.reportId, documentNumber: version.documentNumber, voidedAt: expect.any(String) });
    // Ein neuer Abschluss und eine neue Fassung: nichts mehr zurückgenommen, das gilt.
    later();
    const row = f.deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, y('2025'))).get()!;
    unwrap(f.deps.db.transaction((tx) => closeInternal(tx, f.deps, f.ctx, row)));
    unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'taxReturnGem', params: { taxPeriodId: period.id } }));
    expect(unwrap(await getTaxReturn(f.deps, f.ctx, { taxPeriodId: period.id })).retracted).toBeNull();
  });
});
