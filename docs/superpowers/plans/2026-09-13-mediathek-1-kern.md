# Mediathek Auswahl und Vorschau, Plan 1: Kern

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Kern erzeugt beim Upload ein 320-px-WebP als Vorschau, liefert es über `getMediaPreview` aus und baut es nach, wenn es fehlt; `listMediaAssets` kennt Suche, Typ und Sortierung; Fundstellen tragen ein `href`; `media_list` zeigt dieselben Parameter.

**Architecture:** Eine neue Datei `packages/core/src/media/preview.ts` kapselt `sharp`; `prepare` in `service.ts` liest Maße und rendert die Vorschau vor jedem Schreibzugriff; `storeDetailed` schreibt Original und Vorschau, `deleteMediaAsset` löscht beide. Der Listenfilter ist ein exportiertes Zod-Schema, das Route Handler (Plan 2) und MCP-Werkzeug teilen. `MediaReference.href` folgt dem Muster `FollowUpTarget.href`; jedes Modul füllt es in seinem `references.ts`.

**Tech Stack:** TypeScript, Drizzle/SQLite, Zod 4, `sharp` 0.35, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-13-mediathek-auswahl-und-vorschau-design.md`, §3, §4.

## Global Constraints

- AGENTS.md Coding-Regeln: Service-Signatur `fn(deps, ctx, input) → Promise<Result<T>>`, `requirePermission` → `validate` → Transaktion → `recordAudit`; Fachfehler als `Result`, nie Exceptions; Zeit nur über `deps.clock`.
- Die Vorschau ist ein Cache (Prinzip 5): keine Spalte, keine Migration, kein Protokolleintrag beim Nachbau.
- Vorschau-Datei: `<name ohne Endung>.preview.webp`, 320 px breit, `rotate()` (EXIF), `withoutEnlargement: true`, `webp({ quality: 80 })`. Nur für `image/png`, `image/jpeg`, `image/webp`.
- Tests gegen `createTestDeps()` aus `packages/core/src/testing/index.ts` (In-Memory-SQLite, Memory-FileStore). Je Dienst: Erfolg, `forbidden`, `validation`, Audit.
- Commit je Task, kein Push. Vor jedem Commit `pnpm typecheck` und `pnpm --filter @kompass/core test` grün; bei Task 4 zusätzlich die Modultests, bei Task 5 `pnpm --filter @kompass/mcp test`.
- Commit-Nachrichten englisch im Stil der Historie (`feat(media): …`), am Ende die Attributionszeilen der Sitzung.

---

### Task 1: `preview.ts` — Vorschau rendern und nachbauen

**Files:**
- Create: `packages/core/src/media/preview.ts`
- Modify: `packages/core/package.json` (`sharp` rein, `image-size` raus)
- Test: `packages/core/tests/media-preview.test.ts`

**Interfaces:**
- Consumes: `Deps.media: FileStore` (`write`, `read`, `exists`, `delete` aus `packages/core/src/files/store.ts`), `MediaAssetRecord` aus `service.ts`.
- Produces:
  - `previewFilename(filename: string): string` — `foo-abc123.png` → `foo-abc123.preview.webp`
  - `hasPreview(mimeType: string): boolean` — true für die drei Rasterformate
  - `renderPreview(bytes: Uint8Array): Promise<Uint8Array>` — wirft bei unlesbarem Bild
  - `readImageMeta(bytes: Uint8Array): Promise<{ width: number; height: number }>` — EXIF-gedrehte Maße, wirft bei unlesbarem Bild
  - `ensurePreview(deps: Pick<Deps, 'media'>, record: Pick<MediaAssetRecord, 'filename' | 'mimeType'>): Promise<Uint8Array | null>` — SVG: Original; PDF: `null`; Raster: liest oder baut die Vorschau

- [x] **Step 1: Abhängigkeit umstellen**

In `packages/core/package.json` unter `dependencies`: `"image-size": "^2.0.2"` entfernen, `"sharp": "^0.35.4"` einfügen (gleiche Version wie `packages/modules/site/package.json`). Dann:

```bash
pnpm install
```

Erwartung: Lockfile ändert sich nur um den Eintrag für `@kompass/core`; `sharp` ist bereits im Lockfile.

- [x] **Step 2: Test schreiben**

```ts
// packages/core/tests/media-preview.test.ts
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ensurePreview, hasPreview, previewFilename, readImageMeta, renderPreview } from '../src/media/preview';
import { createTestDeps } from '../src/testing';

/** Ein einfarbiges Bild in den gewünschten Maßen — kein Binärmaterial im Repo. */
async function png(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background: '#336699' } }).png().toBuffer());
}

describe('preview naming', () => {
  it('replaces the extension with .preview.webp and knows which types get one', () => {
    expect(previewFilename('foto-0123456789ab.png')).toBe('foto-0123456789ab.preview.webp');
    expect(previewFilename('logo-0123456789ab.svg')).toBe('logo-0123456789ab.preview.webp');
    expect(hasPreview('image/jpeg')).toBe(true);
    expect(hasPreview('image/svg+xml')).toBe(false);
    expect(hasPreview('application/pdf')).toBe(false);
  });
});

describe('renderPreview', () => {
  it('scales a wide image to 320 px and keeps a small one at its size', async () => {
    const wide = await renderPreview(await png(800, 400));
    expect(await sharp(wide).metadata()).toMatchObject({ format: 'webp', width: 320, height: 160 });
    const small = await renderPreview(await png(100, 50));
    expect(await sharp(small).metadata()).toMatchObject({ width: 100, height: 50 });
  });

  it('keeps portrait portrait', async () => {
    const tall = await renderPreview(await png(400, 800));
    expect(await sharp(tall).metadata()).toMatchObject({ width: 320, height: 640 });
  });

  it('throws on bytes that are not an image', async () => {
    await expect(renderPreview(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
    await expect(readImageMeta(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });

  it('reads the dimensions', async () => {
    expect(await readImageMeta(await png(30, 20))).toEqual({ width: 30, height: 20 });
  });
});

describe('ensurePreview', () => {
  it('builds a missing preview once and reads it afterwards', async () => {
    const deps = createTestDeps();
    const original = await png(640, 320);
    await deps.media.write('bild-0123456789ab.png', original);
    const record = { filename: 'bild-0123456789ab.png', mimeType: 'image/png' };

    const first = await ensurePreview(deps, record);
    expect(first).not.toBeNull();
    expect(await deps.media.exists('bild-0123456789ab.preview.webp')).toBe(true);
    expect(await sharp(first!).metadata()).toMatchObject({ width: 320 });

    // Zweiter Aufruf liest die Datei, statt neu zu rendern: gleicher Inhalt.
    const second = await ensurePreview(deps, record);
    expect(Buffer.from(second!).equals(Buffer.from(first!))).toBe(true);
  });

  it('returns the original for SVG and null for PDF', async () => {
    const deps = createTestDeps();
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>');
    await deps.media.write('logo-0123456789ab.svg', svg);
    const bytes = await ensurePreview(deps, { filename: 'logo-0123456789ab.svg', mimeType: 'image/svg+xml' });
    expect(Buffer.from(bytes!).equals(Buffer.from(svg))).toBe(true);
    expect(await ensurePreview(deps, { filename: 'x-0123456789ab.pdf', mimeType: 'application/pdf' })).toBeNull();
  });
});
```

- [x] **Step 3: Test laufen lassen, rot sehen**

```bash
pnpm --filter @kompass/core exec vitest run tests/media-preview
```

Erwartung: FAIL, `Cannot find module '../src/media/preview'`.

- [x] **Step 4: Implementierung**

```ts
// packages/core/src/media/preview.ts
import sharp from 'sharp';
import type { Deps } from '../deps';
import type { MediaAssetRecord } from './service';

/**
 * Die Vorschau der Mediathek: 320 px breit, WebP, neben dem Original abgelegt.
 * Ein Cache im Sinn von Prinzip 5 — keine Spalte, kein Protokoll, jederzeit
 * aus dem Original neu berechenbar. Fehlt sie (Bestand von vor der Einführung,
 * von Hand gelöscht), baut `ensurePreview` sie beim nächsten Abruf.
 */
export const PREVIEW_WIDTH = 320;
const PREVIEW_SUFFIX = '.preview.webp';
const RASTER = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function previewFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '') + PREVIEW_SUFFIX;
}

export function hasPreview(mimeType: string): boolean {
  return RASTER.has(mimeType);
}

/** Maße nach EXIF-Drehung, so wie ein Browser das Bild zeigt. Wirft bei unlesbarem Bild. */
export async function readImageMeta(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height) throw new Error('image without dimensions');
  const swapped = (meta.orientation ?? 1) >= 5;
  return swapped ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
}

/** Wirft bei unlesbarem Bild — der Aufrufer entscheidet, was das für den Upload heißt. */
export async function renderPreview(bytes: Uint8Array): Promise<Uint8Array> {
  const out = await sharp(bytes).rotate().resize({ width: PREVIEW_WIDTH, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  return new Uint8Array(out);
}

/**
 * Liest die Vorschau, baut sie nach, wenn sie fehlt. SVG hat keine — das
 * Original ist klein und skaliert selbst; PDF hat keine — `null`.
 * `write` schluckt EEXIST: Zwei gleichzeitige Abrufe stören sich nicht.
 */
export async function ensurePreview(deps: Pick<Deps, 'media'>, record: Pick<MediaAssetRecord, 'filename' | 'mimeType'>): Promise<Uint8Array | null> {
  if (record.mimeType === 'image/svg+xml') return deps.media.read(record.filename);
  if (!hasPreview(record.mimeType)) return null;
  const name = previewFilename(record.filename);
  if (await deps.media.exists(name)) return deps.media.read(name);
  const bytes = await renderPreview(await deps.media.read(record.filename));
  await deps.media.write(name, bytes);
  return bytes;
}
```

- [x] **Step 5: Test grün sehen**

```bash
pnpm --filter @kompass/core exec vitest run tests/media-preview
```

Erwartung: PASS, 6 Tests. Typecheck schlägt an dieser Stelle noch fehl, weil `service.ts` `image-size` importiert — das erledigt Task 2. Deshalb erst dort committen, oder hier `pnpm typecheck` bewusst auslassen und die beiden Tasks zusammen committen. Empfehlung: beide Tasks in einem Commit, siehe Task 2 Step 7.

---

### Task 2: Upload rendert vor dem Schreiben, `getMediaPreview`, Löschen beider Dateien

**Files:**
- Modify: `packages/core/src/media/service.ts`
- Modify: `packages/core/src/index.ts` (Export `./media/preview`)
- Test: `packages/core/tests/media-preview.test.ts` (ergänzen), `packages/core/tests/media.test.ts`, `packages/core/tests/media-delete.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `prepare` liefert zusätzlich `preview: Uint8Array | null`; `Prepared` bekommt das Feld.
  - `getMediaPreview(deps, ctx, id): Promise<Result<{ record: MediaAssetRecord; bytes: Uint8Array | null; contentType: string }>>` — Rechte wie `getMediaAsset`; `bytes === null` für PDF.
  - Upload legt `<name>.preview.webp` ab; `deleteMediaAsset` entfernt beide.

- [x] **Step 1: Tests schreiben**

An `packages/core/tests/media-preview.test.ts` anhängen:

```ts
import { deleteMediaAsset, getMediaPreview, storeMediaAsset } from '../src/media/service';
import { unwrap } from '../src/result';
import { ctxWith, insertUser } from '../src/testing';

describe('preview through the service', () => {
  it('stores the preview next to the original at upload, with rotated dimensions', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const record = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'weit.png', bytes: await png(800, 400) }));
    expect(record).toMatchObject({ width: 800, height: 400 });
    expect(await deps.media.exists(previewFilename(record.filename))).toBe(true);
  });

  it('serves the preview, rebuilds it when it was removed, refuses without a session', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const record = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'weit.png', bytes: await png(800, 400) }));
    await deps.media.delete(previewFilename(record.filename));

    const served = unwrap(await getMediaPreview(deps, ctxWith([], 'someone'), record.id));
    expect(served.contentType).toBe('image/webp');
    expect(await sharp(served.bytes!).metadata()).toMatchObject({ width: 320 });
    expect(await deps.media.exists(previewFilename(record.filename))).toBe(true);

    const anonymous = await getMediaPreview(deps, ctxWith([], null), record.id);
    expect(anonymous.ok === false && anonymous.error.type === 'unauthorized').toBe(true);
    const missing = await getMediaPreview(deps, ctx, 'NOPE');
    expect(missing.ok === false && missing.error.type === 'notFound').toBe(true);
  });

  it('answers null bytes for a PDF and the original for an SVG', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>');
    const logo = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'logo.svg', bytes: svg, declaredMimeType: 'image/svg+xml' }));
    const servedSvg = unwrap(await getMediaPreview(deps, ctx, logo.id));
    expect(servedSvg.contentType).toBe('image/svg+xml');
    expect(Buffer.from(servedSvg.bytes!).equals(Buffer.from(svg))).toBe(true);

    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\nxref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF');
    const doc = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'doc.pdf', bytes: pdf, declaredMimeType: 'application/pdf' }));
    const servedPdf = unwrap(await getMediaPreview(deps, ctx, doc.id));
    expect(servedPdf.bytes).toBeNull();
  });

  it('deleting the asset removes original and preview', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const record = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'weg.png', bytes: await png(50, 50) }));
    unwrap(await deleteMediaAsset(deps, ctx, { id: record.id }));
    expect(await deps.media.exists(record.filename)).toBe(false);
    expect(await deps.media.exists(previewFilename(record.filename))).toBe(false);
  });
});
```

Der Test „rejects unsupported types…“ in `media.test.ts` bleibt und bekommt einen Fall dazu: Ein PNG-Header ohne Bild dahinter (`file-type` sagt PNG, `sharp` wirft) muss `unsupportedMediaType` liefern, und nichts darf geschrieben sein — der Memory-Store hat keine Liste, deshalb prüft der Test über das Änderungsprotokoll:

```ts
    const truncated = await storeMediaAsset(deps, ctx, { originalName: 't.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]) });
    expect(truncated.ok === false && truncated.error.type === 'validation' && truncated.error.issues[0]?.message === 'unsupportedMediaType').toBe(true);
    expect(deps.db.select().from(auditLog).all().filter((e) => e.action === 'media.upload')).toHaveLength(0);
```

- [x] **Step 2: Rot sehen**

```bash
pnpm --filter @kompass/core exec vitest run tests/media-preview tests/media.test
```

Erwartung: FAIL — `getMediaPreview` fehlt, Vorschau-Datei fehlt nach Upload.

- [x] **Step 3: `service.ts` umbauen**

Import-Zeile `import { imageSize } from 'image-size';` entfernen, stattdessen:

```ts
import { ensurePreview, hasPreview, previewFilename, readImageMeta, renderPreview } from './preview';
```

`Prepared` und `prepare` ersetzen:

```ts
type Prepared = { mimeType: string; ext: string; hash: string; width: number | null; height: number | null; preview: Uint8Array | null };

async function prepare(input: StoreMediaInput, trustDeclaredPdf: boolean = false): Promise<Result<Prepared>> {
  if (input.bytes.byteLength > MEDIA_MAX_BYTES) return invalid([{ path: 'bytes', message: 'fileTooLarge' }]);
  const mimeType = await detectMimeType(input, trustDeclaredPdf);
  if (!mimeType) return invalid([{ path: 'bytes', message: 'unsupportedMediaType' }]);
  if (mimeType === 'image/svg+xml' && /<script|on[a-z]+\s*=|javascript:/i.test(new TextDecoder().decode(input.bytes))) {
    return invalid([{ path: 'bytes', message: 'svgContainsScript' }]);
  }
  let width: number | null = null;
  let height: number | null = null;
  let preview: Uint8Array | null = null;
  if (hasPreview(mimeType)) {
    // Maße und Vorschau entstehen hier, vor jedem Schreibzugriff: Ein Bild, das
    // sharp nicht lesen kann, wird abgelehnt, nicht halb abgelegt.
    try {
      ({ width, height } = await readImageMeta(input.bytes));
      preview = await renderPreview(input.bytes);
    } catch {
      return invalid([{ path: 'bytes', message: 'unsupportedMediaType' }]);
    }
  }
  return ok({ mimeType, ext: EXTENSIONS[mimeType] as string, hash: createHash('sha256').update(input.bytes).digest('hex'), width, height, preview });
}
```

In `storeDetailed` die Zeile `await deps.media.write(filename, input.bytes);` ersetzen durch:

```ts
  await deps.media.write(filename, input.bytes);
  if (meta.preview) await deps.media.write(previewFilename(filename), meta.preview);
```

Nach `getMediaAsset` einfügen:

```ts
/**
 * Die Vorschau zu einem Asset, mit denselben Rechten wie das Original. Fehlt
 * die Datei, wird sie gebaut — ohne Protokolleintrag, es ist ein Cache.
 * `bytes` ist `null`, wenn es zu diesem Typ keine Vorschau gibt (PDF).
 */
export async function getMediaPreview(deps: Deps, ctx: CallContext, id: string): Promise<Result<{ record: MediaAssetRecord; bytes: Uint8Array | null; contentType: string }>> {
  if (!ctx.userId && ctx.channel !== 'system') return unauthorized('invalidCredentials');
  const record = deps.db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).get();
  if (!record) return notFound('mediaAsset', id);
  if (ctx.channel !== 'system') {
    for (const reference of findMediaReferences(deps, record.id)) {
      if (!reference.permission) continue;
      const denied = requirePermission(ctx, reference.permission);
      if (denied) return denied;
    }
  }
  const bytes = await ensurePreview(deps, record);
  const contentType = record.mimeType === 'image/svg+xml' ? 'image/svg+xml' : 'image/webp';
  return ok({ record, bytes, contentType });
}
```

Die Rechteprüfung steht jetzt zweimal (`getMediaAsset`, `getMediaPreview`). Zieh sie in eine private Funktion:

```ts
/** Angemeldet, und wo ein Modul das Asset unter ein Recht stellt, dieses Recht. */
function loadReadable(deps: Deps, ctx: CallContext, id: string): Result<MediaAssetRecord> {
  if (!ctx.userId && ctx.channel !== 'system') return unauthorized('invalidCredentials');
  const record = deps.db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).get();
  if (!record) return notFound('mediaAsset', id);
  if (ctx.channel !== 'system') {
    for (const reference of findMediaReferences(deps, record.id)) {
      if (!reference.permission) continue;
      const denied = requirePermission(ctx, reference.permission);
      if (denied) return denied;
    }
  }
  return ok(record);
}
```

und beide Funktionen darauf umstellen (`const loaded = loadReadable(deps, ctx, id); if (!loaded.ok) return loaded; const record = loaded.value;`).

In `deleteMediaAsset` nach `await deps.media.delete(record.filename);`:

```ts
  await deps.media.delete(previewFilename(record.filename));
```

In `packages/core/src/index.ts` nach `export * from './media/folders';`:

```ts
export * from './media/preview';
```

- [x] **Step 4: Grün sehen**

```bash
pnpm --filter @kompass/core exec vitest run tests/media
pnpm typecheck
```

Erwartung: alle `tests/media*` grün; Typecheck ohne Fehler (kein `image-size` mehr referenziert).

- [x] **Step 5: Gesamte Kern-Suite**

```bash
pnpm --filter @kompass/core test
```

Erwartung: grün. Falls ein Test mit dem 1×1-PNG an `readImageMeta` scheitert: Das 1×1-PNG der Tests ist ein gültiges Bild, sharp liest es. Sollte der Site-Seed-Test (`packages/modules/site/tests/seed.test.ts`) ein Bild nutzen, das sharp nicht mag, dort auf das 1×1-PNG umstellen — nicht die Prüfung lockern.

- [x] **Step 6: Modul- und App-Tests, die Bilder hochladen**

```bash
pnpm test
```

Erwartung: grün. Betroffen sind nur Tests, die `storeMediaAsset` mit echten Bytes rufen; alle nutzen das 1×1-PNG oder ein SVG.

- [x] **Step 7: Commit (Task 1 und 2 zusammen)**

```bash
git add packages/core/package.json pnpm-lock.yaml packages/core/src/media/preview.ts packages/core/src/media/service.ts packages/core/src/index.ts packages/core/tests/media-preview.test.ts packages/core/tests/media.test.ts
git commit -m "feat(media): a 320 px webp preview is rendered before the upload is written, served next to the original, rebuilt when missing"
```

---

### Task 3: `listMediaAssets` mit Filter, Suche und Sortierung

**Files:**
- Modify: `packages/core/src/media/service.ts`
- Modify: `apps/kompass/src/app/(shell)/admin/media/page.tsx` (Aufruf), `packages/mcp/src/core-tools.ts` (Aufruf im Handler von `media_list`)
- Test: `packages/core/tests/media.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface MediaListFilter { folder?: string | null; query?: string; kind?: 'image' | 'pdf'; sort?: 'newest' | 'oldest' | 'name' | 'size' }
  export const mediaListFilterSchema: z.ZodType<MediaListFilter>  // z.object({...}) mit allen Feldern optional
  export async function listMediaAssets(deps, ctx, filter?: MediaListFilter): Promise<Result<MediaLibraryItem[]>>
  ```
  Vorgabe `sort: 'newest'`.

- [x] **Step 1: Test schreiben**

In `packages/core/tests/media.test.ts` den Fall „filters by folder and reports references“ ersetzen durch:

```ts
  it('filters by folder, kind and query, sorts, and reports references', async () => {
    const deps = createTestDeps({ now: '2026-09-13T10:00:00.000Z' });
    const ctx = ctxWith(['media.upload', 'settings.manage'], insertUser(deps, {}));
    const { createMediaFolder } = await import('../src/media/folders');
    const { setSetting } = await import('../src/settings/service');
    unwrap(await createMediaFolder(deps, ctx, { path: 'logos' }));
    const logo = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'Vereinslogo.png', bytes: PNG, folder: 'logos' }));
    unwrap(await setSetting(deps, ctx, { key: 'branding.logoAssetId', value: logo.id }));
    const svg = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'zeichen.svg', bytes: SVG, declaredMimeType: 'image/svg+xml' }));
    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\nxref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF');
    const doc = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'satzung.pdf', bytes: pdf, declaredMimeType: 'application/pdf' }));

    // Ordner
    expect(unwrap(await listMediaAssets(deps, ctx, { folder: null })).map((m) => m.record.id).sort()).toEqual([svg.id, doc.id].sort());
    const inLogos = unwrap(await listMediaAssets(deps, ctx, { folder: 'logos' }));
    expect(inLogos.map((m) => m.record.id)).toEqual([logo.id]);
    expect(inLogos[0]!.references.map((r) => r.label)).toEqual(['Logo des Vereins']);

    // Typ
    expect(unwrap(await listMediaAssets(deps, ctx, { kind: 'pdf' })).map((m) => m.record.id)).toEqual([doc.id]);
    expect(unwrap(await listMediaAssets(deps, ctx, { kind: 'image' })).map((m) => m.record.id).sort()).toEqual([logo.id, svg.id].sort());

    // Suche: Dateiname ohne Groß-/Kleinschreibung, und Verwendungs-Label
    expect(unwrap(await listMediaAssets(deps, ctx, { query: 'VEREINS' })).map((m) => m.record.id)).toEqual([logo.id]);
    expect(unwrap(await listMediaAssets(deps, ctx, { query: 'logo des' })).map((m) => m.record.id)).toEqual([logo.id]);
    expect(unwrap(await listMediaAssets(deps, ctx, { query: 'gibtsnicht' }))).toEqual([]);

    // Sortierung: alle drei haben denselben Zeitstempel (feste Uhr), deshalb Name und Größe prüfen
    expect(unwrap(await listMediaAssets(deps, ctx, { sort: 'name' })).map((m) => m.record.filename.split('-')[0])).toEqual(['satzung', 'vereinslogo', 'zeichen']);
    const bySize = unwrap(await listMediaAssets(deps, ctx, { sort: 'size' })).map((m) => m.record.bytes);
    expect(bySize).toEqual([...bySize].sort((a, b) => b - a));
  });

  it('sorts newest first by default and oldest on request', async () => {
    const deps = createTestDeps({ now: '2026-09-13T10:00:00.000Z' });
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const first = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'erst.png', bytes: PNG }));
    deps.clock.advance(60 * 60 * 1000); // TestDeps.clock ist der FixedClock aus packages/core/src/clock.ts
    const second = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'dann.svg', bytes: SVG, declaredMimeType: 'image/svg+xml' }));
    expect(unwrap(await listMediaAssets(deps, ctx)).map((m) => m.record.id)).toEqual([second.id, first.id]);
    expect(unwrap(await listMediaAssets(deps, ctx, { sort: 'oldest' })).map((m) => m.record.id)).toEqual([first.id, second.id]);
  });

  it('rejects an unknown sort or kind through the schema', async () => {
    const { mediaListFilterSchema } = await import('../src/media/service');
    expect(mediaListFilterSchema.safeParse({ sort: 'random' }).success).toBe(false);
    expect(mediaListFilterSchema.safeParse({ kind: 'video' }).success).toBe(false);
    expect(mediaListFilterSchema.safeParse({ folder: null, query: 'x', kind: 'image', sort: 'name' }).success).toBe(true);
    expect(mediaListFilterSchema.safeParse({}).success).toBe(true);
  });
```

- [x] **Step 2: Rot sehen**

```bash
pnpm --filter @kompass/core exec vitest run tests/media.test
```

Erwartung: FAIL — Typfehler bzw. `mediaListFilterSchema` fehlt.

- [x] **Step 3: Implementierung**

In `service.ts` die Imports um `asc, desc, like` aus `drizzle-orm` erweitern und `listMediaAssets` ersetzen:

```ts
export interface MediaListFilter {
  /** weggelassen = alle; null = ohne Ordner; Pfad = genau dieser Ordner */
  folder?: string | null;
  /** Teilstring ohne Groß-/Kleinschreibung im Dateinamen oder in einem Verwendungs-Label */
  query?: string;
  /** image umfasst PNG, JPEG, WebP und SVG; pdf nur PDF */
  kind?: 'image' | 'pdf';
  /** Vorgabe newest */
  sort?: 'newest' | 'oldest' | 'name' | 'size';
}

/** Ein Schema für alle Kanäle: MCP-Werkzeug, Route Handler, Seite. */
export const mediaListFilterSchema = z.object({
  folder: z.string().nullable().optional(),
  query: z.string().max(200).optional(),
  kind: z.enum(['image', 'pdf']).optional(),
  sort: z.enum(['newest', 'oldest', 'name', 'size']).optional(),
});

/**
 * Alle Assets mit ihren Fundstellen. Ordner und Typ filtern in SQL, die
 * Suche danach — die Labels entstehen erst durch `findMediaReferences`.
 */
export async function listMediaAssets(deps: Deps, ctx: CallContext, filter: MediaListFilter = {}): Promise<Result<MediaLibraryItem[]>> {
  const denied = requirePermission(ctx, 'media.upload');
  if (denied) return denied;
  const conditions = [];
  if (filter.folder !== undefined) conditions.push(filter.folder === null ? isNull(mediaAssets.folder) : eq(mediaAssets.folder, filter.folder));
  if (filter.kind === 'image') conditions.push(like(mediaAssets.mimeType, 'image/%'));
  if (filter.kind === 'pdf') conditions.push(eq(mediaAssets.mimeType, 'application/pdf'));
  const order = {
    newest: [desc(mediaAssets.createdAt), desc(mediaAssets.id)],
    oldest: [asc(mediaAssets.createdAt), asc(mediaAssets.id)],
    name: [asc(mediaAssets.filename)],
    size: [desc(mediaAssets.bytes), asc(mediaAssets.filename)],
  }[filter.sort ?? 'newest'];
  const rows = deps.db.select().from(mediaAssets).where(conditions.length ? and(...conditions) : undefined).orderBy(...order).all();
  const items = rows.map((record) => ({ record, references: findMediaReferences(deps, record.id) }));
  const q = filter.query?.trim().toLowerCase();
  if (!q) return ok(items);
  return ok(items.filter((it) => it.record.filename.toLowerCase().includes(q) || it.references.some((r) => r.label.toLowerCase().includes(q))));
}
```

`and` ebenfalls aus `drizzle-orm` importieren. Die ID als zweites Sortierkriterium macht die Reihenfolge bei gleichem Zeitstempel stabil (ULIDs sind zeitlich sortiert).

Aufrufer anpassen:

- `apps/kompass/src/app/(shell)/admin/media/page.tsx`: `listMediaAssets(deps, ctx, current ?? undefined)` → `listMediaAssets(deps, ctx, current === null ? {} : { folder: current })`. (Die Seite bekommt in Plan 4 die weiteren Parameter.)
- `packages/mcp/src/core-tools.ts`, `media_list`: Handler `(deps, ctx, { folder }) => listMediaAssets(deps, ctx, folder)` → `(deps, ctx, args) => listMediaAssets(deps, ctx, args)`. Das Schema tauscht Task 5.
- `packages/core/tests/media.test.ts`, Fall „reads assets back…“: `listMediaAssets(deps, uploader)` bleibt gültig.

- [x] **Step 4: Grün sehen**

```bash
pnpm --filter @kompass/core exec vitest run tests/media.test
pnpm typecheck
pnpm --filter @kompass/mcp test
```

Erwartung: grün.

- [x] **Step 5: Commit**

```bash
git add packages/core/src/media/service.ts packages/core/tests/media.test.ts "apps/kompass/src/app/(shell)/admin/media/page.tsx" packages/mcp/src/core-tools.ts
git commit -m "feat(media): the list takes a filter — folder, kind, query over filename and usage, sort newest first"
```

---

### Task 4: `MediaReference.href` im Kern und in den Modulen

**Files:**
- Modify: `packages/core/src/modules/manifest.ts:42-56`
- Modify: `packages/core/src/media/references.ts`
- Modify: `packages/modules/animals/src/references.ts`, `packages/modules/projects/src/references.ts`, `packages/modules/site/src/references.ts`
- Test: `packages/core/tests/media-references.test.ts`, `packages/modules/animals/tests/references.test.ts`, `packages/modules/projects/tests/references.test.ts`, `packages/modules/site/tests/references.test.ts`

**Interfaces:**
- Produces: `MediaReference.href?: string` — Weg zur Fundstelle in der Oberfläche.
  | Modul | Entität | href |
  |---|---|---|
  | Kern | `setting` (Logo) | `/admin/settings` |
  | projects | `project` | `/projects/<id>` |
  | animals | `animal` | `/animals/<id>` |
  | site | `siteEntry` | `/site/c/<collection>/<id>` |
  | site | `siteValue` | `/site/variables` |

- [x] **Step 1: Tests anpassen**

Die bestehenden `toEqual`-Erwartungen in den vier Testdateien bekommen `href`:

`packages/core/tests/media-references.test.ts`, im Fall „reports the club logo…“ nach der `label`-Erwartung:
```ts
    expect(hits[0]!.href).toBe('/admin/settings');
```

`packages/modules/animals/tests/references.test.ts`:
```ts
    expect(animalsMediaReferences(d, photo.id)).toEqual([{ label: 'Tier „Rocky“', entity: 'animal', id: animal.id, href: `/animals/${animal.id}` }]);
```

`packages/modules/projects/tests/references.test.ts`:
```ts
    const hits = projectsMediaReferences(deps, asset.id);
    expect(hits).toEqual([{ label: 'Projekt „hof“', entity: 'project', id: expect.any(String), href: expect.stringMatching(/^\/projects\/[0-9A-Z]{26}$/) }]);
    expect(hits[0]!.href).toBe(`/projects/${hits[0]!.id}`);
```

`packages/modules/site/tests/references.test.ts`, im Fall „finds an asset in a variable and in a collection entry“ nach der `label`-Erwartung:
```ts
    const variable = hits.find((h) => h.entity === 'siteValue')!;
    expect(variable.href).toBe('/site/variables');
    const entry = hits.find((h) => h.entity === 'siteEntry')!;
    expect(entry.href).toBe(`/site/c/news/${entry.id}`);
```

- [x] **Step 2: Rot sehen**

```bash
pnpm --filter @kompass/core exec vitest run tests/media-references
pnpm --filter @kompass/module-animals exec vitest run tests/references
pnpm --filter @kompass/module-projects exec vitest run tests/references
pnpm --filter @kompass/module-site exec vitest run tests/references
```

Erwartung: je FAIL wegen fehlendem `href`.

- [x] **Step 3: Typ und Implementierungen**

`packages/core/src/modules/manifest.ts`, in `MediaReference` nach `id: string;`:

```ts
  /** Der Weg zur Fundstelle in der Oberfläche; weggelassen, wenn es keine Seite gibt. Muster wie `FollowUpTarget.href`. */
  href?: string;
```

`packages/core/src/media/references.ts`:
```ts
    refs.push({ label: 'Logo des Vereins', entity: 'setting', id: 'branding.logoAssetId', href: '/admin/settings' });
```

`packages/modules/animals/src/references.ts`, letzte Zeile der `map`:
```ts
    return { label: `Tier „${name}“`, entity: 'animal', id, href: `/animals/${id}` };
```

`packages/modules/projects/src/references.ts`:
```ts
    .map((p) => ({ label: `Projekt „${p.slug}“`, entity: 'project', id: p.id, href: `/projects/${p.id}` }));
```

`packages/modules/site/src/references.ts`:
```ts
    if (values[key] === assetId) refs.push({ label: `Variable „${key}“`, entity: 'siteValue', id: key, href: '/site/variables' });
```
und
```ts
        refs.push({ label: `Eintrag „${title}“ in „${col.label}“`, entity: 'siteEntry', id: row.id, href: `/site/c/${row.collection}/${row.id}` });
```

- [x] **Step 4: Grün sehen**

Dieselben vier Befehle wie in Step 2, dazu `pnpm typecheck`. Erwartung: grün. Die `apps/kompass/tests/media-references.test.ts` prüft nur `message` und bleibt unberührt.

- [x] **Step 5: Commit**

```bash
git add packages/core/src/modules/manifest.ts packages/core/src/media/references.ts packages/core/tests/media-references.test.ts packages/modules/animals/src/references.ts packages/modules/animals/tests/references.test.ts packages/modules/projects/src/references.ts packages/modules/projects/tests/references.test.ts packages/modules/site/src/references.ts packages/modules/site/tests/references.test.ts
git commit -m "feat(media): every usage of an asset carries the path to its page"
```

---

### Task 5: `media_list` mit dem Filterschema

**Files:**
- Modify: `packages/mcp/src/core-tools.ts:57`
- Test: `packages/mcp/tests/media-tools.test.ts`

**Interfaces:**
- Consumes: `mediaListFilterSchema`, `listMediaAssets` aus Task 3.
- Produces: Werkzeug `media_list` mit Eingabe `{ folder?, query?, kind?, sort? }`.

- [ ] **Step 1: Test schreiben**

An `packages/mcp/tests/media-tools.test.ts` anhängen:

```ts
describe('media_list', () => {
  it('shows the four filter fields and passes them to the service', async () => {
    const deps = setup();
    const ctx = ctxWith(['media.upload']);
    const shape = (tool('media_list').inputSchema as { shape: Record<string, unknown> }).shape;
    expect(Object.keys(shape).sort()).toEqual(['folder', 'kind', 'query', 'sort']);
    expect(tool('media_list').description).toContain('media.upload');

    await tool('media_upload').handler(deps, ctx, { filename: 'punkt.png', contentBase64: PNG_BASE64 });
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>').toString('base64');
    await tool('media_upload').handler(deps, ctx, { filename: 'zeichen.svg', contentBase64: svg });

    const all = unwrap(await tool('media_list').handler(deps, ctx, {})) as { record: { filename: string } }[];
    expect(all).toHaveLength(2);
    const found = unwrap(await tool('media_list').handler(deps, ctx, { query: 'punkt' })) as { record: { filename: string } }[];
    expect(found.map((m) => m.record.filename)).toEqual([expect.stringMatching(/^punkt-/)]);
    const byName = unwrap(await tool('media_list').handler(deps, ctx, { sort: 'name' })) as { record: { filename: string } }[];
    expect(byName.map((m) => m.record.filename.split('-')[0])).toEqual(['punkt', 'zeichen']);
  });
});
```

- [ ] **Step 2: Rot sehen**

```bash
pnpm --filter @kompass/mcp exec vitest run tests/media-tools
```

Erwartung: FAIL — `shape` hat nur `folder`.

- [ ] **Step 3: Werkzeug umstellen**

In `packages/mcp/src/core-tools.ts` `mediaListFilterSchema` mit importieren und die Zeile für `media_list` ersetzen:

```ts
  t({ name: 'media_list', description: 'List media assets with size, type, folder and where each is used (label, entity, id, href). Filters: folder (omitted = all, null = root), query (case-insensitive, matches filename and usage labels), kind (image | pdf), sort (newest default | oldest | name | size). Requires media.upload.', inputSchema: mediaListFilterSchema, handler: (deps, ctx, args) => listMediaAssets(deps, ctx, args), service: listMediaAssets }),
```

- [ ] **Step 4: Grün sehen**

```bash
pnpm --filter @kompass/mcp test
pnpm --filter @kompass/app exec vitest run tests/mcp-tools
pnpm typecheck
```

Erwartung: grün.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/core-tools.ts packages/mcp/tests/media-tools.test.ts
git commit -m "feat(mcp): media_list filters, searches and sorts like the library"
```

---

## Self-Review

**Spec-Abdeckung §3:** Ablage und Name (Task 1), Rendern vor dem Schreiben und `image-size` raus (Task 2), `getMediaPreview` mit Rechten (Task 2), Löschen beider Dateien (Task 2), `sharp` im Kern (Task 1). Route und `betrieb.md` sind Plan 2 bzw. Plan 4.
**§4:** `MediaListFilter`, Schema, SQL-Filter, Suche nach dem Laden, Sortierung (Task 3); `media_list` (Task 5); `href` in Kern und drei Modulen (Task 4).
**Typkonsistenz:** `MediaListFilter` und `mediaListFilterSchema` heißen in Task 3 und 5 gleich; `getMediaPreview` liefert `{ record, bytes, contentType }` und wird in Plan 2 so verwendet; `previewFilename` aus Task 1 in Task 2.
