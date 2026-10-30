import { newId, unwrap } from '@kompass/core';
import { auditEntry, ctxWith } from '@kompass/core/testing';
import { documentLinks, documents } from '@kompass/module-dms';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createTaxPeriod,
  fileTaxPeriodDocument,
  linkTaxPeriodDocument,
  listTaxPeriods,
  saveTaxPeriodAnswers,
  declarationDueOn,
  suggestedDueOn,
  taxPeriodDefaults,
  taxPeriodOfYearInternal,
  updateTaxPeriod,
} from '../src/ledger/tax-periods';
import { financeFiscalYears, financeReports } from '../src/schema';
import { insertDocument, ledgerFixture, pdfBytes } from './helpers';

const code = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : ((r.error as { code?: string; type: string }).code ?? (r.error as { type: string }).type));
const fields = (r: { ok: boolean; error?: unknown }) => (r.ok ? [] : ((r.error as { issues?: { path: string; message: string }[] }).issues ?? []).map((i) => `${i.path}:${i.message}`));
const params = (r: { ok: boolean; error?: unknown }) => (r.ok ? null : (r.error as { params?: Record<string, unknown> }).params);

async function setup() {
  const f = await ledgerFixture({ years: ['2023', '2024', '2025', '2026'] });
  const y = (designation: string) => f.years[designation]!.id;
  return { f, y2023: y('2023'), y2024: y('2024'), y2025: y('2025'), y2026: y('2026') };
}

describe('Erklärungszeitraum (Rechenschaft D2 Task 2)', () => {
  it('creates a period of one to three consecutive years', async () => {
    const { f, y2023, y2025, y2026 } = await setup();
    const period = unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y2023, lastFiscalYearId: y2025, requestedOn: '2026-01-12', withTaxAdvisor: false, dueOn: '2026-07-31' }));
    expect(period).toMatchObject({ label: '2023–2025', firstFiscalYearId: y2023, lastFiscalYearId: y2025, requestedOn: '2026-01-12', dueOn: '2026-07-31', filedOn: null, state: 'open', yearsLocked: false, answers: {}, documents: {} });
    expect(period.fiscalYearIds).toHaveLength(3);
    expect(JSON.parse(auditEntry(f.deps, 'finance.taxPeriod.create').params!)).toEqual({ first: '2023', last: '2025', dueOn: '2026-07-31' });

    const { f: g, y2023: a, y2026: d, y2025: c } = await setup();
    expect(fields(await createTaxPeriod(g.deps, g.ctx, { firstFiscalYearId: a, lastFiscalYearId: d, withTaxAdvisor: false, dueOn: '2027-07-31' }))).toEqual(['lastFiscalYearId:tooManyYears']);
    expect(fields(await createTaxPeriod(g.deps, g.ctx, { firstFiscalYearId: c, lastFiscalYearId: a, withTaxAdvisor: false, dueOn: '2027-07-31' }))).toEqual(['lastFiscalYearId:beforeFirst']);
    // Eine Lücke: 2028 ohne 2027.
    g.deps.db.insert(financeFiscalYears).values({ id: 'FY-2028', startsOn: '2028-01-01', endsOn: '2028-12-31', designation: '2028', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }).run();
    expect(fields(await createTaxPeriod(g.deps, g.ctx, { firstFiscalYearId: d, lastFiscalYearId: 'FY-2028', withTaxAdvisor: false, dueOn: '2029-07-31' }))).toEqual(['lastFiscalYearId:notConsecutive']);
    expect(code(await createTaxPeriod(g.deps, ctxWith(['finance.read'], g.userId), { firstFiscalYearId: c, lastFiscalYearId: c, withTaxAdvisor: false, dueOn: '2026-07-31' }))).toBe('forbidden');
    expect(code(await createTaxPeriod(g.deps, g.ctx, { firstFiscalYearId: 'X', lastFiscalYearId: c, withTaxAdvisor: false, dueOn: '2026-07-31' }))).toBe('notFound');
    expect(y2026).toBeTruthy();
  });

  it('refuses overlapping periods', async () => {
    const { f, y2023, y2025, y2026 } = await setup();
    unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y2023, lastFiscalYearId: y2025, withTaxAdvisor: false, dueOn: '2026-07-31' }));
    const second = await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y2025, lastFiscalYearId: y2026, withTaxAdvisor: false, dueOn: '2027-07-31' });
    expect(code(second)).toBe('taxPeriodOverlap');
    expect(params(second)).toEqual({ designation: '2025', period: '2023–2025' });
    unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y2026, lastFiscalYearId: y2026, withTaxAdvisor: true, dueOn: '2028-02-29' }));
    expect(unwrap(await listTaxPeriods(f.deps, f.ctx, {})).map((p) => p.label)).toEqual(['2026', '2023–2025']);
  });

  it('suggests the next period of three years, as far as they exist, and its deadline (Joe 2026-10-25)', async () => {
    const { f, y2023, y2024, y2025, y2026 } = await setup();
    // Ohne Zeitraum: Von das jüngste beendete Jahr, Bis zwei weiter, soweit angelegt (2027 gibt es nicht).
    expect(unwrap(await taxPeriodDefaults(f.deps, f.ctx, {}))).toEqual({ firstFiscalYearId: y2025, lastFiscalYearId: y2026, dueOn: '2027-08-02', dueOnWithAdvisor: '2028-02-29', statute: null });
    unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y2023, lastFiscalYearId: y2023, withTaxAdvisor: false, dueOn: '2024-07-31' }));
    // Nach einem Zeitraum: Von das Jahr danach, Bis = Von + 2.
    expect(unwrap(await taxPeriodDefaults(f.deps, f.ctx, {}))).toEqual({ firstFiscalYearId: y2024, lastFiscalYearId: y2026, dueOn: '2027-08-02', dueOnWithAdvisor: '2028-02-29', statute: null });
    const g = await setup();
    unwrap(await createTaxPeriod(g.f.deps, g.f.ctx, { firstFiscalYearId: g.y2023, lastFiscalYearId: g.y2025, withTaxAdvisor: false, dueOn: '2026-07-31' }));
    void y2025;
    expect(unwrap(await taxPeriodDefaults(g.f.deps, g.f.ctx, {}))).toEqual({ firstFiscalYearId: g.y2026, lastFiscalYearId: g.y2026, dueOn: '2027-08-02', dueOnWithAdvisor: '2028-02-29', statute: null });
    // Ohne Folgejahr nach dem letzten Zeitraum kein Vorschlag — nie ein Jahr, das schon in einem Zeitraum steht (Befund 23d).
    unwrap(await createTaxPeriod(g.f.deps, g.f.ctx, { firstFiscalYearId: g.y2026, lastFiscalYearId: g.y2026, withTaxAdvisor: false, dueOn: '2027-07-31' }));
    expect(unwrap(await taxPeriodDefaults(g.f.deps, g.f.ctx, {}))).toBeNull();
    expect(suggestedDueOn('2026-12-31', true)).toBe('2028-02-29');
    expect(suggestedDueOn('2025-12-31', true)).toBe('2027-03-01');
    expect(suggestedDueOn('2026-06-30', false)).toBe('2027-08-02');
    const empty = await ledgerFixture();
    expect(unwrap(await taxPeriodDefaults(empty.deps, empty.ctx, {}))).toBeNull();
  });

  it('locks the years once a version is final', async () => {
    const { f, y2023, y2024, y2025 } = await setup();
    const period = unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y2023, lastFiscalYearId: y2025, withTaxAdvisor: false, dueOn: '2026-07-31' }));
    f.deps.clock.set('2026-09-05T09:00:00.000Z');
    const moved = unwrap(await updateTaxPeriod(f.deps, f.ctx, { id: period.id, firstFiscalYearId: y2024, expectedVersion: period.version }));
    expect(moved.label).toBe('2024–2025');
    expect(code(await updateTaxPeriod(f.deps, f.ctx, { id: period.id, dueOn: '2026-08-31', expectedVersion: period.version }))).toBe('staleVersion');
    f.deps.db.insert(financeReports).values({ id: newId(), reportKey: 'taxReturnGem', params: JSON.stringify({ taxPeriodId: period.id }), fiscalYearId: y2025, dataHash: 'h', documentId: 'D', documentNumber: 'FBP-2026-1', releaseBasis: null, finalizedAt: '2026-04-20T10:00:00.000Z', finalizedByUserId: f.userId }).run();
    const locked = unwrap(await listTaxPeriods(f.deps, f.ctx, {}))[0]!;
    expect(locked.yearsLocked).toBe(true);
    expect(code(await updateTaxPeriod(f.deps, f.ctx, { id: period.id, firstFiscalYearId: y2023, expectedVersion: locked.version }))).toBe('taxPeriodYearsLocked');
    const later = unwrap(await updateTaxPeriod(f.deps, f.ctx, { id: period.id, dueOn: '2026-08-31', requestedOn: '2026-02-01', withTaxAdvisor: true, expectedVersion: locked.version }));
    expect(later).toMatchObject({ dueOn: '2026-08-31', requestedOn: '2026-02-01', withTaxAdvisor: true });
    expect(JSON.parse(auditEntry(f.deps, 'finance.taxPeriod.update').params!)).toEqual({ period: '2024–2025' });
    expect(code(await updateTaxPeriod(f.deps, ctxWith(['finance.read'], f.userId), { id: period.id, dueOn: '2026-08-31' }))).toBe('forbidden');
  });

  it('saves the answers', async () => {
    const { f, y2025 } = await setup();
    const period = unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y2025, lastFiscalYearId: y2025, withTaxAdvisor: false, dueOn: '2026-07-31' }));
    const answers = { churchPurposes: false, charitablePurposes: false, statuteDate: '2024-03-01', statuteSubmission: 'onFile', gratuitousBenefits: false, gratuitousBenefitList: [{ reason: 'Jubiläumsfeier', amountCents: 12000 }], replacementAssets: { UNKNOWN: { asset: 'Transporter' } } };
    f.deps.clock.set('2026-09-05T09:00:00.000Z');
    const saved = unwrap(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: period.id, answers, expectedVersion: period.version }));
    expect(saved.answers).toEqual({ churchPurposes: false, charitablePurposes: false, statuteDate: '2024-03-01', statuteSubmission: 'onFile', gratuitousBenefits: false, replacementAssets: { UNKNOWN: { asset: 'Transporter' } } });
    expect(unwrap(await listTaxPeriods(f.deps, f.ctx, {}))[0]!.answers).toEqual(saved.answers);
    const entry = auditEntry(f.deps, 'finance.taxPeriod.answers');
    expect(JSON.parse(entry.params!)).toEqual({ period: '2025' });
    expect(`${entry.before}${entry.after}`).not.toContain('Transporter');
    expect(fields(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: period.id, answers: { gratuitousBenefitList: [{ reason: 'x', amountCents: -1 }] } }))[0]).toMatch(/^answers\.gratuitousBenefitList\.0\.amountCents:/);
    expect(code(await saveTaxPeriodAnswers(f.deps, f.ctx, { id: period.id, answers: {}, expectedVersion: period.version }))).toBe('staleVersion');
    expect(code(await saveTaxPeriodAnswers(f.deps, ctxWith(['finance.read'], f.userId), { id: period.id, answers: {} }))).toBe('forbidden');
  });

  it('files and links documents by slot', async () => {
    const { f, y2024, y2025 } = await setup();
    const period = unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y2024, lastFiscalYearId: y2025, withTaxAdvisor: false, dueOn: '2026-07-31' }));
    const filed = unwrap(await fileTaxPeriodDocument(f.deps, f.ctx, { id: period.id, slot: 'filedReturn', bytes: pdfBytes() }));
    expect(filed.documents.filedReturn).toMatchObject({ documentNumber: expect.stringMatching(/^STE-/) });
    const docId = filed.documents.filedReturn!.documentId;
    expect(f.deps.db.select().from(documents).where(eq(documents.id, docId)).get()!.typeKey).toBe('finance-tax-return');
    const links = f.deps.db.select().from(documentLinks).where(eq(documentLinks.documentId, docId)).all().map((l) => `${l.entityType}:${l.entityId}`);
    expect(links).toEqual(expect.arrayContaining([`financeTaxPeriod:${period.id}`, `financeFiscalYear:${y2025}`]));
    expect(JSON.parse(auditEntry(f.deps, 'finance.taxPeriod.documentFile').params!)).toEqual({ period: '2024–2025', slot: 'filedReturn', documentNumber: filed.documents.filedReturn!.documentNumber });
    expect(fields(await fileTaxPeriodDocument(f.deps, f.ctx, { id: period.id, slot: 'request', bytes: new TextEncoder().encode('kein pdf') }))).toEqual(['bytes:notPdf']);

    const voided = insertDocument(f, { subject: 'Alt', typeKey: 'voucher-invoice', voided: true });
    expect(fields(await linkTaxPeriodDocument(f.deps, f.ctx, { id: period.id, slot: 'request', documentId: voided }))).toEqual(['documentId:documentVoided']);
    const letter = insertDocument(f, { subject: 'Aufforderung', typeKey: 'voucher-invoice' });
    const linked = unwrap(await linkTaxPeriodDocument(f.deps, f.ctx, { id: period.id, slot: 'request', documentId: letter }));
    expect(linked.documents.request?.documentId).toBe(letter);
    expect(f.deps.db.select().from(documentLinks).where(and(eq(documentLinks.documentId, letter), eq(documentLinks.entityType, 'financeTaxPeriod'))).get()).toBeTruthy();
    expect(JSON.parse(auditEntry(f.deps, 'finance.taxPeriod.documentLink').params!)).toMatchObject({ period: '2024–2025', slot: 'request' });
    expect(code(await fileTaxPeriodDocument(f.deps, ctxWith(['finance.read'], f.userId), { id: period.id, slot: 'request', bytes: pdfBytes() }))).toBe('forbidden');
  });

  it('finds the period of a year', async () => {
    const { f, y2023, y2024, y2025, y2026 } = await setup();
    const period = unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: y2023, lastFiscalYearId: y2025, withTaxAdvisor: false, dueOn: '2026-07-31' }));
    expect(taxPeriodOfYearInternal(f.deps.db, y2024)?.id).toBe(period.id);
    expect(taxPeriodOfYearInternal(f.deps.db, y2026)).toBeNull();
  });
});

describe('declarationDueOn', () => {
  it('moves the deadline to the next working day and knows the EGAO dates', () => {
    expect(declarationDueOn(2026, false)).toBe('2027-08-02');
    expect(declarationDueOn(2026, true)).toBe('2028-02-29');
    expect(declarationDueOn(2025, true)).toBe('2027-03-01');
    expect(declarationDueOn(2024, true)).toBe('2026-04-30');
    expect(declarationDueOn(2024, false)).toBe('2025-07-31');
    expect(suggestedDueOn('2026-12-31', false)).toBe('2027-08-02');
  });
});
