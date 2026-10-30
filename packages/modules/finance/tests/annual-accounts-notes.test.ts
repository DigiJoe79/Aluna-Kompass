import { newId, unwrap } from '@kompass/core';
import { auditEntry, ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { ANNUAL_ACCOUNTS_EXPLANATION_MAX, annualAccountsExplanationInternal, getAnnualAccountsExplanation, saveAnnualAccountsExplanation } from '../src/reporting/annual-accounts-notes';
import { financeReports } from '../src/schema';
import { ledgerFixture } from './helpers';

const code = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : ((r.error as { code?: string; type: string }).code ?? (r.error as { type: string }).type));
const fields = (r: { ok: boolean; error?: unknown }) => (r.ok ? [] : ((r.error as { issues?: { path: string; message: string }[] }).issues ?? []).map((i) => `${i.path}:${i.message}`));

function insertAnnualAccounts(f: Awaited<ReturnType<typeof ledgerFixture>>, voided = false) {
  f.deps.db
    .insert(financeReports)
    .values({ id: newId(), reportKey: 'annualAccounts', params: JSON.stringify({ fiscalYearId: f.year.id }), fiscalYearId: f.year.id, dataHash: 'x', documentId: 'D', documentNumber: 'BER-2026-0001', releaseBasis: 'auditReport', finalizedAt: '2027-02-25T10:00:00.000Z', finalizedByUserId: 'U1', voidedAt: voided ? '2027-03-01T10:00:00.000Z' : null })
    .run();
}

describe('Erläuterung der Jahresrechnung (J1 Task 4)', () => {
  it('speichert, liest und löscht bei leerem Text', async () => {
    const f = await ledgerFixture();
    expect(unwrap(await getAnnualAccountsExplanation(f.deps, f.ctx, { fiscalYearId: f.year.id }))).toEqual({ fiscalYearId: f.year.id, text: '', updatedAt: null, updatedByUserId: null, locked: false });
    const saved = unwrap(await saveAnnualAccountsExplanation(f.deps, f.ctx, { fiscalYearId: f.year.id, text: '  Ein **gutes** Jahr.  ' }));
    expect(saved).toMatchObject({ text: 'Ein **gutes** Jahr.', updatedByUserId: f.userId, locked: false });
    expect(annualAccountsExplanationInternal(f.deps.db, f.year.id)?.text).toBe('Ein **gutes** Jahr.');
    const entry = auditEntry(f.deps, 'finance.annualAccounts.explanationSave');
    expect(JSON.parse(entry.params!)).toEqual({ designation: f.year.designation, length: 19 });
    expect(JSON.stringify(entry)).not.toContain('gutes');
    // Veraltete Version.
    expect(code(await saveAnnualAccountsExplanation(f.deps, f.ctx, { fiscalYearId: f.year.id, text: 'x', expectedVersion: '2000-01-01T00:00:00.000Z' }))).toBe('staleVersion');
    unwrap(await saveAnnualAccountsExplanation(f.deps, f.ctx, { fiscalYearId: f.year.id, text: '   ' }));
    expect(annualAccountsExplanationInternal(f.deps.db, f.year.id)).toBeNull();
  });

  it('zwei Tabs, die leer begonnen haben: der zweite bekommt den Konflikt (Review U1)', async () => {
    const f = await ledgerFixture();
    unwrap(await saveAnnualAccountsExplanation(f.deps, f.ctx, { fiscalYearId: f.year.id, text: 'Tab A', expectedVersion: null }));
    expect(code(await saveAnnualAccountsExplanation(f.deps, f.ctx, { fiscalYearId: f.year.id, text: 'Tab B', expectedVersion: null }))).toBe('staleVersion');
    expect(annualAccountsExplanationInternal(f.deps.db, f.year.id)?.text).toBe('Tab A');
    // Spiegelfall: A leert, B speichert mit seinem alten Stand.
    const seen = annualAccountsExplanationInternal(f.deps.db, f.year.id)!.updatedAt;
    unwrap(await saveAnnualAccountsExplanation(f.deps, f.ctx, { fiscalYearId: f.year.id, text: '', expectedVersion: seen }));
    expect(code(await saveAnnualAccountsExplanation(f.deps, f.ctx, { fiscalYearId: f.year.id, text: 'Tab B', expectedVersion: seen }))).toBe('staleVersion');
    expect(annualAccountsExplanationInternal(f.deps.db, f.year.id)).toBeNull();
  });

  it('kennt die Grenze von 4.000 Zeichen', async () => {
    const f = await ledgerFixture();
    expect(ANNUAL_ACCOUNTS_EXPLANATION_MAX).toBe(4000);
    expect(code(await saveAnnualAccountsExplanation(f.deps, f.ctx, { fiscalYearId: f.year.id, text: 'x'.repeat(4000) }))).toBe('ok');
    expect(fields(await saveAnnualAccountsExplanation(f.deps, f.ctx, { fiscalYearId: f.year.id, text: 'x'.repeat(4001) }))).toEqual(['text:tooLong']);
  });

  it('verlangt finance.reportsFinalize zum Speichern und finance.read oder finance.overview zum Lesen', async () => {
    const f = await ledgerFixture();
    expect(code(await saveAnnualAccountsExplanation(f.deps, ctxWith(['finance.read'], f.userId), { fiscalYearId: f.year.id, text: 'x' }))).toBe('forbidden');
    expect(code(await getAnnualAccountsExplanation(f.deps, ctxWith(['finance.overview'], f.userId), { fiscalYearId: f.year.id }))).toBe('ok');
    expect(code(await getAnnualAccountsExplanation(f.deps, ctxWith(['contacts.view'], f.userId), { fiscalYearId: f.year.id }))).toBe('forbidden');
    expect(code(await saveAnnualAccountsExplanation(f.deps, f.ctx, { fiscalYearId: 'NOPE', text: 'x' }))).toBe('notFound');
  });

  it('ist gesperrt, solange eine nicht stornierte Jahresrechnung des Jahres besteht', async () => {
    const f = await ledgerFixture();
    insertAnnualAccounts(f, true);
    expect(code(await saveAnnualAccountsExplanation(f.deps, f.ctx, { fiscalYearId: f.year.id, text: 'vorher' }))).toBe('ok');
    insertAnnualAccounts(f);
    expect(code(await saveAnnualAccountsExplanation(f.deps, f.ctx, { fiscalYearId: f.year.id, text: 'danach' }))).toBe('annualAccountsExplanationLocked');
    expect(unwrap(await getAnnualAccountsExplanation(f.deps, f.ctx, { fiscalYearId: f.year.id }))).toMatchObject({ text: 'vorher', locked: true });
  });
});
