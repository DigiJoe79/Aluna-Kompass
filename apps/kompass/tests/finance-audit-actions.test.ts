import { unwrap, type CallContext, type Deps } from '@kompass/core';
import { createAuditReportDraft, getAuditReport } from '@kompass/module-finance';
import { createTranslator } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { auditFixture } from '../../../packages/modules/finance/tests/auditing-fixture';

const session: { value: { deps: Deps; ctx: CallContext } | null } = { value: null };
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('@/lib/request-context', () => ({ requireSession: async () => session.value }));
vi.mock('next/cache', () => ({ revalidatePath }));
// `redirect` wirft in Next; hier ein Wurf mit erkennbarem Ziel.
const redirect = vi.hoisted(() => vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`); }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => createTranslator({ locale: 'de', messages, timeZone: 'Europe/Berlin' }) }));
const actions = await import('@/app/(shell)/finance/audit/actions');

/**
 * Eine abgelehnte Action baut die Seite nicht neu auf (Schlussdurchsicht D1b, I1): Sonst käme mit der Ablehnung der
 * neue Stand, die Karte zöge ihn nach und Meldung und Eingaben wären weg — gerade beim Konflikt je Karte.
 */
describe('Actions der Kassenprüfung', () => {
  let a: Awaited<ReturnType<typeof auditFixture>>;
  beforeEach(async () => {
    a = await auditFixture();
    revalidatePath.mockReset();
    redirect.mockClear();
  });

  it('a refusal does not revalidate; a success does', async () => {
    const draft = unwrap(await createAuditReportDraft(a.f.deps, a.mira.ctx, { fiscalYearId: a.y2025, kind: 'report' }));
    session.value = { deps: a.f.deps, ctx: a.mira.ctx };
    const refusals = [
      await actions.saveExaminationAction({ reportId: draft.id, expectedVersion: 'veraltet', dates: ['2026-02-18'], place: null, notTested: null, cashCountId: null }),
      await actions.saveResultAction({ reportId: draft.id, expectedVersion: 'veraltet', result: 'clean', recommendation: 'none' }),
      await actions.saveSignaturesAction({ reportId: draft.id, expectedVersion: 'veraltet', mode: 'both', nonSignerAuditorId: null, nonSignerReason: null }),
      await actions.markReadyAction(draft.id),
      await actions.setSampleAction({ fiscalYearId: a.y2025, entryId: 'nope', sampled: true }),
      await actions.createRemarkAction({ fiscalYearId: a.y2025, kind: 'question', targetType: 'year', targetId: a.y2025, text: '' }),
    ];
    expect(refusals.map((r) => r.status)).toEqual(['error', 'error', 'error', 'error', 'error', 'error']);
    session.value = { deps: a.f.deps, ctx: a.f.ctx };
    expect((await actions.removeAuditorAction('nope')).status).toBe('error');
    expect((await actions.saveAuditorAction({ fiscalYearId: a.y2025, contactId: 'nope', mode: 'paper', confidential: false, confidentialityDocumentId: null, electedOn: null, minutesDocumentId: null })).status).toBe('error');
    expect(revalidatePath).not.toHaveBeenCalled();

    session.value = { deps: a.f.deps, ctx: a.mira.ctx };
    expect((await actions.saveExaminationAction({ reportId: draft.id, expectedVersion: draft.examination.version, dates: ['2026-02-18'], place: 'Vereinsheim', notTested: null, cashCountId: null })).status).toBe('success');
    expect(revalidatePath).toHaveBeenCalled();
  });

  it('„Prüfbericht schreiben“ creates the draft and opens it; a second click opens the same draft (auditReportExists)', async () => {
    session.value = { deps: a.f.deps, ctx: a.mira.ctx };
    const to = `/finance/audit/report?year=${encodeURIComponent(a.y2025)}`;
    await expect(actions.writeAuditReportAction(a.y2025)).rejects.toThrow(`REDIRECT ${to}`);
    const first = unwrap(await getAuditReport(a.f.deps, a.mira.ctx, { fiscalYearId: a.y2025, kind: 'report' }));
    expect(first).not.toBeNull();
    await expect(actions.writeAuditReportAction(a.y2025)).rejects.toThrow(`REDIRECT ${to}`);
    expect(unwrap(await getAuditReport(a.f.deps, a.mira.ctx, { fiscalYearId: a.y2025, kind: 'report' }))!.id).toBe(first!.id);
    expect(redirect).toHaveBeenCalledTimes(2);
  });

  it('„Prüfbericht schreiben“ refused (no editor): the refusal comes back, no redirect, no revalidate', async () => {
    session.value = { deps: a.f.deps, ctx: a.f.ctx };
    const result = await actions.writeAuditReportAction(a.y2025);
    expect(result.status).toBe('error');
    expect(redirect).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

