import { unwrap, waitForJob } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { createAuditReportDraft, removeAuditor, startAuditPackageRun } from '@kompass/module-finance';
import { auditPackageSlot } from '../../../packages/modules/finance/src/auditing/package-run';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTranslator } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditFixture } from '../../../packages/modules/finance/tests/auditing-fixture';

const state = vi.hoisted(() => ({ session: null as unknown, deps: null as unknown }));
vi.mock('next-intl/server', async () => {
  const messages = (await import('../messages/de.json')).default;
  return { getTranslations: async () => createTranslator({ locale: 'de', messages, timeZone: 'Europe/Berlin' }) };
});
vi.mock('@/lib/request-context', () => ({ optionalSession: async () => state.session }));
vi.mock('@/lib/deps', () => ({ getDeps: () => state.deps }));

type Fixture = Awaited<ReturnType<typeof auditFixture>>;
let a: Fixture;
const dirs: string[] = [];
beforeEach(async () => {
  a = await auditFixture();
  state.deps = a.f.deps;
  state.session = { ctx: a.f.ctx };
});
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const withStorage = () => {
  const dataPath = mkdtempSync(path.join(tmpdir(), 'kompass-audit-route-'));
  dirs.push(dataPath);
  (a.f.deps as typeof a.f.deps & { dataPath: string }).dataPath = dataPath;
  return dataPath;
};

const print = async (reportId: string) => (await import('@/app/finance/audit/report/[reportId]/print/route')).POST(new Request(`http://x/finance/audit/report/${reportId}/print`, { method: 'POST' }), { params: Promise.resolve({ reportId }) });
const blank = async (fiscalYearId: string) => (await import('@/app/finance/audit/year/[fiscalYearId]/blank/route')).POST(new Request(`http://x/finance/audit/year/${fiscalYearId}/blank`, { method: 'POST' }), { params: Promise.resolve({ fiscalYearId }) });
const file = async (fiscalYearId: string, name: string) => (await import('@/app/finance/audit/year/[fiscalYearId]/package/[file]/route')).GET(new Request(`http://x/finance/audit/year/${fiscalYearId}/package/${name}`), { params: Promise.resolve({ fiscalYearId, file: name }) });
const status = async (fiscalYearId: string) => (await import('@/app/finance/audit/year/[fiscalYearId]/package/status/route')).GET(new Request(`http://x/finance/audit/year/${fiscalYearId}/package/status`), { params: Promise.resolve({ fiscalYearId }) });

const isPdf = async (res: Response) => Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString() === '%PDF-';

describe('Prüfbericht drucken (POST, protokolliert)', () => {
  it('delivers the draft as attachment named by the service; refusals 401, 403, 404, 409', async () => {
    const draft = unwrap(await createAuditReportDraft(a.f.deps, a.mira.ctx, { fiscalYearId: a.y2025, kind: 'report' }));
    state.session = { ctx: a.mira.ctx };
    const res = await print(draft.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="Pruefbericht-2025-Entwurf.pdf"');
    expect(await isPdf(res)).toBe(true);

    state.session = null;
    expect((await print(draft.id)).status).toBe(401);
    state.session = { ctx: ctxWith([], a.mira.userId) };
    expect((await print(draft.id)).status).toBe(403);
    state.session = { ctx: a.mira.ctx };
    expect((await print('nope')).status).toBe(404);
    // Ein Prüfer, der nicht für das Jahr eingetragen ist: fachliche Ablehnung mit Satz.
    const other = await a.linkedUser('Fremdprüfer');
    state.session = { ctx: other.ctx };
    const refused = await print(draft.id);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'auditorRequired', message: expect.any(String) });
  });
});

describe('Vordruck (POST, legt beim ersten Mal den Bericht an)', () => {
  it('prints the blank form when nobody audits in Kompass; refuses with a Kompass auditor', async () => {
    const refused = await blank(a.y2025);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'auditBlankKompassAuditor' });
    unwrap(await removeAuditor(a.f.deps, a.f.ctx, { id: a.miraAuditor.id }));
    const res = await blank(a.y2025);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="Vordruck-Pruefbericht-2025.pdf"');
    expect(await isPdf(res)).toBe(true);
    expect((await blank('nope')).status).toBe(404);
    state.session = { ctx: a.mira.ctx };
    expect((await blank(a.y2025)).status).toBe(403);
  });
});

describe('Prüfpaket: Laufstand und Dateien', () => {
  it('reports idle, then the finished run with its files and skipped steps; files download with type and name', async () => {
    withStorage();
    // Die Prüferin hat `documents.export` — sonst fiele der Schritt „Belege“ weg.
    state.session = { ctx: a.mira.ctx };
    const idle = await status(a.y2025);
    expect(idle.status).toBe(200);
    expect(idle.headers.get('cache-control')).toBe('no-store');
    expect(await idle.json()).toMatchObject({ state: 'idle', steps: [], files: [] });
    expect((await file(a.y2025, 'folder')).status).toBe(409);

    // Der Vorstand erzeugt (Befund 11 a), die Prüferin liest Stand und Dateien.
    const started = unwrap(await startAuditPackageRun(a.f.deps, ctxWith([...a.f.ctx.permissions, 'documents.export'], a.f.userId), { fiscalYearId: a.y2025 }));
    await waitForJob(auditPackageSlot((a.f.deps as typeof a.f.deps & { dataPath: string }).dataPath, a.y2025), (started as { runId: string }).runId);
    const done = (await (await status(a.y2025)).json()) as { state: string; steps: { key: string; state: string }[]; finishedAt: string | null; files: string[]; skipped: Record<string, string> };
    expect(done.state).toBe('success');
    expect(done.steps.map((s) => s.key)).toEqual(['reports', 'folder', 'archive']);
    expect(done.finishedAt).toEqual(expect.any(String));
    // Das Jahr hat keine Belege: Der Schritt „Belege“ nennt seinen Grund, die Datei fehlt.
    expect(done.files.sort()).toEqual(['folder', 'reports']);
    expect(done.skipped).toEqual({ archive: 'noDocuments' });

    const folder = await file(a.y2025, 'folder');
    expect(folder.status).toBe(200);
    expect(folder.headers.get('content-type')).toBe('application/pdf');
    expect(folder.headers.get('content-disposition')).toBe('attachment; filename="Pruefmappe-2025.pdf"');
    const reports = await file(a.y2025, 'reports');
    expect(reports.headers.get('content-disposition')).toBe('attachment; filename="Prueffassungen-2025.pdf"');
    expect((await file(a.y2025, 'archive')).status).toBe(409);
    expect((await file(a.y2025, 'nope')).status).toBe(404);
  });

  it('refuses: no session 401, no right 403, unknown year 404, no storage 409', async () => {
    expect((await status(a.y2025)).status).toBe(409);
    withStorage();
    state.session = null;
    expect((await status(a.y2025)).status).toBe(401);
    expect((await file(a.y2025, 'folder')).status).toBe(401);
    state.session = { ctx: ctxWith([], a.mira.userId) };
    expect((await status(a.y2025)).status).toBe(403);
    expect((await file(a.y2025, 'folder')).status).toBe(403);
    state.session = { ctx: a.f.ctx };
    expect((await status('nope')).status).toBe(404);
  });
});

describe('Prüfbericht abgelegt: der Scan als Seiten (Designer Runde 7, 16e)', () => {
  const scanPage = async (id: string, n: string) => (await import('@/app/dms/[id]/page/[n]/route')).GET(new Request(`http://x/dms/${id}/page/${n}`), { params: Promise.resolve({ id, n }) });

  it('renders the pages of the filed scan with the rights of the document', async () => {
    vi.stubEnv('DATA_PATH', `/tmp/kompass-report-pages-test-${process.pid}-${Math.random()}`);
    const { saveAuditReportExamination, saveAuditReportResult, markAuditReportReadyToSign, fileAuditReportScan } = await import('@kompass/module-finance');
    const { readFileSync } = await import('node:fs');
    const draft = unwrap(await createAuditReportDraft(a.f.deps, a.mira.ctx, { fiscalYearId: a.y2025, kind: 'report' }));
    unwrap(await saveAuditReportExamination(a.f.deps, a.mira.ctx, { reportId: draft.id, dates: ['2026-02-18'] }));
    unwrap(await saveAuditReportResult(a.f.deps, a.mira.ctx, { reportId: draft.id, result: 'clean' }));
    unwrap(await markAuditReportReadyToSign(a.f.deps, a.mira.ctx, { reportId: draft.id }));
    const bytes = new Uint8Array(readFileSync(path.resolve(import.meta.dirname, '../e2e/fixtures/brief-digital.pdf')));
    const filed = unwrap(await fileAuditReportScan(a.f.deps, a.f.ctx, { reportId: draft.id, bytes, fileName: 'scan.pdf' }));
    const res = await scanPage(filed.documentId, '1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-page-count')).toBe('1');
    expect((await scanPage(filed.documentId, '2')).status).toBe(404);
    state.session = { ctx: ctxWith([], a.f.userId) };
    expect([403, 404]).toContain((await scanPage(filed.documentId, '1')).status);
  });
});
