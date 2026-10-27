import { unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fileAuditReportScan } from '../src/auditing/filing';
import { createAuditReportDraft, markAuditReportReadyToSign, saveAuditReportExamination, saveAuditReportResult } from '../src/auditing/report';
import { markSectionReviewed } from '../src/auditing/samples';
import { getAuditSection } from '../src/auditing/sections';
import { getAuditStatus } from '../src/auditing/status';
import { bookEntry } from '../src/ledger/finalize';
import { closeInternal, reopenInternal } from '../src/ledger/period';
import { requestAllocationCorrection } from '../src/ledger/corrections';
import { createAccount, updateAccount } from '../src/ledger/accounts';
import { countCash } from '../src/ledger/cash';
import { updateCategory } from '../src/ledger/categories';
import { uploadVoucher } from '../src/ledger/vouchers';
import { financeAllocationLines, financeAuditSectionReviews, financeFiscalYears } from '../src/schema';
import { auditFixture } from './auditing-fixture';
import { pdfBytes } from './helpers';

/**
 * Plan D1d Task 1 (Befund MCP 1, Spec § D1 „Prüfstand“): „durchgesehen“ gilt je Prüfstand. Nach einem neuen Prüfstand
 * bleibt ein Abschnitt durchgesehen, wenn keine geänderte Buchung in ihm steht; sonst fordert die Nachprüfung ihn neu
 * an, und die frühere Durchsicht bleibt sichtbar.
 */
async function setup() {
  const a = await auditFixture({ close: false });
  const { f } = a;
  // Ohne Beleg: Die Buchung steht im Journal und in der Belegprüfung, nie in der Kontenabstimmung (Zeilen je Konto).
  const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-02-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000, contactId: f.wrongDonor.id }] }));
  const row = () => f.deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, a.y2025)).get()!;
  const close = () => {
    f.deps.clock.advance(60_000);
    unwrap(f.deps.db.transaction((tx) => closeInternal(tx, f.deps, f.ctx, row())));
  };
  const reopen = () => {
    f.deps.clock.advance(60_000);
    unwrap(f.deps.db.transaction((tx) => reopenInternal(tx, f.deps, f.ctx, { id: a.y2025, note: 'Fehler' })));
  };
  const fileReport = async (kind: 'report' | 'followUp') => {
    const draft = unwrap(await createAuditReportDraft(f.deps, a.mira.ctx, { fiscalYearId: a.y2025, kind }));
    unwrap(await saveAuditReportExamination(f.deps, a.mira.ctx, { reportId: draft.id, dates: ['2026-02-18'] }));
    unwrap(await saveAuditReportResult(f.deps, a.mira.ctx, { reportId: draft.id, result: 'clean' }));
    unwrap(await markAuditReportReadyToSign(f.deps, a.mira.ctx, { reportId: draft.id }));
    return unwrap(await fileAuditReportScan(f.deps, a.mira.ctx, { reportId: draft.id, bytes: pdfBytes() })).report;
  };
  close();
  const review = async (section: 'journal' | 'reconciliation' | 'vouchers') => unwrap(await markSectionReviewed(f.deps, a.mira.ctx, { fiscalYearId: a.y2025, section }));
  for (const section of ['journal', 'reconciliation', 'vouchers'] as const) await review(section);
  const firstReviewAt = f.deps.clock.now().toISOString();
  await fileReport('report');
  // Wiederöffnen, die Buchung ändern (Zuordnung), neu abschließen: ein neuer Prüfstand.
  reopen();
  const line = f.deps.db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entry.id)).get()!;
  unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { contactId: f.rightDonor.id }, note: 'Falsch zugeordnet' }));
  close();
  return { ...a, entry, review, fileReport, firstReviewAt };
}

describe('Durchsicht je Prüfstand', () => {
  it('a section with a changed entry falls back to not reviewed and keeps the earlier review visible; others stay reviewed', async () => {
    const { f, y2025, miraAuditor, firstReviewAt } = await setup();
    const status = unwrap(await getAuditStatus(f.deps, f.ctx, { fiscalYearId: y2025 }));
    expect(status.sectionsReviewed).toEqual([{ section: 'reconciliation', auditorIds: [miraAuditor.id] }]);
    expect(status.sectionsReviewedBefore).toEqual([
      { section: 'journal', auditorIds: [miraAuditor.id], at: firstReviewAt },
      { section: 'vouchers', auditorIds: [miraAuditor.id], at: firstReviewAt },
    ]);
    const journal = unwrap(await getAuditSection(f.deps, f.ctx, { fiscalYearId: y2025, section: 'journal' }));
    expect(journal.reviewedBy).toEqual([]);
    expect(journal.previousReview).toEqual({ auditorIds: [miraAuditor.id], at: firstReviewAt });
    const reconciliation = unwrap(await getAuditSection(f.deps, f.ctx, { fiscalYearId: y2025, section: 'reconciliation' }));
    expect(reconciliation.reviewedBy).toEqual([{ auditorId: miraAuditor.id, at: firstReviewAt }]);
    expect(reconciliation.previousReview).toBeNull();
  });

  it('reviewing again records a new review with a new timestamp; status and addendum count it', async () => {
    const { f, y2025, mira, miraAuditor, review } = await setup();
    f.deps.clock.advance(60_000);
    const now = f.deps.clock.now().toISOString();
    await review('journal');
    const journal = unwrap(await getAuditSection(f.deps, f.ctx, { fiscalYearId: y2025, section: 'journal' }));
    expect(journal).toMatchObject({ reviewedBy: [{ auditorId: miraAuditor.id, at: now }], previousReview: null });
    const status = unwrap(await getAuditStatus(f.deps, f.ctx, { fiscalYearId: y2025 }));
    expect(status.sectionsReviewed.map((s) => s.section)).toEqual(['journal', 'reconciliation']);
    expect(status.sectionsReviewedBefore.map((s) => s.section)).toEqual(['vouchers']);
    const draft = unwrap(await createAuditReportDraft(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'followUp' }));
    expect(draft.subject.sectionsReviewed).toEqual({ reviewed: 2, total: 8 });
  });

  it('after the addendum is filed, a section not reviewed again stays not reviewed for the new baseline', async () => {
    const { f, y2025, review, fileReport } = await setup();
    await review('journal');
    await fileReport('followUp');
    const status = unwrap(await getAuditStatus(f.deps, f.ctx, { fiscalYearId: y2025 }));
    expect(status.followUpOpen).toBe(false);
    expect(status.sectionsReviewed.map((s) => s.section)).toEqual(['journal', 'reconciliation']);
    expect(status.sectionsReviewedBefore.map((s) => s.section)).toEqual(['vouchers']);
  });
});

/**
 * Plan D1e Task 0 (Befund D1d-Schlussdurchsicht): Eine Durchsicht hält den Fingerabdruck der Abschnittszeilen fest und
 * gilt, solange er dem heutigen gleicht — auch für Abschnitte ohne Buchungszeilen und für Buchungen, die den Abschnitt
 * verlassen.
 */
describe('Durchsicht hält den Stand des Abschnitts fest', () => {
  async function reviewed() {
    const a = await auditFixture({ close: false });
    const { f } = a;
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-02-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000, contactId: f.wrongDonor.id }] }));
    const row = () => f.deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, a.y2025)).get()!;
    f.deps.clock.advance(60_000);
    unwrap(f.deps.db.transaction((tx) => closeInternal(tx, f.deps, f.ctx, row())));
    for (const section of ['journal', 'reconciliation', 'vouchers', 'partnerPayments'] as const) unwrap(await markSectionReviewed(f.deps, a.mira.ctx, { fiscalYearId: a.y2025, section }));
    const reopenAndClose = async (change: () => Promise<unknown>) => {
      f.deps.clock.advance(60_000);
      unwrap(f.deps.db.transaction((tx) => reopenInternal(tx, f.deps, f.ctx, { id: a.y2025, note: 'Nachtrag' })));
      await change();
      f.deps.clock.advance(60_000);
      unwrap(f.deps.db.transaction((tx) => closeInternal(tx, f.deps, f.ctx, row())));
    };
    const reviewedSections = async () => unwrap(await getAuditStatus(f.deps, f.ctx, { fiscalYearId: a.y2025 })).sectionsReviewed.map((s) => s.section);
    return { ...a, entry, reopenAndClose, reviewedSections };
  }

  it('a changed reconciliation (cash count) is no longer reviewed; unchanged sections stay reviewed', async () => {
    const { f, reopenAndClose, reviewedSections } = await reviewed();
    await reopenAndClose(() => countCash(f.deps, f.ctx, { accountId: f.cash.id, countedOn: '2025-12-31', countedCents: 0, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id }).then(unwrap));
    expect(await reviewedSections()).toEqual(['journal', 'vouchers', 'partnerPayments']);
  });

  it('an entry leaving the voucher check (voucher filed later) makes the voucher check not reviewed', async () => {
    const { f, entry, y2025, miraAuditor, reviewedSections } = await reviewed();
    unwrap(await uploadVoucher(f.deps, f.ctx, { entryId: entry.id, bytes: pdfBytes(), typeKey: 'voucher-invoice', documentDate: '2025-02-01' }));
    const sections = await reviewedSections();
    expect(sections).not.toContain('vouchers');
    expect(sections).toContain('reconciliation');
    const vouchers = unwrap(await getAuditSection(f.deps, f.ctx, { fiscalYearId: y2025, section: 'vouchers' }));
    expect(vouchers.previousReview?.auditorIds).toEqual([miraAuditor.id]);
  });

  it('a review without a stored fingerprint (before the migration) keeps the rule of D1d', async () => {
    const { f, y2025, reopenAndClose, reviewedSections } = await reviewed();
    f.deps.db.update(financeAuditSectionReviews).set({ rowsHash: null }).where(eq(financeAuditSectionReviews.fiscalYearId, y2025)).run();
    // Kassenzählung ändert die Kontenabstimmung, aber keine Buchung: Nach D1d bleibt sie durchgesehen.
    await reopenAndClose(() => countCash(f.deps, f.ctx, { accountId: f.cash.id, countedOn: '2025-12-31', countedCents: 0, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id }).then(unwrap));
    expect(await reviewedSections()).toEqual(['journal', 'reconciliation', 'vouchers', 'partnerPayments']);
  });

  it('reviewing again after a change stores the new fingerprint', async () => {
    const { f, y2025, mira, reopenAndClose, reviewedSections } = await reviewed();
    await reopenAndClose(() => countCash(f.deps, f.ctx, { accountId: f.cash.id, countedOn: '2025-12-31', countedCents: 0, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id }).then(unwrap));
    f.deps.clock.advance(60_000);
    unwrap(await markSectionReviewed(f.deps, mira.ctx, { fiscalYearId: y2025, section: 'reconciliation' }));
    expect(await reviewedSections()).toContain('reconciliation');
  });

  it('renaming a category or account and creating an empty account later change no figure: reviews stay (Schlussdurchsicht D1e, I1)', async () => {
    const { f, reviewedSections } = await reviewed();
    unwrap(await updateCategory(f.deps, f.ctx, { id: f.donations.id, name: 'Spenden allgemein' }));
    unwrap(await updateAccount(f.deps, f.ctx, { id: f.bank.id, name: 'Girokonto Hausbank' }));
    unwrap(await createAccount(f.deps, f.ctx, { name: 'Zweitbank', kind: 'bank', iban: 'DE93999999990000000001' }));
    expect(await reviewedSections()).toEqual(['journal', 'reconciliation', 'vouchers', 'partnerPayments']);
  });
});

