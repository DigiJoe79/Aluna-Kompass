# Mediathek Auswahl und Vorschau, Plan 2: Routen und Auswahl-Dialog

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die App liefert Vorschaubilder über `/media/{id}/preview`, die Liste als JSON über `GET /media`, und ein Client-Baustein `MediaChooserDialog` zeigt die Mediathek zur Auswahl mit Suche, Ordnern, Upload und Einzel- oder Mehrfachauswahl.

**Architecture:** Zwei Route Handler neben dem bestehenden `/media/[id]`. Die Listenlogik liegt in einer reinen Funktion `apps/kompass/src/lib/media-listing.ts` (Parameter parsen, Liste bauen), damit sie ohne Next-Laufzeit testbar ist; der Handler ist eine dünne Hülle. Der Dialog holt Daten per `fetch('/media?…')`, lädt über die bestehende `uploadMediaAction` hoch und gibt IDs zurück. Das Kachel-Grid wandert aus `admin/media` in `components/media/`, damit Dialog und Mediathek-Seite dasselbe Grid nutzen.

**Tech Stack:** Next 16 Route Handler und Server Actions, React 19 Client-Komponenten, next-intl, Vitest (Node-Umgebung, keine Komponententests), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-13-mediathek-auswahl-und-vorschau-design.md`, §3 (Route), §5, §6.

## Global Constraints

- Setzt Plan 1 voraus: `getMediaPreview`, `MediaListFilter`, `mediaListFilterSchema`, `listMediaAssets(deps, ctx, filter)`, `MediaReference.href`.
- Kein UI-Text im Code; alle Beschriftungen in `apps/kompass/messages/de.json`. `apps/kompass/tests/message-keys.test.ts` prüft feste Schlüssel, `no-hardcoded-ui-text.test.ts` sucht Literale.
- Kein Farbwert im Code, nur Theme-Klassen (`bg-surface`, `text-ink-2`, `border-line`, `bg-selected`, …), wie in `admin/media/*`.
- Clientseitiges Nachladen läuft über Route Handler, nie über Server Actions (Memory „Route-Bundles und serielle Server Actions“).
- Beide Medien-Routen antworten mit `content-security-policy: sandbox` und `x-content-type-options: nosniff`.
- Commit je Task, kein Push. Vor jedem Commit `pnpm typecheck` und `pnpm --filter @kompass/app test` grün; bei E2E-Tasks `pnpm --filter @kompass/app e2e -- media.spec.ts` (Playwright startet den Dev-Server auf 3100 selbst).
- Commit-Nachrichten englisch, Attributionszeilen der Sitzung am Ende.

---

### Task 1: Route `/media/[id]/preview`

**Files:**
- Create: `apps/kompass/src/app/media/[id]/preview/route.ts`
- Test: `apps/kompass/e2e/media.spec.ts`

**Interfaces:**
- Consumes: `getMediaPreview(deps, ctx, id)` → `Result<{ record, bytes: Uint8Array | null, contentType }>` (Plan 1, Task 2); `optionalSession`, `getDeps` wie in `apps/kompass/src/app/media/[id]/route.ts`.
- Produces: `GET /media/{id}/preview` → 401 ohne Sitzung, 404 bei unbekanntem Asset oder `bytes === null`, sonst Bytes mit `content-type` aus dem Dienst.

- [x] **Step 1: E2E-Fall schreiben**

In `apps/kompass/e2e/media.spec.ts` innerhalb von `test.describe('media library', …)` anhängen:

```ts
  test('serves a webp preview for an uploaded image, sandboxed', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'vorschau.png', mimeType: 'image/png', buffer: PNG });
    await page.getByRole('row', { name: /vorschau-/ }).click();
    const src = await page.getByRole('dialog').locator('img').getAttribute('src');
    const id = src!.split('/').at(-1)!;
    const response = await page.request.get(`/media/${id}/preview`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/webp');
    expect(response.headers()['content-security-policy']).toBe('sandbox');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    const missing = await page.request.get('/media/NOPE/preview');
    expect(missing.status()).toBe(404);
  });
```

Hinweis: Bis Plan 4 zeigt der Dialog noch `/media/{id}` als `src`; die ID am Ende des Pfads ist dieselbe. Nach Plan 4 lautet der `src` `/media/{id}/preview` — dann `src!.split('/').at(-2)!`. Schreib den Test so, dass beides geht:

```ts
    const id = src!.replace(/\/preview$/, '').split('/').at(-1)!;
```

- [x] **Step 2: Rot sehen**

```bash
pnpm --filter @kompass/app e2e -- media.spec.ts -g "webp preview"
```

Erwartung: FAIL, Status 404 statt 200 (Route existiert nicht).

- [x] **Step 3: Route schreiben**

```ts
// apps/kompass/src/app/media/[id]/preview/route.ts
import { getMediaPreview } from '@kompass/core';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

/** Die Vorschau eines Assets — Rechte wie das Original, Cache-Datei wird bei Bedarf gebaut. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const { id } = await ctx.params;
  const result = await getMediaPreview(getDeps(), session.ctx, id);
  if (!result.ok || result.value.bytes === null) return new Response(null, { status: 404 });
  return new Response(Buffer.from(result.value.bytes), {
    headers: {
      'content-type': result.value.contentType,
      'cache-control': 'private, max-age=3600',
      'content-length': String(result.value.bytes.byteLength),
      'content-security-policy': 'sandbox',
      'x-content-type-options': 'nosniff',
    },
  });
}
```

- [x] **Step 4: Grün sehen**

```bash
pnpm typecheck
pnpm --filter @kompass/app e2e -- media.spec.ts
```

Erwartung: alle Fälle grün.

- [x] **Step 5: Commit**

```bash
git add "apps/kompass/src/app/media/[id]/preview/route.ts" apps/kompass/e2e/media.spec.ts
git commit -m "feat(app): /media/{id}/preview serves the 320 px webp, sandboxed like the original"
```

---

### Task 2: `media-listing.ts` und Route `GET /media`

**Files:**
- Create: `apps/kompass/src/lib/media-listing.ts`
- Create: `apps/kompass/src/app/media/route.ts`
- Test: `apps/kompass/tests/media-listing.test.ts`

**Interfaces:**
- Consumes: `listMediaAssets`, `listMediaFolders`, `mediaListFilterSchema`, `MediaListFilter`, `Result` aus `@kompass/core`.
- Produces:
  ```ts
  export interface MediaListingItem { id: string; filename: string; mimeType: string; bytes: number; width: number | null; height: number | null; createdAt: string; folder: string | null; references: { label: string; href?: string }[] }
  export interface MediaListing { items: MediaListingItem[]; folders: { path: string; assetCount: number }[] }
  export function parseMediaListParams(params: URLSearchParams): MediaListFilter | null   // null = ungültig
  export async function buildMediaListing(deps: Deps, ctx: CallContext, filter: MediaListFilter): Promise<Result<MediaListing>>
  ```
  `GET /media?folder=&query=&kind=&sort=` → JSON `MediaListing`; 401 ohne Sitzung, 400 bei ungültigen Parametern, 403 ohne `media.upload`. `folder=` (leer) heißt ohne Ordner, weggelassen heißt alle.

- [x] **Step 1: Test schreiben**

```ts
// apps/kompass/tests/media-listing.test.ts
import { createMediaFolder, storeMediaAsset, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { buildMediaListing, parseMediaListParams } from '@/lib/media-listing';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>');

describe('parseMediaListParams', () => {
  it('maps the query string onto the filter: empty folder is root, omitted is all', () => {
    expect(parseMediaListParams(new URLSearchParams(''))).toEqual({});
    expect(parseMediaListParams(new URLSearchParams('folder='))).toEqual({ folder: null });
    expect(parseMediaListParams(new URLSearchParams('folder=Tiere%2F2026&query=rex&kind=image&sort=name'))).toEqual({ folder: 'Tiere/2026', query: 'rex', kind: 'image', sort: 'name' });
  });

  it('rejects unknown values', () => {
    expect(parseMediaListParams(new URLSearchParams('kind=video'))).toBeNull();
    expect(parseMediaListParams(new URLSearchParams('sort=random'))).toBeNull();
  });
});

describe('buildMediaListing', () => {
  it('returns items with usage and the folder list, and refuses without the permission', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    unwrap(await createMediaFolder(deps, ctx, { path: 'Bilder' }));
    const a = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'a.png', bytes: PNG, folder: 'Bilder' }));
    unwrap(await storeMediaAsset(deps, ctx, { originalName: 'b.svg', bytes: SVG, declaredMimeType: 'image/svg+xml' }));

    const all = unwrap(await buildMediaListing(deps, ctx, {}));
    expect(all.items).toHaveLength(2);
    expect(all.folders).toEqual([{ path: 'Bilder', assetCount: 1 }]);
    const inFolder = unwrap(await buildMediaListing(deps, ctx, { folder: 'Bilder' }));
    expect(inFolder.items.map((i) => i.id)).toEqual([a.id]);
    expect(inFolder.items[0]).toMatchObject({ filename: a.filename, mimeType: 'image/png', folder: 'Bilder', references: [] });

    const denied = await buildMediaListing(deps, ctxWith([], 'someone'), {});
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
  });
});
```

- [x] **Step 2: Rot sehen**

```bash
pnpm --filter @kompass/app exec vitest run tests/media-listing
```

Erwartung: FAIL, Modul fehlt.

- [x] **Step 3: Implementierung**

```ts
// apps/kompass/src/lib/media-listing.ts
import { listMediaAssets, listMediaFolders, mediaListFilterSchema, ok, type CallContext, type Deps, type MediaListFilter, type Result } from '@kompass/core';

export interface MediaListingItem {
  id: string;
  filename: string;
  mimeType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  folder: string | null;
  references: { label: string; href?: string }[];
}

export interface MediaListing {
  items: MediaListingItem[];
  folders: { path: string; assetCount: number }[];
}

/**
 * Die Query-Parameter von `GET /media` als Filter. `folder=` (leer) heißt ohne
 * Ordner, weggelassen heißt alle — die Suchparameter kennen kein `null`.
 * `null` zurück heißt: ungültige Werte, der Handler antwortet 400.
 */
export function parseMediaListParams(params: URLSearchParams): MediaListFilter | null {
  const raw: Record<string, unknown> = {};
  if (params.has('folder')) raw.folder = params.get('folder') === '' ? null : params.get('folder');
  if (params.get('query')) raw.query = params.get('query');
  if (params.has('kind')) raw.kind = params.get('kind');
  if (params.has('sort')) raw.sort = params.get('sort');
  const parsed = mediaListFilterSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Was der Auswahl-Dialog braucht: die gefilterte Liste und alle Ordner, in einer Antwort. */
export async function buildMediaListing(deps: Deps, ctx: CallContext, filter: MediaListFilter): Promise<Result<MediaListing>> {
  const assets = await listMediaAssets(deps, ctx, filter);
  if (!assets.ok) return assets;
  const folders = await listMediaFolders(deps, ctx);
  if (!folders.ok) return folders;
  return ok({
    items: assets.value.map(({ record, references }) => ({
      id: record.id,
      filename: record.filename,
      mimeType: record.mimeType,
      bytes: record.bytes,
      width: record.width,
      height: record.height,
      createdAt: record.createdAt,
      folder: record.folder,
      references: references.map((r) => (r.href ? { label: r.label, href: r.href } : { label: r.label })),
    })),
    folders: folders.value,
  });
}
```

Prüfe, dass `CallContext`, `Deps`, `MediaListFilter`, `Result`, `ok` aus `@kompass/core` exportiert sind (`packages/core/src/index.ts`); `MediaListFilter` kommt über `export * from './media/service'` mit.

```ts
// apps/kompass/src/app/media/route.ts
import { buildMediaListing, parseMediaListParams } from '@/lib/media-listing';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

/** Die Mediathek als JSON für den Auswahl-Dialog. Kein Cache: Jeder Upload ändert die Liste. */
export async function GET(request: Request): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const filter = parseMediaListParams(new URL(request.url).searchParams);
  if (!filter) return new Response(null, { status: 400 });
  const result = await buildMediaListing(getDeps(), session.ctx, filter);
  if (!result.ok) return new Response(null, { status: result.error.type === 'forbidden' ? 403 : 500 });
  return Response.json(result.value, { headers: { 'cache-control': 'no-store' } });
}
```

- [x] **Step 4: Grün sehen**

```bash
pnpm --filter @kompass/app exec vitest run tests/media-listing
pnpm typecheck
```

- [x] **Step 5: E2E-Rauchtest der Route**

In `apps/kompass/e2e/media.spec.ts` anhängen:

```ts
  test('GET /media answers the listing as JSON and refuses bad parameters', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'json.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('row', { name: /json-/ })).toBeVisible();
    const ok = await page.request.get('/media?query=json&sort=name');
    expect(ok.status()).toBe(200);
    const body = (await ok.json()) as { items: { filename: string }[]; folders: unknown[] };
    expect(body.items.map((i) => i.filename)).toEqual([expect.stringMatching(/^json-/)]);
    expect((await page.request.get('/media?kind=video')).status()).toBe(400);
  });
```

```bash
pnpm --filter @kompass/app e2e -- media.spec.ts
```

Erwartung: grün.

- [x] **Step 6: Commit**

```bash
git add apps/kompass/src/lib/media-listing.ts apps/kompass/src/app/media/route.ts apps/kompass/tests/media-listing.test.ts apps/kompass/e2e/media.spec.ts
git commit -m "feat(app): GET /media hands the chooser the filtered listing and the folders as JSON"
```

---

### Task 3: `uploadMediaAction` meldet `{ id, filename, folder, created }`

**Files:**
- Modify: `apps/kompass/src/app/(shell)/admin/media/actions.ts:9-31`

**Interfaces:**
- Produces: `uploadMediaAction(formData): Promise<ActionState>`; bei Erfolg `data: { id: string; filename: string; folder: string | null; created: boolean }`. Meldung wie bisher (`media.uploaded` bzw. `media.alreadyStored`).

- [ ] **Step 1: Die Rückgabe umstellen**

In `uploadMediaAction` die letzte Zeile ersetzen:

```ts
  return { status: 'success', message, data: { id: record.id, filename: record.filename, folder: record.folder, created } };
```

Die Mediathek-Seite liest `data` nicht (sie lädt neu); der Dialog in Task 4 liest `id` und `created`.

- [ ] **Step 2: Prüfen und committen**

```bash
pnpm typecheck
pnpm --filter @kompass/app e2e -- media.spec.ts -g "dedup"
git add "apps/kompass/src/app/(shell)/admin/media/actions.ts"
git commit -m "refactor(app): the media upload action returns id, folder and whether the bytes were new"
```

---

### Task 4: Grid nach `components/media/`, `MediaChooserDialog`

**Files:**
- Create: `apps/kompass/src/components/media/asset-grid.tsx` (verschoben und erweitert aus `admin/media/asset-grid.tsx`)
- Create: `apps/kompass/src/components/media/media-chooser-dialog.tsx`
- Delete: `apps/kompass/src/app/(shell)/admin/media/asset-grid.tsx`
- Modify: `apps/kompass/src/app/(shell)/admin/media/library-client.tsx` (Import des Grids)
- Modify: `apps/kompass/src/lib/preferences.ts` (`mediaChooserFolder`)
- Modify: `apps/kompass/messages/de.json` (`media.chooser.*`, `media.search`, `media.sort.*`)

**Interfaces:**
- Consumes: `GET /media` (Task 2), `uploadMediaAction` (Task 3), `flattenFolderTree` aus `admin/media/folder-tree-model.ts`, `usePreference`.
- Produces:
  ```ts
  // asset-grid.tsx
  export interface GridItem { id: string; filename: string; mimeType: string; used: boolean }
  export function AssetGrid(props: { items: GridItem[]; selected?: ReadonlySet<string>; onOpen: (item: GridItem) => void; previewSrc?: (id: string) => string })
  // media-chooser-dialog.tsx
  export interface MediaChooserDialogProps { open: boolean; onOpenChange: (open: boolean) => void; kind: 'image' | 'pdf'; multiple: boolean; selected: string[]; onConfirm: (ids: string[]) => void }
  export function MediaChooserDialog(props: MediaChooserDialogProps)
  ```
  `previewSrc` hat die Vorgabe `(id) => `/media/${id}/preview``; die Mediathek-Seite übergibt in Plan 4 nichts anderes mehr, bis dahin nutzt sie die Vorgabe ebenfalls (die Vorschau-Route existiert seit Task 1).

- [ ] **Step 1: Übersetzungen anlegen**

In `apps/kompass/messages/de.json` unter `media` ergänzen (bestehende Schlüssel bleiben):

```json
    "search": "Suchen",
    "searchPlaceholder": "Dateiname oder Verwendung",
    "sort": {
      "label": "Sortierung",
      "newest": "Neueste zuerst",
      "oldest": "Älteste zuerst",
      "name": "Name",
      "size": "Größe"
    },
    "chooser": {
      "titleImage": "Bild wählen",
      "titlePdf": "Datei wählen",
      "titleMultiple": "Bilder wählen",
      "upload": "Hochladen",
      "confirm": "Übernehmen",
      "cancel": "Abbrechen",
      "selectedCount": "{count, plural, =0 {Nichts ausgewählt} one {# ausgewählt} other {# ausgewählt}}",
      "emptyTitle": "Keine passende Datei",
      "empty": "Laden Sie eine Datei hoch oder ändern Sie Suche und Ordner.",
      "loadFailed": "Die Mediathek konnte nicht geladen werden.",
      "select": "Auswählen",
      "selected": "Ausgewählt"
    },
```

- [ ] **Step 2: Präferenz ergänzen**

In `apps/kompass/src/lib/preferences.ts` in `Prefs` und `DEFAULTS`:

```ts
  /** Der zuletzt im Auswahl-Dialog geöffnete Ordner; null = Alle Dateien. */
  mediaChooserFolder: string | null;
```
```ts
  mediaChooserFolder: null,
```

- [ ] **Step 3: Grid verschieben und erweitern**

`git mv "apps/kompass/src/app/(shell)/admin/media/asset-grid.tsx" apps/kompass/src/components/media/asset-grid.tsx`, dann Inhalt ersetzen:

```tsx
'use client';

import { useTranslations } from 'next-intl';

export interface GridItem {
  id: string;
  filename: string;
  mimeType: string;
  used: boolean;
}

/**
 * Die Kacheln der Mediathek — Vorschau, Dateiname, Verwendungs-Marke. Dieselbe
 * Komponente zeigt die Mediathek-Seite und der Auswahl-Dialog; der Dialog gibt
 * `selected` mit, damit angehakte Kacheln als solche erscheinen.
 */
export function AssetGrid({
  items,
  selected,
  onOpen,
  previewSrc = (id) => `/media/${id}/preview`,
}: {
  items: GridItem[];
  selected?: ReadonlySet<string>;
  onOpen: (item: GridItem) => void;
  previewSrc?: (id: string) => string;
}) {
  const t = useTranslations('media');
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
      {items.map((it) => {
        const isSelected = selected?.has(it.id) ?? false;
        return (
          <li key={it.id}>
            <button
              type="button"
              onClick={() => onOpen(it)}
              aria-pressed={selected ? isSelected : undefined}
              className={`flex w-full flex-col overflow-hidden rounded-md border bg-surface text-left hover:border-line-strong ${isSelected ? 'border-brand ring-2 ring-brand' : 'border-line'}`}
            >
              <span className="grid aspect-square place-items-center bg-surface-2">
                {it.mimeType.startsWith('image/') ? (
                  <img src={previewSrc(it.id)} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  <span className="text-[20px] font-semibold uppercase text-ink-2">{it.filename.split('.').at(-1)}</span>
                )}
              </span>
              <span className="flex items-center justify-between gap-1 px-2 py-1.5 text-[12px]">
                <span className="truncate font-mono">{it.filename}</span>
                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${it.used ? 'bg-neutral-badge text-neutral-badge-ink' : 'text-ink-2'}`}>
                  {selected && isSelected ? t('chooser.selected') : it.used ? t('used') : t('unused')}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

Prüfe, dass `border-brand` und `ring-brand` als Theme-Klassen existieren (`grep -rn "border-brand" apps/kompass/src | head`); `photos-editor.tsx` nutzt `border-brand` bereits. Gibt es `ring-brand` nicht, nimm nur `border-brand` und `border-2`.

In `admin/media/library-client.tsx`: Import `./asset-grid` → `@/components/media/asset-grid`, und der Aufruf wird

```tsx
          <AssetGrid items={items.map((it) => ({ id: it.id, filename: it.filename, mimeType: it.mimeType, used: it.references.length > 0 }))} onOpen={(it) => setDetailId(it.id)} />
```

- [ ] **Step 4: Der Dialog**

```tsx
// apps/kompass/src/components/media/media-chooser-dialog.tsx
'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { uploadMediaAction } from '@/app/(shell)/admin/media/actions';
import { flattenFolderTree } from '@/app/(shell)/admin/media/folder-tree-model';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { MediaListing } from '@/lib/media-listing';
import { usePreference } from '@/lib/preferences';
import { AssetGrid } from './asset-grid';

export interface MediaChooserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Was das Feld nimmt — der Dialog zeigt nur das. */
  kind: 'image' | 'pdf';
  multiple: boolean;
  /** Bereits gewählte IDs; bei multiple vorab angehakt, bei single nur markiert. */
  selected: string[];
  onConfirm: (ids: string[]) => void;
}

const ACCEPT = { image: 'image/png,image/jpeg,image/webp,image/svg+xml', pdf: 'application/pdf' } as const;
type Sort = 'newest' | 'oldest' | 'name' | 'size';
const SORTS: Sort[] = ['newest', 'oldest', 'name', 'size'];

/**
 * Die Mediathek in klein: Ordner links, Kacheln rechts, Suche und Upload oben.
 * Einzelauswahl: Klick auf die Kachel übernimmt sofort. Mehrfachauswahl: Häkchen
 * und „Übernehmen“. Ein Upload landet im offenen Ordner und wird ausgewählt.
 */
export function MediaChooserDialog({ open, onOpenChange, kind, multiple, selected, onConfirm }: MediaChooserDialogProps) {
  const t = useTranslations('media');
  const [folder, setFolder] = usePreference('mediaChooserFolder');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [listing, setListing] = useState<MediaListing | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(selected));
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Beim Öffnen den Stand des Feldes übernehmen.
  useEffect(() => {
    if (open) setPicked(new Set(selected));
  }, [open, selected]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (folder !== null) params.set('folder', folder);
    if (query.trim()) params.set('query', query.trim());
    params.set('kind', kind);
    params.set('sort', sort);
    try {
      const res = await fetch(`/media?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setListing((await res.json()) as MediaListing);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [folder, query, kind, sort]);

  // Laden beim Öffnen und bei jeder Änderung; die Suche entprellt.
  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => void load(), query ? 300 : 0);
    return () => clearTimeout(handle);
  }, [open, load, query]);

  const tree = useMemo(() => flattenFolderTree(listing?.folders ?? []), [listing]);
  const items = useMemo(() => (listing?.items ?? []).map((it) => ({ id: it.id, filename: it.filename, mimeType: it.mimeType, used: it.references.length > 0 })), [listing]);

  const choose = (id: string) => {
    if (!multiple) {
      onConfirm([id]);
      onOpenChange(false);
      return;
    }
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const upload = async (files: FileList) => {
    setUploading(true);
    try {
      let last: string | null = null;
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.set('file', file);
        if (folder) fd.set('folder', folder);
        const state = await uploadMediaAction(fd);
        if (state.status === 'error') {
          toast.error(state.message);
          continue;
        }
        if (state.status === 'success') {
          const data = state.data as { id: string; created: boolean };
          if (!data.created && state.message) toast.info(state.message);
          last = data.id;
          if (multiple) setPicked((p) => new Set(p).add(data.id));
        }
      }
      await load();
      if (!multiple && last) {
        onConfirm([last]);
        onOpenChange(false);
      }
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const title = multiple ? t('chooser.titleMultiple') : kind === 'pdf' ? t('chooser.titlePdf') : t('chooser.titleImage');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogTitle>{title}</DialogTitle>

        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('search')}
            className="min-w-0 flex-1"
          />
          <label className="flex items-center gap-2 text-ink-2">
            {t('sort.label')}
            <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="w-auto">
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`sort.${s}`)}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-2 text-ink-2">
            {t('chooser.upload')}
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT[kind]}
              multiple
              disabled={uploading}
              aria-label={t('chooser.upload')}
              className="text-[12px]"
              onChange={(e) => e.target.files && e.target.files.length > 0 && void upload(e.target.files)}
            />
            {uploading ? <span aria-live="polite">{t('uploading')}</span> : null}
          </label>
        </div>

        <div className="flex gap-4">
          <nav className="w-48 shrink-0 text-[13px]" aria-label={t('folder')}>
            <button type="button" onClick={() => setFolder(null)} className={`block w-full rounded px-2 py-1 text-left ${folder === null ? 'bg-selected text-selected-ink' : 'hover:bg-row-hover'}`}>
              {t('root')}
            </button>
            {tree.map((node) => (
              <button
                key={node.path}
                type="button"
                onClick={() => setFolder(node.path)}
                className={`block w-full rounded px-2 py-1 text-left ${folder === node.path ? 'bg-selected text-selected-ink' : 'hover:bg-row-hover'}`}
                style={{ paddingLeft: `${0.5 + node.depth * 0.75}rem` }}
              >
                {node.name} <span className="text-ink-2">({node.assetCount})</span>
              </button>
            ))}
          </nav>

          <div className="max-h-[55vh] min-w-0 flex-1 overflow-y-auto">
            {failed ? (
              <p role="alert" className="text-[13px] text-error">{t('chooser.loadFailed')}</p>
            ) : listing && items.length === 0 ? (
              <EmptyState title={t('chooser.emptyTitle')} text={t('chooser.empty')} />
            ) : (
              <AssetGrid items={items} selected={multiple ? picked : new Set(selected)} onOpen={(it) => choose(it.id)} />
            )}
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between gap-3">
          {multiple ? <span className="text-[13px] text-ink-2">{t('chooser.selectedCount', { count: picked.size })}</span> : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('chooser.cancel')}
            </Button>
            {multiple ? (
              <Button
                type="button"
                onClick={() => {
                  onConfirm([...picked]);
                  onOpenChange(false);
                }}
              >
                {t('chooser.confirm')}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Prüfe `DialogFooter` in `apps/kompass/src/components/ui/dialog.tsx` (exportiert, siehe Zeile 162 ff.). Gibt es `toast.info` in `sonner` nicht in der eingesetzten Version, nimm `toast.message`.

- [ ] **Step 5: Prüfen**

```bash
pnpm typecheck
pnpm --filter @kompass/app test
pnpm --filter @kompass/app e2e -- media.spec.ts
```

Erwartung: grün. `message-keys.test.ts` findet `chooser.*`, `sort.*`, `search*`; `no-hardcoded-ui-text.test.ts` sieht keine Literale (die einzigen Strings sind Klassen, `accept` und URL-Teile). Der Dialog wird in diesem Plan noch nirgends eingebaut — der Browsertest folgt in Plan 3 mit dem ersten Formular.

- [ ] **Step 6: Commit**

```bash
git add apps/kompass/src/components/media/asset-grid.tsx apps/kompass/src/components/media/media-chooser-dialog.tsx "apps/kompass/src/app/(shell)/admin/media/library-client.tsx" apps/kompass/src/lib/preferences.ts apps/kompass/messages/de.json
git rm -q --cached "apps/kompass/src/app/(shell)/admin/media/asset-grid.tsx" 2>/dev/null; true
git commit -m "feat(app): a media chooser dialog — folders, search, sort, upload into the open folder, single or multiple selection"
```

(`git mv` hat die Verschiebung bereits gestaged; der `git rm --cached` ist nur ein Netz, falls die Datei anders verschoben wurde.)

---

## Self-Review

**Spec §3 Route:** Task 1 (Status, Header, Content-Type aus dem Dienst). **§5:** Task 2 (`GET /media`, Parameter, 401/400/403, kein Cache). **§6:** Task 4 deckt Aufbau, Laden mit Entprellung, Upload im offenen Ordner mit Auswahl und Dedup-Meldung, Einzel- und Mehrfachauswahl, Präferenz für den Ordner, Leerzustand; `uploadMediaAction` mit `{ id, created }` ist Task 3.
**Typkonsistenz:** `MediaListing` aus Task 2 wird in Task 4 importiert; `GridItem.used` in Grid und Dialog; `previewSrc`-Vorgabe zeigt auf die Route aus Task 1; `flattenFolderTree` liefert `{ path, name, depth, assetCount }` wie in `folder-tree-model.ts`.
**Offen für Plan 4:** Die Mediathek-Seite nutzt das Grid schon mit der Vorschau-Vorgabe; Liste und Dialog dort stellen erst in Plan 4 um.
