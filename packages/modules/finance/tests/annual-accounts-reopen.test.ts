import { schema as core, unwrap } from '@kompass/core';
import { auditEntry, loadAllViews } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { previewPeriodReopen, reopenFiscalYear } from '../src/ledger/period';
import { financeModule } from '../src/manifest';
import { publishAnnualAccounts } from '../src/closing/annual-accounts-publish';
import { attachSignedAnnualAccountsScan, signAnnualAccounts } from '../src/closing/annual-accounts-sign';
import { recordNameConsent } from '../src/allocation/name-consents';
import { documents } from '@kompass/module-dms';
import { pdfBytes } from './helpers';
import { finalizeFinanceReport, releaseReportsForFinalizing } from '../src/reporting/finalize';
import { financeAnnualAccountsPublications, financePeriodEvents } from '../src/schema';
import { getAnnualAccountsState } from '../src/closing/annual-accounts-state';
import { finalizedAnnualAccounts } from './annual-accounts-j2-fixture';

const view = (s: Awaited<ReturnType<typeof finalizedAnnualAccounts>>) => loadAllViews(s.f.deps, financeModule).annualAccounts!;

const LIVE_SINCE = '2026-09-04T12:00:00.000Z';

/** Veröffentlicht vor der MV (ITZ-Frist) und auf der Webseite (sonst nur bereitgestellt), dann wiedergeöffnet. */
async function publishedThenReopened(o: { live?: boolean } = {}) {
  const s = await finalizedAnnualAccounts();
  unwrap(await signAnnualAccounts(s.f.deps, s.board.ctx, { reportId: s.report.id }));
  const pub = unwrap(await publishAnnualAccounts(s.f.deps, s.publisher, { reportId: s.report.id, earlyReason: 'itzDeadline' }));
  if (o.live !== false) s.live.set(`annualAccounts:/finance/reports/annualAccounts?year=${s.y2025}`, LIVE_SINCE);
  expect(view(s)).toHaveLength(1);
  const preview = unwrap(await previewPeriodReopen(s.f.deps, s.f.ctx, { id: s.y2025 }));
  expect(preview.consequences).toContainEqual({ code: o.live === false ? 'annualAccountsProvisionRetracted' : 'annualAccountsWithdrawn', params: { designation: '2025' } });
  unwrap(await reopenFiscalYear(s.f.deps, s.f.ctx, { id: s.y2025, note: 'Buchung fehlte' }));
  return { ...s, pub };
}

describe('Wiederöffnen eines Jahres mit veröffentlichter Jahresrechnung', () => {
  it('nimmt sie sofort aus der Sicht und legt die Wiedervorlage ab dem Storno-Tag an', async () => {
    const s = await publishedThenReopened();
    expect(view(s)).toEqual([]);
    const row = s.f.deps.db.select().from(financeAnnualAccountsPublications).where(eq(financeAnnualAccountsPublications.id, s.pub.id)).get()!;
    expect(row).toMatchObject({ withdrawnCause: 'voided', withdrawnByUserId: s.f.userId, withdrawnLiveSince: LIVE_SINCE });
    const followUps = s.f.deps.db.select().from(core.followUps).all().filter((r) => r.doneAt === null && r.entityType === 'financeFiscalYear');
    expect(followUps).toMatchObject([{ entityId: s.y2025, dueAt: '2026-09-05', assigneeUserId: s.f.userId, title: 'Webseite neu publizieren (Jahresrechnung 2025)' }]);
    expect(s.mail.sent).toEqual([]);
    const entry = auditEntry(s.f.deps, 'finance.annualAccounts.withdraw');
    expect(JSON.parse(entry.params!)).toMatchObject({ designation: '2025' });
    expect(JSON.parse(entry.after!)).toMatchObject({ withdrawnCause: 'voided' });
  });

  it('nur bereitgestellt (nie auf der Webseite): Bereitstellung still zurückgenommen, keine Wiedervorlage (Bildabnahme 0.4.5 F-2)', async () => {
    const s = await publishedThenReopened({ live: false });
    expect(view(s)).toEqual([]);
    const row = s.f.deps.db.select().from(financeAnnualAccountsPublications).where(eq(financeAnnualAccountsPublications.id, s.pub.id)).get()!;
    expect(row).toMatchObject({ withdrawnCause: 'voided', withdrawnLiveSince: null });
    expect(s.f.deps.db.select().from(core.followUps).all().filter((r) => r.entityType === 'financeFiscalYear')).toEqual([]);
  });

  it('nur bereitgestellt zurückgenommen: die nächste Fassung ist keine berichtigte (Ve-L-3, Abnahme B1 Nachzug 4)', async () => {
    const s = await publishedThenReopened({ live: false });
    s.f.closeYear(s.y2025);
    s.f.deps.db.update(financePeriodEvents).set({ at: '2026-09-05T09:00:00.000Z' }).where(eq(financePeriodEvents.kind, 'closed')).run();
    unwrap(await releaseReportsForFinalizing(s.f.deps, s.f.ctx, { fiscalYearId: s.y2025, basis: 'oralReport', note: null }));
    unwrap(await finalizeFinanceReport(s.f.deps, s.f.ctx, { report: 'cashReport', params: s.params }));
    const next = unwrap(await finalizeFinanceReport(s.f.deps, s.f.ctx, { report: 'annualAccounts', params: s.params }));
    expect(unwrap(await getAnnualAccountsState(s.f.deps, s.f.ctx, { fiscalYearId: s.y2025 })).finalVersion?.corrected).toBeNull();
    unwrap(await signAnnualAccounts(s.f.deps, s.board.ctx, { reportId: next.reportId }));
    const pub = unwrap(await publishAnnualAccounts(s.f.deps, s.publisher, { reportId: next.reportId, earlyReason: 'itzDeadline' }));
    expect(pub).toMatchObject({ corrected: false, replacesFinalizedAt: null, earlyReason: 'itzDeadline' });
  });

  it('bleibt leer bis zur Abzeichnung der neuen Fassung; die ist die berichtigte, ohne Grund vor einer neuen MV', async () => {
    const s = await publishedThenReopened();
    s.f.closeYear(s.y2025);
    // Das zweite Abschließen muss nach dem Wiederöffnen liegen (Ereignisse nach Zeit).
    s.f.deps.db.update(financePeriodEvents).set({ at: '2026-09-05T09:00:00.000Z' }).where(eq(financePeriodEvents.kind, 'closed')).run();
    unwrap(await releaseReportsForFinalizing(s.f.deps, s.f.ctx, { fiscalYearId: s.y2025, basis: 'oralReport', note: null }));
    unwrap(await finalizeFinanceReport(s.f.deps, s.f.ctx, { report: 'cashReport', params: s.params }));
    const next = unwrap(await finalizeFinanceReport(s.f.deps, s.f.ctx, { report: 'annualAccounts', params: s.params }));
    expect(view(s)).toEqual([]);
    unwrap(await signAnnualAccounts(s.f.deps, s.board.ctx, { reportId: next.reportId }));
    const pub = unwrap(await publishAnnualAccounts(s.f.deps, s.publisher, { reportId: next.reportId }));
    expect(pub).toMatchObject({ corrected: true, earlyReason: null, replacesFinalizedAt: s.report.finalizedAt });
    // Abnahme J2, Punkt 2: wieder eine gültige Fassung bereitgestellt — die Wiedervorlage ist erledigt.
    expect(s.f.deps.db.select().from(core.followUps).all().filter((r) => r.entityType === 'financeFiscalYear' && r.doneAt === null)).toEqual([]);
    expect(view(s)).toEqual([expect.objectContaining({ year: '2025', corrected: true, replacesFinalizedOn: '2026-09-05' })]);
  });
});

describe('Storno einer Fassung nimmt ihre weiteren Dokumente mit', () => {
  it('storniert abgezeichnete Fassung, Scan und Webfassung mit demselben Grund', async () => {
    const s = await finalizedAnnualAccounts();
    const signed = unwrap(await attachSignedAnnualAccountsScan(s.f.deps, s.f.ctx, { reportId: s.report.id, contactId: s.board.contactId, signedOn: '2026-09-05', bytes: pdfBytes() }));
    unwrap(await publishAnnualAccounts(s.f.deps, s.publisher, { reportId: s.report.id, earlyReason: 'itzDeadline' }));
    unwrap(await recordNameConsent(s.f.deps, s.f.ctx, { kind: 'revoked', contactId: s.donor.id, on: '2026-09-05' }));
    const web = s.f.deps.db.select().from(financeAnnualAccountsPublications).get()!.webDocumentId!;
    unwrap(await reopenFiscalYear(s.f.deps, s.f.ctx, { id: s.y2025, note: 'Buchung fehlte' }));
    const doc = (id: string) => s.f.deps.db.select().from(documents).where(eq(documents.id, id)).get()!;
    const final = doc(s.report.documentId);
    expect(final.status).toBe('voided');
    for (const id of [signed.documentId, signed.scanDocumentId!, web]) expect(doc(id)).toMatchObject({ status: 'voided', voidReason: final.voidReason });
  });
});
