import { newId, unwrap } from '@kompass/core';
import { auditEntry, ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { requestAllocationCorrection } from '../src/ledger/corrections';
import { bookEntry } from '../src/ledger/finalize';
import { reverseEntry } from '../src/ledger/reverse';
import { listVatPeriods } from '../src/ledger/vat-filings';
import { listFinanceDeadlines } from '../src/closing/deadlines';
import { fileVatFilingDocument, linkVatFilingDocument, listVatPeriodsWithPayments, recordVatFiling, updateVatFiling } from '../src/reporting/vat-filing';
import { finalizeFinanceReport } from '../src/reporting/finalize';
import type { VatSummaryReport } from '../src/reporting/reports/vat-summary';
import { runFinanceReport } from '../src/reporting/service';
import { insertDocument, pdfBytes } from './helpers';
import { vatPeriodDigestInternal } from '../src/ledger/vat-periods';
import { financeVatFilings } from '../src/schema';
import { ledgerFixture } from './helpers';

type F = Awaited<ReturnType<typeof ledgerFixture>>;
const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? null : (r.error as { type: string; code?: string; issues?: { path: string; message: string }[] }));
const code = (r: { ok: boolean; error?: unknown }) => { const e = err(r); return e ? (e.code ?? e.type) : 'ok'; };
const fields = (r: { ok: boolean; error?: unknown }) => (err(r)?.issues ?? []).map((i) => `${i.path}:${i.message}`);

const book = (f: F, date: string, opts: { serviceDate?: string; cents?: number } = {}) =>
  bookEntry(f.deps, f.ctx, { entryDate: date, text: 'Werbung', moneyLines: [{ accountId: f.bank.id, amountCents: opts.cents ?? -20000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: opts.cents ?? -20000, taxCode: 'rc13bEu', ...(opts.serviceDate ? { serviceDate: opts.serviceDate } : {}) }] }).then(unwrap);

const q2 = async (f: F) => unwrap(await listVatPeriods(f.deps, f.ctx, { year: 2026 })).advance.find((p) => p.key === '2026-Q2')!;

/** Plan E6a Task 5 — Abgabe je Zeitraum und Berichtigung. */
describe('VAT filings', () => {
  it('records a filed advance return', async () => {
    const f = await ledgerFixture({ entrepreneur: true });
    await book(f, '2026-05-12');
    const filing = unwrap(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q2', filedOn: '2026-07-08' }));
    expect(filing).toMatchObject({ period: '2026-Q2', filedOn: '2026-07-08', amendment: false });
    expect(await q2(f)).toMatchObject({ amendmentDue: false, filings: [expect.objectContaining({ period: '2026-Q2' })] });
    expect(JSON.parse(auditEntry(f.deps, 'finance.vatFiling.record').params!)).toEqual({ period: '2026-Q2', filedOn: '2026-07-08', amendment: false });
    expect(code(await recordVatFiling(f.deps, ctxWith(['finance.read'], f.userId), { period: '2026-Q2', filedOn: '2026-07-08' }))).toBe('forbidden');
    expect(code(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q3', filedOn: '2026-07-08' }))).toBe('vatAdvanceReturnNotDue');
    expect(code(await recordVatFiling(f.deps, f.ctx, { period: '2026-05', filedOn: '2026-07-08' }))).toBe('vatAdvanceReturnNotDue');
    expect(fields(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q2', filedOn: '2026-06-30' }))).toEqual(['filedOn:beforePeriodEnd']);
    // N7/N26: Die Ablehnung nennt den Tag, ab dem die Abgabe geht.
    expect(err(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q2', filedOn: '2026-06-30' }))!.issues![0]).toMatchObject({ params: { opensOn: '2026-07-01' } });
    expect(fields(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q2', filedOn: '2026-12-01' }))).toEqual(['filedOn:inFuture']);
    expect(fields(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q9', filedOn: '2026-07-08' }))).toEqual(['period:invalid']);
  });

  it('asks for an amended return after a change', async () => {
    const f = await ledgerFixture({ entrepreneur: true });
    const may = await book(f, '2026-05-12');
    unwrap(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q2', filedOn: '2026-07-08' }));
    await book(f, '2026-07-20', { serviceDate: '2026-05-30', cents: -1000 });
    expect((await q2(f)).amendmentDue).toBe(true);

    const g = await ledgerFixture({ entrepreneur: true });
    await book(g, '2026-05-12');
    unwrap(await recordVatFiling(g.deps, g.ctx, { period: '2026-Q2', filedOn: '2026-07-08' }));
    await book(g, '2026-07-20', { cents: -1000 });
    const periods = unwrap(await listVatPeriods(g.deps, g.ctx, { year: 2026 })).advance;
    expect(periods.find((p) => p.key === '2026-Q3')!.required).toBe(true);
    expect(periods.find((p) => p.key === '2026-Q2')!.amendmentDue).toBe(false);

    const h = await ledgerFixture({ entrepreneur: true });
    const hMay = await book(h, '2026-05-12');
    unwrap(await recordVatFiling(h.deps, h.ctx, { period: '2026-Q2', filedOn: '2026-07-08' }));
    const corrected = unwrap(await requestAllocationCorrection(h.deps, h.ctx, { lineId: hMay.allocationLines[0]!.id, changes: { taxCode: 'rc13bOther' }, note: 'Anbieter sitzt im Drittland' }));
    expect(corrected.notices).toContain('vatAmendment');
    expect((await q2(h)).amendmentDue).toBe(true);
    const second = unwrap(await recordVatFiling(h.deps, h.ctx, { period: '2026-Q2', filedOn: '2026-09-01' }));
    expect(second.amendment).toBe(true);
    expect(await q2(h)).toMatchObject({ amendmentDue: false });
    expect((await q2(h)).filings).toHaveLength(2);
    void may;
  });

  // Designer Runde 8, 345: „Zu zahlen“ einer Berichtigung ist die Nachzahlung — berichtigte Kz 83 abzüglich der zuletzt
  // abgegebenen. Der Dienst rechnet, Seite und Agent lesen dasselbe.
  it('names the payment of an amendment as the difference to the last filing', async () => {
    const f = await ledgerFixture({ entrepreneur: true });
    const q2 = async (g: F) => unwrap(await listVatPeriodsWithPayments(g.deps, g.ctx, { year: 2026 })).advance.find((p) => p.key === '2026-Q2')!;
    await book(f, '2026-05-12');
    unwrap(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q2', filedOn: '2026-07-08' }));
    expect((await q2(f)).amendmentPayment).toBeNull();
    await book(f, '2026-07-20', { serviceDate: '2026-05-30', cents: -12000 });
    expect((await q2(f)).amendmentPayment).toEqual({ amendedCents: 6080, filedCents: 3800, payableCents: 2280, filedOn: '2026-07-08', first: true });
    unwrap(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q2', filedOn: '2026-08-01' }));
    await book(f, '2026-08-20', { serviceDate: '2026-06-02', cents: -10000 });
    expect((await q2(f)).amendmentPayment).toEqual({ amendedCents: 7980, filedCents: 6080, payableCents: 1900, filedOn: '2026-08-01', first: false });
  });

  it('asks for an amended return after a reversal of a filed line', async () => {
    const f = await ledgerFixture({ entrepreneur: true });
    const may = await book(f, '2026-05-12');
    unwrap(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q2', filedOn: '2026-07-08' }));
    unwrap(await reverseEntry(f.deps, f.ctx, { id: may.id }));
    expect(await q2(f)).toMatchObject({ required: false, amendmentDue: true });
    // Die berichtigte Anmeldung lässt sich eintragen, obwohl der Zeitraum nun ohne Zahlen ist.
    expect(unwrap(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q2', filedOn: '2026-09-01' })).amendment).toBe(true);
  });

  // N6 (MCP-Nachttest 0.4.0, Joe 2026-10-27): Eine zweite Abgabe ist die Berichtigung — nur, wenn eine fällig ist
  // (dieselbe Regel wie Frist und Hinweis). Ein Doppelklick oder ein wiederholender Agent legt keine zweite an.
  it('refuses a second filing while no amendment is due', async () => {
    const f = await ledgerFixture({ entrepreneur: true });
    f.deps.clock.set('2026-09-10T10:00:00.000Z');
    await book(f, '2026-05-12');
    const first = unwrap(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q2', filedOn: '2026-07-08' }));
    expect(first.figures).toMatchObject({ amended: 0 });
    const again = await recordVatFiling(f.deps, f.ctx, { period: '2026-Q2', filedOn: '2026-07-08' });
    expect(code(again)).toBe('vatAmendmentNotDue');
    expect(err(again)).toMatchObject({ params: { vatPeriod: '2026-Q2', filedOn: '2026-07-08' } });
    expect((await q2(f)).filings).toHaveLength(1);
    // Nach dem Nachbuchen ist die Berichtigung fällig: Kz 10 = 1 in den festgehaltenen Werten.
    await book(f, '2026-07-20', { serviceDate: '2026-05-30', cents: -1000 });
    const amended = unwrap(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q2', filedOn: '2026-08-01' }));
    expect(amended).toMatchObject({ amendment: true, figures: expect.objectContaining({ amended: 1, rc13bEuBase: 21000 }) });
    expect(code(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q2', filedOn: '2026-08-02' }))).toBe('vatAmendmentNotDue');

    // Die Jahreserklärung ebenso.
    const g = await ledgerFixture({ years: ['2026', '2027'], entrepreneur: true });
    await book(g, '2026-05-12');
    g.deps.clock.set('2027-05-03T10:00:00.000Z');
    unwrap(await recordVatFiling(g.deps, g.ctx, { period: '2026', filedOn: '2027-05-03' }));
    expect(code(await recordVatFiling(g.deps, g.ctx, { period: '2026', filedOn: '2027-05-03' }))).toBe('vatAmendmentNotDue');
  });

  it('records the annual return per calendar year', async () => {
    const f = await ledgerFixture({ years: ['2026', '2027'], entrepreneur: true });
    await book(f, '2026-05-12');
    f.deps.clock.set('2027-05-03T10:00:00.000Z');
    unwrap(await recordVatFiling(f.deps, f.ctx, { period: '2026', filedOn: '2027-05-03' }));
    expect(unwrap(await listVatPeriods(f.deps, f.ctx, { year: 2026 })).annual).toMatchObject({ key: '2026', required: true, filings: [expect.objectContaining({ period: '2026' })], amendmentDue: false });
    expect(code(await recordVatFiling(f.deps, f.ctx, { period: '2027', filedOn: '2027-05-03' }))).toBe('vatReturnNotDue');
  });
  // N5 (MCP-Nachttest 0.4.0): Die Jahreszahl trägt die Steuer wie die Quartale und die Jahreserklärung (`vatSummary`).
  it('sums base and tax of the year like the quarters and the annual return', async () => {
    const f = await ledgerFixture({ years: ['2026', '2027'], entrepreneur: true });
    await book(f, '2026-05-12');
    await book(f, '2026-08-03', { cents: -4900 });
    f.deps.clock.set('2027-01-20T10:00:00.000Z');
    const periods = unwrap(await listVatPeriods(f.deps, f.ctx, { year: 2026 }));
    const sum = (pick: (a: { baseCents: number; taxCents: number }) => number) => periods.advance.reduce((s, p) => s + pick(p.amounts.rc13bEu), 0);
    expect(periods.annual.amounts.rc13bEu).toEqual({ baseCents: sum((a) => a.baseCents), taxCents: sum((a) => a.taxCents) });
    expect(periods.annual.amounts.rc13bEu).toEqual({ baseCents: 24900, taxCents: 4731 });
    const summary = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'vatSummary', params: { fiscalYearId: f.year.id } })).data as VatSummaryReport;
    expect(summary.values.find((v) => v.source === 'rc13bEuTax')!.cents).toBe(4731);
  });

  it('names the cause of an amendment', async () => {
    const at = (f: F, day: string) => f.deps.clock.set(`${day}T10:00:00.000Z`);
    const f = await ledgerFixture({ entrepreneur: true });
    at(f, '2026-07-08');
    await book(f, '2026-05-12');
    unwrap(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q2', filedOn: '2026-07-08' }));
    expect((await q2(f)).amendmentCause).toBeNull();
    at(f, '2026-07-20');
    const late = await book(f, '2026-07-20', { serviceDate: '2026-05-30', cents: -1000 });
    expect((await q2(f)).amendmentCause).toEqual({ entryId: late.id, entryNumber: late.number, change: 'booked', changedOn: '2026-07-20', more: 0 });
    at(f, '2026-07-22');
    const later = await book(f, '2026-07-22', { serviceDate: '2026-06-02', cents: -500 });
    expect((await q2(f)).amendmentCause).toMatchObject({ entryId: later.id, change: 'booked', changedOn: '2026-07-22', more: 1 });

    const g = await ledgerFixture({ entrepreneur: true });
    at(g, '2026-07-08');
    const may = await book(g, '2026-05-12');
    unwrap(await recordVatFiling(g.deps, g.ctx, { period: '2026-Q2', filedOn: '2026-07-08' }));
    at(g, '2026-08-03');
    unwrap(await requestAllocationCorrection(g.deps, g.ctx, { lineId: may.allocationLines[0]!.id, changes: { taxCode: 'rc13bOther' }, note: 'Anbieter sitzt im Drittland' }));
    expect((await q2(g)).amendmentCause).toEqual({ entryId: may.id, entryNumber: may.number, change: 'corrected', changedOn: '2026-08-03', more: 0 });

    const h = await ledgerFixture({ entrepreneur: true });
    at(h, '2026-07-08');
    const hMay = await book(h, '2026-05-12');
    unwrap(await recordVatFiling(h.deps, h.ctx, { period: '2026-Q2', filedOn: '2026-07-08' }));
    at(h, '2026-08-10');
    unwrap(await reverseEntry(h.deps, h.ctx, { id: hMay.id }));
    expect((await q2(h)).amendmentCause).toEqual({ entryId: hMay.id, entryNumber: hMay.number, change: 'reversed', changedOn: '2026-08-10', more: 0 });

    const k = await ledgerFixture({ entrepreneur: true });
    at(k, '2026-07-08');
    await book(k, '2026-05-12');
    // Eine Abgabe ohne Abbild, wie aus dem Übertrag vor 0.4.0.
    k.deps.db.insert(financeVatFilings).values({ id: newId(), period: '2026-Q2', filedOn: '2026-07-08', amendment: false, linesDigest: vatPeriodDigestInternal(k.deps.db, '2026-Q2'), linesSnapshot: null, at: '2026-07-08T10:00:00.000Z', byUserId: k.userId }).run();
    at(k, '2026-07-20');
    await book(k, '2026-07-20', { serviceDate: '2026-05-30', cents: -1000 });
    expect(await q2(k)).toMatchObject({ amendmentDue: true, amendmentCause: null });
  });

  it('keeps the figures and the finalized version of a filing', async () => {
    const f = await ledgerFixture({ entrepreneur: true });
    f.deps.clock.set('2026-07-08T10:00:00.000Z');
    await book(f, '2026-05-12');
    const finalized = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'vatAdvanceReturn', params: { vatPeriod: '2026-Q2' } }));
    const filing = unwrap(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q2', filedOn: '2026-07-08' }));
    expect(filing).toMatchObject({ reportId: finalized.reportId, figures: expect.objectContaining({ rc13bEuBase: 20000, rc13bEuTax: 3800, result: 3800 }) });
    expect((await q2(f)).filings.at(-1)).toMatchObject({ reportId: finalized.reportId });

    const g = await ledgerFixture({ entrepreneur: true });
    g.deps.clock.set('2026-07-08T10:00:00.000Z');
    await book(g, '2026-05-12');
    expect(unwrap(await recordVatFiling(g.deps, g.ctx, { period: '2026-Q2', filedOn: '2026-07-08' }))).toMatchObject({ reportId: null, figures: expect.objectContaining({ rc13bEuBase: 20000 }) });

    const h = await ledgerFixture({ entrepreneur: true });
    h.deps.clock.set('2026-07-08T10:00:00.000Z');
    await book(h, '2026-05-12');
    unwrap(await finalizeFinanceReport(h.deps, h.ctx, { report: 'vatAdvanceReturn', params: { vatPeriod: '2026-Q2' } }));
    await book(h, '2026-07-08', { serviceDate: '2026-06-01', cents: -1000 });
    expect(unwrap(await recordVatFiling(h.deps, h.ctx, { period: '2026-Q2', filedOn: '2026-07-08' }))).toMatchObject({ reportId: null, figures: expect.objectContaining({ rc13bEuBase: 21000 }) });
  });

  it('changes the date of the latest filing only', async () => {
    const f = await ledgerFixture({ entrepreneur: true });
    f.deps.clock.set('2026-09-10T10:00:00.000Z');
    await book(f, '2026-05-12');
    const first = unwrap(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q2', filedOn: '2026-07-08' }));
    await book(f, '2026-07-20', { serviceDate: '2026-05-30', cents: -1000 });
    const second = unwrap(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q2', filedOn: '2026-08-01' }));
    expect(code(await updateVatFiling(f.deps, f.ctx, { filingId: first.id, filedOn: '2026-07-09' }))).toBe('vatFilingNotLatest');
    expect(unwrap(await updateVatFiling(f.deps, f.ctx, { filingId: second.id, filedOn: '2026-08-02' }))).toMatchObject({ id: second.id, filedOn: '2026-08-02' });
    expect(JSON.parse(auditEntry(f.deps, 'finance.vatFiling.update').params!)).toEqual({ period: '2026-Q2', filedOn: '2026-08-02' });
    expect(fields(await updateVatFiling(f.deps, f.ctx, { filingId: second.id, filedOn: '2026-06-30' }))).toEqual(['filedOn:beforePeriodEnd']);
    expect(code(await updateVatFiling(f.deps, ctxWith(['finance.read'], f.userId), { filingId: second.id, filedOn: '2026-08-03' }))).toBe('forbidden');
  });

  it('files the transmission protocol and the filed return', async () => {
    const f = await ledgerFixture({ entrepreneur: true });
    f.deps.clock.set('2026-07-08T10:00:00.000Z');
    await book(f, '2026-05-12');
    const filing = unwrap(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q2', filedOn: '2026-07-08' }));
    const filed = unwrap(await fileVatFilingDocument(f.deps, f.ctx, { filingId: filing.id, slot: 'transmissionProtocol', bytes: pdfBytes(), fileName: 'protokoll.pdf' }));
    expect(filed.documents.transmissionProtocol?.documentNumber).toMatch(/^UST-/);
    expect(JSON.parse(auditEntry(f.deps, 'finance.vatFiling.documentFile').params!)).toEqual({ period: '2026-Q2', slot: 'transmissionProtocol' });
    expect(code(await fileVatFilingDocument(f.deps, f.ctx, { filingId: filing.id, slot: 'filedReturn', bytes: pdfBytes() }))).toBe('vatFilingNotFinalized');
    const voided = insertDocument(f, { subject: 'alt', typeKey: 'finance-vat-return', voided: true });
    expect(fields(await linkVatFilingDocument(f.deps, f.ctx, { filingId: filing.id, slot: 'transmissionProtocol', documentId: voided }))).toEqual(['documentId:documentVoided']);
    const other = insertDocument(f, { subject: 'Protokoll', typeKey: 'finance-vat-return' });
    expect(unwrap(await linkVatFilingDocument(f.deps, f.ctx, { filingId: filing.id, slot: 'transmissionProtocol', documentId: other })).documents.transmissionProtocol?.documentId).toBe(other);
    expect(JSON.parse(auditEntry(f.deps, 'finance.vatFiling.documentLink').params!)).toEqual({ period: '2026-Q2', slot: 'transmissionProtocol' });
  });
});

// N8 (MCP-Nachttest 0.4.0): Der Hinweis „Berichtigung fällig“ an Buchen, Storno und Korrektur kommt genau dann, wenn
// danach unter Fristen eine Berichtigung steht — beide aus dem Fingerabdruck der letzten Abgabe.
describe('notice of an amended return follows the deadline', () => {
  const amendmentDeadlines = async (f: F) => unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed.filter((d) => d.kind === 'vatAmendment').map((d) => d.key);

  it('booking into a filed period notes the amendment, booking elsewhere does not', async () => {
    const f = await ledgerFixture({ entrepreneur: true });
    await book(f, '2026-05-12');
    unwrap(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q2', filedOn: '2026-07-08' }));
    const later = await book(f, '2026-07-20', { serviceDate: '2026-05-30', cents: -12000 });
    expect(later.notices).toContain('vatAmendment');
    expect(await amendmentDeadlines(f)).toContain('vatAmendment:2026-Q2');
    const g = await ledgerFixture({ entrepreneur: true });
    await book(g, '2026-05-12');
    unwrap(await recordVatFiling(g.deps, g.ctx, { period: '2026-Q2', filedOn: '2026-07-08' }));
    expect((await book(g, '2026-07-20')).notices).not.toContain('vatAmendment');
    expect(await amendmentDeadlines(g)).toEqual([]);
  });

  it('a reversal of a filed line notes the amendment', async () => {
    const f = await ledgerFixture({ entrepreneur: true });
    const may = await book(f, '2026-05-12');
    unwrap(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q2', filedOn: '2026-07-08' }));
    const reversed = unwrap(await reverseEntry(f.deps, f.ctx, { id: may.id }));
    expect(reversed.reversal.notices).toContain('vatAmendment');
    expect(await amendmentDeadlines(f)).toContain('vatAmendment:2026-Q2');
  });

  it('a correction back to the filed values notes nothing, like the deadlines', async () => {
    const f = await ledgerFixture({ entrepreneur: true });
    const may = await book(f, '2026-05-12');
    unwrap(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q2', filedOn: '2026-07-08' }));
    const lineId = may.allocationLines[0]!.id;
    const away = unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId, changes: { taxCode: 'none' }, note: 'Kein § 13b' }));
    expect(away.notices).toContain('vatAmendment');
    expect(await amendmentDeadlines(f)).toContain('vatAmendment:2026-Q2');
    const back = unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId, changes: { taxCode: 'rc13bEu' }, note: 'Doch § 13b' }));
    expect(back.notices).not.toContain('vatAmendment');
    expect(await amendmentDeadlines(f)).toEqual([]);
  });
});

// N14 (MCP-Nachttest 0.4.0, Joe 2026-10-27): Eine Berichtigung ist nur fällig, wenn sich die Kennzahlen eines abgegebenen
// Zeitraums ändern (§ 153 AO: die Erklärung ist unrichtig) — nicht schon, weil sich eine Zeile darin ändert.
describe('an amended return is due only when the figures change', () => {
  const amendmentDeadlines = async (f: F) => unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed.filter((d) => d.kind === 'vatAmendment').map((d) => d.key);
  const filedQ2andQ3 = async () => {
    const f = await ledgerFixture({ entrepreneur: true });
    f.deps.clock.set('2026-10-05T10:00:00.000Z');
    await book(f, '2026-05-12');
    const august = await book(f, '2026-08-03', { serviceDate: '2026-06-10', cents: -5000 });
    await book(f, '2026-09-01', { cents: -3000 });
    unwrap(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q2', filedOn: '2026-10-05' }));
    unwrap(await recordVatFiling(f.deps, f.ctx, { period: '2026-Q3', filedOn: '2026-10-05' }));
    return { f, lineId: august.allocationLines[0]!.id };
  };

  it('a service date within the same period changes nothing', async () => {
    const { f, lineId } = await filedQ2andQ3();
    const corrected = unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId, changes: { serviceDate: '2026-06-20' }, note: 'Leistungstag genauer' }));
    expect(corrected.notices).not.toContain('vatAmendment');
    expect(await amendmentDeadlines(f)).toEqual([]);
    expect((await q2(f)).amendmentDue).toBe(false);
  });

  it('a service date in the next period makes both due', async () => {
    const { f, lineId } = await filedQ2andQ3();
    const corrected = unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId, changes: { serviceDate: '2026-07-15' }, note: 'Leistung im Juli' }));
    expect(corrected.notices).toContain('vatAmendment');
    expect(await amendmentDeadlines(f)).toEqual(expect.arrayContaining(['vatAmendment:2026-Q2', 'vatAmendment:2026-Q3']));
  });

  it('a changed amount makes it due, the same amount booked again does not', async () => {
    const { f } = await filedQ2andQ3();
    const more = await book(f, '2026-10-05', { serviceDate: '2026-05-20', cents: -1000 });
    expect(more.notices).toContain('vatAmendment');
    expect(await amendmentDeadlines(f)).toContain('vatAmendment:2026-Q2');
    // Zurückgenommen: die Kennzahlen sind wieder die abgegebenen.
    unwrap(await reverseEntry(f.deps, f.ctx, { id: more.id }));
    expect(await amendmentDeadlines(f)).toEqual([]);
  });
});

// N26 (MCP-Nachttest 0.4.0): Die Fristen der Umsatzsteuer nennen den Tag, ab dem die Abgabe geht.
describe('VAT deadlines name the first day of filing', () => {
  it('carries fileableFrom on advance and annual returns', async () => {
    const f = await ledgerFixture({ years: ['2026', '2027'], entrepreneur: true });
    await book(f, '2026-05-12');
    f.deps.clock.set('2027-01-05T10:00:00.000Z');
    const computed = unwrap(await listFinanceDeadlines(f.deps, f.ctx, {})).computed;
    expect(computed.find((d) => d.key === 'vatAdvanceReturn:2026-Q2')).toMatchObject({ fileableFrom: '2026-07-01' });
    expect(computed.find((d) => d.key === 'vatReturn:2026')).toMatchObject({ fileableFrom: '2027-01-01' });
  });
});
