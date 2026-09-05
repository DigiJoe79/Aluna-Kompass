# Fundament Teil 3: Betrieb — Dokumente, MCP, Medien, Backup, Docker — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Fundament betriebsfertig machen: Medienspeicher, Dokumenten-Engine mit Typst (Nummernkreis, Storno, Briefbogen, Protokoll-Export), MCP-Server mit voller Parität zu den Kern-Services, Backup-Export und -Import, die drei Platzhalter der Oberfläche (Dokumente, Backup, Logo-Upload) füllen, und das Ganze als Docker-Image für Test und Prod auf dem QNAP-NAS ausliefern, mit CI.

**Architecture:** Alle neuen Fähigkeiten folgen dem Muster aus Plan 1: Fachlogik im Kern (`packages/core`) als Services mit Rechteprüfung, Validierung, Transaktion und Audit-Eintrag; Adapter drumherum. `packages/documents` ist ein reiner Renderer (Typst) plus Vorlagen, der über die Registry in den Kern eingehängt wird. `packages/mcp` baut aus Kern-Services MCP-Tools und läuft als Web-Standard-Handler im Next-Prozess unter `/mcp`. Backup arbeitet mit der Online-Backup-API von SQLite und `tar.gz`. Ein Multi-Stage-Dockerfile liefert ein amd64-Image mit Node, Typst-Binary und Fonts.

**Tech Stack:** Typst 0.15.1 (Binary im Image) · `@modelcontextprotocol/server` 2.0 + `@modelcontextprotocol/client` 2.0 (Tests) · `tar` 7.5 · `file-type` 22 · `image-size` 2 · Docker (`node:26-bookworm-slim`) · GitHub Actions (checkout v7, setup-node v7, pnpm/action-setup v6, docker/* v4–v7).

**Spec:** `docs/superpowers/specs/2026-09-05-fundament-design.md` — Abschnitte 5 (`mediaAssets`, `documents`), 6 (MCP-Server konkret), 7 (Dokumenten-Engine), 8 (Umgebungen, Backup, Auslieferung).

**Voraussetzung:** Plan 1 (Kern) und Plan 2 (Oberfläche) sind umgesetzt; `pnpm test` und `pnpm --filter @kompass/app e2e` sind grün. Typst 0.15.x ist lokal installiert (`brew install typst` bzw. Release-Tarball), sonst schlagen die Tests in Task 3 mit klarer Meldung fehl.

## Global Constraints

- Alle Regeln aus Plan 1 und Plan 2 gelten weiter (Code Englisch, keine Farbliterale in `apps/kompass/src`, kein Löschen von Rechenschaftsdaten, ein Weg zu den Daten, TDD).
- **Dokumente werden nie gelöscht**, nur storniert; erzeugte PDFs sind unveränderlich; Nummern sind lückenlos je Vorlage und Jahr im Format `<PREFIX>-<JAHR>-<NNN>`.
- **Determinismus:** gleiche Eingabe + Vorlage + Typst-Version ⇒ byte-identische PDF (`set document(date: none)`, Fonts aus dem Repo, keine Systemzeit in Vorlagen).
- **MCP:** Token im `Authorization: Bearer`-Header → `resolveApiToken` → `CallContext` mit Kanal `mcp`; jedes Tool ruft genau eine Service-Funktion; Ergebnisse als JSON-Text; Fehler als `isError` mit dem `ServiceError`-Objekt. Kein Tool umgeht die Rechteprüfung.
- **Backup:** Export enthält DB-Kopie **mit** Passwort-Hashes, **ohne** `sessions` und `api_tokens`, plus Medien und `manifest.json`. Import nur mit passendem Format, nur in derselben oder neueren Migrationsstufe, nur nach Bestätigung durch den Umgebungsnamen; danach sind alle Sitzungen ungültig. Import und Export werden protokolliert.
- **Betrieb:** Konfiguration nur über `APP_ENV`, `DATABASE_PATH`, `MEDIA_PATH`, `PORT`, `SESSION_SECRET`; Typst-Version im Dockerfile gepinnt; Image nur amd64 (TS-873).
- **Versionen** (Stand 2026-09-05): `@modelcontextprotocol/server ^2.0.0`, `@modelcontextprotocol/client ^2.0.0`, `@modelcontextprotocol/node ^2.0.0` (nur für Node-`http`-Tests), `tar ^7.5.22`, `file-type ^22.0.2`, `image-size ^2.0.2`, Typst `0.15.1`, Fonts: Source Sans 3 `3.052R`, Source Serif 4 `4.005R`, IBM Plex Mono `2.5.0`.

---

## Dateistruktur (Ergebnis dieses Plans)

```
packages/core/src/
  media/store.ts                  MediaStore (Datei + In-Memory), createFileMediaStore, createMemoryMediaStore
  media/service.ts                storeMediaAsset, storeMediaInternal, getMediaAsset, listMediaAssets
  documents/service.ts            renderDocument, voidDocument, listDocuments, getDocument, nextDocumentNumber
  backup/export.ts  backup/import.ts  exportBackup, importBackup, BACKUP_FORMAT
  modules/manifest.ts             + DocumentTemplate, McpToolDefinition, DocumentRenderContext
  modules/registry.ts             + documentTemplates, mcpTools
  deps.ts                         + media: MediaStore
  app.ts                          createDeps({ mediaPath, coreTemplates }) → + backupDatabase, reopen, databasePath
packages/documents/
  package.json  src/index.ts  src/typst.ts  src/renderer.ts  src/templates.ts
  templates/base.typ  templates/letterhead.typ  templates/audit-log-export.typ
  fonts/*.ttf + LICENSE-Dateien
  tests/renderer.test.ts  tests/templates.test.ts
packages/mcp/
  package.json  src/index.ts  src/handler.ts  src/core-tools.ts  src/result.ts
  tests/handler.test.ts
apps/kompass/
  src/lib/deps.ts                 + mediaPath, coreTemplates(Typst)
  src/app/mcp/route.ts            GET/POST/DELETE → MCP-Handler
  src/app/media/[id]/route.ts     Asset ausliefern (angemeldet)
  src/app/documents/[id]/file/route.ts  PDF ausliefern (documents.view)
  src/app/api/health/route.ts
  src/app/(shell)/admin/documents/  page.tsx, actions.ts, document-list.tsx, create-document-dialog.tsx, document-preview.tsx
  src/app/(shell)/admin/audit/export-button.tsx + actions.ts (Protokoll-PDF)
  src/app/(shell)/admin/settings/logo-upload.tsx + actions.ts (Logo)
  src/app/(shell)/admin/backup/   page.tsx, actions.ts, export-card.tsx, import-card.tsx
  src/app/admin/backup/export/route.ts   Download-Route
  e2e/documents.spec.ts  e2e/backup.spec.ts  e2e/mcp.spec.ts
Dockerfile  .dockerignore  docker-compose.yml  scripts/docker-entrypoint.sh
.github/workflows/ci.yml
docs/betrieb.md                   NAS-Anleitung (Container Station, Volumes, Update, Backup)
```

---

### Task 1: Medienspeicher im Kern

**Files:**
- Create: `packages/core/src/media/store.ts`, `packages/core/src/media/service.ts`
- Modify: `packages/core/src/deps.ts` (`media`), `packages/core/src/app.ts` (`mediaPath`), `packages/core/src/testing/index.ts` (Memory-Store), `packages/core/src/index.ts`, `packages/core/package.json` (Abhängigkeiten `file-type`, `image-size`)
- Test: `packages/core/tests/media.test.ts`

**Interfaces:**
- Produces:
  - `interface MediaStore { rootDir: string | null; write(filename, bytes: Uint8Array): Promise<void>; read(filename): Promise<Uint8Array>; exists(filename): Promise<boolean>; pathFor(filename): string | null }`; `createFileMediaStore(rootDir)`, `createMemoryMediaStore()`.
  - `Deps.media: MediaStore`; `createDeps({ mediaPath, … })`.
  - `interface MediaAssetRecord { id; filename; mimeType; bytes; width; height; uploadedByUserId; createdAt }`
  - `storeMediaAsset(deps, ctx, { originalName: string; bytes: Uint8Array; declaredMimeType?: string }) → Promise<Result<MediaAssetRecord>>` — `media.upload`; erlaubt PNG, JPEG, WebP, SVG, PDF; max. 10 MB; Dateiname `<slug>-<hash12>.<ext>`; identischer Inhalt ⇒ vorhandener Datensatz.
  - `storeMediaInternal(tx, deps, ctx, input)` — ohne Rechteprüfung (für Dokumente/Import), gleiche Validierung.
  - `getMediaAsset(deps, ctx, id) → Promise<Result<{ record; bytes }>>` — jeder angemeldete Nutzer; `listMediaAssets(deps, ctx)` — `media.upload`.
  - Fehlercodes (validation): `unsupportedMediaType`, `fileTooLarge`, `svgContainsScript`.

- [ ] **Step 1: Test schreiben**

`packages/core/tests/media.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { auditLog } from '../src/db/schema';
import { getMediaAsset, listMediaAssets, storeMediaAsset } from '../src/media/service';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

// 1×1 PNG
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');

describe('media service', () => {
  it('stores a PNG with sniffed type, dimensions, hashed filename and audit entry', async () => {
    const deps = createTestDeps();
    const userId = insertUser(deps, {});
    const record = unwrap(await storeMediaAsset(deps, ctxWith(['media.upload'], userId), { originalName: 'Vereins Logo.PNG', bytes: PNG, declaredMimeType: 'application/octet-stream' }));
    expect(record).toMatchObject({ mimeType: 'image/png', bytes: PNG.byteLength, width: 1, height: 1, uploadedByUserId: userId });
    expect(record.filename).toMatch(/^vereins-logo-[0-9a-f]{12}\.png$/);
    expect(await deps.media.exists(record.filename)).toBe(true);
    expect(deps.db.select().from(auditLog).all().at(-1)).toMatchObject({ action: 'media.upload', entityType: 'mediaAsset', entityId: record.id });
  });

  it('deduplicates identical content and accepts safe SVG', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const a = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'a.png', bytes: PNG }));
    const b = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'b.png', bytes: PNG }));
    expect(b.id).toBe(a.id);
    const svg = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'logo.svg', bytes: SVG, declaredMimeType: 'image/svg+xml' }));
    expect(svg.mimeType).toBe('image/svg+xml');
  });

  it('rejects unsupported types, scripts in SVG, oversized files and missing permission', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const exe = await storeMediaAsset(deps, ctx, { originalName: 'x.exe', bytes: new Uint8Array([0x4d, 0x5a, 0, 0]) });
    expect(exe.ok === false && exe.error.type === 'validation' && exe.error.issues[0]?.message === 'unsupportedMediaType').toBe(true);
    const evil = await storeMediaAsset(deps, ctx, { originalName: 'e.svg', bytes: new TextEncoder().encode('<svg><script>alert(1)</script></svg>'), declaredMimeType: 'image/svg+xml' });
    expect(evil.ok === false && evil.error.type === 'validation' && evil.error.issues[0]?.message === 'svgContainsScript').toBe(true);
    const big = await storeMediaAsset(deps, ctx, { originalName: 'big.png', bytes: new Uint8Array(10 * 1024 * 1024 + 1) });
    expect(big.ok === false && big.error.type === 'validation' && big.error.issues[0]?.message === 'fileTooLarge').toBe(true);
    const denied = await storeMediaAsset(deps, ctxWith([], 'U'), { originalName: 'a.png', bytes: PNG });
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
  });

  it('reads assets back for any authenticated user and lists them for uploaders', async () => {
    const deps = createTestDeps();
    const uploader = ctxWith(['media.upload'], insertUser(deps, {}));
    const record = unwrap(await storeMediaAsset(deps, uploader, { originalName: 'a.png', bytes: PNG }));
    const read = unwrap(await getMediaAsset(deps, ctxWith([], 'someone'), record.id));
    expect(Buffer.from(read.bytes).equals(Buffer.from(PNG))).toBe(true);
    expect(unwrap(await listMediaAssets(deps, uploader)).map((m) => m.id)).toEqual([record.id]);
    expect((await getMediaAsset(deps, ctxWith([], null), record.id)).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core add file-type@^22.0.2 image-size@^2.0.2 && pnpm --filter @kompass/core test tests/media.test.ts`
Expected: FAIL — Module fehlen, `deps.media` existiert nicht.

- [ ] **Step 3: Store und Deps**

`packages/core/src/media/store.ts`:
```ts
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface MediaStore {
  /** Dateisystem-Wurzel oder null (In-Memory). */
  rootDir: string | null;
  write(filename: string, bytes: Uint8Array): Promise<void>;
  read(filename: string): Promise<Uint8Array>;
  exists(filename: string): Promise<boolean>;
  pathFor(filename: string): string | null;
}

const SAFE_FILENAME = /^[a-z0-9][a-z0-9._-]{0,180}$/;

export function assertSafeFilename(filename: string): void {
  if (!SAFE_FILENAME.test(filename) || filename.includes('..')) throw new Error(`unsafe media filename: ${filename}`);
}

export function createFileMediaStore(rootDir: string): MediaStore {
  const resolve = (filename: string) => {
    assertSafeFilename(filename);
    return path.join(rootDir, filename);
  };
  return {
    rootDir,
    async write(filename, bytes) {
      await mkdir(rootDir, { recursive: true });
      await writeFile(resolve(filename), bytes, { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'EEXIST') throw e; // identischer Inhalt (Hash im Namen) ⇒ bereits vorhanden
      });
    },
    read: (filename) => readFile(resolve(filename)),
    exists: (filename) => stat(resolve(filename)).then(() => true, () => false),
    pathFor: (filename) => resolve(filename),
  };
}

export function createMemoryMediaStore(): MediaStore {
  const files = new Map<string, Uint8Array>();
  return {
    rootDir: null,
    async write(filename, bytes) {
      assertSafeFilename(filename);
      if (!files.has(filename)) files.set(filename, new Uint8Array(bytes));
    },
    async read(filename) {
      const bytes = files.get(filename);
      if (!bytes) throw new Error(`media not found: ${filename}`);
      return bytes;
    },
    exists: async (filename) => files.has(filename),
    pathFor: () => null,
  };
}
```

`packages/core/src/deps.ts` ergänzen:
```ts
import type { MediaStore } from './media/store';
// …
export interface Deps {
  db: Db;
  clock: Clock;
  env: AppEnv;
  registry: Registry;
  media: MediaStore;
}
```

`packages/core/src/app.ts`: `CreateDepsOptions` um `mediaPath: string` erweitern und `media: createFileMediaStore(opts.mediaPath)` ins Rückgabeobjekt aufnehmen (`app.test.ts`: `mediaPath: path.join(dir, 'media')` ergänzen und `expect(first.media.rootDir).toBe(path.join(dir, 'media'))` prüfen). `createTestDeps` in `src/testing/index.ts`: `media: createMemoryMediaStore()`.

- [ ] **Step 4: Service**

`packages/core/src/media/service.ts`:
```ts
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import { imageSize } from 'image-size';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import { mediaAssets } from '../db/schema';
import type { Deps } from '../deps';
import { newId } from '../ids';
import { requirePermission } from '../permissions/check';
import { invalid, notFound, ok, unauthorized, type Result } from '../result';

export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
};

export type MediaAssetRecord = typeof mediaAssets.$inferSelect;

export interface StoreMediaInput {
  originalName: string;
  bytes: Uint8Array;
  declaredMimeType?: string;
}

function slug(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  return base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
}

async function detectMimeType(input: StoreMediaInput): Promise<string | null> {
  const sniffed = await fileTypeFromBuffer(input.bytes);
  if (sniffed && EXTENSIONS[sniffed.mime]) return sniffed.mime;
  const head = new TextDecoder().decode(input.bytes.subarray(0, 512)).trimStart();
  if ((input.declaredMimeType === 'image/svg+xml' || input.originalName.toLowerCase().endsWith('.svg')) && (head.startsWith('<svg') || head.startsWith('<?xml'))) return 'image/svg+xml';
  return null;
}

type Prepared = { mimeType: string; ext: string; hash: string; width: number | null; height: number | null };

async function prepare(input: StoreMediaInput): Promise<Result<Prepared>> {
  if (input.bytes.byteLength > MEDIA_MAX_BYTES) return invalid([{ path: 'bytes', message: 'fileTooLarge' }]);
  const mimeType = await detectMimeType(input);
  if (!mimeType) return invalid([{ path: 'bytes', message: 'unsupportedMediaType' }]);
  if (mimeType === 'image/svg+xml' && /<script|on[a-z]+\s*=|javascript:/i.test(new TextDecoder().decode(input.bytes))) {
    return invalid([{ path: 'bytes', message: 'svgContainsScript' }]);
  }
  let width: number | null = null;
  let height: number | null = null;
  if (mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/webp') {
    try {
      const size = imageSize(input.bytes);
      width = size.width ?? null;
      height = size.height ?? null;
    } catch {
      return invalid([{ path: 'bytes', message: 'unsupportedMediaType' }]);
    }
  }
  return ok({ mimeType, ext: EXTENSIONS[mimeType] as string, hash: createHash('sha256').update(input.bytes).digest('hex'), width, height });
}

/** Ohne Rechteprüfung; für Dokument-Rendering und Import. Validiert und protokolliert trotzdem. */
export async function storeMediaInternal(deps: Deps, ctx: CallContext, input: StoreMediaInput, prepared?: Prepared): Promise<Result<MediaAssetRecord>> {
  const prep = prepared ? ok(prepared) : await prepare(input);
  if (!prep.ok) return prep;
  const meta = prep.value;
  const filename = `${slug(input.originalName)}-${meta.hash.slice(0, 12)}.${meta.ext}`;
  const existing = deps.db.select().from(mediaAssets).where(eq(mediaAssets.filename, filename)).get();
  if (existing) return ok(existing);
  await deps.media.write(filename, input.bytes);
  return deps.db.transaction((tx: DbOrTx) => {
    const id = newId();
    tx.insert(mediaAssets)
      .values({ id, filename, mimeType: meta.mimeType, bytes: input.bytes.byteLength, width: meta.width, height: meta.height, uploadedByUserId: ctx.userId, createdAt: isoNow(deps.clock) })
      .run();
    const record = tx.select().from(mediaAssets).where(eq(mediaAssets.id, id)).get() as MediaAssetRecord;
    recordAudit(tx, deps, ctx, { action: 'media.upload', entityType: 'mediaAsset', entityId: id, after: record, summary: `Datei ${filename} abgelegt` });
    return ok(record);
  });
}

export async function storeMediaAsset(deps: Deps, ctx: CallContext, input: StoreMediaInput): Promise<Result<MediaAssetRecord>> {
  const denied = requirePermission(ctx, 'media.upload');
  if (denied) return denied;
  const prepared = await prepare(input);
  if (!prepared.ok) return prepared;
  return storeMediaInternal(deps, ctx, input, prepared.value);
}

export async function getMediaAsset(deps: Deps, ctx: CallContext, id: string): Promise<Result<{ record: MediaAssetRecord; bytes: Uint8Array }>> {
  if (!ctx.userId && ctx.channel !== 'system') return unauthorized('invalidCredentials');
  const record = deps.db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).get();
  if (!record) return notFound('mediaAsset', id);
  return ok({ record, bytes: await deps.media.read(record.filename) });
}

export async function listMediaAssets(deps: Deps, ctx: CallContext): Promise<Result<MediaAssetRecord[]>> {
  const denied = requirePermission(ctx, 'media.upload');
  if (denied) return denied;
  return ok(deps.db.select().from(mediaAssets).orderBy(mediaAssets.createdAt).all());
}
```
Der Parameter `prepared` vermeidet doppeltes Sniffen, wenn `storeMediaAsset` bereits validiert hat.

In `packages/core/src/index.ts` ergänzen: `export * from './media/store'; export * from './media/service';`.

- [ ] **Step 5: Tests ausführen**

Run: `pnpm --filter @kompass/core test && pnpm --filter @kompass/core typecheck`
Expected: alle grün (auch `app.test.ts` mit `mediaPath`). Danach `apps/kompass/src/lib/deps.ts` anpassen: `createDeps({ databasePath, env, mediaPath: env.mediaPath })` — sonst bricht die App; `pnpm --filter @kompass/app typecheck` muss grün bleiben.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): media store with type sniffing, dedupe and audited uploads"
```

---

### Task 2: Dokumenten-Service im Kern (Nummernkreis, Storno, Vorlagen-Registry)

**Files:**
- Modify: `packages/core/src/modules/manifest.ts` (`DocumentTemplate`, `DocumentRenderContext`, `documentTemplates`), `packages/core/src/modules/registry.ts` (`documentTemplates`, `createRegistry(manifests, extra?)`), `packages/core/src/app.ts` (`coreTemplates`), `packages/core/src/testing/index.ts` (`coreTemplates`-Option), `packages/core/src/index.ts`
- Create: `packages/core/src/documents/service.ts`
- Test: `packages/core/tests/documents.test.ts`

**Interfaces:**
- Produces:
  - `interface DocumentRenderContext { number: string; issuedAt: string; organization: Record<string, unknown>; theme: Theme; logo: { bytes: Uint8Array; mimeType: string } | null }`
  - `interface DocumentTemplate<T = unknown> { key: string; prefix: string; schema: z.ZodType<T>; permission?: string; render(data: T, ctx: DocumentRenderContext): Promise<Uint8Array> }` (Prefix `/^[A-Z]{3}$/`, Key `/^[a-z][a-z0-9-]*$/`).
  - `Registry.documentTemplates: ReadonlyMap<string, DocumentTemplate>`; `createRegistry(manifests, { coreTemplates? })`; `createDeps({ coreTemplates? })`.
  - `interface DocumentRecord { id; templateKey; number; entityType; entityId; status; voidedAt; voidedByUserId; voidReason; createdByUserId; createdAt; assetId; inputSnapshot: unknown }`
  - `renderDocument(deps, ctx, { templateKey, input, entityType?, entityId? }) → Promise<Result<DocumentRecord>>` — `documents.create` (+ `template.permission`).
  - `voidDocument(deps, ctx, { id, reason }) → Promise<Result<DocumentRecord>>` — `documents.create`; Code `documentAlreadyVoided`.
  - `listDocuments(deps, ctx, { templateKey?, entityType?, entityId?, limit?, offset? }) → Promise<Result<{ documents: DocumentRecord[]; total: number }>>` — `documents.view`.
  - `getDocument(deps, ctx, id) → Promise<Result<{ record: DocumentRecord; bytes: Uint8Array; filename: string }>>` — `documents.view`.
  - `nextDocumentNumber(db, prefix, year) → string` (rein lesend).

- [ ] **Step 1: Test schreiben**

`packages/core/tests/documents.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { auditLog } from '../src/db/schema';
import { getDocument, listDocuments, nextDocumentNumber, renderDocument, voidDocument } from '../src/documents/service';
import type { DocumentTemplate } from '../src/modules/manifest';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

const encoder = new TextEncoder();
const letter: DocumentTemplate<{ title: string }> = {
  key: 'test-letter',
  prefix: 'TST',
  schema: z.object({ title: z.string().min(1) }),
  render: async (data, ctx) => encoder.encode(`PDF ${ctx.number} ${data.title} ${ctx.organization['organization.name']}`),
};

function setup() {
  const deps = createTestDeps({ coreTemplates: [letter] });
  const userId = insertUser(deps, {});
  return { deps, ctx: ctxWith(['documents.create', 'documents.view'], userId), userId };
}

describe('documents service', () => {
  it('renders with a gapless number per template and year, stores the PDF and audits', async () => {
    const { deps, ctx } = setup();
    const first = unwrap(await renderDocument(deps, ctx, { templateKey: 'test-letter', input: { title: 'Hallo' } }));
    const second = unwrap(await renderDocument(deps, ctx, { templateKey: 'test-letter', input: { title: 'Welt' }, entityType: 'user', entityId: 'U1' }));
    expect(first.number).toBe('TST-2026-001');
    expect(second.number).toBe('TST-2026-002');
    expect(second).toMatchObject({ status: 'issued', entityType: 'user', entityId: 'U1', inputSnapshot: { title: 'Welt' } });
    const file = unwrap(await getDocument(deps, ctx, second.id));
    expect(new TextDecoder().decode(file.bytes)).toBe('PDF TST-2026-002 Welt Neuer Verein');
    expect(file.filename).toBe('TST-2026-002.pdf');
    expect(deps.db.select().from(auditLog).all().filter((e) => e.action === 'documents.render')).toHaveLength(2);
    deps.clock.set('2027-01-02T09:00:00.000Z');
    expect(unwrap(await renderDocument(deps, ctx, { templateKey: 'test-letter', input: { title: 'Neu' } })).number).toBe('TST-2027-001');
    expect(nextDocumentNumber(deps.db, 'TST', 2026)).toBe('TST-2026-003');
  });

  it('validates input against the template schema and requires the permission', async () => {
    const { deps, ctx } = setup();
    const bad = await renderDocument(deps, ctx, { templateKey: 'test-letter', input: { title: '' } });
    expect(bad.ok === false && bad.error.type === 'validation' && bad.error.issues[0]?.path === 'title').toBe(true);
    const unknown = await renderDocument(deps, ctx, { templateKey: 'nope', input: {} });
    expect(unknown.ok === false && unknown.error.type === 'notFound').toBe(true);
    const denied = await renderDocument(deps, ctxWith(['documents.view']), { templateKey: 'test-letter', input: { title: 'x' } });
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
  });

  it('voids a document once, keeps the file and number, and audits the reason', async () => {
    const { deps, ctx, userId } = setup();
    const doc = unwrap(await renderDocument(deps, ctx, { templateKey: 'test-letter', input: { title: 'x' } }));
    const voided = unwrap(await voidDocument(deps, ctx, { id: doc.id, reason: 'Tippfehler' }));
    expect(voided).toMatchObject({ status: 'voided', voidReason: 'Tippfehler', voidedByUserId: userId, number: 'TST-2026-001' });
    expect((await getDocument(deps, ctx, doc.id)).ok).toBe(true);
    const again = await voidDocument(deps, ctx, { id: doc.id, reason: 'nochmal' });
    expect(again.ok === false && again.error.type === 'conflict' && again.error.code === 'documentAlreadyVoided').toBe(true);
    expect(unwrap(await renderDocument(deps, ctx, { templateKey: 'test-letter', input: { title: 'Ersatz' } })).number).toBe('TST-2026-002');
  });

  it('lists newest first with filters and total', async () => {
    const { deps, ctx } = setup();
    unwrap(await renderDocument(deps, ctx, { templateKey: 'test-letter', input: { title: 'a' }, entityType: 'user', entityId: 'U1' }));
    deps.clock.advance(1000);
    unwrap(await renderDocument(deps, ctx, { templateKey: 'test-letter', input: { title: 'b' } }));
    const all = unwrap(await listDocuments(deps, ctx, {}));
    expect(all.total).toBe(2);
    expect(all.documents.map((d) => d.number)).toEqual(['TST-2026-002', 'TST-2026-001']);
    expect(unwrap(await listDocuments(deps, ctx, { entityType: 'user', entityId: 'U1' })).total).toBe(1);
    expect((await listDocuments(deps, ctxWith([]), {})).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core test tests/documents.test.ts`
Expected: FAIL — `coreTemplates` unbekannt, Modul fehlt.

- [ ] **Step 3: Manifest, Registry, Deps erweitern**

In `packages/core/src/modules/manifest.ts` ergänzen:
```ts
import type { Theme } from '../themes/tokens';

export interface DocumentRenderContext {
  number: string;
  issuedAt: string;
  organization: Record<string, unknown>;
  theme: Theme;
  logo: { bytes: Uint8Array; mimeType: string } | null;
}

export interface DocumentTemplate<T = unknown> {
  key: string;
  /** Drei Großbuchstaben, z. B. BRF; Teil der Dokumentnummer. */
  prefix: string;
  schema: z.ZodType<T>;
  /** Zusätzliches Recht neben documents.create, z. B. finance.edit. */
  permission?: string;
  render(data: T, ctx: DocumentRenderContext): Promise<Uint8Array>;
}

export interface McpToolDefinition<T = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<T>;
  handler(deps: Deps, ctx: CallContext, args: T): Promise<Result<unknown>>;
}
// ModuleManifest um `documentTemplates?: readonly DocumentTemplate[]` und `mcpTools?: readonly McpToolDefinition[]` erweitern.
```
(`CallContext` und `Result` als Typ-Importe ergänzen. `defineModule` prüft zusätzlich `prefix` gegen `/^[A-Z]{3}$/` und `key` der Vorlagen gegen `/^[a-z][a-z0-9-]*$/`.)

In `packages/core/src/modules/registry.ts`:
```ts
export interface Registry {
  manifests: readonly ModuleManifest[];
  permissionKeys: ReadonlySet<string>;
  settingDefinitions: ReadonlyMap<string, SettingDefinition>;
  documentTemplates: ReadonlyMap<string, DocumentTemplate>;
  module(key: string): ModuleManifest | undefined;
}

export function createRegistry(manifests: readonly ModuleManifest[], extra: { coreTemplates?: readonly DocumentTemplate[] } = {}): Registry {
  // … bisheriger Code …
  const documentTemplates = new Map<string, DocumentTemplate>();
  const addTemplate = (t: DocumentTemplate) => {
    if (documentTemplates.has(t.key)) throw new Error(`duplicate document template: ${t.key}`);
    for (const other of documentTemplates.values()) if (other.prefix === t.prefix) throw new Error(`duplicate document prefix: ${t.prefix}`);
    documentTemplates.set(t.key, t);
  };
  for (const t of extra.coreTemplates ?? []) addTemplate(t);
  for (const manifest of manifests) for (const t of manifest.documentTemplates ?? []) addTemplate(t);
  return { manifests, permissionKeys, settingDefinitions, documentTemplates, module: (key) => byKey.get(key) };
}
```
`registry.test.ts` ergänzen: doppelter Prefix wirft. `createDeps`-Option `coreTemplates?: DocumentTemplate[]` → `createRegistry([coreModule, ...modules], { coreTemplates })`; `createTestDeps({ coreTemplates })` analog.

- [ ] **Step 4: Service**

`packages/core/src/documents/service.ts`:
```ts
import { and, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import { documents, mediaAssets } from '../db/schema';
import type { Deps } from '../deps';
import { newId } from '../ids';
import { storeMediaInternal } from '../media/service';
import type { DocumentRenderContext, DocumentTemplate } from '../modules/manifest';
import { requirePermission } from '../permissions/check';
import { conflict, notFound, ok, type Result } from '../result';
import { readAllSettings, readSetting } from '../settings/service';
import { resolveActiveTheme } from '../themes/service';
import { validate } from '../validate';

export type DocumentRecord = Omit<typeof documents.$inferSelect, 'inputSnapshot'> & { inputSnapshot: unknown };

const toRecord = (row: typeof documents.$inferSelect): DocumentRecord => ({ ...row, inputSnapshot: JSON.parse(row.inputSnapshot) });

export function nextDocumentNumber(db: DbOrTx, prefix: string, year: number): string {
  const row = db
    .select({ n: count() })
    .from(documents)
    .where(sql`${documents.number} like ${`${prefix}-${year}-%`}`)
    .get();
  return `${prefix}-${year}-${String((row?.n ?? 0) + 1).padStart(3, '0')}`;
}

const renderSchema = z.object({
  templateKey: z.string().min(1),
  input: z.unknown(),
  entityType: z.string().min(1).optional(),
  entityId: z.string().min(1).optional(),
});

async function buildContext(deps: Deps, ctx: CallContext, number: string): Promise<DocumentRenderContext> {
  const all = readAllSettings(deps);
  const organization = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith('organization.')));
  const logoId = readSetting<string | null>(deps, 'branding.logoAssetId');
  let logo: DocumentRenderContext['logo'] = null;
  if (logoId) {
    const asset = deps.db.select().from(mediaAssets).where(eq(mediaAssets.id, logoId)).get();
    if (asset) logo = { bytes: await deps.media.read(asset.filename), mimeType: asset.mimeType };
  }
  return { number, issuedAt: isoNow(deps.clock), organization, theme: resolveActiveTheme(deps), logo };
}

export async function renderDocument(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentRecord>> {
  const denied = requirePermission(ctx, 'documents.create');
  if (denied) return denied;
  const parsed = validate(renderSchema, input);
  if (!parsed.ok) return parsed;
  const template = deps.registry.documentTemplates.get(parsed.value.templateKey) as DocumentTemplate | undefined;
  if (!template) return notFound('documentTemplate', parsed.value.templateKey);
  if (template.permission) {
    const extra = requirePermission(ctx, template.permission);
    if (extra) return extra;
  }
  const data = validate(template.schema, parsed.value.input);
  if (!data.ok) return data;

  // Nummer reservieren: rendern außerhalb der Transaktion (async), Eindeutigkeit über den Unique-Index; bei Kollision erneut versuchen.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const year = deps.clock.now().getUTCFullYear();
    const number = nextDocumentNumber(deps.db, template.prefix, year);
    const context = await buildContext(deps, ctx, number);
    const bytes = await template.render(data.value, context);
    const asset = await storeMediaInternal(deps, ctx, { originalName: `${number}.pdf`, bytes, declaredMimeType: 'application/pdf' });
    if (!asset.ok) return asset;
    try {
      return deps.db.transaction((tx: DbOrTx) => {
        const id = newId();
        tx.insert(documents)
          .values({
            id,
            templateKey: template.key,
            number,
            entityType: parsed.value.entityType ?? null,
            entityId: parsed.value.entityId ?? null,
            inputSnapshot: JSON.stringify(data.value),
            assetId: asset.value.id,
            status: 'issued',
            createdByUserId: ctx.userId as string,
            createdAt: context.issuedAt,
          })
          .run();
        const record = toRecord(tx.select().from(documents).where(eq(documents.id, id)).get()!);
        recordAudit(tx, deps, ctx, { action: 'documents.render', entityType: 'document', entityId: id, after: { number, templateKey: template.key, entityType: record.entityType, entityId: record.entityId }, summary: `Dokument ${number} erzeugt` });
        return ok(record);
      });
    } catch (error) {
      if (!(error instanceof Error && /UNIQUE constraint failed: documents.number/.test(error.message))) throw error;
    }
  }
  return conflict('documentNumberContention', 'Dokumentnummer konnte nicht reserviert werden');
}

const voidSchema = z.object({ id: z.string().min(1), reason: z.string().trim().min(1).max(300) });

export async function voidDocument(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentRecord>> {
  const denied = requirePermission(ctx, 'documents.create');
  if (denied) return denied;
  const parsed = validate(voidSchema, input);
  if (!parsed.ok) return parsed;
  const row = deps.db.select().from(documents).where(eq(documents.id, parsed.value.id)).get();
  if (!row) return notFound('document', parsed.value.id);
  if (row.status === 'voided') return conflict('documentAlreadyVoided', `Dokument ${row.number} ist bereits storniert`);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(documents).set({ status: 'voided', voidedAt: isoNow(deps.clock), voidedByUserId: ctx.userId, voidReason: parsed.value.reason }).where(eq(documents.id, row.id)).run();
    const after = toRecord(tx.select().from(documents).where(eq(documents.id, row.id)).get()!);
    recordAudit(tx, deps, ctx, { action: 'documents.void', entityType: 'document', entityId: row.id, before: { status: 'issued' }, after: { status: 'voided', reason: parsed.value.reason }, summary: `Dokument ${row.number} storniert: ${parsed.value.reason}` });
    return ok(after);
  });
}

const listSchema = z.object({
  templateKey: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export async function listDocuments(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ documents: DocumentRecord[]; total: number }>> {
  const denied = requirePermission(ctx, 'documents.view');
  if (denied) return denied;
  const parsed = validate(listSchema, input);
  if (!parsed.ok) return parsed;
  const q = parsed.value;
  const conditions: SQL[] = [];
  if (q.templateKey) conditions.push(eq(documents.templateKey, q.templateKey));
  if (q.entityType) conditions.push(eq(documents.entityType, q.entityType));
  if (q.entityId) conditions.push(eq(documents.entityId, q.entityId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const total = deps.db.select({ n: count() }).from(documents).where(where).get()?.n ?? 0;
  const rows = deps.db.select().from(documents).where(where).orderBy(desc(documents.createdAt), desc(documents.number)).limit(q.limit).offset(q.offset).all();
  return ok({ documents: rows.map(toRecord), total });
}

export async function getDocument(deps: Deps, ctx: CallContext, id: string): Promise<Result<{ record: DocumentRecord; bytes: Uint8Array; filename: string }>> {
  const denied = requirePermission(ctx, 'documents.view');
  if (denied) return denied;
  const row = deps.db.select().from(documents).where(eq(documents.id, id)).get();
  if (!row) return notFound('document', id);
  const asset = deps.db.select().from(mediaAssets).where(eq(mediaAssets.id, row.assetId)).get();
  if (!asset) return notFound('mediaAsset', row.assetId);
  return ok({ record: toRecord(row), bytes: await deps.media.read(asset.filename), filename: `${row.number}.pdf` });
}
```
In `index.ts`: `export * from './documents/service';`.

- [ ] **Step 5: Tests ausführen**

Run: `pnpm --filter @kompass/core test && pnpm --filter @kompass/core typecheck`
Expected: grün. `nextDocumentNumber(..., 2026)` nach zwei Dokumenten ⇒ `TST-2026-003`; stornierte Dokumente zählen mit (lückenlos).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): document service with gapless numbering, voiding and template registry"
```

---

### Task 3: Typst-Renderer, Basis-Template, Kernvorlagen, Fonts

**Files:**
- Create: `packages/documents/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/typst.ts`, `src/renderer.ts`, `src/templates.ts`, `templates/base.typ`, `templates/letterhead.typ`, `templates/audit-log-export.typ`, `fonts/` (TTF + Lizenzen)
- Test: `packages/documents/tests/renderer.test.ts`, `packages/documents/tests/templates.test.ts`

**Interfaces:**
- Consumes: `DocumentTemplate`, `DocumentRenderContext` aus `@kompass/core`.
- Produces:
  - `findTypstBinary(): string` (Env `TYPST_BINARY` oder `typst` im PATH; wirft mit Installationshinweis), `compileTypst({ binary, rootDir, fontsDir, entry, output })`, `class TypstRenderError`.
  - `interface TypstRenderer { render(templateFile: string, payload: unknown, logo?: { bytes; mimeType } | null): Promise<Uint8Array>; version(): Promise<string> }`; `createTypstRenderer(opts?: { binary?; templatesDir?; fontsDir? })`.
  - `coreDocumentTemplates(renderer): DocumentTemplate[]` — `letterhead` (Prefix `BRF`: `{ title, body, letterhead }`) und `audit-log-export` (Prefix `PRO`, Recht `audit.view`: `{ title, filters, entries[] }`).
  - `buildPayload(data, ctx)` (rein): `{ data, organization, number, issuedDate, brand: { primary, accent, ink, muted, line, fontBody, fontHeading, fontMono }, hasLogo }`; `firstFontFamily('"Source Sans 3", system-ui, sans-serif') → 'Source Sans 3'`.

- [ ] **Step 1: Fonts beschaffen (einmalig, werden committet)**

Run (in `packages/documents`):
```bash
mkdir -p fonts && cd fonts
curl -sSL -o sans.zip https://github.com/adobe-fonts/source-sans/releases/download/3.052R/TTF-source-sans-3.052R.zip
curl -sSL -o serif.zip https://github.com/adobe-fonts/source-serif/releases/download/4.005R/source-serif-4.005_Desktop.zip
curl -sSL -o mono.zip "https://github.com/IBM/plex/releases/download/%40ibm%2Fplex-mono%402.5.0/ibm-plex-mono.zip"
unzip -o -j sans.zip '*/SourceSans3-Regular.ttf' '*/SourceSans3-It.ttf' '*/SourceSans3-Semibold.ttf' '*/SourceSans3-Bold.ttf' '*LICENSE*' -d .
unzip -o -j serif.zip '*/SourceSerif4-Regular.ttf' '*/SourceSerif4-Semibold.ttf' '*LICENSE*' -d .
unzip -o -j mono.zip '*/IBMPlexMono-Regular.ttf' '*/IBMPlexMono-Medium.ttf' '*LICENSE*' -d .
rm sans.zip serif.zip mono.zip && ls
```
Expected: acht `.ttf` plus Lizenzdateien (`LICENSE.md`/`LICENSE.txt` — bei Namenskollision mit `unzip -o -j ... -d sans/` getrennt ablegen und danach als `LICENSE-source-sans.txt` usw. umbenennen). Wenn ein Pfadmuster nicht trifft: `unzip -l datei.zip | grep -i regular` zeigt den tatsächlichen Pfad. Alle drei Familien stehen unter SIL Open Font License 1.1 und dürfen im Repo liegen.

- [ ] **Step 2: Tests schreiben**

`packages/documents/tests/renderer.test.ts`:
```ts
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTypstRenderer, findTypstBinary } from '../src';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe('typst renderer', () => {
  it('finds a typst binary of the pinned minor version', async () => {
    expect(findTypstBinary()).toBeTruthy();
    expect(await createTypstRenderer().version()).toMatch(/^typst 0\.15\./);
  });

  it('renders the letterhead template deterministically', async () => {
    const renderer = createTypstRenderer();
    const payload = {
      data: { title: 'Testbrief', body: 'Erster Absatz.\n\nZweiter Absatz.', letterhead: true },
      organization: { 'organization.name': 'Musterverein e.V.', 'organization.street': 'Musterweg 1', 'organization.postalCode': '12345', 'organization.city': 'Musterstadt', 'organization.registerCourt': 'Amtsgericht Musterstadt', 'organization.registerNumber': 'VR 1234', 'organization.email': 'info@example.org' },
      number: 'BRF-2026-001',
      issuedDate: '05.09.2026',
      brand: { primary: '#2F5D68', accent: '#9C5637', ink: '#191C1F', muted: '#666D75', line: '#E4E4E0', fontBody: 'Source Sans 3', fontHeading: 'Source Serif 4', fontMono: 'IBM Plex Mono' },
      hasLogo: false,
    };
    const a = await renderer.render('letterhead.typ', payload);
    const b = await renderer.render('letterhead.typ', payload);
    expect(new TextDecoder().decode(a.subarray(0, 5))).toBe('%PDF-');
    expect(a.byteLength).toBeGreaterThan(5000);
    expect(sha(a)).toBe(sha(b));
  });

  it('treats user text as literal, not as markup or code', async () => {
    const renderer = createTypstRenderer();
    const hostile = { title: '#panic("x") ]', body: '*nicht fett* #text(red)[rot] $x^2$ // kein Kommentar', letterhead: false };
    const bytes = await renderer.render('letterhead.typ', { data: hostile, organization: {}, number: 'BRF-2026-002', issuedDate: '05.09.2026', brand: { primary: '#000000', accent: '#000000', ink: '#000000', muted: '#666666', line: '#cccccc', fontBody: 'Source Sans 3', fontHeading: 'Source Serif 4', fontMono: 'IBM Plex Mono' }, hasLogo: false });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('fails loudly when a font family is unknown', async () => {
    const renderer = createTypstRenderer();
    await expect(renderer.render('letterhead.typ', { data: { title: 'x', body: 'y', letterhead: false }, organization: {}, number: 'N', issuedDate: 'D', brand: { primary: '#000000', accent: '#000000', ink: '#000000', muted: '#666666', line: '#cccccc', fontBody: 'Comic Sans MS', fontHeading: 'Source Serif 4', fontMono: 'IBM Plex Mono' }, hasLogo: false })).rejects.toThrow(/unknown font family/);
  });
});
```

`packages/documents/tests/templates.test.ts`:
```ts
import type { DocumentRenderContext } from '@kompass/core';
import { DEFAULT_THEME } from '@kompass/core/themes';
import { describe, expect, it } from 'vitest';
import { buildPayload, coreDocumentTemplates, createTypstRenderer, firstFontFamily } from '../src';

const ctx: DocumentRenderContext = {
  number: 'BRF-2026-007',
  issuedAt: '2026-09-05T08:00:00.000Z',
  organization: { 'organization.name': 'Musterverein e.V.' },
  theme: DEFAULT_THEME,
  logo: null,
};

describe('core document templates', () => {
  it('firstFontFamily strips quotes and fallbacks', () => {
    expect(firstFontFamily('"Source Sans 3", system-ui, sans-serif')).toBe('Source Sans 3');
    expect(firstFontFamily('Georgia, serif')).toBe('Georgia');
  });

  it('buildPayload maps theme tokens and formats the issue date in German order', () => {
    const payload = buildPayload({ title: 't' }, ctx);
    expect(payload).toMatchObject({ number: 'BRF-2026-007', issuedDate: '05.09.2026', hasLogo: false, brand: { primary: '#2F5D68', fontBody: 'Source Sans 3', fontHeading: 'Source Serif 4', fontMono: 'IBM Plex Mono' } });
  });

  it('exposes letterhead (BRF) and audit-log-export (PRO) with schemas and renders both', async () => {
    const templates = coreDocumentTemplates(createTypstRenderer());
    expect(templates.map((t) => [t.key, t.prefix, t.permission ?? null])).toEqual([['letterhead', 'BRF', null], ['audit-log-export', 'PRO', 'audit.view']]);
    const letter = templates[0]!;
    expect(letter.schema.safeParse({ title: '', body: 'x' }).success).toBe(false);
    const pdf = await letter.render({ title: 'Einladung', body: 'Sehr geehrte Mitglieder,\n\nhiermit laden wir ein.', letterhead: true }, ctx);
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe('%PDF-');
    const audit = templates[1]!;
    const pdf2 = await audit.render({ title: 'Änderungsprotokoll', filters: { Kanal: 'Alle' }, entries: [{ occurredAt: '2026-09-05T08:00:00.000Z', userName: 'Anna Berger', channel: 'ui', action: 'settings.update', entityType: 'setting', entityId: 'organization.name', summary: 'geändert' }] }, { ...ctx, number: 'PRO-2026-001' });
    expect(pdf2.byteLength).toBeGreaterThan(3000);
  });
});
```

- [ ] **Step 3: Tests ausführen, Fehlschlag prüfen**

Paket anlegen (`packages/documents/package.json`):
```json
{
  "name": "@kompass/documents",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@kompass/core": "workspace:*", "zod": "^4.5.4" },
  "devDependencies": { "@types/node": "^26.4.1", "typescript": "^6.0.3", "vitest": "^5.0.0" }
}
```
`tsconfig.json` und `vitest.config.ts` wie in `packages/core`. Run: `pnpm install && pnpm --filter @kompass/documents test`
Expected: FAIL — `../src` fehlt.

- [ ] **Step 4: Typst-Aufruf und Renderer**

`packages/documents/src/typst.ts`:
```ts
import { spawn, spawnSync } from 'node:child_process';

export class TypstRenderError extends Error {
  constructor(message: string, public readonly stderr: string) {
    super(message);
    this.name = 'TypstRenderError';
  }
}

export function findTypstBinary(): string {
  const candidate = process.env.TYPST_BINARY ?? 'typst';
  const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    throw new Error(`typst binary not found (${candidate}). Install Typst 0.15.x (brew install typst) or set TYPST_BINARY.`);
  }
  return candidate;
}

export function typstVersion(binary: string): string {
  return spawnSync(binary, ['--version'], { encoding: 'utf8' }).stdout.trim();
}

export function compileTypst(opts: { binary: string; rootDir: string; fontsDir: string; entry: string; output: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.binary, ['compile', '--root', opts.rootDir, '--font-path', opts.fontsDir, '--ignore-system-fonts', opts.entry, opts.output], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new TypstRenderError(`typst exited with ${code}`, stderr));
      if (/unknown font family/i.test(stderr)) return reject(new TypstRenderError('typst: unknown font family (fonts must come from the repo)', stderr));
      resolve();
    });
  });
}
```
Hinweis: `--ignore-system-fonts` sorgt dafür, dass nur die Repo-Fonts gelten — dieselbe PDF auf Mac, Linux und im Container. Kennt die installierte Typst-Version das Flag nicht, schlägt Step 6 mit einer klaren CLI-Fehlermeldung fehl; dann Typst auf 0.15.x aktualisieren.

`packages/documents/src/renderer.ts`:
```ts
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileTypst, findTypstBinary, typstVersion } from './typst';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface TypstRenderer {
  render(templateFile: string, payload: unknown, logo?: { bytes: Uint8Array; mimeType: string } | null): Promise<Uint8Array>;
  version(): Promise<string>;
}

const LOGO_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' };

export function createTypstRenderer(opts: { binary?: string; templatesDir?: string; fontsDir?: string } = {}): TypstRenderer {
  const templatesDir = opts.templatesDir ?? path.join(PACKAGE_DIR, 'templates');
  const fontsDir = opts.fontsDir ?? path.join(PACKAGE_DIR, 'fonts');
  let binary: string | null = opts.binary ?? null;
  const bin = () => (binary ??= findTypstBinary());
  return {
    async version() {
      return typstVersion(bin());
    },
    async render(templateFile, payload, logo = null) {
      const job = await mkdtemp(path.join(tmpdir(), 'kompass-typst-'));
      try {
        await cp(templatesDir, path.join(job, 'templates'), { recursive: true });
        let logoFile: string | null = null;
        if (logo && LOGO_EXT[logo.mimeType]) {
          logoFile = `/logo.${LOGO_EXT[logo.mimeType]}`;
          await writeFile(path.join(job, logoFile.slice(1)), logo.bytes);
        }
        await writeFile(path.join(job, 'data.json'), JSON.stringify({ ...(payload as object), logoFile }));
        await compileTypst({ binary: bin(), rootDir: job, fontsDir, entry: path.join(job, 'templates', templateFile), output: path.join(job, 'out.pdf') });
        return new Uint8Array(await readFile(path.join(job, 'out.pdf')));
      } finally {
        await rm(job, { recursive: true, force: true });
      }
    },
  };
}
```

- [ ] **Step 5: Vorlagen**

`packages/documents/templates/base.typ`:
```typst
// Basis-Layout für alle Kompass-Dokumente. Alle Vereinsdaten und Farben kommen aus /data.json.
#let org(p, key) = p.organization.at("organization." + key, default: "")

#let kompass-document(p, letterhead: true, body) = {
  let b = p.brand
  set document(title: p.data.at("title", default: ""), author: org(p, "name"), date: none)
  set text(font: b.fontBody, size: 10.5pt, fill: rgb(b.ink), lang: "de")
  set par(justify: false, leading: 0.65em)
  show heading: set text(font: b.fontHeading, fill: rgb(b.primary), weight: "semibold")
  show heading.where(level: 1): set text(size: 18pt)
  show raw: set text(font: b.fontMono, size: 9.5pt)

  let footer = context [
    #set text(size: 8pt, fill: rgb(b.muted))
    #line(length: 100%, stroke: 0.5pt + rgb(b.line))
    #v(2pt)
    #grid(columns: (1fr, auto),
      [#org(p, "name") · #org(p, "street") · #org(p, "postalCode") #org(p, "city") #if org(p, "registerNumber") != "" [· #org(p, "registerCourt") #org(p, "registerNumber")]],
      [#p.number · Seite #counter(page).display() von #counter(page).final().first()])
  ]

  let head-compact = [
    #set text(size: 8pt, fill: rgb(b.muted))
    #grid(columns: (1fr, auto), [#org(p, "name")], [#p.number])
    #line(length: 100%, stroke: 0.5pt + rgb(b.accent))
  ]

  set page(paper: "a4", margin: (top: 28mm, bottom: 24mm, left: 22mm, right: 20mm), footer: footer,
    header: if letterhead { context { if counter(page).get().first() > 1 { head-compact } } } else { head-compact })

  if letterhead {
    grid(columns: (1fr, auto), align: (left + top, right + top),
      [#text(size: 8pt, fill: rgb(b.muted))[#org(p, "name") · #org(p, "street") · #org(p, "postalCode") #org(p, "city")]],
      [#if p.logoFile != none { image(p.logoFile, height: 16mm) } else { text(font: b.fontHeading, size: 16pt, fill: rgb(b.primary))[#org(p, "name")] }])
    v(14mm)
    grid(columns: (1fr, auto), [], [#text(size: 9.5pt)[#org(p, "city"), #p.issuedDate]])
    v(6mm)
  }
  body
}
```

`packages/documents/templates/letterhead.typ`:
```typst
#import "base.typ": kompass-document
#let p = json("/data.json")
#show: kompass-document.with(p, letterhead: p.data.letterhead)

= #p.data.title

#for para in p.data.body.split("\n\n") {
  par(para)
}
```
Wichtig: `p.data.title` und `para` sind Strings aus JSON; Typst rendert Strings wörtlich — `#panic(...)` im Titel bleibt Text. Die Injektions-Tests in Step 2 sichern das ab.

`packages/documents/templates/audit-log-export.typ`:
```typst
#import "base.typ": kompass-document
#let p = json("/data.json")
#show: kompass-document.with(p, letterhead: false)

= #p.data.title

#text(size: 9pt, fill: rgb(p.brand.muted))[
  Erstellt am #p.issuedDate · Dokument #p.number ·
  #for (k, v) in p.data.filters [#k: #v; ]
]
#v(4mm)

#table(
  columns: (auto, auto, auto, auto, 1fr),
  align: (left, left, left, left, left),
  stroke: (x, y) => if y == 0 { (bottom: 0.8pt + rgb(p.brand.primary)) } else { (bottom: 0.4pt + rgb(p.brand.line)) },
  inset: 5pt,
  table.header([*Zeitpunkt*], [*Nutzer*], [*Kanal*], [*Aktion*], [*Objekt / Zusammenfassung*]),
  ..p.data.entries.map(e => (
    text(font: p.brand.fontMono, size: 8pt)[#e.occurredAt],
    [#e.userName],
    [#e.channel],
    text(font: p.brand.fontMono, size: 8pt)[#e.action],
    [#e.entityType #if e.entityId != none [· #e.entityId] \ #text(size: 8.5pt, fill: rgb(p.brand.muted))[#e.summary]],
  )).flatten()
)
```

- [ ] **Step 6: Vorlagen-Registrierung und Exporte**

`packages/documents/src/templates.ts`:
```ts
import type { DocumentRenderContext, DocumentTemplate } from '@kompass/core';
import { z } from 'zod';
import type { TypstRenderer } from './renderer';

export function firstFontFamily(stack: string): string {
  const first = stack.split(',')[0] ?? '';
  return first.trim().replace(/^["']|["']$/g, '');
}

export function formatGermanDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

export function buildPayload(data: unknown, ctx: DocumentRenderContext) {
  const t = ctx.theme.tokens;
  return {
    data,
    organization: ctx.organization,
    number: ctx.number,
    issuedDate: formatGermanDate(ctx.issuedAt),
    brand: {
      primary: t['color-primary'].light,
      accent: t['color-accent'].light,
      ink: t.ink.light,
      muted: t.muted.light,
      line: t.line.light,
      fontBody: firstFontFamily(t['font-body'].light),
      fontHeading: firstFontFamily(t['font-heading'].light),
      fontMono: firstFontFamily(t['font-mono'].light),
    },
    hasLogo: ctx.logo !== null,
  };
}

const letterheadSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().max(5000).default(''),
  letterhead: z.boolean().default(true),
});

const auditExportSchema = z.object({
  title: z.string().trim().min(1).max(120),
  filters: z.record(z.string(), z.string()).default({}),
  entries: z.array(z.object({
    occurredAt: z.string(),
    userName: z.string().nullable(),
    channel: z.string(),
    action: z.string(),
    entityType: z.string(),
    entityId: z.string().nullable(),
    summary: z.string(),
  })).max(2000),
});

export function coreDocumentTemplates(renderer: TypstRenderer): DocumentTemplate[] {
  const letterhead: DocumentTemplate<z.infer<typeof letterheadSchema>> = {
    key: 'letterhead',
    prefix: 'BRF',
    schema: letterheadSchema,
    render: (data, ctx) => renderer.render('letterhead.typ', buildPayload(data, ctx), ctx.logo),
  };
  const auditExport: DocumentTemplate<z.infer<typeof auditExportSchema>> = {
    key: 'audit-log-export',
    prefix: 'PRO',
    schema: auditExportSchema,
    permission: 'audit.view',
    render: (data, ctx) => renderer.render('audit-log-export.typ', buildPayload({ ...data, entries: data.entries.map((e) => ({ ...e, userName: e.userName ?? '—', entityId: e.entityId ?? null })) }, ctx), ctx.logo),
  };
  return [letterhead as DocumentTemplate, auditExport as DocumentTemplate];
}
```

`packages/documents/src/index.ts`:
```ts
export * from './typst';
export * from './renderer';
export * from './templates';
```

Zu `ctx.theme.tokens` im Client-freien Kern-Typ: `DEFAULT_THEME` im Test kommt aus `@kompass/core/themes` (Subpfad aus Plan 2, Task 10).

- [ ] **Step 7: Tests ausführen**

Run: `pnpm --filter @kompass/documents test && pnpm --filter @kompass/documents typecheck`
Expected: grün. Bricht der Determinismus-Test (verschiedene Hashes), zuerst prüfen, ob `set document(date: none)` greift (`strings out.pdf | grep CreationDate` muss leer sein) und ob `--ignore-system-fonts` gesetzt ist.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(documents): typst renderer with deterministic base layout, letterhead and audit export templates"
```

---

### Task 4: Backup-Export und -Import im Kern

**Files:**
- Modify: `packages/core/src/app.ts` (`databasePath`, `backupDatabase`, `reopen`, `migrationCount`), `packages/core/package.json` (`tar`), `packages/core/src/index.ts`
- Create: `packages/core/src/backup/manifest.ts`, `packages/core/src/backup/export.ts`, `packages/core/src/backup/import.ts`
- Test: `packages/core/tests/backup.test.ts`

**Interfaces:**
- Produces:
  - `createDeps(...)` liefert `AppDeps = Deps & { databasePath: string; migrationCount: number; backupDatabase(dest: string): Promise<void>; reopen(): void; close(): void }` (`reopen` schließt, öffnet neu, migriert, aktualisiert `deps.db` und `deps.migrationCount` **in place**).
  - `BACKUP_FORMAT = 1`; `interface BackupManifest { format: 1; appVersion: string; createdAt: string; environment: AppEnv; migrationCount: number; counts: { users; auditEntries; documents; mediaAssets } }`.
  - `exportBackup(deps: AppDeps, ctx, { workDir }) → Promise<Result<{ archivePath; bytes; manifest }>>` — `backup.export`; Archiv `kompass-backup-<env>-<YYYYMMDD-HHMMSS>.tar.gz` mit `manifest.json`, `kompass.db` (ohne `sessions`/`api_tokens`), `media/`.
  - `inspectBackup({ archivePath, workDir }) → Promise<Result<BackupManifest>>`.
  - `importBackup(deps: AppDeps, ctx, { archivePath, workDir, confirmation, environmentName }) → Promise<Result<{ manifest }>>` — `backup.import`; Codes (validation) `confirmationMismatch`, `backupFormatUnsupported`, `backupNewerThanApp`, `backupCorrupt`.

- [ ] **Step 1: Test schreiben**

`packages/core/tests/backup.test.ts`:
```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as tar from 'tar';
import { afterEach, describe, expect, it } from 'vitest';
import { createDeps } from '../src/app';
import { login } from '../src/auth/login';
import { exportBackup, importBackup, inspectBackup } from '../src/backup';
import { auditLog, users } from '../src/db/schema';
import { unwrap } from '../src/result';
import { seedDevelopment } from '../src/seed/seed';
import { readSetting } from '../src/settings/service';
import { ctxWith } from '../src/testing';
import { isSetupRequired } from '../src/setup/service';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), 'kompass-backup-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function fileDeps(dir: string, env: 'test' | 'production' = 'test') {
  return createDeps({ databasePath: path.join(dir, 'kompass.db'), mediaPath: path.join(dir, 'media'), env });
}

describe('backup', () => {
  it('exports a tar.gz with manifest, db copy without sessions/tokens, and media; records lastExportAt', async () => {
    const dir = tmp();
    const deps = fileDeps(dir);
    const seed = await seedDevelopment(deps);
    unwrap(await login(deps, { email: seed.adminEmail, password: seed.adminPassword, ipAddress: null, requestId: 'R' }));
    const admin = deps.db.select().from(users).all()[0]!;
    const result = unwrap(await exportBackup(deps, ctxWith(['backup.export'], admin.id), { workDir: tmp() }));
    expect(result.archivePath).toMatch(/kompass-backup-test-\d{8}-\d{6}\.tar\.gz$/);
    expect(result.manifest).toMatchObject({ format: 1, environment: 'test', counts: { users: 4 } });
    const out = tmp();
    await tar.extract({ file: result.archivePath, cwd: out });
    const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    expect(manifest.migrationCount).toBe(deps.migrationCount);
    const copy = new Database(path.join(out, 'kompass.db'), { readonly: true });
    expect((copy.prepare('select count(*) as n from sessions').get() as { n: number }).n).toBe(0);
    expect((copy.prepare('select count(*) as n from api_tokens').get() as { n: number }).n).toBe(0);
    expect((copy.prepare('select count(*) as n from users').get() as { n: number }).n).toBe(4);
    copy.close();
    expect(typeof readSetting(deps, 'system.lastExportAt')).toBe('string');
    expect(deps.db.select().from(auditLog).all().some((e) => e.action === 'backup.export')).toBe(true);
    deps.close();
  });

  it('imports into another installation, invalidates sessions and logs a system entry', async () => {
    const source = fileDeps(tmp());
    const seed = await seedDevelopment(source);
    const admin = source.db.select().from(users).all()[0]!;
    const exported = unwrap(await exportBackup(source, ctxWith(['backup.export'], admin.id), { workDir: tmp() }));
    source.close();

    const target = fileDeps(tmp());
    expect(isSetupRequired(target)).toBe(true);
    const inspected = unwrap(await inspectBackup({ archivePath: exported.archivePath, workDir: tmp() }));
    expect(inspected.counts.users).toBe(4);
    const importer = ctxWith(['backup.import'], null);
    const wrong = await importBackup(target, importer, { archivePath: exported.archivePath, workDir: tmp(), confirmation: 'produktion', environmentName: 'test' });
    expect(wrong.ok === false && wrong.error.type === 'validation' && wrong.error.issues[0]?.message === 'confirmationMismatch').toBe(true);
    const done = unwrap(await importBackup(target, importer, { archivePath: exported.archivePath, workDir: tmp(), confirmation: 'test', environmentName: 'test' }));
    expect(done.manifest.counts.users).toBe(4);
    expect(isSetupRequired(target)).toBe(false);
    expect((await login(target, { email: seed.adminEmail, password: seed.adminPassword, ipAddress: null, requestId: 'R' })).ok).toBe(true);
    expect(readSetting(target, 'system.lastImportAt')).not.toBeNull();
    const last = target.db.select().from(auditLog).all().at(-1)!;
    expect(last).toMatchObject({ action: 'backup.import', channel: 'system', userId: null });
    target.close();
  });

  it('rejects archives with an unsupported format and requires backup.import', async () => {
    const dir = tmp();
    const deps = fileDeps(dir);
    const bad = path.join(dir, 'bad.tar.gz');
    const work = tmp();
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(path.join(work, 'src'), { recursive: true });
    writeFileSync(path.join(work, 'src', 'manifest.json'), JSON.stringify({ format: 99 }));
    await tar.create({ gzip: true, cwd: path.join(work, 'src'), file: bad }, ['manifest.json']);
    const result = await importBackup(deps, ctxWith(['backup.import']), { archivePath: bad, workDir: tmp(), confirmation: 'test', environmentName: 'test' });
    expect(result.ok === false && result.error.type === 'validation' && result.error.issues[0]?.message === 'backupFormatUnsupported').toBe(true);
    expect((await exportBackup(deps, ctxWith([]), { workDir: tmp() })).ok).toBe(false);
    deps.close();
  });
});
```
- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core add tar@^7.5.22 && pnpm --filter @kompass/core test tests/backup.test.ts`
Expected: FAIL — `../src/backup` fehlt, `backupDatabase` unbekannt.

- [ ] **Step 3: createDeps erweitern**

`packages/core/src/app.ts` (Rückgabe von `createDeps`):
```ts
export type AppDeps = Deps & {
  databasePath: string;
  migrationCount: number;
  backupDatabase(destination: string): Promise<void>;
  reopen(): void;
  close(): void;
};

export function createDeps(opts: CreateDepsOptions): AppDeps {
  let handle = openDatabase(opts.databasePath);
  const countMigrations = () => (handle.sqlite.prepare('select count(*) as n from __drizzle_migrations').get() as { n: number }).n;
  runMigrations(handle.db);
  const deps: AppDeps = {
    db: handle.db,
    clock: opts.clock ?? systemClock,
    env: opts.env,
    registry: createRegistry([coreModule, ...(opts.modules ?? [])], { coreTemplates: opts.coreTemplates }),
    media: createFileMediaStore(opts.mediaPath),
    databasePath: opts.databasePath,
    migrationCount: countMigrations(),
    backupDatabase: (destination) => handle.sqlite.backup(destination).then(() => undefined),
    reopen() {
      handle.sqlite.close();
      handle = openDatabase(opts.databasePath);
      runMigrations(handle.db);
      deps.db = handle.db;
      deps.migrationCount = countMigrations();
    },
    close: () => handle.sqlite.close(),
  };
  return deps;
}
```
`app.test.ts` ergänzen: `reopen()` nach dem Löschen der DB-Datei liefert `isSetupRequired === true`; `backupDatabase(dest)` erzeugt eine Datei mit `users`-Tabelle.

- [ ] **Step 4: Manifest, Export, Import**

`packages/core/src/backup/manifest.ts`:
```ts
import { z } from 'zod';

export const BACKUP_FORMAT = 1 as const;

export const backupManifestSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  appVersion: z.string(),
  createdAt: z.string(),
  environment: z.enum(['development', 'test', 'production']),
  migrationCount: z.number().int().min(0),
  counts: z.object({ users: z.number().int(), auditEntries: z.number().int(), documents: z.number().int(), mediaAssets: z.number().int() }),
});

export type BackupManifest = z.infer<typeof backupManifestSchema>;
```

`packages/core/src/backup/export.ts`:
```ts
import { count } from 'drizzle-orm';
import { cp, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as tar from 'tar';
import type { AppDeps } from '../app';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import { systemContext, type CallContext } from '../context';
import { auditLog, documents, mediaAssets, users } from '../db/schema';
import { requirePermission } from '../permissions/check';
import { ok, type Result } from '../result';
import { writeSettingInternal } from '../settings/service';
import { BACKUP_FORMAT, type BackupManifest } from './manifest';

export const APP_VERSION = '0.1.0';

function stamp(iso: string): string {
  return iso.replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

export async function exportBackup(deps: AppDeps, ctx: CallContext, opts: { workDir: string }): Promise<Result<{ archivePath: string; bytes: number; manifest: BackupManifest }>> {
  const denied = requirePermission(ctx, 'backup.export');
  if (denied) return denied;
  const now = isoNow(deps.clock);
  const staging = await mkdtemp(path.join(opts.workDir, 'kompass-export-'));
  try {
    const dbCopy = path.join(staging, 'kompass.db');
    await deps.backupDatabase(dbCopy);
    const copy = new Database(dbCopy);
    copy.exec('delete from sessions; delete from api_tokens; vacuum;');
    copy.close();
    await mkdir(path.join(staging, 'media'), { recursive: true });
    if (deps.media.rootDir && (await stat(deps.media.rootDir).catch(() => null))) {
      await cp(deps.media.rootDir, path.join(staging, 'media'), { recursive: true });
    }
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      appVersion: APP_VERSION,
      createdAt: now,
      environment: deps.env,
      migrationCount: deps.migrationCount,
      counts: {
        users: deps.db.select({ n: count() }).from(users).get()?.n ?? 0,
        auditEntries: deps.db.select({ n: count() }).from(auditLog).get()?.n ?? 0,
        documents: deps.db.select({ n: count() }).from(documents).get()?.n ?? 0,
        mediaAssets: deps.db.select({ n: count() }).from(mediaAssets).get()?.n ?? 0,
      },
    };
    await writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2));
    const archivePath = path.join(opts.workDir, `kompass-backup-${deps.env}-${stamp(now)}.tar.gz`);
    await tar.create({ gzip: true, cwd: staging, file: archivePath, portable: true }, ['manifest.json', 'kompass.db', 'media']);
    const bytes = (await stat(archivePath)).size;
    deps.db.transaction((tx) => {
      writeSettingInternal(tx, deps, systemContext(ctx.requestId), 'system.lastExportAt', now, 'backup.export.mark');
      recordAudit(tx, deps, ctx, { action: 'backup.export', entityType: 'backup', entityId: path.basename(archivePath), after: manifest, summary: `Backup exportiert (${Math.round(bytes / 1024)} KB)` });
    });
    return ok({ archivePath, bytes, manifest });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
```
`portable: true` lässt Besitzer/Zeiten weg, damit Archive reproduzierbarer werden.

`packages/core/src/backup/import.ts`:
```ts
import { cp, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as tar from 'tar';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import { systemContext, type CallContext } from '../context';
import { requirePermission } from '../permissions/check';
import { invalid, ok, type Result } from '../result';
import { writeSettingInternal } from '../settings/service';
import { loadUserSummary } from '../users/service';
import { validate } from '../validate';
import { backupManifestSchema, type BackupManifest } from './manifest';

async function extract(archivePath: string, workDir: string): Promise<string> {
  const dir = await mkdtemp(path.join(workDir, 'kompass-import-'));
  await tar.extract({ file: archivePath, cwd: dir });
  return dir;
}

async function readManifest(dir: string): Promise<Result<BackupManifest>> {
  const raw = await readFile(path.join(dir, 'manifest.json'), 'utf8').catch(() => null);
  if (raw === null) return invalid([{ path: 'archive', message: 'backupFormatUnsupported' }]);
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return invalid([{ path: 'archive', message: 'backupFormatUnsupported' }]); }
  const parsed = validate(backupManifestSchema, json);
  return parsed.ok ? parsed : invalid([{ path: 'archive', message: 'backupFormatUnsupported' }]);
}

export async function inspectBackup(opts: { archivePath: string; workDir: string }): Promise<Result<BackupManifest>> {
  const dir = await extract(opts.archivePath, opts.workDir);
  try { return await readManifest(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

const importSchema = z.object({ archivePath: z.string().min(1), workDir: z.string().min(1), confirmation: z.string(), environmentName: z.string().min(1) });

export async function importBackup(deps: AppDeps, ctx: CallContext, input: unknown): Promise<Result<{ manifest: BackupManifest }>> {
  const denied = requirePermission(ctx, 'backup.import');
  if (denied) return denied;
  const parsed = validate(importSchema, input);
  if (!parsed.ok) return parsed;
  const { archivePath, workDir, confirmation, environmentName } = parsed.value;
  if (confirmation !== environmentName) return invalid([{ path: 'confirmation', message: 'confirmationMismatch' }]);
  const dir = await extract(archivePath, workDir);
  try {
    const manifest = await readManifest(dir);
    if (!manifest.ok) return manifest;
    if (manifest.value.migrationCount > deps.migrationCount) return invalid([{ path: 'archive', message: 'backupNewerThanApp' }]);
    const dbFile = path.join(dir, 'kompass.db');
    if (!(await stat(dbFile).catch(() => null))) return invalid([{ path: 'archive', message: 'backupCorrupt' }]);
    const probe = new Database(dbFile, { readonly: true });
    const integrity = (probe.prepare('pragma integrity_check').get() as { integrity_check: string }).integrity_check;
    probe.close();
    if (integrity !== 'ok') return invalid([{ path: 'archive', message: 'backupCorrupt' }]);

    const importer = ctx.userId ? loadUserSummary(deps.db, ctx.userId) : null;
    const stampSuffix = `.before-import-${isoNow(deps.clock).replace(/[-:.]/g, '')}`;
    deps.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${deps.databasePath}${suffix}`;
      if (await stat(file).catch(() => null)) await rename(file, `${file}${stampSuffix}`);
    }
    await cp(dbFile, deps.databasePath);
    if (deps.media.rootDir) {
      if (await stat(deps.media.rootDir).catch(() => null)) await rename(deps.media.rootDir, `${deps.media.rootDir}${stampSuffix}`);
      await cp(path.join(dir, 'media'), deps.media.rootDir, { recursive: true });
    }
    deps.reopen();

    const now = isoNow(deps.clock);
    deps.db.transaction((tx) => {
      const sys = { ...systemContext(ctx.requestId), ipAddress: ctx.ipAddress };
      writeSettingInternal(tx, deps, sys, 'system.lastImportAt', now, 'backup.import.mark');
      writeSettingInternal(tx, deps, sys, 'system.lastImportSource', `${manifest.value.environment} ${manifest.value.createdAt}`, 'backup.import.mark');
      recordAudit(tx, deps, sys, { action: 'backup.import', entityType: 'backup', entityId: path.basename(archivePath), after: manifest.value, summary: `Bestand aus Backup (${manifest.value.environment}, ${manifest.value.createdAt}) importiert durch ${importer?.email ?? 'unbekannt'}` });
    });
    return ok({ manifest: manifest.value });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
```
`packages/core/src/backup/index.ts`: `export * from './manifest'; export * from './export'; export * from './import';` und in `src/index.ts` `export * from './backup';`.

Hinweis: Nach `deps.close()` darf bis `deps.reopen()` kein anderer Request auf die DB zugreifen. Die App (Task 8) serialisiert das über die Import-Action, die während des Vorgangs läuft; bei drei LAN-Nutzern und einem ausdrücklich bestätigten Import ist das ausreichend. Die alten Dateien bleiben mit `.before-import-…`-Suffix liegen (manuell löschbar, siehe `docs/betrieb.md`).

- [ ] **Step 5: Tests ausführen**

Run: `pnpm --filter @kompass/core test && pnpm --filter @kompass/core typecheck`
Expected: grün.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): backup export/import with manifest, integrity check and system audit entry"
```

---

### Task 5: MCP-Server-Paket

**Files:**
- Create: `packages/mcp/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/result.ts`, `src/core-tools.ts`, `src/handler.ts`
- Test: `packages/mcp/tests/handler.test.ts`

**Interfaces:**
- Consumes: `McpToolDefinition` (Task 2), `resolveApiToken`, `enabledManifests`, alle Kern-Services.
- Produces:
  - `toCallToolResult(result: Result<unknown>): CallToolResult` — ok ⇒ `content[0].text = JSON.stringify(value)` und `structuredContent`; Fehler ⇒ `isError: true`, `content[0].text = JSON.stringify({ error })`.
  - `coreMcpTools: McpToolDefinition[]` — Namen mit Unterstrich (MCP erlaubt in Tool-Namen keine Punkte): `settings_list`, `settings_get`, `settings_set`, `roles_list`, `roles_create`, `roles_update`, `roles_set_permissions`, `roles_assign`, `roles_remove`, `users_list`, `users_create`, `users_set_active`, `users_reset_start_password`, `audit_query`, `documents_list`, `documents_render`, `documents_void`, `modules_list`, `modules_set_enabled`, `themes_list`.
  - `createKompassMcpHandler(deps, { extraTools?, version? }) → { fetch(request: Request): Promise<Response>; close(): Promise<void> }` — Bearer-Token → `resolveApiToken` → `authInfo.extra.ctx`; ohne gültiges Token `401` mit `WWW-Authenticate: Bearer`.

- [ ] **Step 1: Test schreiben**

`packages/mcp/tests/handler.test.ts`:
```ts
import { createApiToken, createRole, schema, setRolePermissions, assignRole, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import { coreMcpTools, createKompassMcpHandler, toCallToolResult } from '../src';

async function connect(fetchImpl: (url: string | URL, init?: RequestInit) => Promise<Response>, token: string | null) {
  const client = new Client({ name: 'kompass-test', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('http://kompass.test/mcp'), {
    fetch: fetchImpl,
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  await client.connect(transport);
  return client;
}

async function tokenFor(deps: ReturnType<typeof createTestDeps>, permissions: string[]) {
  const userId = insertUser(deps, {});
  const admin = ctxWith(['roles.manage', 'users.manage'], userId);
  const role = unwrap(await createRole(deps, admin, { name: `R-${permissions.join('-') || 'none'}` }));
  unwrap(await setRolePermissions(deps, admin, { roleId: role.id, permissionKeys: permissions }));
  unwrap(await assignRole(deps, admin, { userId, roleId: role.id }));
  const { token } = unwrap(await createApiToken(deps, ctxWith([], userId), { name: 'test' }));
  return { token, userId };
}

describe('toCallToolResult', () => {
  it('serialises ok values and marks errors', () => {
    expect(toCallToolResult({ ok: true, value: { a: 1 } })).toEqual({ content: [{ type: 'text', text: '{"a":1}' }], structuredContent: { a: 1 } });
    const err = toCallToolResult({ ok: false, error: { type: 'forbidden', permission: 'x.y' } });
    expect(err.isError).toBe(true);
    expect(JSON.parse((err.content[0] as { text: string }).text)).toEqual({ error: { type: 'forbidden', permission: 'x.y' } });
  });
});

describe('kompass mcp handler', () => {
  it('lists core tools and executes a read with the token owner permissions', async () => {
    const deps = createTestDeps();
    const handler = createKompassMcpHandler(deps, { extraTools: coreMcpTools });
    const { token } = await tokenFor(deps, ['settings.manage']);
    const client = await connect((url, init) => handler.fetch(new Request(url, init)), token);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['settings_get', 'settings_set', 'roles_list', 'users_create', 'audit_query', 'documents_render', 'modules_set_enabled']));
    const result = await client.callTool({ name: 'settings_get', arguments: { key: 'organization.name' } });
    expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toEqual({ key: 'organization.name', value: 'Neuer Verein' });
    await client.close();
  });

  it('writes through the service layer with channel mcp and token id in the audit log', async () => {
    const deps = createTestDeps();
    const handler = createKompassMcpHandler(deps, { extraTools: coreMcpTools });
    const { token, userId } = await tokenFor(deps, ['settings.manage']);
    const client = await connect((url, init) => handler.fetch(new Request(url, init)), token);
    const result = await client.callTool({ name: 'settings_set', arguments: { key: 'organization.city', value: 'Jülich' } });
    expect(result.isError).toBeFalsy();
    const entry = deps.db.select().from(schema.auditLog).all().at(-1)!;
    expect(entry).toMatchObject({ action: 'settings.update', channel: 'mcp', userId });
    expect(entry.apiTokenId).toBeTruthy();
    await client.close();
  });

  it('returns a structured forbidden error instead of bypassing permissions', async () => {
    const deps = createTestDeps();
    const handler = createKompassMcpHandler(deps, { extraTools: coreMcpTools });
    const { token } = await tokenFor(deps, ['audit.view']);
    const client = await connect((url, init) => handler.fetch(new Request(url, init)), token);
    const result = await client.callTool({ name: 'settings_set', arguments: { key: 'organization.city', value: 'X' } });
    expect(result.isError).toBe(true);
    expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toEqual({ error: { type: 'forbidden', permission: 'settings.manage' } });
    await client.close();
  });

  it('rejects missing or revoked tokens with 401', async () => {
    const deps = createTestDeps();
    const handler = createKompassMcpHandler(deps, { extraTools: coreMcpTools });
    const response = await handler.fetch(new Request('http://kompass.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) }));
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
    await expect(connect((url, init) => handler.fetch(new Request(url, init)), 'akx_test_invalid')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

`packages/mcp/package.json`:
```json
{
  "name": "@kompass/mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@kompass/core": "workspace:*", "@modelcontextprotocol/server": "^2.0.0", "zod": "^4.5.4" },
  "devDependencies": { "@modelcontextprotocol/client": "^2.0.0", "@types/node": "^26.4.1", "typescript": "^6.0.3", "vitest": "^5.0.0" }
}
```
`tsconfig.json`/`vitest.config.ts` wie in `packages/core`. Run: `pnpm install && pnpm --filter @kompass/mcp test`
Expected: FAIL — `../src` fehlt.

- [ ] **Step 3: Ergebnis-Abbildung und Kern-Tools**

`packages/mcp/src/result.ts`:
```ts
import type { Result } from '@kompass/core';
import type { CallToolResult } from '@modelcontextprotocol/server';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function toCallToolResult(result: Result<unknown>): CallToolResult {
  if (!result.ok) return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: result.error }) }] };
  const value = result.value === undefined ? null : result.value;
  return { content: [{ type: 'text', text: JSON.stringify(value) }], ...(isRecord(value) ? { structuredContent: value } : {}) };
}
```

`packages/mcp/src/core-tools.ts`:
```ts
import {
  activateTheme, assignRole, createRole, createUser, getAuditEntry, listDocuments, listModules, listRoles, listThemes, listUsers,
  queryAudit, readAllSettings, readSetting, removeRole, renderDocument, resetStartPassword, setModuleEnabled, setRolePermissions,
  setSetting, setUserActive, updateRole, voidDocument, ok, invalid,
  type McpToolDefinition,
} from '@kompass/core';
import { z } from 'zod';

const t = <T>(def: McpToolDefinition<T>): McpToolDefinition => def as McpToolDefinition;

export const coreMcpTools: McpToolDefinition[] = [
  t({ name: 'settings_list', description: 'Read all registered settings with their current values.', inputSchema: z.object({}), handler: async (deps) => ok(readAllSettings(deps)) }),
  t({ name: 'settings_get', description: 'Read one setting by key, e.g. organization.name.', inputSchema: z.object({ key: z.string() }), handler: async (deps, _ctx, { key }) => (deps.registry.settingDefinitions.has(key) ? ok({ key, value: readSetting(deps, key) }) : invalid([{ path: 'key', message: 'unknownSetting' }])) }),
  t({ name: 'settings_set', description: 'Update one setting. Requires settings.manage. Audited.', inputSchema: z.object({ key: z.string(), value: z.unknown() }), handler: (deps, ctx, args) => setSetting(deps, ctx, args) }),
  t({ name: 'roles_list', description: 'List roles with permission keys and user counts.', inputSchema: z.object({}), handler: (deps, ctx) => listRoles(deps, ctx) }),
  t({ name: 'roles_create', description: 'Create a role. Requires roles.manage.', inputSchema: z.object({ name: z.string(), description: z.string().optional() }), handler: (deps, ctx, args) => createRole(deps, ctx, args) }),
  t({ name: 'roles_update', description: 'Rename or describe a role. Requires roles.manage.', inputSchema: z.object({ id: z.string(), name: z.string().optional(), description: z.string().optional() }), handler: (deps, ctx, args) => updateRole(deps, ctx, args) }),
  t({ name: 'roles_set_permissions', description: 'Replace the permission set of a role. Requires roles.manage.', inputSchema: z.object({ roleId: z.string(), permissionKeys: z.array(z.string()) }), handler: (deps, ctx, args) => setRolePermissions(deps, ctx, args) }),
  t({ name: 'roles_assign', description: 'Assign a role to a user. Requires users.manage.', inputSchema: z.object({ userId: z.string(), roleId: z.string() }), handler: (deps, ctx, args) => assignRole(deps, ctx, args) }),
  t({ name: 'roles_remove', description: 'Remove a role from a user. Requires users.manage.', inputSchema: z.object({ userId: z.string(), roleId: z.string() }), handler: (deps, ctx, args) => removeRole(deps, ctx, args) }),
  t({ name: 'users_list', description: 'List users with roles and status. Requires users.manage.', inputSchema: z.object({}), handler: (deps, ctx) => listUsers(deps, ctx) }),
  t({ name: 'users_create', description: 'Create a user; returns the one-time start password. Requires users.manage.', inputSchema: z.object({ name: z.string(), email: z.string(), roleIds: z.array(z.string()).default([]) }), handler: (deps, ctx, args) => createUser(deps, ctx, args) }),
  t({ name: 'users_set_active', description: 'Activate or deactivate a user. Requires users.manage.', inputSchema: z.object({ id: z.string(), isActive: z.boolean() }), handler: (deps, ctx, args) => setUserActive(deps, ctx, args) }),
  t({ name: 'users_reset_start_password', description: 'Issue a new one-time start password. Requires users.manage.', inputSchema: z.object({ id: z.string() }), handler: (deps, ctx, args) => resetStartPassword(deps, ctx, args) }),
  t({ name: 'audit_query', description: 'Query the immutable audit log. Requires audit.view.', inputSchema: z.object({ userId: z.string().optional(), channel: z.enum(['ui', 'mcp', 'system']).optional(), action: z.string().optional(), entityType: z.string().optional(), entityId: z.string().optional(), from: z.string().optional(), to: z.string().optional(), text: z.string().optional(), limit: z.number().int().optional(), offset: z.number().int().optional() }), handler: async (deps, ctx, args) => queryAudit(deps, ctx, args) }),
  t({ name: 'audit_get', description: 'Read one audit entry. Requires audit.view.', inputSchema: z.object({ id: z.string() }), handler: async (deps, ctx, { id }) => getAuditEntry(deps, ctx, id) }),
  t({ name: 'documents_list', description: 'List generated documents. Requires documents.view.', inputSchema: z.object({ templateKey: z.string().optional(), entityType: z.string().optional(), entityId: z.string().optional(), limit: z.number().int().optional(), offset: z.number().int().optional() }), handler: (deps, ctx, args) => listDocuments(deps, ctx, args) }),
  t({ name: 'documents_render', description: 'Render a PDF from a registered template; returns the document record (download via the app). Requires documents.create.', inputSchema: z.object({ templateKey: z.string(), input: z.unknown(), entityType: z.string().optional(), entityId: z.string().optional() }), handler: (deps, ctx, args) => renderDocument(deps, ctx, args) }),
  t({ name: 'documents_void', description: 'Void a document with a reason; the PDF and number remain. Requires documents.create.', inputSchema: z.object({ id: z.string(), reason: z.string() }), handler: (deps, ctx, args) => voidDocument(deps, ctx, args) }),
  t({ name: 'modules_list', description: 'List installed modules and whether they are enabled.', inputSchema: z.object({}), handler: async (deps) => ok(listModules(deps)) }),
  t({ name: 'modules_set_enabled', description: 'Enable or disable a module. Requires modules.manage.', inputSchema: z.object({ key: z.string(), enabled: z.boolean() }), handler: (deps, ctx, args) => setModuleEnabled(deps, ctx, args) }),
  t({ name: 'themes_list', description: 'List themes and the active theme key.', inputSchema: z.object({}), handler: async (deps) => ok(listThemes(deps)) }),
  t({ name: 'themes_activate', description: 'Activate a theme. Requires settings.manage.', inputSchema: z.object({ key: z.string() }), handler: (deps, ctx, args) => activateTheme(deps, ctx, args) }),
];
```
- [ ] **Step 4: Handler**

`packages/mcp/src/handler.ts`:
```ts
import { enabledManifests, newId, resolveApiToken, type CallContext, type Deps, type McpToolDefinition } from '@kompass/core';
import { createMcpHandler, McpServer, type AuthInfo } from '@modelcontextprotocol/server';
import { toCallToolResult } from './result';

export interface KompassMcpHandler {
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
}

function requestMeta(request: Request): { ipAddress: string | null; requestId: string } {
  const forwarded = request.headers.get('x-forwarded-for');
  return {
    ipAddress: forwarded ? (forwarded.split(',')[0]?.trim() ?? null) : (request.headers.get('x-real-ip') ?? null),
    requestId: request.headers.get('x-request-id') ?? newId(),
  };
}

function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized: valid API token required' }, id: null }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="kompass-mcp"' },
  });
}

function buildServer(deps: Deps, ctx: CallContext, tools: McpToolDefinition[], version: string): McpServer {
  const server = new McpServer({ name: 'aluna-kompass', version });
  for (const tool of tools) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, async (args: unknown) => toCallToolResult(await tool.handler(deps, ctx, args)));
  }
  return server;
}

export function createKompassMcpHandler(deps: Deps, opts: { extraTools?: McpToolDefinition[]; version?: string } = {}): KompassMcpHandler {
  const version = opts.version ?? '0.1.0';
  const handler = createMcpHandler(
    (mcpCtx) => {
      const ctx = (mcpCtx.authInfo?.extra as { ctx?: CallContext } | undefined)?.ctx;
      if (!ctx) throw new Error('mcp request without authenticated context');
      const tools = [...(opts.extraTools ?? []), ...enabledManifests(deps).flatMap((m) => [...(m.mcpTools ?? [])])];
      return buildServer(deps, ctx, tools, version);
    },
    { legacy: 'stateless', onerror: (error) => console.error('[mcp]', error) },
  );
  return {
    async fetch(request) {
      const header = request.headers.get('authorization') ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      const ctx = token ? resolveApiToken(deps, token, requestMeta(request)) : null;
      if (!ctx || !ctx.userId) return unauthorizedResponse();
      const authInfo: AuthInfo = { token: `${token.slice(0, 12)}…`, clientId: ctx.userId, scopes: [...ctx.permissions], extra: { ctx } };
      return handler.fetch(request, { authInfo });
    },
    close: () => handler.close(),
  };
}
```
Hinweis: Das Klartext-Token wird nicht in `authInfo.token` gehalten (nur Präfix) — es wird nirgends benötigt und taucht so in keinem Log auf.

`packages/mcp/src/index.ts`:
```ts
export * from './result';
export * from './core-tools';
export * from './handler';
```

- [ ] **Step 5: Tests ausführen**

Run: `pnpm --filter @kompass/mcp test && pnpm --filter @kompass/mcp typecheck`
Expected: grün. Wenn `registerTool` den Zod-Typ ablehnt (`StandardSchemaWithJSON`), `inputSchema: tool.inputSchema as never` casten — Zod 4 erfüllt Standard Schema und Standard JSON Schema zur Laufzeit.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(mcp): token-authenticated MCP handler exposing core services as tools"
```

---

### Task 6: Verdrahtung in der App — Deps, MCP-Route, Medien- und PDF-Auslieferung, Health

**Files:**
- Modify: `apps/kompass/package.json` (`@kompass/documents`, `@kompass/mcp`), `next.config.ts` (`transpilePackages`), `src/lib/deps.ts`, `proxy.ts` (`/mcp`, `/api` öffentlich)
- Create: `src/lib/mcp.ts`, `src/app/mcp/route.ts`, `src/app/media/[id]/route.ts`, `src/app/documents/[id]/file/route.ts`, `src/app/api/health/route.ts`
- Test: `e2e/mcp.spec.ts`, `e2e/health.spec.ts`

**Interfaces:**
- Produces: `getMcpHandler()` (Singleton), Routen `GET|POST|DELETE /mcp`, `GET /media/:id`, `GET /documents/:id/file`, `GET /api/health`.

- [ ] **Step 1: E2E-Tests schreiben**

`apps/kompass/e2e/health.spec.ts`:
```ts
import { expect, test } from '@playwright/test';

test('health endpoint reports environment and migrations without auth', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ status: 'ok', environment: 'test' });
  expect(body.migrationCount).toBeGreaterThan(0);
});
```

`apps/kompass/e2e/mcp.spec.ts`:
```ts
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test('an API token created in the profile drives the MCP endpoint and is audited as channel MCP', async ({ page, baseURL }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Token erstellen' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Playwright');
  await page.getByRole('dialog').getByRole('button', { name: 'Erstellen' }).click();
  const token = (await page.getByTestId('api-token-plaintext').textContent())!.trim();
  await page.getByRole('button', { name: 'Ich habe das Token gespeichert' }).click();

  const client = new Client({ name: 'e2e', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', baseURL), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  const tools = await client.listTools();
  expect(tools.tools.map((t) => t.name)).toContain('settings_set');
  const result = await client.callTool({ name: 'settings_set', arguments: { key: 'organization.city', value: 'Jülich' } });
  expect(result.isError).toBeFalsy();
  await client.close();

  await page.goto('/admin/audit');
  const row = page.getByRole('table').getByRole('row').nth(1);
  await expect(row).toContainText('settings.update');
  await expect(row).toContainText('MCP');
  await page.goto('/admin/settings');
  await expect(page.getByLabel('Ort')).toHaveValue('Jülich');
});

test('the MCP endpoint rejects requests without a token', async ({ request }) => {
  const res = await request.post('/mcp', { headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, data: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} } });
  expect(res.status()).toBe(401);
});
```

- [ ] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app add @kompass/documents@workspace:* @kompass/mcp@workspace:* && pnpm --filter @kompass/app add -D @modelcontextprotocol/client@^2.0.0 && pnpm --filter @kompass/app e2e e2e/health.spec.ts e2e/mcp.spec.ts`
Expected: FAIL — 404 auf `/api/health` und `/mcp`.

- [ ] **Step 3: Deps und Handler**

`apps/kompass/next.config.ts`: `transpilePackages: ['@kompass/core', '@kompass/documents', '@kompass/mcp']`.

`apps/kompass/src/lib/deps.ts` — `getDeps()` anpassen:
```ts
import { coreDocumentTemplates, createTypstRenderer } from '@kompass/documents';
// …
export type AppDeps = import('@kompass/core').AppDeps;
// in getDeps():
holder.deps = createDeps({
  databasePath: env.databasePath,
  env: env.env,
  mediaPath: env.mediaPath,
  coreTemplates: coreDocumentTemplates(createTypstRenderer()),
});
```
(`resetDeps` löscht zusätzlich das Medienverzeichnis: `rmSync(env.mediaPath, { recursive: true, force: true })`.)

`apps/kompass/src/lib/mcp.ts`:
```ts
import 'server-only';
import { coreMcpTools, createKompassMcpHandler, type KompassMcpHandler } from '@kompass/mcp';
import { getDeps } from './deps';

const holder: { handler: KompassMcpHandler | null } = ((globalThis as unknown as { __kompassMcp?: { handler: KompassMcpHandler | null } }).__kompassMcp ??= { handler: null });

export function getMcpHandler(): KompassMcpHandler {
  holder.handler ??= createKompassMcpHandler(getDeps(), { extraTools: coreMcpTools });
  return holder.handler;
}

export async function resetMcpHandler(): Promise<void> {
  await holder.handler?.close();
  holder.handler = null;
}
```
In `resetDeps` (E2E) nach dem Neuaufbau `await resetMcpHandler()` aufrufen, damit der Handler die neuen Deps sieht.

- [ ] **Step 4: Routen**

`apps/kompass/src/app/mcp/route.ts`:
```ts
import { getMcpHandler } from '@/lib/mcp';

export const dynamic = 'force-dynamic';

const handle = (request: Request) => getMcpHandler().fetch(request);

export { handle as GET, handle as POST, handle as DELETE };
```

`apps/kompass/proxy.ts`: `PUBLIC_PREFIXES` um `'/mcp'` und `'/api/health'` ergänzen (der Matcher schließt `/api/` bereits aus; `/mcp` muss explizit ohne Cookie durch).

`apps/kompass/src/app/media/[id]/route.ts`:
```ts
import { getMediaAsset } from '@kompass/core';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const { id } = await ctx.params;
  const result = await getMediaAsset(getDeps(), session.ctx, id);
  if (!result.ok) return new Response(null, { status: 404 });
  return new Response(result.value.bytes, { headers: { 'content-type': result.value.record.mimeType, 'cache-control': 'private, max-age=3600', 'content-length': String(result.value.bytes.byteLength) } });
}
```
`apps/kompass/src/app/documents/[id]/file/route.ts`:
```ts
import { getDocument } from '@kompass/core';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const { id } = await ctx.params;
  const result = await getDocument(getDeps(), session.ctx, id);
  if (!result.ok) return new Response(null, { status: result.error.type === 'forbidden' ? 403 : 404 });
  return new Response(result.value.bytes, {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${result.value.filename}"`, 'cache-control': 'private, no-store' },
  });
}
```

`apps/kompass/src/app/api/health/route.ts`:
```ts
import { getDeps, runtimeEnv } from '@/lib/deps';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const deps = getDeps();
  return Response.json({ status: 'ok', environment: runtimeEnv().env, migrationCount: deps.migrationCount, version: '0.1.0' });
}
```

- [ ] **Step 5: Tests ausführen**

Run: `pnpm --filter @kompass/app typecheck && pnpm --filter @kompass/app test && pnpm --filter @kompass/app e2e e2e/health.spec.ts e2e/mcp.spec.ts`
Expected: grün. Der Literal-Scanner bleibt grün (keine Farben in den neuen Dateien).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(app): wire typst templates, MCP endpoint, media and PDF delivery, health check"
```

---

### Task 7: Dokumente-Seite, Protokoll-PDF, Logo-Upload

**Files:**
- Replace: `src/app/(shell)/admin/documents/page.tsx`; Create: `actions.ts`, `document-list.tsx`, `create-document-dialog.tsx`, `document-preview.tsx`, `void-document-dialog.tsx`
- Create: `src/app/(shell)/admin/audit/export-button.tsx`, `src/app/(shell)/admin/audit/actions.ts`; Modify: `audit/page.tsx` (Button ersetzen)
- Create: `src/app/(shell)/admin/settings/logo-upload.tsx`, `src/app/(shell)/admin/settings/logo-actions.ts`; Modify: `settings-form.tsx` (Branding-Reiter), `src/components/shell/sidebar.tsx` (Logo), `src/app/(shell)/layout.tsx` (`logoAssetId`)
- Test: `e2e/documents.spec.ts`

**Interfaces:**
- Consumes: `renderDocument`, `voidDocument`, `listDocuments`, `queryAudit`, `storeMediaAsset`, `setSetting`, `Registry.documentTemplates`.
- Produces: Actions `createLetterheadAction(prev, formData)`, `voidDocumentAction(id, reason)`, `exportAuditPdfAction(filters)`, `uploadLogoAction(prev, formData)`.

- [ ] **Step 1: E2E-Test schreiben**

`apps/kompass/e2e/documents.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('documents', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('creates a letterhead document, previews it, downloads the PDF and voids it', async ({ page, request }) => {
    await page.goto('/admin/documents');
    await page.getByRole('button', { name: 'Dokument erzeugen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Vorlage').selectOption('letterhead');
    await dialog.getByLabel('Titel').fill('Einladung zur Mitgliederversammlung');
    await dialog.getByLabel('Text').fill('Sehr geehrte Mitglieder,\n\nhiermit laden wir ein.');
    await dialog.getByRole('button', { name: 'Erzeugen' }).click();
    const row = page.getByRole('row', { name: /Einladung zur Mitgliederversammlung/ });
    await expect(row).toContainText('BRF-2026-001');
    await expect(page.getByTitle('Vorschau BRF-2026-001')).toHaveAttribute('src', /\/documents\/[A-Z0-9]+\/file$/);
    const href = await row.getByRole('link', { name: 'Herunterladen' }).getAttribute('href');
    const pdf = await request.get(href!);
    expect(pdf.headers()['content-type']).toBe('application/pdf');
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

    await row.getByRole('button', { name: 'Stornieren' }).click();
    await page.getByRole('alertdialog').getByLabel('Grund').fill('Datum falsch');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Stornieren' }).click();
    await expect(row).toContainText('Storniert');
    await expect(row.getByRole('button', { name: 'Stornieren' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Dokument erzeugen' }).click();
    await page.getByRole('dialog').getByLabel('Titel').fill('Ersatz');
    await page.getByRole('dialog').getByRole('button', { name: 'Erzeugen' }).click();
    await expect(page.getByRole('row', { name: /Ersatz/ })).toContainText('BRF-2026-002');
  });

  test('exports the audit log as a PRO document with the active filters', async ({ page }) => {
    await page.goto('/admin/audit?channel=system');
    await page.getByRole('button', { name: 'Als PDF exportieren' }).click();
    await expect(page).toHaveURL(/\/admin\/documents\?selected=/);
    await expect(page.getByRole('row', { name: /Änderungsprotokoll/ })).toContainText('PRO-2026-001');
  });

  test('uploads a logo that appears in the sidebar and in the letterhead', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.getByRole('tab', { name: 'Branding' }).click();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    await page.getByLabel('Logo-Datei').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
    await page.getByRole('button', { name: 'Logo speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Logo gespeichert');
    const logo = page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('img', { name: 'Vereinslogo' });
    await expect(logo).toHaveAttribute('src', /\/media\/[A-Z0-9]+$/);
  });
});
```

- [ ] **Step 2: E2E ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app e2e e2e/documents.spec.ts`
Expected: FAIL — Platzhalterseite, keine Buttons.

- [ ] **Step 3: Dokumente-Actions und -Komponenten**

`src/app/(shell)/admin/documents/actions.ts`:
```ts
'use server';

import { renderDocument, voidDocument } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function createLetterheadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await renderDocument(deps, ctx, {
    templateKey: String(formData.get('templateKey') ?? 'letterhead'),
    input: { title: formData.get('title'), body: formData.get('body') ?? '', letterhead: formData.get('letterhead') === 'on' },
  });
  revalidatePath('/admin/documents');
  return toActionState(result, t, t('documents.toast.created'));
}

export async function voidDocumentAction(id: string, reason: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await voidDocument(deps, ctx, { id, reason });
  revalidatePath('/admin/documents');
  return toActionState(result, t, t('documents.toast.voided'));
}
```

`src/app/(shell)/admin/documents/create-document-dialog.tsx`:
```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { idleState } from '@/lib/actions';
import { createLetterheadAction } from './actions';

export function CreateDocumentDialog({ templates }: { templates: { key: string; enabled: boolean; reason?: string }[] }) {
  const t = useTranslations('documents.create');
  const c = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createLetterheadAction, idleState);
  const errors = state.status === 'error' ? state.fieldErrors : {};
  useEffect(() => {
    if (state.status === 'success') {
      setOpen(false);
      toast.success(state.message ?? '');
      router.push(`/admin/documents?selected=${(state.data as { id: string }).id}`);
    }
  }, [state, router]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>{t('button')}</Button></DialogTrigger>
      <DialogContent className="w-[560px] bg-surface shadow-md">
        <form action={action} className="flex flex-col gap-4" aria-busy={pending}>
          <DialogTitle className="font-heading text-[19px]">{t('title')}</DialogTitle>
          {state.status === 'error' && Object.keys(errors).length === 0 ? <p role="alert" className="rounded-md border border-error bg-error-bg p-3 text-[13px] text-error">{state.message}</p> : null}
          <FormField id="templateKey" label={t('template')}>
            <select id="templateKey" name="templateKey" className="h-9 rounded-md border border-line-strong bg-field px-2 text-[14px]" defaultValue="letterhead">
              {templates.map((tpl) => <option key={tpl.key} value={tpl.key} disabled={!tpl.enabled}>{t(`templates.${tpl.key}`)}{tpl.enabled ? '' : ` (${tpl.reason ?? ''})`}</option>)}
            </select>
          </FormField>
          <FormField id="title" label={t('titleField')} error={errors.title}><Input id="title" name="title" required maxLength={120} /></FormField>
          <FormField id="body" label={t('body')} error={errors.body}><Textarea id="body" name="body" rows={6} maxLength={5000} /></FormField>
          <div className="flex items-center gap-2"><Checkbox id="letterhead" name="letterhead" defaultChecked /><Label htmlFor="letterhead">{t('letterhead')}</Label></div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{c('cancel')}</Button>
            <SubmitButton>{pending ? t('rendering') : t('submit')}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```
Hinweis: `useActionState` liefert in React 19 als drittes Element `pending`. Solange gerendert wird, ist der Knopf deaktiviert und zeigt „Wird erzeugt …" (Ladezustand „Rendering" aus dem Handoff `2e`).

`src/app/(shell)/admin/documents/void-document-dialog.tsx`:
```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormField } from '@/components/forms/form-field';
import { Input } from '@/components/ui/input';
import { voidDocumentAction } from './actions';

export function VoidDocumentDialog({ id, number, open, onOpenChange }: { id: string; number: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('documents.void');
  const [reason, setReason] = useState('');
  return (
    <ConfirmDialog open={open} onOpenChange={onOpenChange} title={t('title', { number })} description={t('text')} confirmLabel={t('confirm')} destructive action={() => voidDocumentAction(id, reason)}>
      <FormField id="void-reason" label={t('reason')}><Input id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} required /></FormField>
    </ConfirmDialog>
  );
}
```

`src/app/(shell)/admin/documents/document-list.tsx`:
```tsx
'use client';

import type { DocumentRecord } from '@kompass/core';
import { Download } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { VoidDocumentDialog } from './void-document-dialog';

type Row = DocumentRecord & { createdByName: string | null; title: string };

export function DocumentList({ documents, selectedId, canCreate }: { documents: Row[]; selectedId: string | null; canCreate: boolean }) {
  const t = useTranslations('documents');
  const format = useFormatter();
  const [voiding, setVoiding] = useState<Row | null>(null);
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <table className="w-full text-[14px]">
        <thead className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink"><tr className="h-9"><th className="px-4">{t('columns.title')}</th><th className="px-4">{t('columns.reference')}</th><th className="px-4">{t('columns.createdBy')}</th><th className="px-4">{t('columns.date')}</th><th className="px-4" /></tr></thead>
        <tbody>
          {documents.map((d, i) => (
            <tr key={d.id} className={cn('h-[52px] border-b border-line-2 hover:bg-row-hover', i % 2 === 1 && 'bg-zebra', d.id === selectedId && 'bg-selected')}>
              <td className="px-4">
                <Link href={`?selected=${d.id}`} className={cn('font-semibold', d.status === 'voided' && 'text-muted-ink')}>{d.title}</Link>
                {d.status === 'voided' ? <StatusBadge tone="neutral" className="ml-2">{t('voided')}</StatusBadge> : null}
                <div className="text-[12px] text-muted-ink">{t(`templates.${d.templateKey}`)} · <span className="font-mono">{d.number}</span></div>
              </td>
              <td className="px-4 text-ink-2">{d.entityType ? `${d.entityType} · ${d.entityId ?? ''}` : '—'}</td>
              <td className="px-4 text-ink-2">{d.createdByName ?? '—'}</td>
              <td className="px-4 font-mono text-[12px]">{format.dateTime(new Date(d.createdAt), { dateStyle: 'short' })}</td>
              <td className="px-4 text-right">
                <div className="flex justify-end gap-1">
                  <Button asChild variant="ghost" size="icon" aria-label={t('download')}><a href={`/documents/${d.id}/file`} download={`${d.number}.pdf`} title={t('download')}><Download className="size-4" /><span className="sr-only">{t('download')}</span></a></Button>
                  {canCreate && d.status === 'issued' ? <Button variant="outline" size="sm" className="border-error text-error" onClick={() => setVoiding(d)}>{t('void.confirm')}</Button> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {voiding ? <VoidDocumentDialog id={voiding.id} number={voiding.number} open onOpenChange={(o) => { if (!o) setVoiding(null); }} /> : null}
    </div>
  );
}
```
Hinweis: Der Link „Herunterladen" hat ein sichtbares `sr-only`-Label; der E2E-Test findet ihn über den barrierefreien Namen.

`src/app/(shell)/admin/documents/document-preview.tsx`:
```tsx
import { getTranslations } from 'next-intl/server';

export async function DocumentPreview({ id, number, pages }: { id: string; number: string; pages?: number }) {
  const t = await getTranslations('documents.preview');
  return (
    <aside className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-4">
      <div className="flex items-center justify-between text-[13px]"><span className="font-semibold">{t('title')} · <span className="font-mono">{number}</span></span>{pages ? <span className="text-muted-ink">{t('pages', { count: pages })}</span> : null}</div>
      <iframe title={`${t('title')} ${number}`} src={`/documents/${id}/file`} className="h-[640px] w-full rounded-sm border border-line-strong bg-surface" />
      <a href={`/documents/${id}/file`} download={`${number}.pdf`} className="text-[13px] text-link underline">{t('download')}</a>
    </aside>
  );
}
```

`src/app/(shell)/admin/documents/page.tsx`:
```tsx
import { hasPermission, listDocuments, listUsers, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { CreateDocumentDialog } from './create-document-dialog';
import { DocumentList } from './document-list';
import { DocumentPreview } from './document-preview';

export default async function DocumentsPage(props: { searchParams: Promise<{ selected?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'documents.view')) return <ForbiddenCard permission="documents.view" />;
  const t = await getTranslations('documents');
  const { selected } = await props.searchParams;
  const result = await listDocuments(deps, ctx, { limit: 200 });
  if (!result.ok) return <ForbiddenCard permission="documents.view" />;
  const users = hasPermission(ctx, 'users.manage') ? await listUsers(deps, ctx) : null;
  const nameOf = (id: string) => (users?.ok ? users.value.find((u) => u.id === id)?.name ?? null : null);
  const rows = result.value.documents.map((d) => ({ ...d, createdByName: nameOf(d.createdByUserId), title: String((d.inputSnapshot as { title?: string }).title ?? d.number) }));
  const canCreate = hasPermission(ctx, 'documents.create');
  const templates = [...deps.registry.documentTemplates.values()].map((tpl) => ({ key: tpl.key, enabled: !tpl.permission || hasPermission(ctx, tpl.permission), reason: tpl.permission && !hasPermission(ctx, tpl.permission) ? t('create.missingPermission', { permission: tpl.permission }) : undefined }));
  const selectedDoc = rows.find((d) => d.id === selected) ?? null;
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} actions={canCreate ? <CreateDocumentDialog templates={templates} /> : null} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        {rows.length === 0 ? <EmptyState title={t('empty.title')} text={t('empty.text')} /> : <DocumentList documents={rows} selectedId={selectedDoc?.id ?? null} canCreate={canCreate} />}
        {selectedDoc ? <DocumentPreview id={selectedDoc.id} number={selectedDoc.number} /> : null}
      </div>
      <p className="mt-3 text-[12px] text-muted-ink">{t('footnote')}</p>
    </>
  );
}
```

- [ ] **Step 4: Protokoll-Export**

`src/app/(shell)/admin/audit/actions.ts`:
```ts
'use server';

import { queryAudit, renderDocument } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function exportAuditPdfAction(filters: Record<string, string | undefined>): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const query = queryAudit(deps, ctx, {
    userId: filters.userId || undefined,
    channel: filters.channel || undefined,
    action: filters.action || undefined,
    text: filters.text || undefined,
    from: filters.from ? `${filters.from}T00:00:00.000Z` : undefined,
    to: filters.to ? `${filters.to}T23:59:59.999Z` : undefined,
    limit: 200,
  });
  if (!query.ok) return toActionState(query, t);
  const labels = t.raw('audit.filters') as Record<string, string>;
  const shown = Object.fromEntries(Object.entries(filters).filter(([, v]) => v).map(([k, v]) => [labels[k] ?? k, String(v)]));
  const result = await renderDocument(deps, ctx, {
    templateKey: 'audit-log-export',
    input: {
      title: t('audit.title'),
      filters: shown,
      entries: query.value.entries.map((e) => ({ occurredAt: e.occurredAt, userName: e.userName, channel: e.channel, action: e.action, entityType: e.entityType, entityId: e.entityId, summary: e.summary })),
    },
  });
  if (!result.ok) return toActionState(result, t);
  redirect(`/admin/documents?selected=${result.value.id}`);
}
```
(Die Obergrenze von 200 Einträgen je Export entspricht der Abfragegrenze des Kerns; für größere Zeiträume filtert der Nutzer nach Datum. Die Vorlage nimmt bis zu 2000 Einträge, falls der Kern-Limit später steigt.)

`src/app/(shell)/admin/audit/export-button.tsx`:
```tsx
'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { exportAuditPdfAction } from './actions';

export function ExportButton({ enabled }: { enabled: boolean }) {
  const t = useTranslations('audit');
  const params = useSearchParams();
  const [pending, start] = useTransition();
  return (
    <Button variant="secondary" disabled={!enabled || pending} onClick={() => start(async () => { const s = await exportAuditPdfAction(Object.fromEntries(params.entries())); if (s.status === 'error') toast.error(s.message); })}>
      <Download className="size-4" aria-hidden />{pending ? t('exporting') : t('export')}
    </Button>
  );
}
```
In `audit/page.tsx` den deaktivierten Button durch `<ExportButton enabled={hasPermission(ctx, 'documents.create')} />` ersetzen.

- [ ] **Step 5: Logo-Upload**

`src/app/(shell)/admin/settings/logo-actions.ts`:
```ts
'use server';

import { setSetting, storeMediaAsset } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function uploadLogoAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const file = formData.get('logo');
  if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('settings.logo.noFile'), fieldErrors: { logo: t('settings.logo.noFile') } };
  const stored = await storeMediaAsset(deps, ctx, { originalName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), declaredMimeType: file.type });
  if (!stored.ok) return toActionState(stored, t);
  const saved = await setSetting(deps, ctx, { key: 'branding.logoAssetId', value: stored.value.id });
  revalidatePath('/', 'layout');
  return toActionState(saved, t, t('settings.logo.saved'));
}
```

`src/app/(shell)/admin/settings/logo-upload.tsx`:
```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { idleState } from '@/lib/actions';
import { uploadLogoAction } from './logo-actions';

export function LogoUpload({ currentAssetId }: { currentAssetId: string | null }) {
  const t = useTranslations('settings.logo');
  const [state, action] = useActionState(uploadLogoAction, idleState);
  useEffect(() => { if (state.status === 'success' && state.message) toast.success(state.message); }, [state]);
  const error = state.status === 'error' ? (state.fieldErrors.logo ?? state.fieldErrors.bytes ?? state.message) : undefined;
  return (
    <form action={action} className="flex flex-col gap-3 md:col-span-2">
      <div className="flex items-center gap-4 rounded-md border border-dashed border-line-strong bg-surface-2 p-3">
        {currentAssetId ? <img src={`/media/${currentAssetId}`} alt={t('current')} className="size-11 rounded-sm object-contain" /> : <div className="size-11 rounded-sm border border-dashed border-line-strong" aria-hidden />}
        <FormField id="logo" label={t('file')} hint={t('hint')} error={error} className="flex-1"><input id="logo" name="logo" type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" className="text-[13px]" /></FormField>
        <SubmitButton variant="secondary">{t('submit')}</SubmitButton>
      </div>
    </form>
  );
}
```
In `settings-form.tsx`, Reiter `branding`: das schreibgeschützte Feld `branding.logoAssetId` nicht mehr rendern, stattdessen `<LogoUpload currentAssetId={String(values['branding.logoAssetId'] ?? '') || null} />` oberhalb des Grids; das Feld aus `SETTINGS_TABS` entfernen und den Test `settings-fields.test.ts` anpassen (Erwartung: alle `organization.*`- und `branding.*`-Keys **außer** `branding.logoAssetId`).

Sidebar-Logo: `Sidebar` erhält `logoUrl: string | null`; im Kopf `logoUrl ? <img src={logoUrl} alt={t('nav.logoAlt')} className="size-7 rounded-sm object-contain" /> : <Platzhalter>`. `(shell)/layout.tsx` liest `readSetting('branding.logoAssetId')` und übergibt `logoUrl={id ? `/media/${id}` : null}` über `ShellFrame`.

`messages/de.json` ergänzen:
```json
"documents": {
  "title": "Dokumente", "description": "Erzeugte PDFs sind unveränderlich und lückenlos nummeriert. Ein fehlerhaftes Dokument wird storniert und ersetzt.",
  "columns": { "title": "Vorlage / Titel", "reference": "Bezug", "createdBy": "Erstellt von", "date": "Datum" },
  "download": "Herunterladen", "voided": "Storniert",
  "templates": { "letterhead": "Briefbogen", "audit-log-export": "Änderungsprotokoll" },
  "create": { "button": "Dokument erzeugen", "title": "Dokument erzeugen", "template": "Vorlage", "titleField": "Titel", "body": "Text", "letterhead": "Briefkopf und Vereinsangaben einsetzen", "submit": "Erzeugen", "rendering": "Wird erzeugt …", "missingPermission": "benötigt {permission}", "templates": { "letterhead": "Briefbogen", "audit-log-export": "Änderungsprotokoll-Export" } },
  "void": { "title": "Dokument {number} stornieren?", "text": "Das Dokument behält Nummer und PDF und wird als storniert markiert. Ein Ersatz erhält eine neue Nummer.", "reason": "Grund", "confirm": "Stornieren" },
  "preview": { "title": "Vorschau", "pages": "{count, plural, one {# Seite} other {# Seiten}}", "download": "Herunterladen" },
  "empty": { "title": "Noch keine Dokumente", "text": "Erzeugen Sie ein erstes Dokument, zum Beispiel einen Briefbogen." },
  "footnote": "Dokumente werden nicht gelöscht. Ein fehlerhaftes Dokument wird storniert; es bleibt mit dem Vermerk „storniert“ in der Liste.",
  "toast": { "created": "Dokument erzeugt.", "voided": "Dokument storniert." }
},
"settings": { "logo": { "file": "Logo-Datei", "hint": "PNG oder SVG, mindestens 256 px. Erscheint in Sidebar, Login und Briefkopf.", "submit": "Logo speichern", "saved": "Logo gespeichert.", "noFile": "Bitte eine Datei auswählen.", "current": "Aktuelles Logo" } },
"audit": { "exporting": "Wird erzeugt …" },
"nav": { "logoAlt": "Vereinslogo" },
"errors": { "fields": { "unsupportedMediaType": "Dateityp nicht unterstützt (PNG, JPEG, WebP, SVG, PDF).", "fileTooLarge": "Datei größer als 10 MB.", "svgContainsScript": "SVG enthält Skripte und wird abgelehnt." } }
```
(Die Namensräume `settings`, `audit`, `nav`, `errors.fields` existieren bereits — Schlüssel dort ergänzen, nicht doppelt anlegen. `fieldMessage` in `src/lib/actions.ts` um die drei Medien-Codes erweitern: exakte Treffer `unsupportedMediaType`, `fileTooLarge`, `svgContainsScript` → `errors.fields.<code>`.)

- [ ] **Step 6: Tests ausführen**

Run: `pnpm --filter @kompass/app test && pnpm --filter @kompass/app typecheck && pnpm --filter @kompass/app e2e e2e/documents.spec.ts e2e/settings.spec.ts e2e/shell.spec.ts`
Expected: grün.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(app): documents page with preview and voiding, audit PDF export, logo upload"
```

---

### Task 8: Backup-Seite — Export-Download und Import mit Bestätigung

**Files:**
- Replace: `src/app/(shell)/admin/backup/page.tsx`; Create: `actions.ts`, `export-card.tsx`, `import-card.tsx`, `src/app/admin/backup/export/route.ts`
- Modify: `src/lib/deps.ts` (`reopen` nach Import ist Kern-Sache; hier nur MCP-Handler zurücksetzen)
- Test: `e2e/backup.spec.ts`

**Interfaces:**
- Produces: `POST /admin/backup/export` (Download `application/gzip`), `importBackupAction(prev, formData)`; Umgebungsnamen für die Bestätigung: `production → "produktion"`, `test → "test"`, `development → "entwicklung"` (`environmentConfirmationName(env)` in `src/lib/env-banner.ts`).

- [ ] **Step 1: E2E-Test schreiben**

`apps/kompass/e2e/backup.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test('exports a backup and imports it back, ending all sessions', async ({ page, request }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/admin/backup');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export erstellen' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^kompass-backup-test-\d{8}-\d{6}\.tar\.gz$/);
  const archivePath = await download.path();
  await expect(page.getByText(/Letzter Export/)).toBeVisible();

  await page.getByLabel('Backup-Datei').setInputFiles(archivePath!);
  await page.getByRole('button', { name: 'Import vorbereiten' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Bestand der Umgebung „test“ überschreiben?');
  await expect(confirm).toContainText('4 Nutzer');
  await expect(confirm.getByRole('button', { name: 'Bestand überschreiben' })).toBeDisabled();
  await confirm.getByLabel('Tippen Sie zur Bestätigung den Umgebungsnamen').fill('test');
  await confirm.getByRole('button', { name: 'Bestand überschreiben' }).click();
  await expect(page).toHaveURL(/\/login\?imported=1/);
  await expect(page.getByRole('status')).toContainText('Import abgeschlossen');

  await loginAsAdmin(page);
  await page.goto('/admin/audit');
  await expect(page.getByRole('table').getByRole('row').nth(1)).toContainText('backup.import');
  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
});
```

- [ ] **Step 2: E2E ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app e2e e2e/backup.spec.ts`
Expected: FAIL — Platzhalterseite.

- [ ] **Step 3: Export-Route und Actions**

In `src/lib/env-banner.ts` ergänzen:
```ts
export function environmentConfirmationName(env: AppEnv): string {
  return env === 'production' ? 'produktion' : env === 'test' ? 'test' : 'entwicklung';
}
```

`src/app/admin/backup/export/route.ts`:
```ts
import { exportBackup, requirePermission } from '@kompass/core';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  if (requirePermission(session.ctx, 'backup.export')) return new Response(null, { status: 403 });
  const result = await exportBackup(getDeps(), session.ctx, { workDir: tmpdir() });
  if (!result.ok) return Response.json(result.error, { status: 400 });
  const bytes = await readFile(result.value.archivePath);
  await rm(result.value.archivePath, { force: true });
  const name = result.value.archivePath.split('/').pop() ?? 'kompass-backup.tar.gz';
  return new Response(bytes, { headers: { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${name}"`, 'content-length': String(bytes.byteLength), 'cache-control': 'no-store' } });
}
```

`src/app/(shell)/admin/backup/actions.ts`:
```ts
'use server';

import { importBackup, inspectBackup } from '@kompass/core';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { toActionState, type ActionState } from '@/lib/actions';
import { runtimeEnv } from '@/lib/deps';
import { environmentConfirmationName } from '@/lib/env-banner';
import { resetMcpHandler } from '@/lib/mcp';
import { clearSessionCookie, requireSession } from '@/lib/request-context';

async function stash(file: File): Promise<{ dir: string; archivePath: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kompass-upload-'));
  const archivePath = path.join(dir, 'backup.tar.gz');
  await writeFile(archivePath, new Uint8Array(await file.arrayBuffer()));
  return { dir, archivePath };
}

export async function inspectBackupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  await requireSession();
  const file = formData.get('archive');
  if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('backup.import.noFile'), fieldErrors: { archive: t('backup.import.noFile') } };
  const { dir, archivePath } = await stash(file);
  try {
    const result = await inspectBackup({ archivePath, workDir: dir });
    return toActionState(result, t);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function importBackupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const file = formData.get('archive');
  if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('backup.import.noFile'), fieldErrors: { archive: t('backup.import.noFile') } };
  const { dir, archivePath } = await stash(file);
  let result;
  try {
    result = await importBackup(deps, ctx, { archivePath, workDir: dir, confirmation: String(formData.get('confirmation') ?? ''), environmentName: environmentConfirmationName(runtimeEnv().env) });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  if (!result.ok) return toActionState(result, t);
  await resetMcpHandler();
  await clearSessionCookie();
  redirect('/login?imported=1');
}
```
Hinweis: `clearSessionCookie` versucht die alte Session zu widerrufen — die Tabelle wurde ersetzt, `revokeSession` löscht dann 0 Zeilen; das ist in Ordnung.

- [ ] **Step 4: Karten und Seite**

`src/app/(shell)/admin/backup/export-card.tsx`:
```tsx
'use client';

import { Download } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function ExportCard({ lastExportAt }: { lastExportAt: string | null }) {
  const t = useTranslations('backup.export');
  const format = useFormatter();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const res = await fetch('/admin/backup/export', { method: 'POST' });
      if (!res.ok) { toast.error(t('failed')); return; }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'kompass-backup.tar.gz';
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      a.click();
      URL.revokeObjectURL(url);
      window.location.reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="grid grid-cols-[minmax(0,1fr)_220px] gap-4 rounded-lg border border-line bg-surface p-5">
      <div>
        <h3 className="font-heading text-[18px]">{t('title')}</h3>
        <p className="mt-1 text-[14px] text-ink-2">{t('text')}</p>
        <dl className="mt-3 grid grid-cols-3 gap-3 text-[13px]"><dt className="text-muted-ink">{t('last')}</dt><dd className="col-span-2 font-mono font-semibold">{lastExportAt ? format.dateTime(new Date(lastExportAt), { dateStyle: 'short', timeStyle: 'short' }) : '—'}</dd></dl>
      </div>
      <div className="flex flex-col items-end gap-1">
        <Button className="h-[38px]" disabled={busy} aria-busy={busy} onClick={run}><Download className="size-4" aria-hidden />{busy ? t('running') : t('button')}</Button>
        <span className="text-[12px] text-muted-ink">{t('duration')}</span>
      </div>
    </section>
  );
}
```

`src/app/(shell)/admin/backup/import-card.tsx`:
```tsx
'use client';

import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { FormField } from '@/components/forms/form-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { importBackupAction, inspectBackupAction } from './actions';

type Manifest = { createdAt: string; environment: string; appVersion: string; counts: { users: number; auditEntries: number; documents: number } };

export function ImportCard({ environmentName }: { environmentName: string }) {
  const t = useTranslations('backup.import');
  const c = useTranslations('common');
  const formRef = useRef<HTMLFormElement>(null);
  const [inspect, inspectAction] = useActionState(inspectBackupAction, idleState);
  const [imp, importAction, importing] = useActionState(importBackupAction, idleState);
  const [confirmation, setConfirmation] = useState('');
  const [open, setOpen] = useState(false);
  const manifest = inspect.status === 'success' ? (inspect.data as Manifest) : null;
  useEffect(() => { if (manifest) setOpen(true); }, [manifest]);
  const error = inspect.status === 'error' ? inspect.message : imp.status === 'error' ? imp.message : null;
  return (
    <section className="rounded-lg border border-warning bg-surface p-5">
      <div className="flex items-center gap-2"><h3 className="font-heading text-[18px]">{t('title')}</h3><span className="rounded-sm bg-warning-bg px-2 py-0.5 text-[12px] font-semibold text-warning">{t('badge')}</span></div>
      <p className="mt-3 flex gap-2 rounded-md border border-warning bg-warning-bg p-3 text-[13px] text-ink-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /><span>{t('warning')}</span></p>
      <form ref={formRef} action={inspectAction} className="mt-4 flex flex-col gap-3">
        <FormField id="archive" label={t('file')} error={error ?? undefined}><input id="archive" name="archive" type="file" accept=".tar.gz,application/gzip" required className="text-[13px]" /></FormField>
        <div className="flex justify-end gap-2 border-t border-warning pt-3"><SubmitButton variant="secondary" className="bg-warning text-on-brand">{t('prepare')}</SubmitButton></div>
      </form>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent role="alertdialog" className="w-[520px] bg-surface shadow-md">
          <form action={(fd) => { const file = (formRef.current?.elements.namedItem('archive') as HTMLInputElement | null)?.files?.[0]; if (file) fd.set('archive', file); fd.set('confirmation', confirmation); importAction(fd); }} className="flex flex-col gap-4">
            <DialogTitle className="flex items-center gap-2 font-heading text-[19px]"><AlertTriangle className="size-5 text-warning" aria-hidden />{t('confirmTitle', { env: environmentName })}</DialogTitle>
            <DialogDescription className="text-[14px] text-ink-2">{manifest ? t('confirmText', { users: manifest.counts.users, audit: manifest.counts.auditEntries, documents: manifest.counts.documents, source: `${manifest.environment}, ${new Date(manifest.createdAt).toLocaleString('de-DE')}` }) : ''}</DialogDescription>
            {importing ? (
              <ol className="flex flex-col gap-1 text-[13px]" aria-live="polite">
                <li className="font-semibold">{t('steps.writing')}</li>
                <li className="text-muted-ink-2">{t('steps.sessions')}</li>
              </ol>
            ) : (
              <FormField id="confirmation" label={t('confirmLabel')}>
                <div className="flex items-center gap-2"><Input id="confirmation" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="font-mono" autoComplete="off" /><code className="rounded-sm bg-code px-2 py-1 font-mono text-[12px]">{environmentName}</code></div>
              </FormField>
            )}
            <p className="text-[12px] text-muted-ink">{importing ? t('noAbort') : confirmation === environmentName ? '' : t('notConfirmed')}</p>
            <DialogFooter>
              {importing ? null : <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{c('cancel')}</Button>}
              <Button type="submit" disabled={confirmation !== environmentName || importing} className="bg-warning text-on-brand">{t('confirm')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
```

`src/app/(shell)/admin/backup/page.tsx`:
```tsx
import { readSetting, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { runtimeEnv } from '@/lib/deps';
import { environmentConfirmationName } from '@/lib/env-banner';
import { requireSession } from '@/lib/request-context';
import { ExportCard } from './export-card';
import { ImportCard } from './import-card';

export default async function BackupPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'backup.export')) return <ForbiddenCard permission="backup.export" />;
  const t = await getTranslations('backup');
  return (
    <>
      <PageHeader title={t('title')} />
      <div className="flex max-w-[880px] flex-col gap-5">
        <ExportCard lastExportAt={readSetting<string | null>(deps, 'system.lastExportAt')} />
        {requirePermission(ctx, 'backup.import') ? null : <ImportCard environmentName={environmentConfirmationName(runtimeEnv().env)} />}
      </div>
    </>
  );
}
```

`messages/de.json` — Namensraum `backup` (ersetzt `placeholders.backup`):
```json
"backup": {
  "title": "Backup",
  "export": { "title": "Export erstellen", "text": "Vollständiger Datenbestand samt Dokumenten, Protokoll und Einstellungen als eine Datei. Themes und Module sind enthalten, Sitzungen und API-Tokens nicht.", "last": "Letzter Export", "button": "Export erstellen", "running": "Export läuft …", "duration": "Dauert etwa 40 Sekunden.", "failed": "Export fehlgeschlagen." },
  "import": {
    "title": "Import", "badge": "Überschreibt alles",
    "warning": "Der Import ersetzt den gesamten Bestand dieser Umgebung, einschließlich Änderungsprotokoll. Erstellen Sie vorher einen Export. Der Vorgang selbst wird im neuen Bestand als Systemeintrag protokolliert.",
    "file": "Backup-Datei", "noFile": "Bitte eine Backup-Datei auswählen.", "prepare": "Import vorbereiten",
    "confirmTitle": "Bestand der Umgebung „{env}“ überschreiben?",
    "confirmText": "{users} Nutzer, {audit} Protokolleinträge und {documents} Dokumente aus dem Backup ({source}) ersetzen den aktuellen Bestand. Dieser Schritt lässt sich nicht rückgängig machen.",
    "confirmLabel": "Tippen Sie zur Bestätigung den Umgebungsnamen", "notConfirmed": "Noch nicht bestätigt.", "confirm": "Bestand überschreiben",
    "steps": { "writing": "Bestand wird ersetzt …", "sessions": "Sitzungen werden beendet" }, "noAbort": "Fenster nicht schließen. Ab hier lässt sich der Vorgang nicht mehr abbrechen; danach werden alle Sitzungen abgemeldet."
  }
},
"errors": { "fields": { "confirmationMismatch": "Der Umgebungsname stimmt nicht.", "backupFormatUnsupported": "Diese Datei ist kein Kompass-Backup oder hat ein unbekanntes Format.", "backupNewerThanApp": "Das Backup stammt aus einer neueren Version. Bitte zuerst die App aktualisieren.", "backupCorrupt": "Die Datenbank im Backup ist beschädigt." } }
```
(`fieldMessage` um die vier Codes erweitern; `placeholders.backup` entfernen.)

- [ ] **Step 5: Tests ausführen**

Run: `pnpm --filter @kompass/app test && pnpm --filter @kompass/app typecheck && pnpm --filter @kompass/app e2e e2e/backup.spec.ts`
Expected: grün. Der Download läuft über `fetch` + Blob, damit Playwright das `download`-Ereignis sieht und die Seite danach neu lädt (aktualisiert „Letzter Export").

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(app): backup page with export download and confirmed import"
```

---

### Task 9: Docker-Image, Compose für das NAS, CI, Betriebsanleitung

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `scripts/docker-entrypoint.sh`, `.github/workflows/ci.yml`, `docs/betrieb.md`
- Modify: `apps/kompass/next.config.ts` (`outputFileTracingRoot`), `packages/core/src/db/client.ts` (`KOMPASS_MIGRATIONS_DIR`), `packages/documents/src/renderer.ts` (`KOMPASS_TEMPLATES_DIR`, `KOMPASS_FONTS_DIR`), `AGENTS.md`/`CLAUDE.md` (Befehle)
- Test: `packages/core/tests/db.test.ts` (+ Env-Override), `packages/documents/tests/renderer.test.ts` (+ Env-Override), lokaler Container-Smoke-Test

**Interfaces:**
- Produces: Image `ghcr.io/<owner>/aluna-kompass:<tag>` (amd64) mit Node 26, Typst 0.15.1, Fonts, Vorlagen, Migrationen; Compose-Dienste `kompass-test` (Port 3001) und `kompass-prod` (Port 3000); CI mit Tests, E2E und Image-Push.

- [ ] **Step 1: Pfad-Overrides testgetrieben ergänzen**

`packages/core/tests/db.test.ts` ergänzen:
```ts
it('honours KOMPASS_MIGRATIONS_DIR', async () => {
  const { MIGRATIONS_DIR, resolveMigrationsDir } = await import('../src/db/client');
  expect(resolveMigrationsDir({})).toBe(MIGRATIONS_DIR);
  expect(resolveMigrationsDir({ KOMPASS_MIGRATIONS_DIR: '/srv/migrations' })).toBe('/srv/migrations');
});
```
`packages/core/src/db/client.ts`:
```ts
export function resolveMigrationsDir(env: Record<string, string | undefined> = process.env): string {
  return env.KOMPASS_MIGRATIONS_DIR ?? MIGRATIONS_DIR;
}
export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: resolveMigrationsDir() });
}
```
`packages/documents/tests/renderer.test.ts` ergänzen:
```ts
it('honours KOMPASS_TEMPLATES_DIR and KOMPASS_FONTS_DIR', async () => {
  const { resolveAssetDirs } = await import('../src/renderer');
  const dirs = resolveAssetDirs({ KOMPASS_TEMPLATES_DIR: '/srv/t', KOMPASS_FONTS_DIR: '/srv/f' });
  expect(dirs).toEqual({ templatesDir: '/srv/t', fontsDir: '/srv/f' });
});
```
`packages/documents/src/renderer.ts`: `resolveAssetDirs(env = process.env)` liefert `{ templatesDir: env.KOMPASS_TEMPLATES_DIR ?? <Paketpfad>/templates, fontsDir: env.KOMPASS_FONTS_DIR ?? <Paketpfad>/fonts }`; `createTypstRenderer` nutzt es als Default. Grund: Im Turbopack-Serverbundle zeigt `import.meta.url` nicht mehr auf die Paketdateien; im Container setzen wir die drei Variablen explizit.

Run: `pnpm --filter @kompass/core test && pnpm --filter @kompass/documents test`
Expected: grün.

- [ ] **Step 2: Next für Standalone im Monorepo konfigurieren**

`apps/kompass/next.config.ts` ergänzen:
```ts
import path from 'node:path';
// …
const nextConfig: NextConfig = {
  transpilePackages: ['@kompass/core', '@kompass/documents', '@kompass/mcp'],
  serverExternalPackages: ['better-sqlite3', '@node-rs/argon2', 'tar', 'file-type', 'image-size'],
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
};
```

Run: `pnpm --filter @kompass/app build`
Expected: `.next/standalone/apps/kompass/server.js` existiert; `ls apps/kompass/.next/standalone/node_modules | head` zeigt u. a. `better-sqlite3`.

- [ ] **Step 3: Dockerfile, Entrypoint, dockerignore**

`.dockerignore`:
```
node_modules
**/node_modules
**/.next
**/dist
**/e2e/.tmp
**/test-results
**/playwright-report
**/data
**/media
.git
docs/design
*.db
*.db-wal
*.db-shm
.env
.env.*
```

`Dockerfile`:
```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:26-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /app

FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/kompass/package.json apps/kompass/
COPY packages/core/package.json packages/core/
COPY packages/documents/package.json packages/documents/
COPY packages/mcp/package.json packages/mcp/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @kompass/app build

FROM node:26-bookworm-slim AS runner
ARG TYPST_VERSION=0.15.1
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
 && curl -sSL "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-x86_64-unknown-linux-musl.tar.xz" \
    | tar -xJ -C /usr/local/bin --strip-components=1 "typst-x86_64-unknown-linux-musl/typst" \
 && typst --version \
 && apt-get purge -y curl xz-utils && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    APP_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/kompass.db \
    MEDIA_PATH=/media \
    KOMPASS_MIGRATIONS_DIR=/app/packages/core/src/db/migrations \
    KOMPASS_TEMPLATES_DIR=/app/packages/documents/templates \
    KOMPASS_FONTS_DIR=/app/packages/documents/fonts
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/kompass/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/kompass/.next/static ./apps/kompass/.next/static
COPY --from=build --chown=node:node /app/apps/kompass/public ./apps/kompass/public
COPY --from=build --chown=node:node /app/packages/core/src/db/migrations ./packages/core/src/db/migrations
COPY --from=build --chown=node:node /app/packages/documents/templates ./packages/documents/templates
COPY --from=build --chown=node:node /app/packages/documents/fonts ./packages/documents/fonts
COPY --chown=node:node scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN mkdir -p /data /media && chown node:node /data /media && chmod +x /usr/local/bin/docker-entrypoint.sh
USER node
VOLUME ["/data", "/media"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "apps/kompass/server.js"]
```

`scripts/docker-entrypoint.sh`:
```sh
#!/bin/sh
set -eu
: "${SESSION_SECRET:?SESSION_SECRET muss gesetzt sein (mindestens 32 Zeichen)}"
mkdir -p "$(dirname "$DATABASE_PATH")" "$MEDIA_PATH"
echo "Aluna Kompass · APP_ENV=$APP_ENV · DB=$DATABASE_PATH · MEDIA=$MEDIA_PATH · typst $(typst --version)"
exec "$@"
```
(Migrationen laufen beim ersten `getDeps()` im App-Prozess — kein separater Schritt nötig.)

- [ ] **Step 4: Compose für das NAS**

`docker-compose.yml`:
```yaml
# Vorlage für die Container Station (QNAP TS-873). Vor dem Start: .env.test und .env.prod mit SESSION_SECRET anlegen.
services:
  kompass-test:
    image: ghcr.io/OWNER/aluna-kompass:latest
    container_name: kompass-test
    restart: unless-stopped
    ports: ["3001:3000"]
    environment:
      APP_ENV: test
    env_file: [.env.test]
    volumes:
      - /share/Container/kompass-test/data:/data
      - /share/Container/kompass-test/media:/media

  kompass-prod:
    image: ghcr.io/OWNER/aluna-kompass:latest
    container_name: kompass-prod
    restart: unless-stopped
    ports: ["3000:3000"]
    environment:
      APP_ENV: production
    env_file: [.env.prod]
    volumes:
      - /share/Container/kompass-prod/data:/data
      - /share/Container/kompass-prod/media:/media
```
`OWNER` durch den GitHub-Namensraum ersetzen (im CI-Workflow kommt er aus `github.repository`). `.env.test.example`/`.env.prod.example` mit `SESSION_SECRET=` ins Repo, echte Dateien sind git-ignoriert (`.env.*` steht bereits in `.gitignore`, `!.env.example`-Muster für die Beispiele ergänzen).

- [ ] **Step 5: CI**

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:

env:
  TYPST_VERSION: 0.15.1

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
        with: { version: 11.25.0 }
      - uses: actions/setup-node@v7
        with: { node-version: 26, cache: pnpm }
      - name: Install Typst
        run: |
          curl -sSL "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-x86_64-unknown-linux-musl.tar.xz" | tar -xJ
          sudo mv typst-x86_64-unknown-linux-musl/typst /usr/local/bin/typst && typst --version
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm --filter @kompass/app exec playwright install --with-deps chromium
      - run: pnpm --filter @kompass/app e2e
      - uses: actions/upload-artifact@v5
        if: failure()
        with: { name: playwright-report, path: apps/kompass/playwright-report }

  image:
    needs: test
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions: { contents: read, packages: write }
    steps:
      - uses: actions/checkout@v7
      - uses: docker/setup-buildx-action@v4
      - uses: docker/login-action@v4
        with: { registry: ghcr.io, username: ${{ github.actor }}, password: ${{ secrets.GITHUB_TOKEN }} }
      - id: meta
        uses: docker/metadata-action@v6
        with:
          images: ghcr.io/${{ github.repository_owner }}/aluna-kompass
          tags: |
            type=sha
            type=ref,event=branch
            type=semver,pattern={{version}}
            type=raw,value=latest,enable={{is_default_branch}}
      - uses: docker/build-push-action@v7
        with:
          context: .
          platforms: linux/amd64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          build-args: TYPST_VERSION=${{ env.TYPST_VERSION }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```
(`actions/upload-artifact@v5` ist die aktuelle Hauptversion; falls die CI eine neuere verlangt, den Major-Tag anheben.)

- [ ] **Step 6: Lokaler Container-Smoke-Test**

Run:
```bash
docker build -t kompass-local .
mkdir -p /tmp/kompass-smoke/data /tmp/kompass-smoke/media
docker run --rm -d --name kompass-smoke -p 3900:3000 -e APP_ENV=test -e SESSION_SECRET="$(openssl rand -hex 24)" -v /tmp/kompass-smoke/data:/data -v /tmp/kompass-smoke/media:/media kompass-local
sleep 8 && curl -sf http://localhost:3900/api/health && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3900/setup
docker exec kompass-smoke typst --version
docker stop kompass-smoke
```
Expected: Health-JSON mit `"environment":"test"`, `/setup` liefert `200`, `typst 0.15.1`. Auf einem Apple-Silicon-Mac `docker build --platform linux/amd64` verwenden (Emulation, langsamer, aber es ist das Zielformat des NAS).

- [ ] **Step 7: Betriebsanleitung**

`docs/betrieb.md`:
```markdown
# Betrieb auf dem QNAP TS-873

## Erstinstallation
1. Container Station öffnen → „Anwendung erstellen" → Inhalt von `docker-compose.yml` einfügen, `OWNER` ersetzen.
2. Ordner anlegen: `/share/Container/kompass-test/{data,media}` und `/share/Container/kompass-prod/{data,media}`.
3. `.env.test` und `.env.prod` neben die Compose-Datei legen, jeweils `SESSION_SECRET=<48 zufällige Zeichen>` (z. B. `openssl rand -hex 24`).
4. Anwendung starten. Test: `http://<nas>:3001`, Prod: `http://<nas>:3000`. Der erste Aufruf zeigt die Einrichtungsseite (genau einmal).
5. Health: `http://<nas>:3000/api/health`.

## Update
1. In Prod ein Backup exportieren (Verwaltung → Backup → Export erstellen) und die Datei sichern.
2. Container Station: Image `ghcr.io/OWNER/aluna-kompass:<version>` ziehen, zuerst `kompass-test` neu erstellen, prüfen (Login, Startseite, Health), dann `kompass-prod`.
3. Migrationen laufen beim Start automatisch; der Migrationsstand steht im Health-JSON und im Umgebungsbalken der Testumgebung.

## Prod nach Test kopieren
Export in Prod → Datei herunterladen → in Test unter Verwaltung → Backup importieren (Umgebungsname `test` eintippen). Danach sind in Test alle Sitzungen beendet; Anmeldung mit den Prod-Zugangsdaten. API-Tokens werden nicht mitkopiert.

## Backups
- Anwendungs-Backup: Export-Datei (`kompass-backup-<env>-<datum>.tar.gz`) — enthält DB, Medien, Manifest; ohne Sitzungen und Tokens.
- NAS-Ebene: Snapshots des Shared Folders `Container` zusätzlich aktivieren (Volume-Konsistenz: SQLite im WAL-Modus ist snapshot-sicher, das Backup-Export ist aber die verlässliche Form).
- Nach einem Import bleiben die vorherigen Dateien als `kompass.db.before-import-<zeit>` und `media.before-import-<zeit>` liegen; nach Prüfung manuell löschen.

## Zugriff von außerhalb
Nicht vorgesehen. Bei Bedarf QNAP-VPN (QVPN) verwenden; die App selbst bleibt LAN-only und ohne TLS.

## MCP
Endpunkt `http://<nas>:3000/mcp` (Streamable HTTP), Authentifizierung mit einem persönlichen API-Token aus dem Profil (`Authorization: Bearer akx_live_…`). Tokens wirken mit den Rechten des Nutzers; jeder Vorgang steht im Änderungsprotokoll mit Kanal „MCP".
```

`AGENTS.md`, Abschnitt „Befehle", ergänzen: `pnpm --filter @kompass/app e2e`, `docker build -t kompass-local .`, Verweis auf `docs/betrieb.md`. `CLAUDE.md` bleibt der dünne Verweis.

- [ ] **Step 8: Gesamtlauf und Commit**

Run: `pnpm typecheck && pnpm test && pnpm --filter @kompass/app e2e`
Expected: alle grün (Kern, Dokumente, MCP, App-Vitest, alle E2E-Specs).

```bash
git add -A
git commit -m "chore: docker image with typst and fonts, NAS compose, CI with image push, operations guide"
```

---

## Abschluss dieses Plans

Mit Task 9 ist das Fundament vollständig: Der Verein kann Test und Prod auf dem NAS betreiben, sich einrichten, Nutzer und Rollen führen, Einstellungen und Themes pflegen, Dokumente mit lückenlosen Nummern erzeugen und stornieren, das Protokoll als PDF exportieren, Backups ziehen und einspielen, und über MCP mit denselben Rechten und demselben Protokoll arbeiten wie in der Oberfläche. Der nächste Schritt ist Stufe 2 (Webseite) mit eigener Spec.

## Self-Review (durchgeführt beim Schreiben)

**Spec-Abdeckung:**
- Abschnitt 5 `mediaAssets` (Content-Hash im Namen, `MEDIA_PATH`) → Task 1; `documents` (Nummer `<PREFIX>-<JAHR>-<NNN>`, `issued|voided`, `inputSnapshot`, Doppel bleibt) → Task 2.
- Abschnitt 7 Dokumenten-Engine: Basis-Template mit Vereinsdaten als Parameter, Briefkopf optional, Kernvorlagen `letterhead` und `audit-log-export`, `renderDocument` mit Validierung, Temp-Verzeichnis, `typst compile`, Asset + `documents`-Zeile, Fehler ohne Speichern, Determinismus-Test, Schriften im Repo, Vorlagen aus Modul-Manifesten → Tasks 2, 3.
- Abschnitt 6 MCP: `/mcp` im Kompass-Prozess, Bearer-Token → `apiTokens`, Tools des Kerns (Einstellungen, Rollen, Nutzer, Protokoll, Dokumente, Module), englische Beschreibungen, ein Tool je Service → Tasks 5, 6. Abweichung: Tool-Namen mit Unterstrich statt Punkt (MCP-Namensregel), in Task 5 vermerkt.
- Abschnitt 8 Backup (Export mit Hashes, ohne Sitzungen/Tokens; Import überschreibt vollständig, Bestätigung durch Umgebungsnamen, danach Login mit „Import abgeschlossen") → Tasks 4, 8. Auslieferung (Multi-Stage-Dockerfile amd64, Compose `kompass-test`/`kompass-prod`, Volumes unter `/share/Container/…`, GitHub Actions mit Tests und GHCR-Push, Migrationen beim Start, Backup vor Update in der Anleitung) → Task 9. Umgebungs-Balken zeigt „Daten vom …" aus `system.lastImportAt` (gesetzt in Task 4).
- Plan-2-Lücken (Dokumente-Seite, Backup-Seite, Protokoll-PDF, Logo-Upload) → Tasks 7, 8. E2E-Pfad „Dokument erzeugen" → Task 7.

**Placeholder-Scan:** keine TBD/TODO; jede Code-Task enthält Test- und Implementierungscode in der gültigen Fassung.

**Typkonsistenz:** `AppDeps` (Task 4) = `Deps & { databasePath; migrationCount; backupDatabase; reopen; close }` wird von `apps/kompass/src/lib/deps.ts` (Task 6) und den Backup-Actions (Task 8) verwendet; `DocumentTemplate.render(data, ctx)` (Task 2) ⇄ `coreDocumentTemplates` (Task 3) ⇄ `renderDocument` (Task 2); `McpToolDefinition.handler(deps, ctx, args)` (Task 2) ⇄ `coreMcpTools` und `buildServer` (Task 5); `toActionState`/`fieldMessage` aus Plan 2 um die neuen Fehlercodes erweitert (Tasks 7, 8).

**Kern-Erweiterungen dieses Plans (alle mit Tests):** `Deps.media`, `createDeps({ mediaPath, coreTemplates })`, `Registry.documentTemplates`, Manifest-Felder `documentTemplates`/`mcpTools`, `AppDeps` mit `backupDatabase`/`reopen`, `resolveMigrationsDir`.
