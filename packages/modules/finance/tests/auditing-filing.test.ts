import { unwrap } from '@kompass/core';
import { auditEntry } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditorCandidates } from '../src/auditing/auditor-candidates';
import { removeAuditor } from '../src/auditing/auditors';
import { registerAuditorCandidateSource } from '../src/sources';
import { baselinesOfYearInternal } from '../src/auditing/baseline';
import { fileAuditReportScan } from '../src/auditing/filing';
import { printAuditReportBlank } from '../src/auditing/print';
import { createAuditReportDraft, getAuditReport, markAuditReportReadyToSign, saveAuditReportExamination, saveAuditReportResult, saveAuditReportSignatures } from '../src/auditing/report';
import { getEntryAuditState, setSample } from '../src/auditing/samples';
import { getAuditStatus } from '../src/auditing/status';
import { bookEntry } from '../src/ledger/finalize';
import { closeInternal, previewReopenInternal, reopenInternal } from '../src/ledger/period';
import { withTestReports } from '../src/reporting/catalog';
import { finalizeFinanceReport, releaseReportsForFinalizing } from '../src/reporting/finalize';
import { releaseOfYearInternal } from '../src/reporting/stage';
import { financeAllocationLines, financeFiscalYears } from '../src/schema';
import { requestAllocationCorrection } from '../src/ledger/corrections';
import { fileAccountStatementDocument } from '../src/ledger/statement-documents';
import { auditFixture } from './auditing-fixture';
import { pdfBytes } from './helpers';
import { testReport } from './reporting-fixture';

const code = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : ((r.error as { code?: string; type: string }).code ?? (r.error as { type: string }).type));

async function setup() {
  const a = await auditFixture({ close: false });
  const { f } = a;
  const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-02-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000, contactId: f.wrongDonor.id }] }));
  const row = () => f.deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, a.y2025)).get()!;
  const close = () => {
    f.deps.clock.advance(60_000);
    return unwrap(f.deps.db.transaction((tx) => closeInternal(tx, f.deps, f.ctx, row())));
  };
  const reopen = () => {
    f.deps.clock.advance(60_000);
    return unwrap(f.deps.db.transaction((tx) => reopenInternal(tx, f.deps, f.ctx, { id: a.y2025, note: 'Fehler' })));
  };
  close();
  const ready = async (kind: 'report' | 'followUp' = 'report', mode?: 'separate') => {
    const draft = unwrap(await createAuditReportDraft(f.deps, a.mira.ctx, { fiscalYearId: a.y2025, kind }));
    if (mode) unwrap(await saveAuditReportSignatures(f.deps, a.mira.ctx, { reportId: draft.id, mode }));
    unwrap(await saveAuditReportExamination(f.deps, a.mira.ctx, { reportId: draft.id, dates: ['2026-02-18'] }));
    unwrap(await saveAuditReportResult(f.deps, a.mira.ctx, { reportId: draft.id, result: 'clean' }));
    return unwrap(await markAuditReportReadyToSign(f.deps, a.mira.ctx, { reportId: draft.id }));
  };
  return { ...a, entry, close, reopen, ready };
}

describe('Scan ablegen', () => {
  it('an editor files the scan of a report ready to sign: filed, released with auditReport, audited', async () => {
    const { f, y2025, mira, ready } = await setup();
    const report = await ready();
    const filed = unwrap(await fileAuditReportScan(f.deps, mira.ctx, { reportId: report.id, bytes: pdfBytes(), fileName: 'scan.pdf' }));
    expect(filed).toMatchObject({ releaseKept: false, report: { state: 'filed', scans: [expect.objectContaining({ documentId: filed.documentId })] } });
    expect(releaseOfYearInternal(f.deps.db, y2025)).toMatchObject({ basis: 'auditReport', documentId: filed.documentId });
    expect(JSON.parse(auditEntry(f.deps, 'finance.audit.report.file').params!)).toEqual({ designation: '2025', kind: 'report', scans: 1, expected: 1 });
    expect(code(await fileAuditReportScan(f.deps, f.ctx, { reportId: report.id, bytes: pdfBytes() }))).toBe('auditReportFiled');
    expect(unwrap(await getAuditStatus(f.deps, f.ctx, { fiscalYearId: y2025 }))).toMatchObject({ followUpOpen: false, report: { state: 'filed', scansFiled: 1 } });
  });

  it('refuses drafts, too large files, non-PDFs and outsiders', async () => {
    const { f, y2025, mira, linkedUser } = await setup();
    const draft = unwrap(await createAuditReportDraft(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'report' }));
    expect(code(await fileAuditReportScan(f.deps, f.ctx, { reportId: draft.id, bytes: pdfBytes() }))).toBe('auditReportNotReadyToSign');
    expect(code(await fileAuditReportScan(f.deps, f.ctx, { reportId: draft.id, bytes: new Uint8Array(10 * 1024 * 1024 + 1) }))).toBe('statementTooLarge');
    expect(code(await fileAuditReportScan(f.deps, f.ctx, { reportId: draft.id, bytes: new TextEncoder().encode('kein pdf') }))).toBe('validation');
    const outsider = await linkedUser('Fremd');
    expect(code(await fileAuditReportScan(f.deps, outsider.ctx, { reportId: draft.id, bytes: pdfBytes() }))).toBe('auditorRequired');
  });

  it('separate reports expect one scan per auditor: after the first „1 von 2“, the release only after the second', async () => {
    const { f, y2025, mira, miraAuditor, paperAuditor, ready } = await setup();
    const report = await ready('report', 'separate');
    expect(code(await fileAuditReportScan(f.deps, mira.ctx, { reportId: report.id, bytes: pdfBytes() }))).toBe('validation');
    const first = unwrap(await fileAuditReportScan(f.deps, mira.ctx, { reportId: report.id, auditorId: miraAuditor.id, bytes: pdfBytes() }));
    expect(first.report).toMatchObject({ state: 'readyToSign', scansExpected: 2, scans: [expect.objectContaining({ auditorId: miraAuditor.id })] });
    expect(releaseOfYearInternal(f.deps.db, y2025)).toBeNull();
    expect(code(await fileAuditReportScan(f.deps, mira.ctx, { reportId: report.id, auditorId: miraAuditor.id, bytes: pdfBytes() }))).toBe('auditReportFiled');
    const second = unwrap(await fileAuditReportScan(f.deps, f.ctx, { reportId: report.id, auditorId: paperAuditor.id, bytes: pdfBytes() }));
    expect(second.report.state).toBe('filed');
    expect(releaseOfYearInternal(f.deps.db, y2025)).toMatchObject({ basis: 'auditReport', documentId: first.documentId });
    expect(code(await removeAuditor(f.deps, f.ctx, { id: paperAuditor.id }))).toBe('auditorHasWork');
  });

  it('replaces another release while nothing is finalized; keeps it once a report rests on it', async () => {
    const { f, y2025, mira, ready } = await setup();
    const report = await ready();
    unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'oralReport', note: null }));
    // Rechenschaft C: ohne Kontoauszug als PDF schreibt Kompass nicht fest.
    unwrap(await fileAccountStatementDocument(f.deps, f.ctx, { accountId: f.bank.id, periodTo: '2025-12-31', bytes: pdfBytes() }));
    await withTestReports([testReport()], async () => {
      unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testAssembly', params: { fiscalYearId: y2025 } }));
      const filed = unwrap(await fileAuditReportScan(f.deps, mira.ctx, { reportId: report.id, bytes: pdfBytes() }));
      expect(filed.releaseKept).toBe(true);
      expect(releaseOfYearInternal(f.deps.db, y2025)!.basis).toBe('oralReport');
    });
    const other = await setup();
    const r2 = await other.ready();
    unwrap(await releaseReportsForFinalizing(other.f.deps, other.f.ctx, { fiscalYearId: other.y2025, basis: 'oralReport', note: null }));
    expect(unwrap(await fileAuditReportScan(other.f.deps, other.mira.ctx, { reportId: r2.id, bytes: pdfBytes() })).releaseKept).toBe(false);
    expect(releaseOfYearInternal(other.f.deps.db, other.y2025)!.basis).toBe('auditReport');
  });
});

describe('Nachprüfung', () => {
  it('reopening after a filed report opens the follow-up; a new baseline, recheck, the addendum closes with its own scan', async () => {
    const { f, y2025, mira, entry, close, reopen, ready } = await setup();
    unwrap(await setSample(f.deps, mira.ctx, { fiscalYearId: y2025, entryId: entry.id, sampled: true }));
    const report = await ready();
    unwrap(await fileAuditReportScan(f.deps, mira.ctx, { reportId: report.id, bytes: pdfBytes() }));
    const [first] = baselinesOfYearInternal(f.deps.db, y2025);
    expect(previewReopenInternal(f.deps.db, y2025).consequences).toContainEqual({ code: 'auditFollowUpNeeded', params: {} });

    reopen();
    expect(unwrap(await getAuditStatus(f.deps, f.ctx, { fiscalYearId: y2025 })).followUpOpen).toBe(true);
    const line = f.deps.db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entry.id)).get()!;
    unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { contactId: f.rightDonor.id }, note: 'Falsch zugeordnet' }));
    close();
    const baselines = baselinesOfYearInternal(f.deps.db, y2025);
    expect(baselines.map((b) => b.kind)).toEqual(['initial', 'followUp']);
    const status = unwrap(await getAuditStatus(f.deps, f.ctx, { fiscalYearId: y2025 }));
    expect(status).toMatchObject({ followUpOpen: true, referenceBaselineId: first!.id, changedEntryIds: [entry.id] });
    expect(unwrap(await getEntryAuditState(f.deps, mira.ctx, { entryId: entry.id }))!.sampleState).toBe('recheck');

    const addendum = await ready('followUp');
    expect(addendum).toMatchObject({ kind: 'followUp', subject: { baseline: { id: baselines[1]!.id }, changedEntryIds: [entry.id] } });
    const filed = unwrap(await fileAuditReportScan(f.deps, mira.ctx, { reportId: addendum.id, bytes: pdfBytes() }));
    expect(filed.report.state).toBe('filed');
    expect(releaseOfYearInternal(f.deps.db, y2025)).toMatchObject({ basis: 'auditReport', documentId: filed.documentId });
    const after = unwrap(await getAuditStatus(f.deps, f.ctx, { fiscalYearId: y2025 }));
    expect(after).toMatchObject({ followUpOpen: false, referenceBaselineId: baselines[1]!.id, changedEntryIds: [] });
    // Der abgelegte Bericht bleibt.
    expect(unwrap(await getAuditReport(f.deps, f.ctx, { fiscalYearId: y2025, kind: 'report' }))!.state).toBe('filed');
  });

  it('reopening before a filed report: no follow-up, the draft keeps the first baseline and shows the changes', async () => {
    const { f, y2025, mira, entry, close, reopen } = await setup();
    const draft = unwrap(await createAuditReportDraft(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'report' }));
    reopen();
    const line = f.deps.db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entry.id)).get()!;
    unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { contactId: f.rightDonor.id }, note: 'Falsch zugeordnet' }));
    close();
    expect(baselinesOfYearInternal(f.deps.db, y2025).map((b) => b.kind)).toEqual(['initial']);
    const status = unwrap(await getAuditStatus(f.deps, f.ctx, { fiscalYearId: y2025 }));
    expect(status).toMatchObject({ followUpOpen: false, changedEntryIds: [entry.id], report: { id: draft.id, state: 'draft' } });
  });
});

describe('Nur Papier-Prüfer', () => {
  it('the blank form creates a report ready to sign; filing the scan files it and releases', async () => {
    const { f, y2025, miraAuditor } = await setup();
    unwrap(await removeAuditor(f.deps, f.ctx, { id: miraAuditor.id }));
    const blank = unwrap(await printAuditReportBlank(f.deps, f.ctx, { fiscalYearId: y2025 }));
    expect(unwrap(await getAuditReport(f.deps, f.ctx, { fiscalYearId: y2025 }))).toMatchObject({ id: blank.reportId, origin: 'blank', state: 'readyToSign' });
    const filed = unwrap(await fileAuditReportScan(f.deps, f.ctx, { fiscalYearId: y2025, bytes: pdfBytes() }));
    expect(filed.report).toMatchObject({ id: blank.reportId, state: 'filed' });
    expect(releaseOfYearInternal(f.deps.db, y2025)!.basis).toBe('auditReport');
  });
});

describe('V-9: no auditor suggestions once the report of the year is filed', () => {
  it('the source still names someone, but after filing the list is empty', async () => {
    const { f, y2025, mira, ready } = await setup();
    registerAuditorCandidateSource((_deps, _db, year) => (year.id === y2025 ? [{ contactId: f.wrongDonor.id, name: 'Gewählt', electedOn: '2025-03-20', minutesDocumentId: null, source: { label: 'Beschluss', href: '/governance/resolutions/R1' } }] : []));
    expect(unwrap(await auditorCandidates(f.deps, f.ctx, { fiscalYearId: y2025 }))).toHaveLength(1);
    const report = await ready();
    unwrap(await fileAuditReportScan(f.deps, mira.ctx, { reportId: report.id, bytes: pdfBytes() }));
    expect(unwrap(await auditorCandidates(f.deps, f.ctx, { fiscalYearId: y2025 }))).toEqual([]);
  });
});
