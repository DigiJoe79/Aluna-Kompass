import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { documentLinks, documents, receiveGeneratedUpload, textPdf } from '@kompass/module-dms';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { setDatedValue, valueAt } from '../src/ledger/dated-values';
import { withTestReports } from '../src/reporting/catalog';
import { fileAuditReportFromDocument, fileAuditReportScan } from '../src/auditing/filing';
import { finalizeFinanceReport, readFinanceReportDocument, releaseReportsForFinalizing } from '../src/reporting/finalize';
import { listFinanceReports, listFinanceReportVersions, runFinanceReport } from '../src/reporting/service';
import { ledgerFixture } from './helpers';
import { testReport } from './reporting-fixture';

/**
 * Rechenschaft A3 Task 0 — was die Oberfläche braucht: Sperrgrund am Lauf, Freigabe in der Liste, Fassungen je
 * Bericht, Datei einer Fassung, Freigabe mit schriftlichem Prüfbericht.
 */
const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
const mutable = testReport({ key: 'testMutable', compute: (db) => ({ lines: 0, totalCents: Number(valueAt(db, 'mileageRate', '2025-12-31') ?? 0) }) });
const tax = testReport({ key: 'testTax', group: 'taxOffice' });
const probe = testReport({ key: 'testProbe', group: 'taxOffice', finalizeBlock: () => ({ code: 'reportProbeFails', params: { differenceCents: 12 } }) });
const REPORTS = [testReport(), tax, mutable, probe];

const setup = async () => {
  const f = await ledgerFixture({ years: ['2025', '2026'] });
  return { f, y2025: f.years['2025']!.id, y2026: f.years['2026']!.id };
};

describe('finalizeBlock am Lauf', () => {
  it('names why the data cannot be finalized', async () => {
    const { f, y2025, y2026 } = await setup();
    await withTestReports(REPORTS, async () => {
      const run = async (report: string, fiscalYearId: string) => unwrap(await runFinanceReport(f.deps, f.ctx, { report, params: { fiscalYearId } })).finalizeBlock;
      expect(await run('testAssembly', y2026)).toMatchObject({ code: 'reportYearOpen', params: { designation: '2026' } });
      f.closeYear(y2025);
      expect(await run('testAssembly', y2025)).toMatchObject({ code: 'reportNotReleased' });
      expect(await run('testTax', y2025)).toBeNull();
      expect(await run('testProbe', y2025)).toMatchObject({ code: 'reportProbeFails', params: { differenceCents: 12 } });
      expect(err(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testProbe', params: { fiscalYearId: y2025 } }))).toMatchObject({ code: 'reportProbeFails' });
      unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testTax', params: { fiscalYearId: y2025 } }));
      expect(await run('testTax', y2025)).toMatchObject({ code: 'reportAlreadyFinal' });
    });
  });
});

describe('listFinanceReportVersions', () => {
  it('lists the versions with exactly these params, newest first, voided ones too', async () => {
    const { f, y2025 } = await setup();
    f.closeYear(y2025);
    await withTestReports(REPORTS, async () => {
      unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'oralReport', note: null }));
      const params = { fiscalYearId: y2025 };
      const first = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testMutable', params }));
      unwrap(await setDatedValue(f.deps, f.ctx, { key: 'mileageRate', validFrom: '2025-01-01', value: 25 }));
      f.deps.clock.advance(60_000);
      const second = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testMutable', params }));
      unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testAssembly', params }));
      const { versions } = unwrap(await listFinanceReportVersions(f.deps, f.ctx, { report: 'testMutable', params }));
      expect(versions.map((v) => v.reportId)).toEqual([second.reportId, first.reportId]);
      expect(versions[0]).toMatchObject({ shortHash: second.shortHash, documentId: second.documentId, documentNumber: second.documentNumber, releaseBasis: 'oralReport', voidedAt: null, byUserId: f.userId });
      expect(versions[1]).toMatchObject({ voidReason: `Ersetzt durch ${second.documentNumber}`, replacedByReportId: second.reportId });
      expect(versions[1]!.voidedAt).not.toBeNull();
      expect(err(await listFinanceReportVersions(f.deps, ctxWith([], f.userId), { report: 'testMutable', params }))).toEqual({ type: 'forbidden', permission: 'finance.overview' });
    });
  });
});

describe('Freigabe: in der Liste, änderbar bis zum ersten Festschreiben', () => {
  it('shows the release in the list and locks it after the first final report', async () => {
    const { f, y2025 } = await setup();
    f.closeYear(y2025);
    await withTestReports(REPORTS, async () => {
      const list = async () => unwrap(await listFinanceReports(f.deps, f.ctx, { fiscalYearId: y2025 }));
      expect(await list()).toMatchObject({ release: null, releaseChangeable: true });
      unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'oralReport', note: null }));
      expect((await list()).release).toMatchObject({ basis: 'oralReport', note: null, byUserId: f.userId });
      // Ändern geht, solange nichts festgeschrieben ist — mit Protokoll.
      unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'singleAuditor', note: 'Nur Frau Berger hat geprüft' }));
      expect((await list()).release).toMatchObject({ basis: 'singleAuditor', note: 'Nur Frau Berger hat geprüft' });
      unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testAssembly', params: { fiscalYearId: y2025 } }));
      expect((await list()).releaseChangeable).toBe(false);
      expect(err(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'oralReport', note: null }))).toMatchObject({ code: 'releaseLocked' });
    });
  });

  it('stays changeable when only a tax office report is final', async () => {
    const { f, y2025 } = await setup();
    f.closeYear(y2025);
    await withTestReports(REPORTS, async () => {
      unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'oralReport', note: null }));
      unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testTax', params: { fiscalYearId: y2025 } }));
      // Gesperrt wird nur, was die Freigabe trägt: ein Bericht, der sie brauchte.
      expect(unwrap(await listFinanceReports(f.deps, f.ctx, { fiscalYearId: y2025 })).releaseChangeable).toBe(true);
    });
  });

  it('needs a note for notAudited', async () => {
    const { f, y2025 } = await setup();
    f.closeYear(y2025);
    expect(err(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'notAudited', note: null }))).toMatchObject({ type: 'validation', issues: [expect.objectContaining({ path: 'note' })] });
  });
});

describe('Freigabe mit schriftlichem Prüfbericht', () => {
  it('files the scan at the fiscal year and releases with it (D1: filing releases; the release service refuses auditReport)', async () => {
    const { f, y2025 } = await setup();
    f.closeYear(y2025);
    expect(err(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'auditReport', note: null }))).toMatchObject({ type: 'validation', issues: [expect.objectContaining({ path: 'documentId' })] });

    const filed = unwrap(await fileAuditReportScan(f.deps, f.ctx, { fiscalYearId: y2025, bytes: textPdf(['Prüfbericht 2025']), fileName: 'pruefbericht.pdf' }));
    expect(filed.documentNumber).toMatch(/^PBR-/);
    const doc = f.deps.db.select().from(documents).where(eq(documents.id, filed.documentId)).get()!;
    expect(doc).toMatchObject({ typeKey: 'finance-audit-report', direction: 'incoming' });
    expect(f.deps.db.select().from(documentLinks).where(and(eq(documentLinks.documentId, filed.documentId), eq(documentLinks.entityType, 'financeFiscalYear'), eq(documentLinks.entityId, y2025))).get()).toBeDefined();
    expect(err(await fileAuditReportScan(f.deps, ctxWith(['finance.read'], f.userId), { fiscalYearId: y2025, bytes: textPdf(['x']), fileName: 'x.pdf' }))).toEqual({ type: 'forbidden', permission: 'finance.periodClose' });

    expect(unwrap(await listFinanceReports(f.deps, f.ctx, { fiscalYearId: y2025 })).release).toMatchObject({ basis: 'auditReport', documentId: filed.documentId });
    expect(err(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'auditReport', documentId: filed.documentId }))).toMatchObject({ type: 'conflict', code: 'auditReportViaAudit' });
    // Derselbe Scan noch einmal aus der Akte gewählt: nichts ändert sich (der Dialog freigibt danach mit ihm).
    expect(unwrap(await fileAuditReportFromDocument(f.deps, f.ctx, { fiscalYearId: y2025, documentId: filed.documentId })).documentId).toBe(filed.documentId);
  });

  it('refuses a document of another type', async () => {
    const { f, y2025 } = await setup();
    f.closeYear(y2025);
    const other = unwrap(await receiveGeneratedUpload(f.deps, f.ctx, { bytes: textPdf(['Zählung']), typeKey: 'finance-cash-count', subject: 'x', documentDate: '2025-12-31', links: [{ entityType: 'financeCashCount', entityId: 'c1' }] }));
    expect(err(await fileAuditReportFromDocument(f.deps, f.ctx, { fiscalYearId: y2025, documentId: other.document.id }))).toMatchObject({ type: 'validation', issues: [expect.objectContaining({ path: 'documentId' })] });
  });
});

describe('readFinanceReportDocument', () => {
  it('returns the filed file, also when voided', async () => {
    const { f, y2025 } = await setup();
    f.closeYear(y2025);
    await withTestReports(REPORTS, async () => {
      const params = { fiscalYearId: y2025 };
      unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'oralReport', note: null }));
      const first = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testMutable', params }));
      unwrap(await setDatedValue(f.deps, f.ctx, { key: 'mileageRate', validFrom: '2025-01-01', value: 25 }));
      unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testMutable', params }));
      const file = unwrap(await readFinanceReportDocument(f.deps, f.ctx, { reportId: first.reportId }));
      expect(new TextDecoder().decode(file.bytes.subarray(0, 5))).toBe('%PDF-');
      expect(file.filename).toBe(`${first.documentNumber}.pdf`);
      expect(err(await readFinanceReportDocument(f.deps, f.ctx, { reportId: 'nope' }))).toMatchObject({ type: 'notFound' });
      expect(err(await readFinanceReportDocument(f.deps, ctxWith([], f.userId), { reportId: first.reportId }))).toMatchObject({ type: 'forbidden' });
    });
  });
});

describe('Freitext nur mit finance.read (ledger/access.ts: overview ohne Freitext)', () => {
  it('leaves the release note and the withdrawal reason out for overview readers', async () => {
    const { f, y2025 } = await setup();
    f.closeYear(y2025);
    const overview = ctxWith(['finance.overview'], f.userId);
    await withTestReports(REPORTS, async () => {
      unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'other', note: 'Prüferin erkrankt' }));
      const params = { fiscalYearId: y2025 };
      unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testMutable', params }));
      unwrap(await setDatedValue(f.deps, f.ctx, { key: 'mileageRate', validFrom: '2025-01-01', value: 25 }));
      unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testMutable', params }));
      expect(unwrap(await listFinanceReports(f.deps, overview, { fiscalYearId: y2025 })).release).toMatchObject({ basis: 'other', note: null });
      expect(unwrap(await listFinanceReports(f.deps, f.ctx, { fiscalYearId: y2025 })).release).toMatchObject({ note: 'Prüferin erkrankt' });
      const versions = unwrap(await listFinanceReportVersions(f.deps, overview, { report: 'testMutable', params })).versions;
      expect(versions[1]!.voidedAt).not.toBeNull();
      expect(versions[1]!.voidReason).toBeNull();
    });
  });
});
