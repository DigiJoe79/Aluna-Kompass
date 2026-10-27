import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fileAuditReportScan } from '../src/auditing/filing';
import { answerAuditRemark, createAuditRemark, resolveAuditRemark } from '../src/auditing/remarks';
import { removeAuditor } from '../src/auditing/auditors';
import { printAuditReport, printAuditReportBlank } from '../src/auditing/print';
import { createAuditReportDraft, getAuditReport, markAuditReportReadyToSign, revokeAuditReportReadyToSign, saveAuditReportExamination, saveAuditReportResult } from '../src/auditing/report';
import { markSectionReviewed, setSample } from '../src/auditing/samples';
import { getAuditStatus } from '../src/auditing/status';
import { countCash } from '../src/ledger/cash';
import { bookEntry } from '../src/ledger/finalize';
import { closeInternal, reopenInternal } from '../src/ledger/period';
import { financeEntries, financeFiscalYears } from '../src/schema';
import { AUDITOR_PERMISSIONS, auditFixture } from './auditing-fixture';
import { pdfBytes } from './helpers';

const code = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : ((r.error as { code?: string; type: string }).code ?? (r.error as { type: string }).type));
const issues = (r: { ok: boolean; error?: unknown }) => (r.ok ? [] : ((r.error as { issues?: { path: string; message: string }[] }).issues ?? []));

/** Plan D1d Task 2: Ablehnungen, Bearbeitbarkeit und Zählung der Vermerke am Prüfbericht. */
async function setup() {
  const a = await auditFixture({ close: false });
  const { f } = a;
  unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-02-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000 }] }));
  const row = () => f.deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, a.y2025)).get()!;
  const close = () => {
    f.deps.clock.advance(60_000);
    unwrap(f.deps.db.transaction((tx) => closeInternal(tx, f.deps, f.ctx, row())));
  };
  const reopen = () => {
    f.deps.clock.advance(60_000);
    unwrap(f.deps.db.transaction((tx) => reopenInternal(tx, f.deps, f.ctx, { id: a.y2025, note: 'Fehler' })));
  };
  close();
  const ready = async () => {
    const draft = unwrap(await createAuditReportDraft(f.deps, a.mira.ctx, { fiscalYearId: a.y2025, kind: 'report' }));
    unwrap(await saveAuditReportExamination(f.deps, a.mira.ctx, { reportId: draft.id, dates: ['2026-02-18'] }));
    unwrap(await saveAuditReportResult(f.deps, a.mira.ctx, { reportId: draft.id, result: 'clean' }));
    return unwrap(await markAuditReportReadyToSign(f.deps, a.mira.ctx, { reportId: draft.id }));
  };
  return { ...a, close, reopen, ready };
}

describe('Prüfbericht — Ablehnungen', () => {
  it('taking back the release after the scan is filed names the scan, not the state', async () => {
    const { f, mira, ready } = await setup();
    const report = await ready();
    unwrap(await fileAuditReportScan(f.deps, mira.ctx, { reportId: report.id, bytes: pdfBytes() }));
    expect(code(await revokeAuditReportReadyToSign(f.deps, mira.ctx, { reportId: report.id }))).toBe('auditReportScanFiled');
  });

  it('someone who writes in the finances gets their own reason, not „ask the treasurer“', async () => {
    const { f, y2025, mira } = await setup();
    expect(code(await createAuditReportDraft(f.deps, f.ctx, { fiscalYearId: y2025, kind: 'report' }))).toBe('auditorHasWriteRights');
    const draft = unwrap(await createAuditReportDraft(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'report' }));
    expect(code(await saveAuditReportExamination(f.deps, f.ctx, { reportId: draft.id, dates: ['2026-02-18'] }))).toBe('auditorHasWriteRights');
    const miraWriting = ctxWith([...AUDITOR_PERMISSIONS, 'finance.entriesWrite'], mira.userId);
    expect(code(await saveAuditReportExamination(f.deps, miraWriting, { reportId: draft.id, dates: ['2026-02-18'] }))).toBe('auditorHasWriteRights');
  });

  it('the chosen cash count must be one of the audit', async () => {
    const { f, y2025, mira } = await setup();
    const draft = unwrap(await createAuditReportDraft(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'report' }));
    const refused = await saveAuditReportExamination(f.deps, mira.ctx, { reportId: draft.id, dates: ['2026-02-18'], cashCountId: 'NOT-A-COUNT' });
    expect(code(refused)).toBe('validation');
    expect(issues(refused)).toEqual([{ path: 'cashCountId', message: 'notACashCountOfAudit' }]);
    expect(code(await saveAuditReportExamination(f.deps, mira.ctx, { reportId: draft.id, dates: ['2026-02-18'], cashCountId: null }))).toBe('ok');
  });
});

describe('Prüfbericht — Stand', () => {
  it('canEditReport is false once the audit is done, true again while a follow-up is open', async () => {
    const { f, y2025, mira, ready, reopen, close } = await setup();
    const report = await ready();
    expect(unwrap(await getAuditStatus(f.deps, mira.ctx, { fiscalYearId: y2025 })).me.canEditReport).toBe(true);
    unwrap(await fileAuditReportScan(f.deps, mira.ctx, { reportId: report.id, bytes: pdfBytes() }));
    expect(unwrap(await getAuditStatus(f.deps, mira.ctx, { fiscalYearId: y2025 })).me.canEditReport).toBe(false);
    reopen();
    close();
    expect(unwrap(await getAuditStatus(f.deps, mira.ctx, { fiscalYearId: y2025 })).me.canEditReport).toBe(true);
  });

  it('remarksUnresolved counts open and answered remarks, not resolved ones', async () => {
    const { f, y2025, mira } = await setup();
    const remark = (text: string) => createAuditRemark(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'question', targetType: 'year', targetId: y2025, text }).then(unwrap);
    await remark('offen');
    const answered = await remark('beantwortet');
    unwrap(await answerAuditRemark(f.deps, f.ctx, { remarkId: answered.id, text: 'Antwort' }));
    const resolved = await remark('geklärt');
    unwrap(await resolveAuditRemark(f.deps, mira.ctx, { remarkId: resolved.id }));
    expect(unwrap(await getAuditStatus(f.deps, f.ctx, { fiscalYearId: y2025 })).remarksUnresolved).toBe(2);
  });
});

describe('Gegenstand ab der Freigabe (Plan D1d Task 3)', () => {
  it('after ready to sign, later samples and reviews do not change the subject; revoking makes it live again; the filed report keeps it', async () => {
    const { f, y2025, mira, ready } = await setup();
    const entry = f.deps.db.select().from(financeEntries).where(eq(financeEntries.fiscalYearId, y2025)).get()!;
    const report = await ready();
    const fixed = report.subject;
    expect(fixed.samples.sampledEntries).toBe(0);
    unwrap(await setSample(f.deps, mira.ctx, { fiscalYearId: y2025, entryId: entry.id, sampled: true }));
    unwrap(await markSectionReviewed(f.deps, mira.ctx, { fiscalYearId: y2025, section: 'journal' }));
    expect(unwrap(await getAuditReport(f.deps, f.ctx, { fiscalYearId: y2025 }))!.subject).toEqual(fixed);
    // Der Druck liest denselben Gegenstand.
    const calls: string[] = [];
    const original = f.deps.documents.render;
    f.deps.documents.render = async (args) => { calls.push(args.bodyTypst); return original(args); };
    unwrap(await printAuditReport(f.deps, mira.ctx, { reportId: report.id }));
    expect(calls[0]).toContain('Stichproben: 0 von');

    const live = unwrap(await revokeAuditReportReadyToSign(f.deps, mira.ctx, { reportId: report.id }));
    expect(live.subject.samples.sampledEntries).toBe(1);
    expect(live.subject.sectionsReviewed.reviewed).toBe(1);
    const again = unwrap(await markAuditReportReadyToSign(f.deps, mira.ctx, { reportId: report.id }));
    unwrap(await fileAuditReportScan(f.deps, mira.ctx, { reportId: report.id, bytes: pdfBytes() }));
    // Nach Ablage stehen Stichproben fest (Designer Runde 7, 274/279) — der Gegenstand bleibt ohnehin.
    expect(await setSample(f.deps, mira.ctx, { fiscalYearId: y2025, entryId: entry.id, sampled: false })).toMatchObject({ ok: false, error: { code: 'auditWorkFixed' } });
    expect(unwrap(await getAuditReport(f.deps, f.ctx, { fiscalYearId: y2025 }))!.subject).toEqual(again.subject);
    expect(() => f.deps.sqlite.prepare("update finance_audit_reports set subject_snapshot = '{}' where id = ?").run(report.id)).toThrow(/immutable/);
  });

  it('the blank form is not printed again once its scan is filed', async () => {
    const { f, y2025, miraAuditor } = await setup();
    unwrap(await removeAuditor(f.deps, f.ctx, { id: miraAuditor.id }));
    const blank = unwrap(await printAuditReportBlank(f.deps, f.ctx, { fiscalYearId: y2025 }));
    unwrap(await fileAuditReportScan(f.deps, f.ctx, { reportId: blank.reportId, bytes: pdfBytes() }));
    expect(code(await printAuditReportBlank(f.deps, f.ctx, { fiscalYearId: y2025 }))).toBe('auditReportFiled');
  });
});

describe('Schlussdurchsicht D1d', () => {
  it('I-2: the blank form fixes its subject at the first print — a later count does not change the signed paper', async () => {
    const { f, y2025, miraAuditor, paperAuditor } = await setup();
    unwrap(await removeAuditor(f.deps, f.ctx, { id: miraAuditor.id }));
    const blank = unwrap(await printAuditReportBlank(f.deps, f.ctx, { fiscalYearId: y2025 }));
    const before = unwrap(await getAuditReport(f.deps, f.ctx, { fiscalYearId: y2025 }))!.subject;
    expect(before.cash).toBeNull();
    f.deps.clock.advance(60_000);
    unwrap(await countCash(f.deps, f.ctx, { accountId: f.cash.id, countedOn: '2026-09-05', countedCents: 0, counterOneContactId: f.donor.id, counterTwoContactId: f.rightDonor.id, witnessAuditorIds: [paperAuditor.id] }));
    unwrap(await fileAuditReportScan(f.deps, f.ctx, { reportId: blank.reportId, bytes: pdfBytes() }));
    expect(unwrap(await getAuditReport(f.deps, f.ctx, { fiscalYearId: y2025 }))!.subject).toEqual(before);
  });

  it('I-3: in a follow-up only counts the addendum can show are accepted, and the chosen one is in its subject', async () => {
    const { f, y2025, mira, miraAuditor, ready, reopen, close } = await setup();
    const count = () => countCash(f.deps, f.ctx, { accountId: f.cash.id, countedOn: '2026-09-05', countedCents: 0, counterOneContactId: f.donor.id, counterTwoContactId: f.rightDonor.id, witnessAuditorIds: [miraAuditor.id] }).then(unwrap).then((r) => r.count);
    f.deps.clock.advance(60_000);
    const early = await count();
    const report = await ready();
    unwrap(await fileAuditReportScan(f.deps, mira.ctx, { reportId: report.id, bytes: pdfBytes() }));
    reopen();
    close();
    f.deps.clock.advance(60_000);
    const late = await count();
    const addendum = unwrap(await createAuditReportDraft(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'followUp' }));
    expect(addendum.cashCounts.map((c) => c.countId)).toEqual([late.id]);
    expect(code(await saveAuditReportExamination(f.deps, mira.ctx, { reportId: addendum.id, dates: ['2026-09-05'], cashCountId: early.id }))).toBe('validation');
    const saved = unwrap(await saveAuditReportExamination(f.deps, mira.ctx, { reportId: addendum.id, dates: ['2026-09-05'], cashCountId: late.id }));
    expect(saved.subject.cash?.countId).toBe(late.id);
  });
});
