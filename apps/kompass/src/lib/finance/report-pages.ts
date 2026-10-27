import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ok, type CallContext, type Deps, type Result } from '@kompass/core';
import { pdfPageCount, renderPdfPage } from '@kompass/documents';
import { previewFinanceReport, readFinanceReportDocument, runFinanceReport, type ReportParams } from '@kompass/module-finance';
import { getDocument } from '@kompass/module-dms';

/**
 * Seitenbilder der Berichte für `PdfPages` (Designer Runde 6, Punkt 4). Jeder Aufruf prüft die Rechte über den Dienst
 * des Berichts (`runFinanceReport`, dasselbe Leserecht wie das PDF); erst danach greift ein Zwischenspeicher, damit
 * nicht jedes Bild das PDF neu setzt und neu rastert.
 *
 * Schlüssel ist der Datenstand (Kurz-Hash) mit Bericht, Parametern und Stufe — die Stufe gehört dazu, weil das
 * Abschließen eines Jahres den Hinweis auf dem Papier ändert, nicht die Daten. Was nicht im Hash steht (Namen von
 * Kategorien, die Uhrzeit im Fuß), darf bis zu `KEEP_MS` alt sein; „PDF öffnen“ und „Herunterladen“ rendern frisch.
 *
 * Der Speicher liegt im Temp-Verzeichnis, nicht in `deps.files`: Er gehört nicht ins Backup, und Next teilt keine
 * Modulvariablen zwischen den Bündeln von Seite und Route. Der Datenpfad steht im Namen (wie beim Seed-Schnappschuss),
 * damit sich zwei Server nicht gegenseitig bedienen.
 */
const KEEP_MS = 10 * 60_000;
/** Dichte je Stufe des `srcset`: 150 dpi füllt die Inhaltsspalte, 300 dpi für doppelte Pixeldichte. */
export const PAGE_DPI: Readonly<Record<string, number>> = { '1': 150, '2': 300 };

function cacheDir(): string {
  const key = createHash('sha256').update(process.env.DATA_PATH ?? process.cwd()).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `kompass-report-pages-${key}`);
}

async function fresh(name: string): Promise<Uint8Array | null> {
  const file = path.join(cacheDir(), name);
  const info = await stat(file).catch(() => null);
  return info && Date.now() - info.mtimeMs < KEEP_MS ? new Uint8Array(await readFile(file)) : null;
}

async function cached(name: string, produce: () => Promise<Uint8Array>): Promise<Uint8Array> {
  const hit = await fresh(name);
  if (hit) return hit;
  const bytes = await produce();
  await store(name, bytes);
  return bytes;
}

async function store(name: string, bytes: Uint8Array): Promise<void> {
  const dir = cacheDir();
  const file = path.join(dir, name);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // Erst unter fremdem Namen, dann umbenennen: Ein gleichzeitiger Leser sieht nie eine halbe Datei.
  const partial = `${file}.${process.pid}.${Date.now()}.part`;
  await writeFile(partial, bytes, { mode: 0o600 });
  await rename(partial, file);
  await sweep(dir);
}

/** Was älter ist als `KEEP_MS`, fliegt raus — bei jedem Schreiben, damit der Ordner nicht wächst. */
async function sweep(dir: string): Promise<void> {
  const now = Date.now();
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const info = await stat(path.join(dir, name)).catch(() => null);
    if (info && now - info.mtimeMs > KEEP_MS) await rm(path.join(dir, name), { force: true });
  }
}

/**
 * Rechte und Datenstand über den Dienst (der Hash enthält Bericht und Parameter); das PDF selbst erst, wenn der
 * Speicher es nicht hat.
 */
async function reportPdf(deps: Deps, ctx: CallContext, key: string, params: ReportParams): Promise<Result<{ stem: string; pdf: Uint8Array }>> {
  const run = await runFinanceReport(deps, ctx, { report: key, params });
  if (!run.ok) return run;
  const stem = `${run.value.hash.slice(0, 24)}-${run.value.stage}`;
  const file = `${stem}.pdf`;
  const hit = await fresh(file);
  if (hit) return ok({ stem, pdf: hit });
  const preview = await previewFinanceReport(deps, ctx, { report: key, params });
  if (!preview.ok) return preview;
  await store(file, preview.value.bytes);
  return ok({ stem, pdf: preview.value.bytes });
}

/** Die Seitenzahl des Berichts, für die Blätter der Seite; `null`, wenn das PDF keine trägt. */
export async function reportPageCount(deps: Deps, ctx: CallContext, key: string, params: ReportParams): Promise<Result<number | null>> {
  const source = await reportPdf(deps, ctx, key, params);
  if (!source.ok) return source;
  return ok(pdfPageCount(source.value.pdf));
}

/** Seite `page` als PNG in der Dichte `scale` (`PAGE_DPI`), mit der Seitenzahl dazu. */
export async function reportPageImage(deps: Deps, ctx: CallContext, key: string, params: ReportParams, page: number, scale: string): Promise<Result<{ png: Uint8Array; pageCount: number | null }>> {
  const source = await reportPdf(deps, ctx, key, params);
  if (!source.ok) return source;
  const { stem, pdf } = source.value;
  const dpi = PAGE_DPI[scale]!;
  const png = await cached(`${stem}-${page}-${dpi}.png`, () => renderPdfPage(pdf, page, { dpi }));
  return ok({ png, pageCount: pdfPageCount(pdf) });
}

// ── Abgelegte PDFs: Fassung eines Berichts, Scan in der Akte ─────────────────

/**
 * Seiten einer abgelegten Datei (Designer Runde 7, 16a C und 16e): Die Bytes kommen über den Dienst, der die Rechte des
 * Dokuments prüft; sie ändern sich nie, also hält der Speicher sie unter der Kennung des Dokuments.
 */
async function filedPageImage(stem: string, source: Result<{ bytes: Uint8Array }>, page: number, scale: string): Promise<Result<{ png: Uint8Array; pageCount: number | null }>> {
  if (!source.ok) return source;
  const pdf = source.value.bytes;
  const dpi = PAGE_DPI[scale]!;
  const png = await cached(`${stem}-${page}-${dpi}.png`, () => renderPdfPage(pdf, page, { dpi }));
  return ok({ png, pageCount: pdfPageCount(pdf) });
}

/** Seitenzahl der festgeschriebenen Fassung `reportId` — Rechte wie ihr Dokument (`readFinanceReportDocument`). */
export async function versionPageCount(deps: Deps, ctx: CallContext, reportId: string): Promise<Result<number | null>> {
  const file = await readFinanceReportDocument(deps, ctx, { reportId });
  if (!file.ok) return file;
  return ok(pdfPageCount(file.value.bytes));
}

/** Seite `page` der festgeschriebenen Fassung `reportId` als PNG. */
export async function versionPageImage(deps: Deps, ctx: CallContext, reportId: string, page: number, scale: string): Promise<Result<{ png: Uint8Array; pageCount: number | null }>> {
  return filedPageImage(`version-${reportId}`, await readFinanceReportDocument(deps, ctx, { reportId }), page, scale);
}

/** Seitenzahl eines Dokuments der Akte (Scan des Prüfberichts) — Rechte wie das Dokument (`getDocument`). */
export async function documentPageCount(deps: Deps, ctx: CallContext, documentId: string): Promise<Result<number | null>> {
  const file = await getDocument(deps, ctx, documentId);
  if (!file.ok) return file;
  return ok(pdfPageCount(file.value.bytes));
}

/** Seite `page` eines Dokuments der Akte als PNG. */
export async function documentPageImage(deps: Deps, ctx: CallContext, documentId: string, page: number, scale: string): Promise<Result<{ png: Uint8Array; pageCount: number | null }>> {
  return filedPageImage(`document-${documentId}`, await getDocument(deps, ctx, documentId), page, scale);
}
