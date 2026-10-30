import { schema, unwrap, waitForJob, writeJsonAtomic } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { unzipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { bookEntry } from '../src/ledger/finalize';
import { cancelDataExport, dataExportRunStatus, dataExportSlot, listDataExports, readDataExportFile, startDataExport } from '../src/reporting/export/run';
import { EXPORT_TABLES } from '../src/reporting/export/tables';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { financeDataExports } from '../src/schema';
import { ledgerFixture } from './helpers';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function setup(opts: { storage?: boolean } = {}) {
  const f = await ledgerFixture({ years: ['2024', '2025', '2026'] });
  const dataPath = mkdtempSync(path.join(tmpdir(), 'kompass-export-'));
  dirs.push(dataPath);
  if (opts.storage !== false) (f.deps as typeof f.deps & { dataPath: string }).dataPath = dataPath;
  unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-02-01', text: 'Futter', moneyLines: [{ accountId: f.bank.id, amountCents: -4500 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -4500 }] }));
  f.closeYear(f.years['2024']!.id);
  f.closeYear(f.years['2025']!.id);
  const slot = dataExportSlot(dataPath);
  const ids = { y2024: f.years['2024']!.id, y2025: f.years['2025']!.id, y2026: f.years['2026']!.id };
  const ctx = ctxWith([...FINANCE_PERMISSIONS, 'documents.export'], f.userId);
  return { f, ctx, slot, dataPath, ...ids };
}

const runIdOf = (s: unknown) => (s as { runId: string }).runId;
const audits = (f: Awaited<ReturnType<typeof setup>>['f'], action: string) => f.deps.db.select().from(schema.auditLog).all().filter((a) => a.action === action);

describe('Datenexport als Lauf', () => {
  it('produces one ZIP with every file, a row and one create entry', async () => {
    const { f, ctx, slot, y2024, y2025 } = await setup();
    const started = unwrap(await startDataExport(f.deps, ctx, { fiscalYearIds: [y2025, y2024] }));
    expect(started.started).toBe(true);
    expect(await waitForJob(slot, runIdOf(started))).toMatchObject({ status: 'success', kind: 'dataExport' });
    const rows = f.deps.db.select().from(financeDataExports).all();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({ designations: '2024, 2025', provisional: '', channel: 'ui', fileDeletedAt: null });
    const bytes = await f.deps.files('finance').read(row.fileName);
    expect(row.sizeBytes).toBe(bytes.length);
    expect(row.checksum).toBe(createHash('sha256').update(bytes).digest('hex'));
    const names = Object.keys(unzipSync(bytes)).sort();
    expect(names).toEqual([...EXPORT_TABLES.map((t) => t.file), 'index.xml', 'feldbeschreibung.csv', 'LIESMICH.txt', 'gdpdu-01-09-2004.dtd'].sort());
    const created = audits(f, 'finance.dataExport.create');
    expect(created).toHaveLength(1);
    expect(JSON.parse(created[0]!.params ?? '{}')).toEqual({ years: '2024, 2025', provisional: '' });
    expect(readdirSync(slot.workDir).filter((n) => n.startsWith('work-'))).toEqual([]);
  });

  it('names an open year provisional and reports a running export instead of starting a second', async () => {
    const { f, ctx, slot, y2025, y2026 } = await setup();
    const first = unwrap(await startDataExport(f.deps, ctx, { fiscalYearIds: [y2025, y2026] }));
    const second = unwrap(await startDataExport(f.deps, ctxWith(['finance.read', 'documents.export'], f.secondPersonId), { fiscalYearIds: [y2025] }));
    expect(second).toMatchObject({ started: false, running: { kind: 'dataExport' } });
    await waitForJob(slot, runIdOf(first));
    const rows = f.deps.db.select().from(financeDataExports).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ designations: '2025, 2026', provisional: '2026' });
  });

  it('cancelled in the third step leaves no row, no entry and no work files', async () => {
    const { f, ctx, slot, y2025 } = await setup();
    const vouchers = EXPORT_TABLES.find((t) => t.step === 'vouchers')! as { rows: (typeof EXPORT_TABLES)[number]['rows'] };
    const original = vouchers.rows;
    vouchers.rows = function* (db, scope) {
      void cancelDataExport(f.deps, ctx, {});
      yield* original.call(this, db, scope);
    };
    try {
      const started = unwrap(await startDataExport(f.deps, ctx, { fiscalYearIds: [y2025] }));
      expect(await waitForJob(slot, runIdOf(started))).toMatchObject({ status: 'aborted', reason: 'cancelled', lastStep: 'vouchers' });
    } finally {
      vouchers.rows = original;
    }
    expect(f.deps.db.select().from(financeDataExports).all()).toEqual([]);
    expect(audits(f, 'finance.dataExport.create')).toEqual([]);
    expect(readdirSync(slot.workDir).filter((n) => n.startsWith('work-'))).toEqual([]);
  });

  it('a restart in the middle ends as interrupted; the next start removes the stray ZIP', async () => {
    const { f, ctx, slot, y2025 } = await setup();
    mkdirSync(path.join(slot.workDir, 'work-x'), { recursive: true });
    const stray = 'data-export-stray.zip';
    await f.deps.files('finance').write(stray, new Uint8Array([1]));
    writeJsonAtomic(path.join(slot.dir, 'running-job.json'), { runId: 'R1', kind: 'dataExport', startedAt: '2026-01-01T00:00:00.000Z', steps: [{ key: 'package', state: 'running' }], process: 'anderer', meta: { fileName: stray } });
    const status = unwrap(await dataExportRunStatus(f.deps, ctx, {}));
    expect(status.running).toBeNull();
    expect(status.last?.status).toBe('interrupted');
    expect(existsSync(path.join(slot.workDir, 'work-x'))).toBe(false);
    expect(f.deps.db.select().from(financeDataExports).all()).toEqual([]);
    const started = unwrap(await startDataExport(f.deps, ctx, { fiscalYearIds: [y2025] }));
    await waitForJob(slot, runIdOf(started));
    expect(await f.deps.files('finance').exists(stray)).toBe(false);
  });

  it('refuses without both rights, an empty list, an unknown year and without storage', async () => {
    const { f, ctx, y2025 } = await setup();
    for (const ctx of [ctxWith(['finance.read']), ctxWith(['documents.export'])]) {
      expect(await startDataExport(f.deps, ctx, { fiscalYearIds: [y2025] })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
      expect(await dataExportRunStatus(f.deps, ctx, {})).toMatchObject({ ok: false, error: { type: 'forbidden' } });
      expect(await cancelDataExport(f.deps, ctx, {})).toMatchObject({ ok: false, error: { type: 'forbidden' } });
      expect(await listDataExports(f.deps, ctx, {})).toMatchObject({ ok: false, error: { type: 'forbidden' } });
      expect(await readDataExportFile(f.deps, ctx, { exportId: 'X' })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    }
    expect(await startDataExport(f.deps, ctx, { fiscalYearIds: [] })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await startDataExport(f.deps, ctx, { fiscalYearIds: ['NOPE'] })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    expect(await cancelDataExport(f.deps, ctx, {})).toMatchObject({ ok: false, error: { code: 'jobNotRunning' } });
    const bare = await setup({ storage: false });
    expect(await startDataExport(bare.f.deps, bare.ctx, { fiscalYearIds: [bare.y2025] })).toMatchObject({ ok: false, error: { code: 'dataExportNoStorage' } });
  });

  it('names the file with the day of the export in the association\'s zone (F-B3)', async () => {
    const { f, ctx, slot, y2025 } = await setup();
    f.deps.clock.set('2026-12-31T23:30:00.000Z');
    const started = unwrap(await startDataExport(f.deps, ctx, { fiscalYearIds: [y2025] }));
    await waitForJob(slot, runIdOf(started));
    const row = f.deps.db.select().from(financeDataExports).all()[0]!;
    expect(unwrap(await readDataExportFile(f.deps, ctx, { exportId: row.id })).filename).toBe('Datenexport-2025-01.01.2027.zip');
  });

  it('lists exports with their end, hands out the file once recorded, refuses after 30 days', async () => {
    const { f, ctx, slot, y2025 } = await setup();
    const started = unwrap(await startDataExport(f.deps, ctx, { fiscalYearIds: [y2025] }));
    await waitForJob(slot, runIdOf(started));
    const auditor = ctxWith(['finance.read', 'finance.audit', 'documents.export'], f.secondPersonId);
    const listed = unwrap(await listDataExports(f.deps, auditor, {}));
    expect(listed.exports).toHaveLength(1);
    const view = listed.exports[0]!;
    expect(new Date(view.expiresAt).getTime() - new Date(view.createdAt).getTime()).toBe(30 * 86_400_000);
    const file = unwrap(await readDataExportFile(f.deps, auditor, { exportId: view.id }));
    expect(file.filename).toMatch(/^Datenexport-2025-\d{2}\.\d{2}\.\d{4}\.zip$/);
    expect(file.bytes.length).toBe(view.sizeBytes);
    expect(audits(f, 'finance.dataExport.download')).toHaveLength(1);
    expect(await readDataExportFile(f.deps, auditor, { exportId: 'NOPE' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    f.deps.clock.advance(31 * 86_400_000);
    expect(await readDataExportFile(f.deps, auditor, { exportId: view.id })).toMatchObject({ ok: false, error: { code: 'dataExportExpired' } });
    expect(unwrap(await listDataExports(f.deps, auditor, {})).exports).toEqual([]);
    f.deps.db.update(financeDataExports).set({ fileDeletedAt: '2026-01-01T00:00:00.000Z' }).where(eq(financeDataExports.id, view.id)).run();
    expect(await readDataExportFile(f.deps, auditor, { exportId: view.id })).toMatchObject({ ok: false, error: { code: 'dataExportExpired' } });
  });
});
