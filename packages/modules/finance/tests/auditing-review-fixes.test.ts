import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isReportEditorInternal } from '../src/auditing/access';
import { removeAuditor, saveAuditor } from '../src/auditing/auditors';
import { entryFingerprintInternal } from '../src/auditing/baseline';
import { fileAuditReportScan } from '../src/auditing/filing';
import { auditPackageSlot, readAuditPackageFile, startAuditPackageRun } from '../src/auditing/package-run';
import { createAuditRemark } from '../src/auditing/remarks';
import { createAuditReportDraft, markAuditReportReadyToSign, saveAuditReportExamination, saveAuditReportResult, saveAuditReportSignatures } from '../src/auditing/report';
import { bookEntry } from '../src/ledger/finalize';
import { uploadVoucher } from '../src/ledger/vouchers';
import { financeMoneyLines } from '../src/schema';
import { waitForJob } from '@kompass/core';
import { AUDITOR_PERMISSIONS, auditFixture } from './auditing-fixture';
import { pdfBytes } from './helpers';

const code = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : ((r.error as { code?: string; type: string }).code ?? (r.error as { type: string }).type));

describe('Befunde der Schlussdurchsicht', () => {
  it('1: filing the scan releases the year — human only, like the release itself', async () => {
    const { f, y2025, miraAuditor } = await auditFixture();
    unwrap(await removeAuditor(f.deps, f.ctx, { id: miraAuditor.id }));
    expect(code(await fileAuditReportScan(f.deps, { ...f.ctx, channel: 'mcp' }, { fiscalYearId: y2025, bytes: pdfBytes() }))).toBe('humanOnly');
  });

  it('2: no blank report from the filing path while someone audits in Kompass', async () => {
    const { f, y2025 } = await auditFixture();
    expect(code(await fileAuditReportScan(f.deps, f.ctx, { fiscalYearId: y2025, bytes: pdfBytes() }))).toBe('auditBlankKompassAuditor');
  });

  it('3: an auditor with work keeps contact and mode', async () => {
    const { f, y2025, mira, miraAuditor, person } = await auditFixture();
    unwrap(await createAuditRemark(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'question', targetType: 'year', targetId: y2025, text: 'Frage?' }));
    const other = await person('Anders');
    expect(code(await saveAuditor(f.deps, f.ctx, { id: miraAuditor.id, fiscalYearId: y2025, contactId: other.id, mode: 'kompass' }))).toBe('auditorHasWork');
    expect(code(await saveAuditor(f.deps, f.ctx, { id: miraAuditor.id, fiscalYearId: y2025, contactId: miraAuditor.contactId, mode: 'paper' }))).toBe('auditorHasWork');
    expect(code(await saveAuditor(f.deps, f.ctx, { id: miraAuditor.id, fiscalYearId: y2025, contactId: miraAuditor.contactId, mode: 'kompass', electedOn: '2025-04-12' }))).toBe('ok');
  });

  it('4: any finance write right (also approve) keeps someone from editing the report', async () => {
    const { f, y2025, mira } = await auditFixture();
    for (const p of ['finance.approve', 'finance.reportsFinalize', 'finance.donationsIssue', 'finance.directDebit']) expect(isReportEditorInternal(f.deps.db, ctxWith([...AUDITOR_PERMISSIONS, p], mira.userId), y2025), p).toBe(false);
  });

  it('5: auditors cannot be added or removed while separate reports wait for their scans', async () => {
    const { f, y2025, mira, miraAuditor, paperAuditor, person } = await auditFixture();
    const draft = unwrap(await createAuditReportDraft(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'report' }));
    unwrap(await saveAuditReportSignatures(f.deps, mira.ctx, { reportId: draft.id, mode: 'separate' }));
    unwrap(await saveAuditReportExamination(f.deps, mira.ctx, { reportId: draft.id, dates: ['2026-02-18'] }));
    unwrap(await saveAuditReportResult(f.deps, mira.ctx, { reportId: draft.id, result: 'clean' }));
    unwrap(await markAuditReportReadyToSign(f.deps, mira.ctx, { reportId: draft.id }));
    unwrap(await fileAuditReportScan(f.deps, mira.ctx, { reportId: draft.id, auditorId: miraAuditor.id, bytes: pdfBytes() }));
    expect(code(await removeAuditor(f.deps, f.ctx, { id: paperAuditor.id }))).toBe('auditReportReadyToSign');
    const third = await person('Dritter');
    expect(code(await saveAuditor(f.deps, f.ctx, { fiscalYearId: y2025, contactId: third.id, mode: 'paper' }))).toBe('auditReportReadyToSign');
  });

  it('6: linking the bank transaction changes the fingerprint', async () => {
    const { f } = await auditFixture({ close: false });
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-02-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000 }] }));
    const before = entryFingerprintInternal(f.deps.db, entry.id);
    f.deps.db.update(financeMoneyLines).set({ rawTransactionId: 'RAW-1' }).where(eq(financeMoneyLines.entryId, entry.id)).run();
    expect(entryFingerprintInternal(f.deps.db, entry.id)).not.toBe(before);
  });

  it('7: the archive of the package needs documents.export to download', async () => {
    const a = await auditFixture({ close: false });
    const { f } = a;
    const dataPath = mkdtempSync(path.join(tmpdir(), 'kompass-audit-'));
    (f.deps as typeof f.deps & { dataPath: string }).dataPath = dataPath;
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-02-01', text: 'Rechnung', moneyLines: [{ accountId: f.bank.id, amountCents: -500 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -500 }] }));
    unwrap(await uploadVoucher(f.deps, f.ctx, { entryId: entry.id, bytes: pdfBytes(), typeKey: 'voucher-invoice', documentDate: '2025-02-01' }));
    f.closeYear(a.y2025);
    unwrap(await saveAuditor(f.deps, f.ctx, { fiscalYearId: a.y2025, contactId: f.donor.id, mode: 'paper' }));
    const started = unwrap(await startAuditPackageRun(f.deps, ctxWith([...f.ctx.permissions, 'documents.export'], f.userId), { fiscalYearId: a.y2025 }));
    await waitForJob(auditPackageSlot(dataPath, a.y2025), (started as { runId: string }).runId);
    expect(code(await readAuditPackageFile(f.deps, ctxWith(['finance.read'], a.mira.userId), { fiscalYearId: a.y2025, file: 'archive' }))).toBe('forbidden');
    expect(code(await readAuditPackageFile(f.deps, a.mira.ctx, { fiscalYearId: a.y2025, file: 'archive' }))).toBe('ok');
    rmSync(dataPath, { recursive: true, force: true });
  });
});
