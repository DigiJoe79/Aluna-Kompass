import { unwrap, waitForJob } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { startDataExport } from '@kompass/module-finance';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTranslator } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataExportSlot } from '../../../packages/modules/finance/src/reporting/export/run';
import { FINANCE_PERMISSIONS } from '../../../packages/modules/finance/src/manifest';
import { ledgerFixture } from '../../../packages/modules/finance/tests/helpers';

const state = vi.hoisted(() => ({ session: null as unknown, deps: null as unknown }));
vi.mock('next-intl/server', async () => {
  const messages = (await import('../messages/de.json')).default;
  return { getTranslations: async () => createTranslator({ locale: 'de', messages, timeZone: 'Europe/Berlin' }) };
});
vi.mock('@/lib/request-context', () => ({ optionalSession: async () => state.session }));
vi.mock('@/lib/deps', () => ({ getDeps: () => state.deps }));

type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;
let f: Fixture;
const dirs: string[] = [];
let exporter: ReturnType<typeof ctxWith>;
beforeEach(async () => {
  f = await ledgerFixture({ years: ['2025', '2026'] });
  f.closeYear(f.years['2025']!.id);
  const dataPath = mkdtempSync(path.join(tmpdir(), 'kompass-export-route-'));
  dirs.push(dataPath);
  (f.deps as typeof f.deps & { dataPath: string }).dataPath = dataPath;
  exporter = ctxWith([...FINANCE_PERMISSIONS, 'documents.export'], f.userId);
  state.deps = f.deps;
  state.session = { ctx: exporter };
});
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const status = async () => (await import('@/app/finance/data-export/status/route')).GET();
const file = async (exportId: string) => (await import('@/app/finance/data-export/[exportId]/file/route')).GET(new Request(`http://x/finance/data-export/${exportId}/file`), { params: Promise.resolve({ exportId }) });

async function produced(): Promise<string> {
  const started = unwrap(await startDataExport(f.deps, exporter, { fiscalYearIds: [f.years['2025']!.id] }));
  const record = await waitForJob(dataExportSlot((f.deps as typeof f.deps & { dataPath: string }).dataPath), (started as { runId: string }).runId);
  return (record?.result as { exportId: string }).exportId;
}

describe('Routen des Datenexports', () => {
  it('reports the state of the last run; 401 without session, 403 without either right', async () => {
    const id = await produced();
    const res = await status();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'success', designations: '2025' });
    expect(id).toBeTruthy();
    state.session = null;
    expect((await status()).status).toBe(401);
    for (const perms of [['finance.read'], ['documents.export']]) {
      state.session = { ctx: ctxWith(perms, f.userId) };
      expect((await status()).status).toBe(403);
    }
  });

  it('hands out the ZIP as attachment, 404 for an unknown id, 410 after 30 days', async () => {
    const id = await produced();
    const res = await file(id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="Datenexport-2025-\d{2}\.\d{2}\.\d{4}\.zip"$/);
    expect((await file('NOPE')).status).toBe(404);
    state.session = { ctx: ctxWith(['finance.read'], f.userId) };
    expect((await file(id)).status).toBe(403);
    state.session = { ctx: exporter };
    f.deps.clock.advance(31 * 86_400_000);
    const gone = await file(id);
    expect(gone.status).toBe(410);
    expect(await gone.json()).toMatchObject({ code: 'dataExportExpired', message: expect.any(String) });
  });
});
