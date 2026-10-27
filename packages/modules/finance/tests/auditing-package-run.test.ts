import { unwrap, waitForJob } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { auditPackageRunStatus, auditPackageSlot, cancelAuditPackageRun, readAuditPackageFile, startAuditPackageRun } from '../src/auditing/package-run';
import { getAuditStatus } from '../src/auditing/status';
import { bookEntry } from '../src/ledger/finalize';
import { closeInternal, reopenInternal } from '../src/ledger/period';
import { uploadVoucher } from '../src/ledger/vouchers';
import { financeFiscalYears } from '../src/schema';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { auditFixture } from './auditing-fixture';
import { pdfBytes } from './helpers';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function setup() {
  const a = await auditFixture({ close: false });
  const { f } = a;
  const dataPath = mkdtempSync(path.join(tmpdir(), 'kompass-audit-'));
  dirs.push(dataPath);
  (f.deps as typeof f.deps & { dataPath: string }).dataPath = dataPath;
  const bodies: string[] = [];
  const original = f.deps.documents.render;
  f.deps.documents.render = async (args) => {
    bodies.push(args.bodyTypst);
    return original(args);
  };
  const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-02-01', text: 'Rechnung Futter', moneyLines: [{ accountId: f.bank.id, amountCents: -4500 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -4500 }] }));
  unwrap(await uploadVoucher(f.deps, f.ctx, { entryId: entry.id, bytes: pdfBytes(), typeKey: 'voucher-invoice', documentDate: '2025-02-01' }));
  const row = () => f.deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, a.y2025)).get()!;
  unwrap(f.deps.db.transaction((tx) => closeInternal(tx, f.deps, f.ctx, row())));
  const slot = auditPackageSlot(dataPath, a.y2025);
  // Der Vorstand erzeugt (Joe 2026-10-25, Befund 11 a); mit `documents.export`, damit die Belege mitkommen.
  const board = ctxWith([...FINANCE_PERMISSIONS, 'documents.export'], f.userId);
  return { ...a, dataPath, bodies, slot, row, board };
}

describe('Prüfpaket als Lauf', () => {
  it('produces the reports, the folder and the archive; an auditor reads the files', async () => {
    const { f, y2025, mira, bodies, slot, board } = await setup();
    const started = unwrap(await startAuditPackageRun(f.deps, board, { fiscalYearId: y2025 }));
    expect(started.started).toBe(true);
    const record = await waitForJob(slot, (started as { runId: string }).runId);
    expect(record).toMatchObject({ status: 'success', kind: 'auditPackage' });
    const status = unwrap(await auditPackageRunStatus(f.deps, mira.ctx, { fiscalYearId: y2025 }));
    expect(status.files.sort()).toEqual(['archive', 'folder', 'reports']);
    // Rechenschaft B1: die Belegprüfung (Gruppe Kassenprüfung) gehört zu den Prüffassungen.
    expect(bodies.some((b) => b.includes('Mehrfach verwendete Nachweise'))).toBe(true);
    const folderBody = bodies.find((b) => b.includes('Fragen und Feststellungen (Bogen 2)'))!;
    expect(folderBody).toContain('✓ / Anmerkung');
    expect(folderBody).toContain('Nr. / Seite');
    for (const title of ['Journal', 'Kontenabstimmung', 'Belegprüfung', 'Importabgleich', 'Auffälligkeiten', 'Zweckmittel und Rücklagen', 'Spenden', 'Zahlungen an Partner']) expect(folderBody).toContain(`#"${title}";`);
    const archive = unwrap(await readAuditPackageFile(f.deps, mira.ctx, { fiscalYearId: y2025, file: 'archive' }));
    expect(archive).toMatchObject({ mimeType: 'application/zip', filename: 'Aktenexport-2025.zip' });
    expect(archive.bytes.length).toBeGreaterThan(0);
    expect(unwrap(await getAuditStatus(f.deps, f.ctx, { fiscalYearId: y2025 })).packageRun).toMatchObject({ state: 'success', files: expect.arrayContaining(['folder']) });
  });

  it('skips the archive without documents.export, refuses an open year and other readers', async () => {
    const { f, y2025, mira, slot, board } = await setup();
    const noExport = f.ctx;
    const started = unwrap(await startAuditPackageRun(f.deps, noExport, { fiscalYearId: y2025 }));
    const record = await waitForJob(slot, (started as { runId: string }).runId);
    expect(record?.result).toMatchObject({ skipped: { archive: 'noExportPermission' } });
    expect(record?.steps.find((s) => s.key === 'archive')?.state).toBe('skipped');
    expect(await startAuditPackageRun(f.deps, ctxWith(['finance.overview']), { fiscalYearId: y2025 })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await startAuditPackageRun(f.deps, board, { fiscalYearId: f.years['2026']!.id })).toMatchObject({ ok: false, error: { code: 'auditReportYearOpen' } });
    expect(await cancelAuditPackageRun(f.deps, board, { fiscalYearId: y2025 })).toMatchObject({ ok: false, error: { code: 'jobNotRunning' } });
    // Erzeugen und Abbrechen nur der Vorstand (Joe 2026-10-25, Befund 11 a); Prüfer lesen Stand und Dateien.
    expect(await startAuditPackageRun(f.deps, mira.ctx, { fiscalYearId: y2025 })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.periodClose' } });
    expect(await cancelAuditPackageRun(f.deps, mira.ctx, { fiscalYearId: y2025 })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.periodClose' } });
    expect(await auditPackageRunStatus(f.deps, mira.ctx, { fiscalYearId: y2025 })).toMatchObject({ ok: true });
  });

  it('a new baseline makes the files outdated', async () => {
    const { f, y2025, mira, slot, row, board } = await setup();
    const started = unwrap(await startAuditPackageRun(f.deps, board, { fiscalYearId: y2025 }));
    await waitForJob(slot, (started as { runId: string }).runId);
    // Ein abgelegter Bericht fehlt hier, darum entsteht beim erneuten Abschluss kein neuer Prüfstand: einen erzwingen.
    const { ensureBaselineInternal } = await import('../src/auditing/baseline');
    f.deps.clock.advance(60_000);
    unwrap(f.deps.db.transaction((tx) => reopenInternal(tx, f.deps, f.ctx, { id: y2025, note: 'x' })));
    unwrap(f.deps.db.transaction((tx) => closeInternal(tx, f.deps, f.ctx, row())));
    f.deps.db.transaction((tx) => ensureBaselineInternal(tx, f.deps, f.ctx, y2025, 'followUp'));
    const status = unwrap(await auditPackageRunStatus(f.deps, mira.ctx, { fiscalYearId: y2025 }));
    expect(status).toMatchObject({ outdated: true, files: [] });
    expect(await readAuditPackageFile(f.deps, mira.ctx, { fiscalYearId: y2025, file: 'folder' })).toMatchObject({ ok: false, error: { code: 'auditPackageOutdated' } });
  });

  it('without a data path there is no place for the run', async () => {
    const a = await auditFixture();
    expect(await startAuditPackageRun(a.f.deps, a.f.ctx, { fiscalYearId: a.y2025 })).toMatchObject({ ok: false, error: { code: 'auditPackageNoStorage' } });
  });
});
