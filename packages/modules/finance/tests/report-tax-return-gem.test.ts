import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { approvePartnerPayment } from '../src/allocation/approvals';
import { savePartnerPaymentDraft, submitPartnerPayment } from '../src/allocation/partner-payments';
import { savePartnerProfile } from '../src/allocation/partners';
import { recordReserveMovement, saveReserve } from '../src/allocation/reserves';
import { createCategory } from '../src/ledger/categories';
import { bookEntry } from '../src/ledger/finalize';
import { createTaxPeriod, fileTaxPeriodDocument, saveTaxPeriodAnswers } from '../src/ledger/tax-periods';
import { FINANCE_MCP_TOOLS } from '../src/mcp-tools';
import { finalizeFinanceReport, releaseReportsForFinalizing } from '../src/reporting/finalize';
import { annualRevenueForGemInternal } from '../src/reporting/revenue';
import { taxReturnGemReport, type GemLineValue, type TaxReturnGemReport } from '../src/reporting/reports/tax-return-gem';
import { runFinanceReport } from '../src/reporting/service';
import { getTaxReturn } from '../src/reporting/tax-return';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { financeCategories, financeFiscalYears } from '../src/schema';
import { insertDocument, ledgerFixture, pdfBytes } from './helpers';
import { insertPaidPartnerPayment } from './partner-fixture';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

/** Antworten, die keine Pflichtzeile offen lassen. */
const COMPLETE = { churchPurposes: false, charitablePurposes: false, statuteDate: '2022-03-01', statuteSubmission: 'onFile', feeResolution: 'none', welfare: false, hospital: false, sport: false, gratuitousBenefits: false } as const;

async function setup(years: readonly string[] = ['2023', '2024', '2025', '2026']) {
  const f = await ledgerFixture({ years });
  const y = (d: string) => f.years[d]!.id;
  const cat = (key: string) => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get()!.id;
  // Bargeld: Kassen brauchen keinen Kontoauszug zum Festschreiben.
  const book = (date: string, key: string, cents: number, line: Record<string, unknown> = {}) =>
    bookEntry(f.deps, f.ctx, { entryDate: date, text: key, moneyLines: [{ accountId: f.cash.id, amountCents: cents }], allocationLines: [{ categoryId: cat(key), amountCents: cents, ...line }] }).then(unwrap);
  const period = async (first: string, last: string) => unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y(first), lastFiscalYearId: y(last), withTaxAdvisor: false, dueOn: `${Number(last) + 1}-07-31` }));
  const run = async (taxPeriodId: string) => unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'taxReturnGem', params: { taxPeriodId } }));
  const data = async (taxPeriodId: string) => (await run(taxPeriodId)).data as TaxReturnGemReport;
  const line = (d: TaxReturnGemReport, n: string): GemLineValue | undefined => d.lines.find((l) => l.line === n);
  return { f, y, cat, book, period, run, data, line };
}

describe('Bericht taxReturnGem — Werte für die Anlage Gem (Rechenschaft D2 Task 5)', () => {
  it('lists the revenue of each year with 9 as the last', async () => {
    const { f, y, book, period, data, line } = await setup();
    await book('2023-02-01', 'donations', 1000);
    await book('2024-02-01', 'donations', 2000);
    await book('2025-02-01', 'donations', 3000);
    await book('2025-02-02', 'expense-waivers', 500);
    const p = await period('2023', '2025');
    const d = await data(p.id);
    expect(d.formYear).toBe(2025);
    // Unterzeile im PDF (15i): wie die EÜR für das Finanzamt.
    expect(taxReturnGemReport.paperPeriod!(d)).toBe('Erklärungszeitraum 2023–2025');
    expect(d.lines[0]).toMatchObject({ line: '1', value: { kind: 'yearRange', from: '2023', to: '2025' }, missing: false });
    const nine = line(d, '9')!.value as Extract<GemLineValue['value'], { kind: 'amountPerYear' }>;
    expect(nine.perYear).toEqual([
      { line: '9', fiscalYearId: y('2025'), cents: annualRevenueForGemInternal(f.deps.db, y('2025')).totalCents, parts: annualRevenueForGemInternal(f.deps.db, y('2025')).parts },
      { line: '9a', fiscalYearId: y('2024'), cents: 2000, parts: annualRevenueForGemInternal(f.deps.db, y('2024')).parts },
      { line: '9b', fiscalYearId: y('2023'), cents: 1000, parts: annualRevenueForGemInternal(f.deps.db, y('2023')).parts },
    ]);
    // Die Zusammensetzung je Jahr (Board 15f): Aufwandsspenden als eigener Posten nur im Jahr mit Aufwandsspende.
    expect(nine.perYear[2]!.parts.find((p) => p.key === 'expenseWaiver')).toMatchObject({ cents: 0 });
    expect(nine.perYear[0]!.cents).toBe(3500);
    expect(nine.parts.find((p) => p.key === 'expenseWaiver')).toMatchObject({ cents: 500, included: true });
    expect(line(d, '9')!.origin).toEqual({ kind: 'report', report: 'taxReturnIncomeStatement', params: { taxPeriodId: p.id } });
    expect(d.hints.map((h) => h.code)).toEqual(expect.arrayContaining(['revenueDefinition', 'unverifiedLines']));

    const single = await period('2026', '2026');
    const one = (line(await data(single.id), '9')!.value as Extract<GemLineValue['value'], { kind: 'amountPerYear' }>).perYear;
    expect(one.map((r) => r.line)).toEqual(['9']);
  });

  it('answers line 10 against the limit of the form', async () => {
    const { f, book, period, data, line, cat } = await setup();
    await book('2025-03-01', 'sales', 3_000_000, { taxCode: 'standard' });
    await book('2025-03-02', 'purpose-income', 1_500_000, { taxCode: 'reduced' });
    await book('2025-03-03', 'business-costs', -500_000);
    const p = await period('2025', '2025');
    const below = await data(p.id);
    expect(line(below, '10')!.value).toEqual({ kind: 'yesNo', value: false, cents: 4_500_000, limitCents: 4_500_000 });
    expect(['11', '18', '24'].map((n) => line(below, n))).toEqual([undefined, undefined, undefined]);

    await book('2025-03-04', 'events', 1, { taxCode: 'standard' });
    const above = await data(p.id);
    expect(line(above, '10')!.value).toMatchObject({ value: true, cents: 4_500_001 });
    // Ein Eintrag „wGB zusammengefasst“ (§ 64 Abs. 2 AO) mit allen Kategorien in der Bezeichnung (Recherche 2026-10-25, Frage 1).
    expect(line(above, '11')!.value).toEqual({ kind: 'list', rows: [{ designation: [cat('sales'), cat('events')].sort().join(','), incomeCents: 3_000_001, expenseCents: 500_000, resultCents: 2_500_001 }] });
    expect(line(above, '18')!.value).toEqual({ kind: 'list', rows: [{ designation: cat('purpose-income'), incomeCents: 1_500_000 }] });
    expect(line(above, '24')!.value).toEqual({ kind: 'amount', cents: 1_500_000 });
    expect(above.hints.map((h) => h.code)).toContain('businessCombined');
    expect(f).toBeTruthy();
  });

  it('counts grants in line 9 but not in line 10, and names when spheres could be merged from 2026 on', async () => {
    const { f, book, period, data, line } = await setup();
    unwrap(await createCategory(f.deps, f.ctx, { key: 'business-grant', name: 'Zuschuss Betrieb', direction: 'income', sphere: 'business', incomeKind: 'other', thresholdExclusion: 'notPerformance' }));
    await book('2026-03-01', 'business-grant', 6_000_000);
    await book('2026-03-02', 'sales', 1_000, { taxCode: 'standard' });
    const p = await period('2026', '2026');
    const d = await data(p.id);
    expect(d.formYear).toBe(2026);
    expect(d.line10LimitCents).toBe(5_000_000);
    expect(line(d, '10')!.value).toMatchObject({ value: false, cents: 1_000 });
    expect((line(d, '9')!.value as Extract<GemLineValue['value'], { kind: 'amountPerYear' }>).perYear[0]!.cents).toBe(6_001_000);
    expect(d.hints.map((h) => h.code)).toEqual(expect.arrayContaining(['formAssumed', 'spheresMergeable']));
  });

  it('names merged spheres only with a profit, not at zero (§ 64 Abs. 3 S. 2 AO „Gewinn“, Plan E6a Task 8)', async () => {
    const { f, book, period, data } = await setup();
    unwrap(await createCategory(f.deps, f.ctx, { key: 'business-cost', name: 'Wareneinkauf', direction: 'expense', sphere: 'business', costFunction: 'administration' }));
    // Eine Spende hält die Kasse im Plus; sie gehört zum ideellen Bereich und zählt nicht zum Ergebnis der Betriebe.
    await book('2026-03-01', 'donations', 5_000);
    await book('2026-03-02', 'sales', 1_000, { taxCode: 'standard' });
    await book('2026-03-03', 'business-cost', -1_000);
    const p = await period('2026', '2026');
    expect((await data(p.id)).hints.map((h) => h.code)).not.toContain('spheresMergeable');
    await book('2026-03-04', 'sales', 1, { taxCode: 'standard' });
    expect((await data(p.id)).hints.map((h) => h.code)).toContain('spheresMergeable');
  });

  it('warns per year about the business limit', async () => {
    const { book, period, data } = await setup();
    await book('2024-04-01', 'sales', 4_600_000, { taxCode: 'standard' });
    await book('2025-04-01', 'sales', 100_000, { taxCode: 'standard' });
    const d = await data((await period('2023', '2025')).id);
    expect(d.hints.filter((h) => h.code === 'businessOverLimit')).toEqual([{ code: 'businessOverLimit', designation: '2024', cents: 4_600_000, limitCents: 4_500_000 }]);
    expect(d.hints.map((h) => h.code)).not.toContain('kst1FullyExempt');
    const quiet = await setup();
    await quiet.book('2025-04-01', 'sales', 100_000, { taxCode: 'standard' });
    // Mit Abstand zur Grenze je Jahr (Board 15f, `LimitProgress`).
    expect((await quiet.data((await quiet.period('2025', '2025')).id)).hints.find((h) => h.code === 'kst1FullyExempt')).toEqual({ code: 'kst1FullyExempt', years: [{ designation: '2025', cents: 100_000, limitCents: 4_500_000 }] });
  });

  it('fills reserves, assets and endowments', async () => {
    const { f, y, book, period, data, line, cat } = await setup();
    const minutes = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const withDms = ctxWith([...FINANCE_PERMISSIONS, 'dms.view'], f.userId);
    const project = unwrap(await saveReserve(f.deps, withDms, { kind: 'projectFunds', name: 'Neues Gehege', purposeText: 'Bau eines Geheges', resolutionDocumentId: minutes }));
    unwrap(await recordReserveMovement(f.deps, withDms, { reserveId: project.id, kind: 'allocate', movementDate: '2025-06-01', amountCents: 200_000, resolutionDocumentId: minutes }));
    const replacement = unwrap(await saveReserve(f.deps, withDms, { kind: 'replacement', name: 'Transporter', purposeText: 'Ersatz des Transporters', resolutionDocumentId: minutes }));
    unwrap(await recordReserveMovement(f.deps, withDms, { reserveId: replacement.id, kind: 'allocate', movementDate: '2025-06-02', amountCents: 300_000, resolutionDocumentId: minutes }));
    const org = unwrap(await createContact(f.deps, { ...f.ctx, permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Stiftung Inland' }));
    const partner = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'publicBody' }));
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'Ausstattung', retroactive: false, assetEndowment: true, positions: [{ kind: 'money', amountCents: 7000, categoryId: f.programCosts.id }] }));
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    // Freigabe im Zeitraum: Die Uhr steht im Test am 2026-09-05; der Zeitraum 2025–2026 nimmt sie mit.
    unwrap(await approvePartnerPayment(f.deps, f.secondPerson, { id: submitted.id, expectedVersion: submitted.version }));
    await book('2026-02-01', 'body-grants', 50_000, { contactId: org.id, assetEndowment: true, addsToAssets: false, addsToAssetsOptOut: 'donorAllowedCurrentUse' });
    const p = await period('2025', '2026');
    const d = await data(p.id);
    expect(line(d, '50')!.value).toEqual({ kind: 'list', rows: [{ reserveId: project.id, amountCents: 200_000 }] });
    expect(line(d, '54')).toMatchObject({ missing: true, value: { kind: 'list', rows: [{ reserveId: replacement.id, asset: null, balanceCents: 300_000, allocatedCents: 300_000, dissolvedCents: 0 }] } });
    expect(line(d, '63')).toMatchObject({ value: { kind: 'amount', cents: 0 }, missing: false });
    expect(line(d, '64')!.value).toEqual({ kind: 'yesNo', value: true });
    expect(line(d, '65')).toMatchObject({ missing: true, value: { kind: 'list', rows: [{ party: 'Stiftung Inland', contactId: org.id, taxOffice: null, taxNumber: null, purpose: null, amountCents: 7000 }] } });
    expect(line(d, '69')!.value).toEqual({ kind: 'yesNo', value: true });
    expect(line(d, '70')).toMatchObject({ missing: true, value: { kind: 'list', rows: [{ party: 'Stiftung Inland', contactId: org.id, amountCents: 50_000 }] } });
    expect(d.hints.map((h) => h.code)).toContain('endowmentNotToAssets');

    unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: p.id, answers: { ...COMPLETE, replacementAssets: { [replacement.id]: { asset: 'Transporter Baujahr 2015', expectedCostCents: 4_000_000 } }, participations: { UNKNOWN: { company: 'X GmbH', taxOffice: 'FA', taxNumber: '1' } } } }));
    expect(line(await data(p.id), '54')).toMatchObject({ missing: false, value: { rows: [{ asset: 'Transporter Baujahr 2015', expectedCostCents: 4_000_000, regularDepreciationCents: null }] } });
    // Zuführungen zum Vermögen im ganzen Zeitraum, und 0 ist ein Wert.
    await book('2025-07-01', 'inheritances', 80_000);
    expect(line(await data(p.id), '63')!.value).toEqual({ kind: 'amount', cents: 80_000 });
    expect(y('2025') && cat('inheritances')).toBeTruthy();
  });

  it('lines 50 to 59 ignore operation reserves (M1 Task 2, Prüfung L-7)', async () => {
    const { f, period, data } = await setup();
    const minutes = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const withDms = ctxWith([...FINANCE_PERMISSIONS, 'dms.view'], f.userId);
    const project = unwrap(await saveReserve(f.deps, withDms, { kind: 'projectFunds', name: 'Neues Gehege', purposeText: 'Bau eines Geheges', resolutionDocumentId: minutes }));
    unwrap(await recordReserveMovement(f.deps, withDms, { reserveId: project.id, kind: 'allocate', movementDate: '2025-06-01', amountCents: 200_000, resolutionDocumentId: minutes }));
    const p = await period('2025', '2026');
    const reserveLines = (d: TaxReturnGemReport) => d.lines.filter((l) => Number(l.line) >= 50 && Number(l.line) <= 59).map((l) => ({ line: l.line, value: l.value }));
    const withoutOperation = reserveLines(await data(p.id));
    const business = unwrap(await saveReserve(f.deps, withDms, { kind: 'business', name: 'Rücklage Vereinsfest', purposeText: 'Ersatz der Kühltheke', resolutionDocumentId: minutes }));
    unwrap(await recordReserveMovement(f.deps, withDms, { reserveId: business.id, kind: 'allocate', movementDate: '2025-07-15', amountCents: 25_000, resolutionDocumentId: minutes }));
    expect(reserveLines(await data(p.id))).toEqual(withoutOperation);
  });

  it('counts missing answers and blocks finalizing', async () => {
    const { f, y, period, run, line } = await setup();
    const p = await period('2023', '2025');
    const empty = await run(p.id);
    const d = empty.data as TaxReturnGemReport;
    expect(d.lines.filter((l) => l.missing).map((l) => l.line)).toEqual(['2', '3', '5', '6', '7', '30', '38', '39', '74']);
    expect(d.missingCount).toBe(9);
    // Vor dem Block gelten Jahr offen und Kontoauszüge wie bisher.
    expect(empty.finalizeBlock).toMatchObject({ code: 'reportYearOpen' });
    for (const yr of ['2023', '2024', '2025']) f.closeYear(y(yr));
    expect((await run(p.id)).finalizeBlock).toEqual({ code: 'reportGemIncomplete', params: { missing: 9 } });
    expect(err(await finalizeFinanceReport(f.deps, f.ctx, { report: 'taxReturnGem', params: { taxPeriodId: p.id } }))).toMatchObject({ code: 'reportGemIncomplete' });
    unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: p.id, answers: { ...COMPLETE, gratuitousBenefits: true } }));
    const gifts = (await run(p.id)).data as TaxReturnGemReport;
    expect(line(gifts, '75')).toMatchObject({ missing: true });
    expect(gifts.missingCount).toBe(1);
    unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: p.id, answers: { ...COMPLETE, feeResolution: { date: '2023-05-01' } } }));
    expect(((await run(p.id)).data as TaxReturnGemReport).lines.filter((l) => l.missing).map((l) => l.line)).toEqual(['8']);
    unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: p.id, answers: COMPLETE }));
    const ready = await run(p.id);
    expect(ready.finalizeBlock).toBeNull();
    expect(ready.stage).toBe('review');
    unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'taxReturnGem', params: { taxPeriodId: p.id } }));
    expect((await run(p.id)).stage).toBe('final');
  });

  it('keeps the hash when an attachment gets finalized', async () => {
    const { f, y, book, period, run } = await setup();
    await book('2025-02-01', 'donations', 3000);
    const p = await period('2025', '2025');
    unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: p.id, answers: COMPLETE }));
    f.closeYear(y('2025'));
    const before = await run(p.id);
    expect((before.data as TaxReturnGemReport).attachments).toEqual(expect.arrayContaining([{ key: 'assetOverview', params: { fiscalYearId: y('2025') }, fiscalYearId: y('2025') }, { key: 'taxReturnIncomeStatement', params: { taxPeriodId: p.id } }]));
    unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y('2025'), basis: 'noAuditProvided', note: 'Satzung sieht keine Prüfung vor' }));
    unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'assetOverview', params: { fiscalYearId: y('2025') } }));
    expect((await run(p.id)).hash).toBe(before.hash);
  });

  it('refuses a period before the first form, and an unknown one', async () => {
    const { f } = await setup(['2022', '2023']);
    const p = unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: f.years['2022']!.id, lastFiscalYearId: f.years['2022']!.id, withTaxAdvisor: false, dueOn: '2023-07-31' }));
    expect(err(await runFinanceReport(f.deps, f.ctx, { report: 'taxReturnGem', params: { taxPeriodId: p.id } }))).toMatchObject({ code: 'gemFormMissing', params: { year: '2022' } });
    expect(err(await runFinanceReport(f.deps, f.ctx, { report: 'taxReturnGem', params: { taxPeriodId: 'NOPE' } }))).toMatchObject({ type: 'notFound' });
    expect(err(await runFinanceReport(f.deps, f.ctx, { report: 'taxReturnGem', params: { fiscalYearId: f.years['2022']!.id } }))).toMatchObject({ type: 'validation' });
  });

  it('follows the form of the calendar year in which a deviating fiscal year ends', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    f.deps.db.insert(financeFiscalYears).values({ id: 'FY-2526', startsOn: '2026-01-01', endsOn: '2026-06-30', designation: '2026', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }).run();
    const p = unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: 'FY-2526', lastFiscalYearId: 'FY-2526', withTaxAdvisor: false, dueOn: '2027-07-31' }));
    const d = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'taxReturnGem', params: { taxPeriodId: p.id } })).data as TaxReturnGemReport;
    expect(d.formYear).toBe(2026);
    expect(d.line10LimitCents).toBe(5_000_000);
  });

  it('getTaxReturn: the run with the state of each attachment and the rights of the caller', async () => {
    const { f, y, book, period } = await setup();
    await book('2025-02-01', 'donations', 3000);
    const p = await period('2025', '2025');
    unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: p.id, answers: COMPLETE }));
    f.closeYear(y('2025'));
    unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y('2025'), basis: 'noAuditProvided', note: 'Satzung sieht keine Prüfung vor' }));
    unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'assetOverview', params: { fiscalYearId: y('2025') } }));
    const view = unwrap(await getTaxReturn(f.deps, f.ctx, { taxPeriodId: p.id }));
    expect(view.period.id).toBe(p.id);
    expect(view.run.report).toBe('taxReturnGem');
    expect(view.attachments.find((a) => a.key === 'assetOverview')).toMatchObject({ fiscalYearId: y('2025'), state: 'final' });
    expect(view.attachments.find((a) => a.key === 'activityReport')).toMatchObject({ state: 'missing' });
    expect(view.attachments.find((a) => a.key === 'assemblyMinutes')).toMatchObject({ fiscalYearId: y('2025'), state: 'missing' });
    expect(view.me).toEqual({ canEdit: true, canFinalize: true });
    expect(unwrap(await getTaxReturn(f.deps, ctxWith(['finance.read'], f.userId), { taxPeriodId: p.id })).me).toEqual({ canEdit: false, canFinalize: false });
    expect(err(await getTaxReturn(f.deps, ctxWith(['finance.overview'], f.userId), { taxPeriodId: p.id }))).toMatchObject({ type: 'forbidden' });
    expect(err(await getTaxReturn(f.deps, f.ctx, { taxPeriodId: 'NOPE' }))).toMatchObject({ type: 'notFound' });
  });

  it('getTaxReturn: the statute is an attachment only when submitted separately, done once it lies at the period (Befund 18b)', async () => {
    const { f, period } = await setup();
    const p = await period('2025', '2025');
    const statute = async () => unwrap(await getTaxReturn(f.deps, f.ctx, { taxPeriodId: p.id })).attachments.find((a) => a.key === 'statute');
    unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: p.id, answers: COMPLETE }));
    expect(await statute()).toBeUndefined();
    unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: p.id, answers: { ...COMPLETE, statuteSubmission: 'willSubmit' } }));
    expect(await statute()).toMatchObject({ state: 'missing' });
    // Über MCP abgelegt wie über die Oberfläche: derselbe Dienst, derselbe Platz.
    const tool = FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_tax_period_document_file')!;
    const filed = unwrap(await tool.handler(f.deps, f.ctx, tool.inputSchema.parse({ id: p.id, slot: 'statute', contentBase64: Buffer.from(pdfBytes()).toString('base64') }))) as { documents: Record<string, unknown> };
    expect(filed.documents.statute).toBeTruthy();
    expect(await statute()).toMatchObject({ state: 'present' });
    // Liegt die Satzung dem Finanzamt vor, fällt die Beilage weg — das abgelegte Dokument bleibt am Zeitraum.
    unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: p.id, answers: COMPLETE }));
    expect(await statute()).toBeUndefined();
    expect(unwrap(await fileTaxPeriodDocument(f.deps, f.ctx, { id: p.id, slot: 'statute', bytes: pdfBytes() })).documents.statute).toBeTruthy();
  });

  it('getTaxReturn: the reserve statement over the years of the period carries the stage of that version (Befund 18d)', async () => {
    const { f, y, book, period } = await setup();
    await book('2025-02-01', 'donations', 300_000);
    const minutes = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const withDms = ctxWith([...FINANCE_PERMISSIONS, 'dms.view'], f.userId);
    const reserve = unwrap(await saveReserve(f.deps, withDms, { kind: 'projectFunds', name: 'Neues Gehege', purposeText: 'Bau eines Geheges', resolutionDocumentId: minutes }));
    unwrap(await recordReserveMovement(f.deps, withDms, { reserveId: reserve.id, kind: 'allocate', movementDate: '2025-06-01', amountCents: 200_000, resolutionDocumentId: minutes }));
    const p = await period('2025', '2025');
    const attachment = async () => unwrap(await getTaxReturn(f.deps, f.ctx, { taxPeriodId: p.id })).attachments.find((a) => a.key === 'reserveStatement')!;
    expect(await attachment()).toMatchObject({ params: { fiscalYearIds: [y('2025')] }, state: 'preliminary' });
    f.closeYear(y('2025'));
    unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y('2025'), basis: 'noAuditProvided', note: 'Satzung sieht keine Prüfung vor' }));
    // Die Fassung je Jahr ist eine andere als die über den Zeitraum: Sie erledigt die Beilage nicht.
    unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'reserveStatement', params: { fiscalYearId: y('2025') } }));
    expect((await attachment()).state).not.toBe('final');
    const version = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'reserveStatement', params: { fiscalYearIds: [y('2025')] } }));
    expect(await attachment()).toMatchObject({ state: 'final' });
    // Der Hash ist stabil: derselbe Lauf ergibt die festgeschriebene Fassung.
    expect(unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'reserveStatement', params: { fiscalYearIds: [y('2025')] } })).shortHash).toBe(version.shortHash);
  });

  it('suggests candidates for line 74 from the member categories', async () => {
    const { book, period, data } = await setup();
    await book('2025-11-01', 'donations', 10000);
    await book('2025-12-01', 'member-gifts', -4500);
    await book('2025-12-02', 'member-care', -500);
    const d = await data((await period('2025', '2025')).id);
    expect(d.hints.find((h) => h.code === 'gratuitousCandidates')).toEqual({ code: 'gratuitousCandidates', count: 2, cents: 5000 });
  });

  it('is personal: needs finance.read', async () => {
    const { f, period } = await setup();
    const p = await period('2025', '2025');
    expect(err(await runFinanceReport(f.deps, ctxWith(['finance.overview'], f.userId), { report: 'taxReturnGem', params: { taxPeriodId: p.id } }))).toMatchObject({ type: 'forbidden' });
    expect(insertPaidPartnerPayment).toBeTruthy();
  });
});
