import { unwrap, writeSettingInternal } from '@kompass/core';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ctxWith, fakeDocumentEngine, systemContext } from '@kompass/core/testing';
import { finalizeFinanceReport, releaseReportsForFinalizing } from '@kompass/module-finance';
import { createTranslator } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ledgerFixture } from '../../../packages/modules/finance/tests/helpers';

const state = vi.hoisted(() => ({ session: null as unknown, deps: null as unknown }));
vi.mock('next-intl/server', async () => {
  const messages = (await import('../messages/de.json')).default;
  return { getTranslations: async () => createTranslator({ locale: 'de', messages, timeZone: 'Europe/Berlin' }) };
});
vi.mock('@/lib/request-context', () => ({ optionalSession: async () => state.session }));
vi.mock('@/lib/deps', () => ({ getDeps: () => state.deps }));

const REAL_PDF = path.resolve(import.meta.dirname, '../e2e/fixtures/brief-digital.pdf');

type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;
let f: Fixture;
let y2025: string;
beforeEach(async () => {
  f = await ledgerFixture({ years: ['2025', '2026'] });
  y2025 = f.years['2025']!.id;
  state.deps = f.deps;
  state.session = { ctx: f.ctx };
});

const preview = async (key: string, query: string) => (await import('@/app/finance/reports/[key]/preview/route')).GET(new Request(`http://x/finance/reports/${key}/preview?${query}`), { params: Promise.resolve({ key }) });
const pageImage = async (key: string, n: string, query: string) => (await import('@/app/finance/reports/[key]/page/[n]/route')).GET(new Request(`http://x/finance/reports/${key}/page/${n}?${query}`), { params: Promise.resolve({ key, n }) });
const file = async (reportId: string) => (await import('@/app/finance/reports/versions/[reportId]/file/route')).GET(new Request(`http://x/finance/reports/versions/${reportId}/file`), { params: Promise.resolve({ reportId }) });

describe('Vorschau eines Berichts', () => {
  it('delivers the PDF inline, named after title, year and stage; attachment on download', async () => {
    const res = await preview('incomeStatement', `year=${y2025}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-disposition')).toBe('inline; filename="einnahmen-ueberschuss-rechnung-2025-vorlaeufig.pdf"');
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    f.closeYear(y2025);
    const download = await preview('cashReport', `year=${y2025}&download=1`);
    expect(download.headers.get('content-disposition')).toBe('attachment; filename="kassenbericht-2025-pruefung.pdf"');
  });

  it('refuses: no session 401, module off 404, no right 403, unknown or unavailable report 404, refusal 409', async () => {
    state.session = null;
    expect((await preview('cashReport', `year=${y2025}`)).status).toBe(401);
    state.session = { ctx: ctxWith([], f.userId) };
    expect((await preview('cashReport', `year=${y2025}`)).status).toBe(403);
    state.session = { ctx: f.ctx };
    expect((await preview('nope', `year=${y2025}`)).status).toBe(404);
    expect((await preview('fundsUse', `year=${y2025}`)).status).toBe(404);
    const refused = await preview('incomeStatement', `year=${y2025}&combine=1`);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: expect.any(String), message: expect.any(String) });
    f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'modules.enabled', ['contacts', 'dms', 'projects']));
    expect((await preview('cashReport', `year=${y2025}`)).status).toBe(404);
  });
});

describe('Seitenbild eines Berichts (PdfPages)', () => {
  const PNG = [0x89, 0x50, 0x4e, 0x47];
  beforeEach(() => {
    // Der Zwischenspeicher hängt am Datenpfad: je Test ein eigener, sonst bediente ein früherer Lauf diesen.
    vi.stubEnv('DATA_PATH', `/tmp/kompass-report-pages-test-${process.pid}-${Math.random()}`);
    // Ein echtes PDF statt des Platzhalters der Test-Deps: `pdftoppm` rastert es wirklich.
    Object.assign(f.deps, { documents: fakeDocumentEngine({ render: async () => ({ bytes: new Uint8Array(readFileSync(REAL_PDF)), pages: 1 }) }) });
  });

  it('delivers page n as PNG, twice the width with scale=2, and the page count with it', async () => {
    const res = await pageImage('incomeStatement', '1', `year=${y2025}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const png = Buffer.from(await res.arrayBuffer());
    expect([...png.subarray(0, 4)]).toEqual(PNG);
    const total = Number(res.headers.get('x-page-count'));
    expect(total).toBeGreaterThanOrEqual(1);
    const double = Buffer.from(await (await pageImage('incomeStatement', '1', `year=${y2025}&scale=2`)).arrayBuffer());
    expect(double.readUInt32BE(16)).toBeGreaterThan(png.readUInt32BE(16) * 1.9);
    // Außerhalb der Seiten, keine Zahl, unbekannte Dichte → 404.
    expect((await pageImage('incomeStatement', String(total + 1), `year=${y2025}`)).status).toBe(404);
    expect((await pageImage('incomeStatement', '0', `year=${y2025}`)).status).toBe(404);
    expect((await pageImage('incomeStatement', '../x', `year=${y2025}`)).status).toBe(404);
    expect((await pageImage('incomeStatement', '1', `year=${y2025}&scale=7`)).status).toBe(404);
  });

  it('has the rights of the PDF: no session 401, no right 403, unknown or unavailable report 404', async () => {
    state.session = null;
    expect((await pageImage('cashReport', '1', `year=${y2025}`)).status).toBe(401);
    state.session = { ctx: ctxWith([], f.userId) };
    expect((await pageImage('cashReport', '1', `year=${y2025}`)).status).toBe(403);
    // Ein Bericht mit Personenbezug braucht `finance.read`, die Übersicht reicht nicht.
    state.session = { ctx: ctxWith(['finance.overview'], f.userId) };
    expect((await pageImage('donationBook', '1', `year=${y2025}`)).status).toBe(403);
    state.session = { ctx: f.ctx };
    expect((await pageImage('nope', '1', `year=${y2025}`)).status).toBe(404);
    expect((await pageImage('fundsUse', '1', `year=${y2025}`)).status).toBe(404);
  });
});

describe('Datei einer festgeschriebenen Fassung', () => {
  it('delivers the filed file; unknown id 404', async () => {
    f.closeYear(y2025);
    unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'oralReport', note: null }));
    const done = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'cashReport', params: { fiscalYearId: y2025 } }));
    const res = await file(done.reportId);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await file('nope')).status).toBe(404);
  });
});

describe('Seitenbild einer festgeschriebenen Fassung (Designer Runde 7, 16a C)', () => {
  const versionImage = async (reportId: string, n: string, query = '') => (await import('@/app/finance/reports/versions/[reportId]/page/[n]/route')).GET(new Request(`http://x/finance/reports/versions/${reportId}/page/${n}?${query}`), { params: Promise.resolve({ reportId, n }) });
  beforeEach(() => {
    vi.stubEnv('DATA_PATH', `/tmp/kompass-report-pages-test-${process.pid}-${Math.random()}`);
    Object.assign(f.deps, { documents: fakeDocumentEngine({ render: async () => ({ bytes: new Uint8Array(readFileSync(REAL_PDF)), pages: 1 }) }) });
  });

  it('renders the pages from the file in the records, never a newly generated PDF; rights of the document', async () => {
    f.closeYear(y2025);
    unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'oralReport', note: null }));
    const done = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'cashReport', params: { fiscalYearId: y2025 } }));
    // Ab hier erzeugt die Engine nichts mehr: Ein Bild kann nur noch aus der abgelegten Datei kommen.
    Object.assign(f.deps, { documents: fakeDocumentEngine({ render: async () => { throw new Error('kein neues PDF'); } }) });
    const res = await versionImage(done.reportId, '1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-page-count')).toBe('1');
    expect((await versionImage(done.reportId, '2')).status).toBe(404);
    expect((await versionImage('nope', '1')).status).toBe(404);
    state.session = { ctx: ctxWith([], f.userId) };
    expect((await versionImage(done.reportId, '1')).status).toBe(403);
    state.session = null;
    expect((await versionImage(done.reportId, '1')).status).toBe(401);
  });
});
