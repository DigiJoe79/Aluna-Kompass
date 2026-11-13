import { unwrap } from '@kompass/core';
import { auditEntry, ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { bookEntry } from '../src/ledger/finalize';
import { listFinanceDeadlines } from '../src/closing/deadlines';
import { runFinanceReport } from '../src/reporting/service';
import type { HandoverListReport } from '../src/reporting/reports/handover-list';
import { cashReportTypst } from '../src/reporting/reports/cash-report-typst';
import type { CashReport } from '../src/reporting/reports/cash-report';
import { renderContextInternal } from '../src/reporting/finalize';
import { FINANCE_MCP_TOOLS } from '../src/mcp-tools';
import { closeTaxAmendmentReview, listTaxPeriods, recordTaxAmendment, recordTaxAmendmentNotice, updateTaxAmendment, updateTaxPeriod } from '../src/reporting/tax-amendments';
import { createTaxPeriod, fileTaxPeriodDocument, linkTaxPeriodDocument, saveTaxPeriodAnswers } from '../src/ledger/tax-periods';
import { finalizeFinanceReport } from '../src/reporting/finalize';
import { financeTaxPeriods, financeVatFilings } from '../src/schema';
import { insertDocument, ledgerFixture, pdfBytes } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
const fields = (r: { ok: boolean; error?: unknown }) => (r.ok ? [] : ((r.error as { issues?: { path: string; message: string }[] }).issues ?? []).map((i) => `${i.path}:${i.message}`));
const COMPLETE = { churchPurposes: false, charitablePurposes: false, statuteDate: '2022-03-01', statuteSubmission: 'onFile', feeResolution: 'none', welfare: false, hospital: false, sport: false, gratuitousBenefits: false } as const;

/** Ein abgegebener Zeitraum 2025 mit einer Spende, das Jahr wieder geöffnet — bereit für eine Nachbuchung. */
export async function filedPeriod(years: readonly string[] = ['2024', '2025', '2026']) {
  const f = await ledgerFixture({ years });
  const y = (d: string) => f.years[d]!.id;
  let tick = 0;
  const later = () => f.deps.clock.set(`2026-09-05T09:${String(++tick).padStart(2, '0')}:00.000Z`);
  const { reopenInternal, closeInternal } = await import('../src/ledger/period');
  const { financeFiscalYears } = await import('../src/schema');
  const { eq } = await import('drizzle-orm');
  const book = (date: string, cents: number) => bookEntry(f.deps, f.ctx, { entryDate: date, text: 'Spende', moneyLines: [{ accountId: f.cash.id, amountCents: cents }], allocationLines: [{ categoryId: f.donations.id, amountCents: cents }] }).then(unwrap);
  await book('2025-03-01', 100_000);
  const period = unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y('2025'), lastFiscalYearId: y('2025'), withTaxAdvisor: false, dueOn: '2026-07-31' }));
  unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: period.id, answers: COMPLETE }));
  f.closeYear(y('2025'));
  const finalize = async () => unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'taxReturnGem', params: { taxPeriodId: period.id } }));
  await finalize();
  later();
  unwrap(await updateTaxPeriod(f.deps, f.ctx, { id: period.id, filedOn: '2026-05-31' }));
  later();
  unwrap(f.deps.db.transaction((tx) => reopenInternal(tx, f.deps, f.ctx, { id: y('2025'), note: 'Nachbuchung' })));
  /** Das Jahr wieder schließen und neu festschreiben. */
  const close = async () => {
    later();
    const row = f.deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, y('2025'))).get()!;
    unwrap(f.deps.db.transaction((tx) => closeInternal(tx, f.deps, f.ctx, row)));
    later();
    return finalize();
  };
  const reopen = () => {
    later();
    unwrap(f.deps.db.transaction((tx) => reopenInternal(tx, f.deps, f.ctx, { id: y('2025'), note: 'Nachbuchung' })));
  };
  const view = async () => unwrap(await listTaxPeriods(f.deps, f.ctx, {})).find((p) => p.id === period.id)!;
  return { f, y, later, book, period, close, reopen, view };
}

describe('Berichtigung der Steuererklärung als zweite Abgabe (B9, Spec 0.5.2 § 4.3)', () => {
  it('records the amendment: the first day stays, the review closes, and a new change opens a new one', async () => {
    const { f, later, book, period, close, reopen, view } = await filedPeriod();
    await book('2025-06-01', 50_000);
    expect(await view()).toMatchObject({ reviewDue: true, amendmentAllowed: true });
    // Ohne festgeschriebene Fassung mit den Daten von heute keine Berichtigung.
    expect(err(await recordTaxAmendment(f.deps, f.ctx, { taxPeriodId: period.id, filedOn: '2026-09-01' }))).toMatchObject({ code: 'taxReturnNotFinal', params: { period: '2025' } });
    const version = await close();
    later();
    const amendment = unwrap(await recordTaxAmendment(f.deps, f.ctx, { taxPeriodId: period.id, filedOn: '2026-09-01' }));
    expect(amendment).toMatchObject({ filedOn: '2026-09-01', reportId: version.reportId, cause: expect.arrayContaining([{ kind: 'line', line: '9', year: '2025' }]) });
    expect(await view()).toMatchObject({ filedOn: '2026-05-31', reviewDue: false, amendmentAllowed: false, amendments: [{ id: amendment.id, filedOn: '2026-09-01' }] });
    expect(JSON.parse(auditEntry(f.deps, 'finance.taxAmendment.record').params!)).toEqual({ period: '2025', filedOn: '2026-09-01' });
    expect(auditEntry(f.deps, 'finance.taxAmendment.record').after).not.toMatch(/lines|attachments/);
    // N24: ohne Wertänderung keine zweite Berichtigung.
    expect(err(await recordTaxAmendment(f.deps, f.ctx, { taxPeriodId: period.id, filedOn: '2026-09-02' }))).toMatchObject({ code: 'taxAmendmentNotDue', params: { period: '2025', filedOn: '2026-09-01' } });
    // Eine neue Änderung: ein neuer Anlass, eine zweite Berichtigung.
    reopen();
    await book('2025-07-01', 30_000);
    expect(await view()).toMatchObject({ reviewDue: true });
    await close();
    later();
    expect(fields(await recordTaxAmendment(f.deps, f.ctx, { taxPeriodId: period.id, filedOn: '2026-08-31' }))).toEqual(['filedOn:beforeLastFiling']);
    expect(fields(await recordTaxAmendment(f.deps, f.ctx, { taxPeriodId: period.id, filedOn: '2026-12-01' }))).toEqual(['filedOn:inFuture']);
    unwrap(await recordTaxAmendment(f.deps, f.ctx, { taxPeriodId: period.id, filedOn: '2026-09-05' }));
    expect((await view()).amendments.map((a) => a.filedOn)).toEqual(['2026-09-01', '2026-09-05']);
  });

  it('a filing without figures (before 0.5.2) never brings a review, but allows an amendment', async () => {
    const { f, later, period, close, view } = await filedPeriod();
    const { eq } = await import('drizzle-orm');
    f.deps.db.update(financeTaxPeriods).set({ filedFigures: null }).where(eq(financeTaxPeriods.id, period.id)).run();
    await close();
    expect(await view()).toMatchObject({ reviewDue: false, amendmentAllowed: true, filedFiguresMissing: true });
    later();
    unwrap(await recordTaxAmendment(f.deps, f.ctx, { taxPeriodId: period.id, filedOn: '2026-09-01' }));
    expect(await view()).toMatchObject({ reviewDue: false, amendmentAllowed: false, filedFiguresMissing: false });
  });

  it('changes only the day of the latest amendment, under the same rules', async () => {
    const { f, later, book, period, close, reopen } = await filedPeriod();
    await book('2025-06-01', 50_000);
    await close();
    later();
    const first = unwrap(await recordTaxAmendment(f.deps, f.ctx, { taxPeriodId: period.id, filedOn: '2026-09-01' }));
    later();
    const moved = unwrap(await updateTaxAmendment(f.deps, f.ctx, { amendmentId: first.id, filedOn: '2026-09-02' }));
    expect(moved.filedOn).toBe('2026-09-02');
    expect(JSON.parse(auditEntry(f.deps, 'finance.taxAmendment.update').params!)).toEqual({ period: '2025', filedOn: '2026-09-02' });
    expect(fields(await updateTaxAmendment(f.deps, f.ctx, { amendmentId: first.id, filedOn: '2026-05-30' }))).toEqual(['filedOn:beforeLastFiling']);
    reopen();
    await book('2025-07-01', 30_000);
    await close();
    later();
    unwrap(await recordTaxAmendment(f.deps, f.ctx, { taxPeriodId: period.id, filedOn: '2026-09-03' }));
    expect(err(await updateTaxAmendment(f.deps, f.ctx, { amendmentId: first.id, filedOn: '2026-09-02' }))).toMatchObject({ code: 'taxAmendmentNotLatest', params: { period: '2025' } });
  });

  it('refuses without the right and with invalid input', async () => {
    const { f, period } = await filedPeriod();
    const reader = ctxWith(['finance.read'], f.userId);
    expect(err(await recordTaxAmendment(f.deps, reader, { taxPeriodId: period.id, filedOn: '2026-09-01' }))).toMatchObject({ type: 'forbidden' });
    expect(err(await updateTaxAmendment(f.deps, reader, { amendmentId: 'x', filedOn: '2026-09-01' }))).toMatchObject({ type: 'forbidden' });
    expect(err(await recordTaxAmendment(f.deps, f.ctx, { taxPeriodId: period.id, filedOn: '1.9.2026' }))).toMatchObject({ type: 'validation' });
    expect(err(await recordTaxAmendment(f.deps, f.ctx, { taxPeriodId: 'nope', filedOn: '2026-09-01' }))).toMatchObject({ type: 'notFound' });
  });

  it('files and links the documents of the amendment in its own slots', async () => {
    const { f, later, book, period, close, view } = await filedPeriod();
    await book('2025-06-01', 50_000);
    await close();
    later();
    const amendment = unwrap(await recordTaxAmendment(f.deps, f.ctx, { taxPeriodId: period.id, filedOn: '2026-09-01' }));
    unwrap(await fileTaxPeriodDocument(f.deps, f.ctx, { id: period.id, target: 'amendment', amendmentId: amendment.id, slot: 'filedReturn', bytes: pdfBytes() }));
    const protocol = insertDocument(f, { subject: 'ELSTER-Protokoll' });
    unwrap(await linkTaxPeriodDocument(f.deps, f.ctx, { id: period.id, target: 'amendment', amendmentId: amendment.id, slot: 'transmissionProtocol', documentId: protocol }));
    const listed = await view();
    expect(listed.amendments[0]!.documents).toMatchObject({ filedReturn: { documentId: expect.any(String) }, transmissionProtocol: { documentId: protocol } });
    // Die Fächer der ersten Abgabe bleiben leer.
    expect(listed.documents.filedReturn).toBeUndefined();
    expect(JSON.parse(auditEntry(f.deps, 'finance.taxPeriod.documentLink').params!)).toMatchObject({ period: '2025', slot: 'transmissionProtocol', target: 'amendment' });
    expect(fields(await linkTaxPeriodDocument(f.deps, f.ctx, { id: period.id, target: 'amendment', slot: 'transmissionProtocol', documentId: protocol }))).toEqual(['amendmentId:required']);
    expect(fields(await linkTaxPeriodDocument(f.deps, f.ctx, { id: period.id, target: 'amendment', amendmentId: amendment.id, slot: 'activityReport', documentId: protocol }))).toEqual(['slot:wrongTarget']);
  });
});

describe('Prüfanlass schließen und Anzeige eintragen (B9, Spec 0.5.2 § 4.3, F2, F6)', () => {
  const REASON = 'Geprüft: nur Zeile 9 erhöht, Grenze weit unterschritten, keine Verkürzung möglich.';

  it('closes an open review with a reason; a new change opens a new one, the amendment stays possible', async () => {
    const { f, later, book, period, close, view } = await filedPeriod();
    expect(err(await closeTaxAmendmentReview(f.deps, f.ctx, { taxPeriodId: period.id, reason: REASON }))).toMatchObject({ code: 'taxAmendmentCheckNotOpen', params: { period: '2025' } });
    await book('2025-06-01', 50_000);
    expect(err(await closeTaxAmendmentReview(f.deps, f.ctx, { taxPeriodId: period.id, reason: '  ' }))).toMatchObject({ type: 'validation' });
    later();
    const check = unwrap(await closeTaxAmendmentReview(f.deps, f.ctx, { taxPeriodId: period.id, reason: REASON }));
    expect(check).toMatchObject({ kind: 'noAmendment', checkedOn: '2026-09-05', reason: REASON, byUserId: f.userId, document: null, cause: expect.arrayContaining([{ kind: 'line', line: '9', year: '2025' }]) });
    expect(await view()).toMatchObject({ reviewDue: false, amendmentAllowed: true, checks: [{ id: check.id, kind: 'noAmendment' }] });
    // Die Begründung steht nicht im Protokoll.
    const entry = auditEntry(f.deps, 'finance.taxAmendment.closeWithoutAmendment');
    expect(JSON.parse(entry.params!)).toEqual({ period: '2025', checkedOn: '2026-09-05', withDocument: false });
    expect(`${entry.after}${entry.before}`).not.toContain('Grenze');
    await book('2025-07-01', 30_000);
    expect(await view()).toMatchObject({ reviewDue: true });
    // Eine Berichtigung bleibt eintragbar.
    await close();
    later();
    unwrap(await recordTaxAmendment(f.deps, f.ctx, { taxPeriodId: period.id, filedOn: '2026-09-05' }));
  });

  it('is human only: over MCP the close is refused unless the setting allows it', async () => {
    const { f, book, period } = await filedPeriod();
    await book('2025-06-01', 50_000);
    expect(err(await closeTaxAmendmentReview(f.deps, { ...f.ctx, channel: 'mcp' }, { taxPeriodId: period.id, reason: REASON }))).toMatchObject({ code: 'humanOnly' });
    expect(err(await closeTaxAmendmentReview(f.deps, ctxWith(['finance.read'], f.userId), { taxPeriodId: period.id, reason: REASON }))).toMatchObject({ type: 'forbidden' });
  });

  it('closes with a document from the file module, issued and not voided', async () => {
    const { f, later, book, period } = await filedPeriod();
    await book('2025-06-01', 50_000);
    const voided = insertDocument(f, { subject: 'Beschluss', voided: true });
    const withDms = ctxWith([...(await import('../src/manifest')).FINANCE_PERMISSIONS, 'dms.view'], f.userId);
    expect(fields(await closeTaxAmendmentReview(f.deps, withDms, { taxPeriodId: period.id, reason: REASON, documentId: voided }))).toEqual(['documentId:documentVoided']);
    const resolution = insertDocument(f, { subject: 'Vorstandsbeschluss' });
    later();
    const check = unwrap(await closeTaxAmendmentReview(f.deps, withDms, { taxPeriodId: period.id, reason: REASON, documentId: resolution }));
    expect(check.document).toMatchObject({ documentId: resolution });
    expect(JSON.parse(auditEntry(f.deps, 'finance.taxAmendment.closeWithoutAmendment').params!)).toMatchObject({ withDocument: true });
  });

  it('records the notice of an open review: notifiedOn, a second time moves the day, nothing closes', async () => {
    const { f, later, book, period, view } = await filedPeriod();
    expect(err(await recordTaxAmendmentNotice(f.deps, f.ctx, { taxPeriodId: period.id, notifiedOn: '2026-09-01' }))).toMatchObject({ code: 'taxAmendmentCheckNotOpen' });
    await book('2025-06-01', 50_000);
    expect(fields(await recordTaxAmendmentNotice(f.deps, f.ctx, { taxPeriodId: period.id, notifiedOn: '2026-12-01' }))).toEqual(['notifiedOn:inFuture']);
    later();
    const first = unwrap(await recordTaxAmendmentNotice(f.deps, f.ctx, { taxPeriodId: period.id, notifiedOn: '2026-09-01' }));
    expect(await view()).toMatchObject({ reviewDue: true, notifiedOn: '2026-09-01' });
    expect(JSON.parse(auditEntry(f.deps, 'finance.taxAmendment.notified').params!)).toEqual({ period: '2025', checkedOn: '2026-09-01' });
    later();
    const second = unwrap(await recordTaxAmendmentNotice(f.deps, f.ctx, { taxPeriodId: period.id, notifiedOn: '2026-09-02' }));
    expect(second.id).toBe(first.id);
    expect(await view()).toMatchObject({ reviewDue: true, notifiedOn: '2026-09-02', checks: [{ kind: 'notified', checkedOn: '2026-09-02' }] });
    // Das Anzeigeschreiben im Fach der Anzeige.
    unwrap(await fileTaxPeriodDocument(f.deps, f.ctx, { id: period.id, target: 'notice', slot: 'notice', bytes: pdfBytes() }));
    expect((await view()).checks[0]!.document).toMatchObject({ documentId: expect.any(String) });
    expect(err(await recordTaxAmendmentNotice(f.deps, ctxWith(['finance.read'], f.userId), { taxPeriodId: period.id, notifiedOn: '2026-09-01' }))).toMatchObject({ type: 'forbidden' });
    expect(err(await recordTaxAmendmentNotice(f.deps, f.ctx, { taxPeriodId: period.id }))).toMatchObject({ type: 'validation' });
  });

  it('refuses a notice letter without a notice of the running review', async () => {
    const { f, period } = await filedPeriod();
    expect(err(await fileTaxPeriodDocument(f.deps, f.ctx, { id: period.id, target: 'notice', slot: 'notice', bytes: pdfBytes() }))).toMatchObject({ code: 'taxAmendmentNoNotice', params: { period: '2025' } });
  });
});

describe('Frist und Übergabeliste (B9, Spec 0.5.2 § 4.4, § 4.7)', () => {
  const deadline = async (f: Awaited<ReturnType<typeof filedPeriod>>['f']) => unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed;
  const handover = async (f: Awaited<ReturnType<typeof filedPeriod>>['f']) => (unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'handoverList', params: { date: '2026-09-05' } })).data as HandoverListReport).groups.find((g) => g.userId === null)?.items ?? [];

  it('puts the review first, without a date, and carries the notice; it goes with the amendment', async () => {
    const { f, later, book, period, close } = await filedPeriod();
    expect((await deadline(f)).filter((d) => d.kind === 'taxReturnAmendment')).toEqual([]);
    expect((await handover(f)).filter((i) => i.kind === 'taxReturnAmendment')).toEqual([]);
    await book('2025-06-01', 50_000);
    const [first] = await deadline(f);
    expect(first).toEqual({ key: `taxReturnAmendment:${period.id}`, kind: 'taxReturnAmendment', dueOn: null, overdue: false, params: { period: '2025', lines: 'Zeile 9 (2025), Beilage EÜR 2025, Vermögensübersicht 2025' }, href: `/finance/tax?period=${period.id}` });
    expect((await handover(f)).filter((i) => i.kind === 'taxReturnAmendment')).toEqual([expect.objectContaining({ refId: period.id, refNumber: '2025', date: '2026-05-31', notifiedOn: null })]);
    later();
    unwrap(await recordTaxAmendmentNotice(f.deps, f.ctx, { taxPeriodId: period.id, notifiedOn: '2026-09-01' }));
    expect((await deadline(f))[0]!.params).toMatchObject({ notifiedOn: '2026-09-01' });
    expect((await handover(f)).find((i) => i.kind === 'taxReturnAmendment')).toMatchObject({ notifiedOn: '2026-09-01' });
    await close();
    later();
    unwrap(await recordTaxAmendment(f.deps, f.ctx, { taxPeriodId: period.id, filedOn: '2026-09-05' }));
    expect((await deadline(f)).filter((d) => d.kind === 'taxReturnAmendment')).toEqual([]);
    expect((await handover(f)).filter((i) => i.kind === 'taxReturnAmendment')).toEqual([]);
  });

  it('goes when the review is closed without amendment', async () => {
    const { f, later, book, period } = await filedPeriod();
    await book('2025-06-01', 50_000);
    later();
    unwrap(await closeTaxAmendmentReview(f.deps, f.ctx, { taxPeriodId: period.id, reason: 'Geprüft, keine Verkürzung möglich.' }));
    expect((await deadline(f)).filter((d) => d.kind === 'taxReturnAmendment')).toEqual([]);
  });

  it('names an open VAT amendment in the handover list, by the same rule as the deadline', async () => {
    const { f } = await filedPeriod();
    f.deps.db.insert(financeVatFilings).values({ id: 'V1', period: '2025', filedOn: '2026-03-01', amendment: false, linesDigest: null, linesSnapshot: null, figures: JSON.stringify({ result: 12_345 }), reportId: null, filedReturnDocumentId: null, transmissionProtocolDocumentId: null, at: '2026-03-01T10:00:00.000Z', byUserId: f.userId }).run();
    expect((await deadline(f)).some((d) => d.kind === 'vatAmendment')).toBe(true);
    expect((await handover(f)).filter((i) => i.kind === 'vatAmendment')).toEqual([expect.objectContaining({ refId: '2025', refNumber: '2025', date: '2026-03-01' })]);
  });
});

describe('Kassenbericht nennt Berichtigungen und Prüfungen (B9, Spec 0.5.2 § 4.6)', () => {
  const cash = async (f: Awaited<ReturnType<typeof filedPeriod>>['f'], fiscalYearId: string) => unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'cashReport', params: { fiscalYearId } }));

  it('lists amendment and check in the year of their day, and section 11 appears without corrections', async () => {
    const { f, y, later, book, period, close } = await filedPeriod();
    expect((await cash(f, y('2026'))).data).not.toHaveProperty('taxReturnNotes');
    await book('2025-06-01', 50_000);
    later();
    unwrap(await closeTaxAmendmentReview(f.deps, f.ctx, { taxPeriodId: period.id, reason: 'Geprüft, keine Verkürzung möglich.' }));
    await book('2025-07-01', 30_000);
    await close();
    later();
    unwrap(await recordTaxAmendment(f.deps, f.ctx, { taxPeriodId: period.id, filedOn: '2026-09-05' }));
    const run = await cash(f, y('2026'));
    const data = run.data as CashReport;
    expect(data.taxReturnNotes).toEqual([
      { kind: 'noAmendment', period: '2025', on: '2026-09-05', lines: 'Zeile 9 (2025), Beilage EÜR 2025, Vermögensübersicht 2025', late: false },
      { kind: 'amendment', period: '2025', on: '2026-09-05', lines: 'Zeile 9 (2025), Beilage EÜR 2025, Vermögensübersicht 2025', late: false },
    ]);
    // Keine Begründung, kein Name auf Papier.
    const paper = cashReportTypst(data, renderContextInternal(f.deps));
    expect(paper).toContain('11 Korrekturen an Vorjahren');
    expect(paper).not.toContain('keine Verkürzung');
    expect(data.priorYearCorrections).toEqual([]);
  });

  it('puts a day in a closed year into the first open year after, and the closed one keeps its hash', async () => {
    const { f, y, book, period, close } = await filedPeriod(['2024', '2025', '2026', '2027']);
    await book('2025-06-01', 50_000);
    await close();
    f.closeYear(y('2026'));
    const before = (await cash(f, y('2026'))).hash;
    f.deps.clock.set('2027-02-01T10:00:00.000Z');
    unwrap(await recordTaxAmendment(f.deps, f.ctx, { taxPeriodId: period.id, filedOn: '2026-12-20' }));
    expect((await cash(f, y('2026'))).hash).toBe(before);
    expect(((await cash(f, y('2027'))).data as CashReport).taxReturnNotes).toEqual([expect.objectContaining({ kind: 'amendment', on: '2026-12-20', late: true })]);
  });
});

describe('Werkzeuge für Berichtigung, Prüfung und Anzeige (B9, Spec 0.5.2 § 5)', () => {
  const tool = (name: string) => FINANCE_MCP_TOOLS.find((t) => t.name === name)!;

  it('records notice and amendment over MCP, refuses the close by an agent, files at the amendment', async () => {
    const { f, later, book, period, close } = await filedPeriod();
    const agent = { ...f.ctx, channel: 'mcp' as const };
    await book('2025-06-01', 50_000);
    for (const name of ['finance_tax_amendment_filed', 'finance_tax_amendment_update', 'finance_tax_amendment_close', 'finance_tax_amendment_notified']) expect(tool(name).description, name).toContain('finance.periodClose');
    expect(err(await tool('finance_tax_amendment_close').handler(f.deps, agent, { taxPeriodId: period.id, reason: 'Geprüft.' }))).toMatchObject({ code: 'humanOnly' });
    later();
    expect(unwrap(await tool('finance_tax_amendment_notified').handler(f.deps, agent, { taxPeriodId: period.id, notifiedOn: '2026-09-01' }))).toMatchObject({ kind: 'notified', checkedOn: '2026-09-01' });
    expect(unwrap(await tool('finance_tax_periods_list').handler(f.deps, agent, {}))).toEqual(expect.arrayContaining([expect.objectContaining({ id: period.id, reviewDue: true, notifiedOn: '2026-09-01' })]));
    await close();
    later();
    const amendment = unwrap(await tool('finance_tax_amendment_filed').handler(f.deps, agent, { taxPeriodId: period.id, filedOn: '2026-09-04' })) as { id: string };
    later();
    expect(unwrap(await tool('finance_tax_amendment_update').handler(f.deps, agent, { amendmentId: amendment.id, filedOn: '2026-09-05' }))).toMatchObject({ filedOn: '2026-09-05' });
    const base64 = Buffer.from(pdfBytes()).toString('base64');
    unwrap(await tool('finance_tax_period_document_file').handler(f.deps, agent, { id: period.id, target: 'amendment', amendmentId: amendment.id, slot: 'filedReturn', contentBase64: base64 }));
    const protocol = insertDocument(f, { subject: 'ELSTER-Protokoll' });
    unwrap(await tool('finance_tax_period_document_link').handler(f.deps, agent, { id: period.id, target: 'amendment', amendmentId: amendment.id, slot: 'transmissionProtocol', documentId: protocol }));
    expect((await listTaxPeriods(f.deps, f.ctx, {})).ok).toBe(true);
  });
});
