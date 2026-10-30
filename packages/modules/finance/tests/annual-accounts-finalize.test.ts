import { unwrap } from '@kompass/core';
import { auditEntry, ctxWith } from '@kompass/core/testing';
import { addContactRole, createContact } from '@kompass/module-contacts';
import { documents } from '@kompass/module-dms';
import { createProject, setProjectPublished } from '@kompass/module-projects';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { recordNameConsent } from '../src/allocation/name-consents';
import { bookEntry } from '../src/ledger/finalize';
import { fileAccountStatementDocument } from '../src/ledger/statement-documents';
import { saveAnnualAccountsExplanation } from '../src/reporting/annual-accounts-notes';
import { finalizeFinanceReport, previewFinanceReport, releaseReportsForFinalizing } from '../src/reporting/finalize';
import { runFinanceReport } from '../src/reporting/service';
import type { AnnualAccounts } from '../src/reporting/reports/annual-accounts';
import { financeCategories, financeReports } from '../src/schema';
import { ledgerFixture, pdfBytes } from './helpers';

type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;
const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
const contactCtx = ctxWith(['contacts.view', 'contacts.manage']);
const category = (f: Fixture, key: string) => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get()!;
const book = (f: Fixture, date: string, key: string, cents: number, line: Record<string, unknown> = {}, entry: Record<string, unknown> = {}) =>
  bookEntry(f.deps, f.ctx, { ...entry, entryDate: date, text: key, moneyLines: [{ accountId: f.bank.id, amountCents: cents }], allocationLines: [{ categoryId: category(f, key).id, amountCents: cents, taxCode: 'none', ...line }] }).then(unwrap);

async function closedYear() {
  const f = await ledgerFixture({ years: ['2025', '2026'] });
  const y2025 = f.years['2025']!.id;
  const donor = unwrap(await createContact(f.deps, contactCtx, { kind: 'person', firstName: 'Petra', lastName: 'Privatier' }));
  const project = unwrap(await createProject(f.deps, ctxWith(['projects.manage']), { slug: 'offen', name: { de: 'Offenes Projekt' }, type: 'ongoing' as const, summary: { de: '' }, body: { de: '' } }));
  unwrap(await setProjectPublished(f.deps, ctxWith(['projects.manage']), { id: project.id, isPublished: true }));
  await book(f, '2025-03-01', 'donations', 10000);
  await book(f, '2025-03-02', 'donations', 5000, { contactId: donor.id });
  await book(f, '2025-03-03', 'program-costs', -900, { projectId: project.id });
  unwrap(await recordNameConsent(f.deps, f.ctx, { kind: 'granted', contactId: donor.id, on: '2026-01-10', fromYear: 2025 }));
  unwrap(await fileAccountStatementDocument(f.deps, f.ctx, { accountId: f.bank.id, periodTo: '2025-12-31', bytes: pdfBytes() }));
  return { f, y2025, donor, project, params: { fiscalYearId: y2025 } };
}
const run = async (f: Fixture, params: { fiscalYearId: string }) => unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'annualAccounts', params }));
const finalize = (f: Fixture, params: { fiscalYearId: string }, extra: Record<string, unknown> = {}) => finalizeFinanceReport(f.deps, f.ctx, { report: 'annualAccounts', params, ...extra });

describe('Festschreiben der Jahresrechnung (J1 Task 7)', () => {
  it('verlangt die Freigabe und den festgeschriebenen Kassenbericht, dann legt es ab', async () => {
    const { f, y2025, params } = await closedYear();
    f.closeYear(y2025);
    expect((await run(f, params)).finalizeBlock).toMatchObject({ code: 'reportNotReleased' });
    unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'oralReport', note: null }));
    expect((await run(f, params)).finalizeBlock).toEqual({ code: 'annualAccountsCashReportMissing', params: { designation: '2025' } });
    expect(err(await finalize(f, params))).toMatchObject({ code: 'annualAccountsCashReportMissing' });
    unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'cashReport', params }));
    expect((await run(f, params)).finalizeBlock).toBeNull();
    const done = unwrap(await finalize(f, params));
    expect(f.deps.db.select().from(documents).where(eq(documents.id, done.documentId)).get()).toMatchObject({ typeKey: 'finance-report', status: 'issued' });
    expect((await run(f, params)).stage).toBe('final');
  });

  it('verlangt bei Vergütung ohne Grundlage eine Bestätigung mit Begründung und hält sie an der Fassung', async () => {
    const { f, y2025, params } = await closedYear();
    const board = unwrap(await createContact(f.deps, contactCtx, { kind: 'person', firstName: 'Vera', lastName: 'Vorstand' }));
    unwrap(await addContactRole(f.deps, contactCtx, { id: board.id, role: 'board-member', since: '2025-01-01' }));
    await book(f, '2025-05-01', 'volunteer-allowance', -300, { contactId: board.id }, { reason: 'Beschluss folgt' });
    f.closeYear(y2025);
    unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'oralReport', note: null }));
    unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'cashReport', params }));
    const r = await run(f, params);
    expect(r.finalizeBlock).toBeNull();
    expect(r.confirmation).toEqual({ code: 'annualAccountsRemunerationWithoutBasis', params: { count: 1 } });
    expect(err(await finalize(f, params))).toMatchObject({ code: 'annualAccountsRemunerationWithoutBasis', params: { count: 1 } });
    expect(err(await finalize(f, params, { confirmation: { reason: 'other' } }))).toMatchObject({ type: 'validation' });
    const done = unwrap(await finalize(f, params, { confirmation: { reason: 'other', note: 'Rückzahlung vereinbart' } }));
    expect(JSON.parse(f.deps.db.select().from(financeReports).where(eq(financeReports.id, done.reportId)).get()!.finalizeConfirmation!)).toEqual({ code: 'annualAccountsRemunerationWithoutBasis', reason: 'other', note: 'Rückzahlung vereinbart' });
    const entry = auditEntry(f.deps, 'finance.report.finalize');
    expect(JSON.parse(entry.params!)).toMatchObject({ reportKey: 'annualAccounts', confirmation: 'other' });
    expect(JSON.stringify(entry)).not.toContain('Rückzahlung');
  });

  it('bleibt final mit gleichem Hash nach Widerruf der Einwilligung und Rückzug des Projekts (Review Focus 1)', async () => {
    const { f, y2025, donor, project, params } = await closedYear();
    f.closeYear(y2025);
    unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'oralReport', note: null }));
    unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'cashReport', params }));
    unwrap(await finalize(f, params));
    const before = await run(f, params);
    unwrap(await recordNameConsent(f.deps, f.ctx, { kind: 'revoked', contactId: donor.id, on: '2026-09-01' }));
    unwrap(await setProjectPublished(f.deps, ctxWith(['projects.manage']), { id: project.id, isPublished: false }));
    const after = await run(f, params);
    expect(after.stage).toBe('final');
    expect(after.hash).toBe(before.hash);
    expect(err(await saveAnnualAccountsExplanation(f.deps, f.ctx, { fiscalYearId: y2025, text: 'später' }))).toMatchObject({ code: 'annualAccountsExplanationLocked', params: { designation: '2025' } });
  });

  it('übergeht eine Bestätigung bei Berichten, die keine verlangen', async () => {
    const { f, y2025, params } = await closedYear();
    f.closeYear(y2025);
    unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'oralReport', note: null }));
    unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'cashReport', params, confirmation: { reason: 'other' } }));
  });

  it('zeigt ohne finance.read in F8 bei Unbenannten weder Kontakt noch Betrag, nur die Bandbreite', async () => {
    const { f, params, donor } = await closedYear();
    const stranger = unwrap(await createContact(f.deps, contactCtx, { kind: 'person', firstName: 'Otto', lastName: 'Ohne' }));
    await book(f, '2025-04-01', 'donations', 4000, { contactId: stranger.id });
    const overview = unwrap(await runFinanceReport(f.deps, ctxWith(['finance.overview'], f.userId), { report: 'annualAccounts', params }));
    const majors = (overview.data as AnnualAccounts).majorDonors;
    expect(majors).toContainEqual({ contactId: null, amountCents: null, sharePermille: null, bandFromPercent: 20, platform: false });
    expect(majors.find((m) => m.contactId === donor.id)?.amountCents).toBe(5000);
    expect(JSON.stringify(overview.data)).not.toContain(stranger.id);
    const full = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'annualAccounts', params }));
    expect((full.data as AnnualAccounts).majorDonors.find((m) => m.contactId === stranger.id)?.amountCents).toBe(4000);
    expect(full.hash).toBe(overview.hash);
  });

  it('zeigt die Vorschau ohne finance.read', async () => {
    const { f, params } = await closedYear();
    const preview = unwrap(await previewFinanceReport(f.deps, ctxWith(['finance.overview'], f.userId), { report: 'annualAccounts', params }));
    expect(new TextDecoder().decode(preview.bytes.subarray(0, 5))).toBe('%PDF-');
  });
});

describe('Kopf der Jahresrechnung ohne Prüfvermerk (Abnahme B1, Nachzug 2)', () => {
  it('nennt „ohne schriftlichen Prüfbericht“ nicht im Kopf, F9 nennt die Prüfung mit festem Text', async () => {
    const { finalizedAnnualAccounts } = await import('./annual-accounts-j2-fixture');
    const s = await finalizedAnnualAccounts();
    const last = s.renders.at(-1)!;
    const slots = JSON.parse(last.slice(last.lastIndexOf('\n') + 1)) as { title: string; stageText?: string };
    expect(slots.title).toBe('Jahresrechnung');
    expect(slots.stageText ?? '').toBe('');
    expect(last).toContain('Die Kassenprüfer haben mündlich in der Mitgliederversammlung berichtet.');
    // Der Kassenbericht derselben Freigabe trägt den Vermerk weiter.
    const cash = s.renders.at(-2)!;
    expect(JSON.parse(cash.slice(cash.lastIndexOf('\n') + 1)).stageText).toBe('Ohne schriftlichen Prüfbericht festgeschrieben');
  });
});
