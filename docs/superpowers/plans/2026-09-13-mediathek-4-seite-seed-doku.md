# Mediathek Auswahl und Vorschau, Plan 4: Mediathek-Seite, Seed, Doku

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Mediathek-Seite bekommt Suche, Sortierung und Typfilter in der URL, Vorschaubilder statt Originale, Spalten Ordner und Datum, verlinkte Fundstellen und einen Öffnen-Link; die Wurzel heißt am Asset „Ohne Ordner“. Ein Kern-Seed legt Ordner und Beispieldateien an. Die Doku zieht nach.

**Architecture:** Die Seite bleibt serverseitig: `page.tsx` liest `folder`, `q`, `kind`, `sort` aus den Suchparametern, ruft `listMediaAssets` mit dem Filter und reicht `references` als `{ label, href? }[]` weiter. Die Werkzeugleiste ist ein `<form method="get">`. Der Seed erzeugt Bilder mit `sharp`, ein PDF und ein SVG als Konstanten.

**Tech Stack:** Next 16 Server Components, next-intl, `sharp`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-13-mediathek-auswahl-und-vorschau-design.md`, §8, §9, Doku-Teile aus §3 und §11.

## Global Constraints

- Setzt Plan 1 bis 3 voraus.
- Kein UI-Text im Code; alle Beschriftungen in `apps/kompass/messages/de.json`.
- Seed-Regeln aus AGENTS.md: erfundene Beispiele, idempotent, Varianten der wichtigen Zustände, Test daneben. Kein Binärmaterial im Repo.
- Commit je Task, kein Push. Vor jedem Commit `pnpm typecheck` und die genannten Tests grün. Am Ende des Plans `pnpm verify`, weil Seed und Seite den zweiten und dritten Prüfring berühren.
- Commit-Nachrichten englisch, Attributionszeilen der Sitzung am Ende.

---

### Task 1: Werkzeugleiste, Spalten, Vorschau, Links, „Öffnen“, „Ohne Ordner“

**Files:**
- Modify: `apps/kompass/src/app/(shell)/admin/media/page.tsx`
- Modify: `apps/kompass/src/app/(shell)/admin/media/library-client.tsx`
- Modify: `apps/kompass/src/app/(shell)/admin/media/asset-detail-dialog.tsx`
- Modify: `apps/kompass/src/app/(shell)/admin/media/types.ts`
- Modify: `apps/kompass/src/app/(shell)/admin/media/folder-tree.tsx` (Links behalten die übrigen Parameter)
- Modify: `apps/kompass/src/app/(shell)/admin/media/actions.ts` (`media.rootFolder` → `media.noFolder`)
- Modify: `apps/kompass/messages/de.json`
- Test: `apps/kompass/e2e/media.spec.ts`

**Interfaces:**
- Consumes: `listMediaAssets(deps, ctx, { folder?, query?, kind?, sort? })`, `mediaListFilterSchema`, `MediaReference.href`, `AssetGrid` aus `components/media/asset-grid.tsx`, `useDateFormat`.
- Produces: `Item.references: { label: string; href?: string }[]`; URL-Parameter `folder`, `q`, `kind` (`all | image | pdf`), `sort` (`newest | oldest | name | size`).

- [x] **Step 1: E2E schreiben**

In `apps/kompass/e2e/media.spec.ts` anhängen:

```ts
  test('searches by usage, filters by kind, sorts by name, and links the usage', async ({ page }) => {
    // Ein Hund mit Foto — die Suche soll ihn über das Verwendungs-Label finden.
    await page.goto('/animals');
    await page.getByRole('link', { name: 'Tier anlegen' }).click();
    await page.getByLabel('Slug (URL-Teil)').fill('rex');
    await page.getByLabel('Name').fill('Rex');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/animals\/[A-Z0-9]+$/);
    const animalUrl = page.url();
    await page.getByRole('tab', { name: 'Fotos' }).click();
    await page.getByRole('button', { name: 'Fotos wählen' }).click();
    const chooser = page.getByRole('dialog', { name: 'Bilder wählen' });
    await chooser.getByLabel('Hochladen').setInputFiles({ name: 'rex-foto.png', mimeType: 'image/png', buffer: PNG });
    await chooser.getByRole('button', { name: 'Übernehmen' }).click();
    await page.getByRole('button', { name: 'Fotos speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Fotos gespeichert');

    // Ein PDF für den Typfilter
    await page.goto('/admin/media');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'satzung.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(page.getByRole('row', { name: /satzung-/ })).toBeVisible();

    await page.getByLabel('Suchen').fill('Rex');
    await page.getByRole('button', { name: 'Filtern' }).click();
    await expect(page).toHaveURL(/q=Rex/);
    await expect(page.getByRole('row', { name: /rex-foto-/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /satzung-/ })).toHaveCount(0);

    await page.goto('/admin/media?kind=pdf');
    await expect(page.getByRole('row', { name: /satzung-/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /rex-foto-/ })).toHaveCount(0);

    await page.goto('/admin/media?sort=name');
    const names = await page.locator('tbody tr td:first-child').allInnerTexts();
    expect(names.map((n) => n.trim())).toEqual([...names.map((n) => n.trim())].sort((a, b) => a.localeCompare(b)));

    await page.goto('/admin/media');
    await page.getByRole('row', { name: /rex-foto-/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('link', { name: 'Öffnen' })).toHaveAttribute('href', /^\/media\/[0-9A-Z]{26}$/);
    await dialog.getByRole('link', { name: 'Tier „Rex“' }).click();
    await expect(page).toHaveURL(animalUrl);
  });

  test('a file without a folder says so, and the list shows folder and date', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'lose.png', mimeType: 'image/png', buffer: PNG });
    const row = page.getByRole('row', { name: /lose-/ });
    await expect(row).toContainText('Ohne Ordner');
    await row.click();
    await expect(page.getByRole('dialog')).toContainText('Ohne Ordner');
  });
```

`PDF` als Konstante neben `PNG`:

```ts
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\nxref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF');
```

Der Dedup-Fall aus dem Fork („dedup“, Meldung `im Ordner „bilder“`) bleibt; sein zweiter Teil prüft die Wurzel nicht. Der Fall „Alle Dateien shows files from every folder“ bleibt.

Pflichtfelder des Tierformulars aus `animals.spec.ts` übernehmen.

- [x] **Step 2: Rot sehen**

```bash
pnpm --filter @kompass/app e2e -- media.spec.ts
```

- [x] **Step 3: Übersetzungen**

`de.json`, `media`: `"rootFolder": "Wurzel"` → `"noFolder": "Ohne Ordner"`; ergänzen:

```json
    "filter": "Filtern",
    "kind": { "label": "Typ", "all": "Alle", "image": "Bilder", "pdf": "PDF" },
    "columns": { "file": "Datei", "folder": "Ordner", "size": "Größe", "uploadedAt": "Hochgeladen", "usage": "Verwendung" },
    "open": "Öffnen",
```

(`columns` ersetzt den bestehenden Block; `search`, `searchPlaceholder`, `sort.*` sind seit Plan 2 da.)

In `actions.ts`: `t('media.rootFolder')` → `t('media.noFolder')`.

- [x] **Step 4: `types.ts`**

```ts
export interface Reference {
  label: string;
  href?: string;
}

export interface Item {
  id: string;
  filename: string;
  mimeType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  uploadedBy: string | null;
  folder: string | null;
  references: Reference[];
}

export interface Folder {
  path: string;
  assetCount: number;
}

export interface ListQuery {
  folder: string | null;
  q: string;
  kind: 'all' | 'image' | 'pdf';
  sort: 'newest' | 'oldest' | 'name' | 'size';
}

/** Die URL der Mediathek für einen Zustand; leere Werte fallen weg. */
export function mediaHref(query: ListQuery): string {
  const params = new URLSearchParams();
  if (query.folder !== null) params.set('folder', query.folder);
  if (query.q) params.set('q', query.q);
  if (query.kind !== 'all') params.set('kind', query.kind);
  if (query.sort !== 'newest') params.set('sort', query.sort);
  const s = params.toString();
  return s ? `/admin/media?${s}` : '/admin/media';
}

export function formatBytes(b: number): string {
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
}
```

`kb` durch `formatBytes` ersetzen (in `library-client.tsx` und `asset-detail-dialog.tsx`). Ein Vitest für `mediaHref` und `formatBytes` in `apps/kompass/tests/media-href.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatBytes, mediaHref } from '@/app/(shell)/admin/media/types';

describe('mediaHref', () => {
  it('writes only what differs from the default', () => {
    expect(mediaHref({ folder: null, q: '', kind: 'all', sort: 'newest' })).toBe('/admin/media');
    expect(mediaHref({ folder: 'Tiere/2026', q: 'rex', kind: 'image', sort: 'name' })).toBe('/admin/media?folder=Tiere%2F2026&q=rex&kind=image&sort=name');
  });
});

describe('formatBytes', () => {
  it('shows KB below a megabyte and MB with one decimal above', () => {
    expect(formatBytes(500)).toBe('1 KB');
    expect(formatBytes(300 * 1024)).toBe('300 KB');
    expect(formatBytes(5 * 1024 * 1024 + 200 * 1024)).toBe('5,2 MB');
  });
});
```

- [x] **Step 5: `page.tsx`**

```tsx
import { listMediaAssets, listMediaFolders, mediaListFilterSchema, requirePermission, schema, unwrap } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { LibraryClient } from './library-client';
import type { ListQuery } from './types';

type Params = { folder?: string; q?: string; kind?: string; sort?: string };

/** Unbekannte Werte fallen auf die Vorgabe zurück — eine getippte URL soll die Seite nie brechen. */
function readQuery(params: Params): ListQuery {
  const kind = params.kind === 'image' || params.kind === 'pdf' ? params.kind : 'all';
  const parsed = mediaListFilterSchema.safeParse({ sort: params.sort });
  const sort = parsed.success && parsed.data.sort ? parsed.data.sort : 'newest';
  return { folder: params.folder ?? null, q: (params.q ?? '').trim().slice(0, 200), kind, sort };
}

export default async function MediaPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'media.upload')) return <ForbiddenCard permission="media.upload" />;
  const t = await getTranslations('media');
  const query = readQuery(await searchParams);

  const names = new Map(deps.db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).all().map((u) => [u.id, u.name]));
  const folders = unwrap(await listMediaFolders(deps, ctx));
  const items = unwrap(
    await listMediaAssets(deps, ctx, {
      ...(query.folder !== null ? { folder: query.folder } : {}),
      ...(query.q ? { query: query.q } : {}),
      ...(query.kind !== 'all' ? { kind: query.kind } : {}),
      sort: query.sort,
    }),
  ).map((it) => ({
    id: it.record.id,
    filename: it.record.filename,
    mimeType: it.record.mimeType,
    bytes: it.record.bytes,
    width: it.record.width,
    height: it.record.height,
    createdAt: it.record.createdAt,
    uploadedBy: it.record.uploadedByUserId ? (names.get(it.record.uploadedByUserId) ?? null) : null,
    folder: it.record.folder,
    references: it.references.map((r) => (r.href ? { label: r.label, href: r.href } : { label: r.label })),
  }));

  return (
    <>
      <PageHeader title={t('title')} />
      <LibraryClient query={query} folders={folders} items={items} />
    </>
  );
}
```

- [x] **Step 6: `folder-tree.tsx`**

Die Signatur wird `{ query, folders, run }` mit `query: ListQuery`; `current` ist `query.folder`. `folderHref(path)` wird `mediaHref({ ...query, folder: path })`, damit Suche und Sortierung beim Ordnerwechsel bleiben. Nach Umbenennen: `router.push(mediaHref({ ...query, folder: parent + seg }))`; nach Löschen: `router.push(mediaHref({ ...query, folder: null }))`. Alle Vorkommen von `current` im Datei-Rumpf auf `query.folder` umstellen (`const current = query.folder;` am Anfang der Komponente reicht).

- [x] **Step 7: `library-client.tsx`**

Props: `{ query: ListQuery; folders: Folder[]; items: Item[] }`. Über der Liste, neben Upload und Umschalter, die Werkzeugleiste als GET-Formular; die Liste bekommt die Spalten Ordner und Hochgeladen, Zeilen einen fokussierbaren Knopf, Vorschau statt Original:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { AssetGrid } from '@/components/media/asset-grid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { ActionState } from '@/lib/actions';
import { usePreference } from '@/lib/preferences';
import { AssetDetailDialog } from './asset-detail-dialog';
import { FolderTree } from './folder-tree';
import { formatBytes, type Folder, type Item, type ListQuery } from './types';
import { deleteMediaAction, moveMediaAction, uploadMediaAction } from './actions';

const KINDS = ['all', 'image', 'pdf'] as const;
const SORTS = ['newest', 'oldest', 'name', 'size'] as const;

export function LibraryClient({ query, folders, items }: { query: ListQuery; folders: Folder[]; items: Item[] }) {
  const t = useTranslations('media');
  const fmt = useDateFormat();
  const router = useRouter();
  const [view, setView] = usePreference('mediaView');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [, start] = useTransition();
  const current = query.folder;

  const detail = items.find((it) => it.id === detailId) ?? null;

  const run = async (p: Promise<ActionState>) => {
    const s = await p;
    if (s.status === 'error') toast.error(s.message);
    else if (s.status === 'success') {
      if (s.message) toast.success(s.message);
      start(() => router.refresh());
    }
    return s;
  };

  const move = async (id: string, folder: string | null) => {
    const s = await run(moveMediaAction(id, folder));
    if (s.status === 'success') setDetailId(null);
  };

  const requestDelete = (id: string) => {
    setDetailId(null);
    setConfirmId(id);
  };

  return (
    <div className="flex gap-6">
      <FolderTree query={query} folders={folders} run={run} />

      <div className="min-w-0 flex-1">
        <form method="get" action="/admin/media" className="mb-3 flex flex-wrap items-center gap-3 text-[13px]">
          {current !== null ? <input type="hidden" name="folder" value={current} /> : null}
          <Input type="search" name="q" defaultValue={query.q} placeholder={t('searchPlaceholder')} aria-label={t('search')} className="min-w-0 flex-1" />
          <label className="flex items-center gap-2 text-ink-2">
            {t('kind.label')}
            <Select name="kind" defaultValue={query.kind} className="w-auto">
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}`)}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-2 text-ink-2">
            {t('sort.label')}
            <Select name="sort" defaultValue={query.sort} className="w-auto">
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`sort.${s}`)}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" size="sm" variant="secondary">
            {t('filter')}
          </Button>
        </form>

        <div className="mb-4 flex items-center justify-between gap-4">
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            {t('upload')}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf"
              className="text-[12px]"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const fd = new FormData();
                fd.set('file', file);
                if (current) fd.set('folder', current);
                e.target.value = '';
                setUploading(true);
                void run(uploadMediaAction(fd)).finally(() => setUploading(false));
              }}
            />
            {uploading ? <span aria-live="polite">{t('uploading')}</span> : null}
          </label>
          <div className="flex overflow-hidden rounded-md border border-line text-[13px]">
            {(['list', 'grid'] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} className={`px-3 py-1 ${view === v ? 'bg-selected text-selected-ink' : 'hover:bg-row-hover'}`}>
                {t(`view.${v}`)}
              </button>
            ))}
          </div>
        </div>

        {items.length === 0 ? (
          <EmptyState title={t('emptyTitle')} text={t('empty')} />
        ) : view === 'grid' ? (
          <AssetGrid items={items.map((it) => ({ id: it.id, filename: it.filename, mimeType: it.mimeType, used: it.references.length > 0 }))} onOpen={(it) => setDetailId(it.id)} />
        ) : (
          <table className="w-full text-[14px]">
            <thead className="text-left text-ink-2">
              <tr>
                <th className="py-2">{t('columns.file')}</th>
                <th>{t('columns.folder')}</th>
                <th>{t('columns.size')}</th>
                <th>{t('columns.uploadedAt')}</th>
                <th>{t('columns.usage')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="h-[var(--row-h)] cursor-pointer border-b border-line-2 hover:bg-row-hover" onClick={() => setDetailId(it.id)}>
                  <td className="py-2">
                    <button type="button" className="flex items-center gap-2 text-left" onClick={(e) => { e.stopPropagation(); setDetailId(it.id); }}>
                      {it.mimeType.startsWith('image/') ? (
                        <img src={`/media/${it.id}/preview`} alt="" loading="lazy" className="size-8 shrink-0 rounded border border-line object-cover" />
                      ) : (
                        <span className="grid size-8 shrink-0 place-items-center rounded border border-line bg-surface-2 text-[10px] uppercase text-ink-2">{it.filename.split('.').at(-1)}</span>
                      )}
                      <span className="font-mono text-[13px]">{it.filename}</span>
                    </button>
                  </td>
                  <td className="text-ink-2">{it.folder ?? t('noFolder')}</td>
                  <td>{formatBytes(it.bytes)}</td>
                  <td className="text-ink-2">{fmt.date(it.createdAt)}</td>
                  <td>{it.references.length === 0 ? <span className="text-ink-2">{t('unused')}</span> : it.references.map((r) => r.label).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <AssetDetailDialog item={detail} folders={folders} assetFolder={detail?.folder ?? null} onOpenChange={(open) => !open && setDetailId(null)} onMove={move} onDelete={requestDelete} />

      <ConfirmDialog
        open={confirmId !== null}
        onOpenChange={(open) => !open && setConfirmId(null)}
        title={t('confirmDelete')}
        description={t('confirmDeleteBody')}
        confirmLabel={t('delete')}
        destructive
        action={async () => {
          if (!confirmId) return { status: 'idle' } as ActionState;
          const state = await deleteMediaAction(confirmId);
          if (state.status === 'success') start(() => router.refresh());
          setConfirmId(null);
          return state;
        }}
      />
    </div>
  );
}
```

Die Zeilen bleiben klickbar, der Knopf im Dateinamen macht sie zusätzlich per Tastatur erreichbar. Der E2E-Selektor `getByRole('row', { name: /…/ })` greift weiter, weil der Zeilenname aus dem Text der Zellen entsteht.

- [x] **Step 8: `asset-detail-dialog.tsx`**

Vorschau über `/media/${item.id}/preview`; `kb` → `formatBytes`; Ordnerzeile `assetFolder ?? t('noFolder')`; Verwendung als Links; „Öffnen“:

```tsx
              <dt className="text-ink-2">{t('columns.usage')}</dt>
              <dd>
                {item.references.length === 0 ? (
                  <span className="text-ink-2">{t('unused')}</span>
                ) : (
                  item.references.map((r, i) => (
                    <span key={`${r.label}-${i}`}>
                      {i > 0 ? ', ' : null}
                      {r.href ? <Link href={r.href} className="text-link underline">{r.label}</Link> : r.label}
                    </span>
                  ))
                )}
              </dd>
```

und in der Aktionsleiste vor dem Verschieben-Feld:

```tsx
              <a href={`/media/${item.id}`} target="_blank" rel="noopener" className="text-[13px] text-link underline">
                {t('open')}
              </a>
```

`import Link from 'next/link';` ergänzen. Die Zeile mit `t('root')` im Ordnerfeld wird `assetFolder ?? t('noFolder')`.

- [x] **Step 9: Grün sehen**

```bash
pnpm typecheck
pnpm --filter @kompass/app test
pnpm --filter @kompass/app e2e -- media.spec.ts
grep -rn "rootFolder\|'./asset-grid'\|kb(" "apps/kompass/src/app/(shell)/admin/media"
```

Erwartung: grün, kein Treffer.

- [x] **Step 10: Commit**

```bash
git add "apps/kompass/src/app/(shell)/admin/media" apps/kompass/messages/de.json apps/kompass/e2e/media.spec.ts apps/kompass/tests/media-href.test.ts
git commit -m "feat(app): the media library searches, filters by kind and sorts from the URL, shows previews, folder and date, links every usage and opens the file"
```

---

### Task 2: Kern-Seed für die Mediathek

**Files:**
- Create: `packages/core/src/seed/media.ts`
- Modify: `packages/core/src/seed/seed.ts` (Aufruf vor den Modul-Seeds)
- Test: `packages/core/tests/seed-media.test.ts`

**Interfaces:**
- Consumes: `createMediaFolder`, `storeMediaInternal`, `folderExists`, `renderPreview`-Pfad über `storeMediaInternal`.
- Produces: `seedMedia(deps: Deps, ctx: CallContext): Promise<void>` — legt `Bilder`, `Bilder/2026`, `Dokumente` an, vier Rasterbilder, ein PDF, ein SVG; läuft nicht, wenn `Bilder` existiert.

- [x] **Step 1: Test schreiben**

```ts
// packages/core/tests/seed-media.test.ts
import { describe, expect, it } from 'vitest';
import { mediaAssets, mediaFolders } from '../src/db/schema';
import { previewFilename } from '../src/media/preview';
import { seedMedia } from '../src/seed/media';
import { seedDevelopment } from '../src/seed/seed';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

describe('seedMedia', () => {
  it('creates folders and example files with previews, and is idempotent', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    await seedMedia(deps, ctx);
    await seedMedia(deps, ctx);

    expect(deps.db.select().from(mediaFolders).all().map((f) => f.path).sort()).toEqual(['Bilder', 'Bilder/2026', 'Dokumente']);
    const assets = deps.db.select().from(mediaAssets).all();
    expect(assets).toHaveLength(6);
    expect(assets.filter((a) => a.mimeType === 'application/pdf').map((a) => a.folder)).toEqual(['Dokumente']);
    expect(assets.filter((a) => a.mimeType === 'image/svg+xml').map((a) => a.folder)).toEqual([null]);
    expect(assets.filter((a) => a.folder === 'Bilder/2026')).toHaveLength(2);
    expect(assets.filter((a) => a.folder === null)).toHaveLength(2); // ein Bild, das SVG
    for (const a of assets.filter((a) => a.mimeType !== 'application/pdf' && a.mimeType !== 'image/svg+xml')) {
      expect(await deps.media.exists(previewFilename(a.filename))).toBe(true);
    }
  });

  it('runs as part of seedDevelopment', async () => {
    const deps = createTestDeps({ env: 'development' });
    await seedDevelopment(deps);
    expect(deps.db.select().from(mediaFolders).all().length).toBeGreaterThanOrEqual(3);
  });
});
```

- [x] **Step 2: Rot sehen**

```bash
pnpm --filter @kompass/core exec vitest run tests/seed-media
```

- [x] **Step 3: Seed schreiben**

```ts
// packages/core/src/seed/media.ts
import sharp from 'sharp';
import type { CallContext } from '../context';
import type { Deps } from '../deps';
import { createMediaFolder, folderExists } from '../media/folders';
import { storeMediaInternal } from '../media/service';
import { unwrap } from '../result';

/**
 * Beispieldateien für die Mediathek: Ordner in zwei Ebenen, Bilder in
 * verschiedenen Maßen, ein PDF, ein SVG — nichts davon wird von einem Modul
 * verwendet, damit „nicht verwendet“, Löschen und Verschieben ausprobierbar
 * sind. Bilder entstehen mit sharp, damit kein Binärmaterial im Repo liegt.
 */
const IMAGES: { name: string; width: number; height: number; color: string; folder: string | null }[] = [
  { name: 'Sommerfest Wiese.jpg', width: 1600, height: 900, color: '#5b8c5a', folder: 'Bilder/2026' },
  { name: 'Hoftor.png', width: 900, height: 1600, color: '#8c6a5b', folder: 'Bilder/2026' },
  { name: 'Vereinsbanner.png', width: 1200, height: 1200, color: '#5b6f8c', folder: 'Bilder' },
  { name: 'Notiz.png', width: 240, height: 160, color: '#8c8a5b', folder: null },
];

const PDF = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\nxref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF',
);

const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="28" fill="none" stroke="#5b6f8c" stroke-width="4"/><path d="M20 34l8 8 16-18" fill="none" stroke="#5b6f8c" stroke-width="4"/></svg>',
);

export async function seedMedia(deps: Deps, ctx: CallContext): Promise<void> {
  if (folderExists(deps, 'Bilder')) return;
  for (const path of ['Bilder', 'Bilder/2026', 'Dokumente']) unwrap(await createMediaFolder(deps, ctx, { path }));

  for (const image of IMAGES) {
    const ext = image.name.toLowerCase().endsWith('.jpg') ? 'jpeg' : 'png';
    const base = sharp({ create: { width: image.width, height: image.height, channels: 3, background: image.color } });
    const bytes = new Uint8Array(await (ext === 'jpeg' ? base.jpeg({ quality: 85 }) : base.png()).toBuffer());
    unwrap(await storeMediaInternal(deps, ctx, { originalName: image.name, bytes, folder: image.folder }));
  }
  unwrap(await storeMediaInternal(deps, ctx, { originalName: 'Satzung Entwurf.pdf', bytes: PDF, declaredMimeType: 'application/pdf', folder: 'Dokumente' }));
  unwrap(await storeMediaInternal(deps, ctx, { originalName: 'Haken.svg', bytes: SVG, declaredMimeType: 'image/svg+xml', folder: null }));
}
```

Die Farbwerte sind Bildinhalt, kein Oberflächen-Farbwert — `no-color-literals.test.ts` prüft `apps/kompass/src`, nicht den Kern; sollte ein Kern-Test Farbliterale suchen, die Zeile im Test begründet ausnehmen. Die Namen sind erfunden; `no-association-content.test.ts` sucht Vereinsnamen, hier stehen keine.

In `seed.ts` vor der Schleife `for (const manifest of deps.registry.manifests) { if (manifest.seed) …` einfügen:

```ts
  await seedMedia(deps, ctx);
```

mit `import { seedMedia } from './media';`. Die Reihenfolge (vor den Modulen) ist Absicht: Der Site-Seed legt den Ordner „Webseite“ an; der Kern-Seed prüft „Bilder“, beide stören sich nicht.

- [x] **Step 4: Grün sehen**

```bash
pnpm --filter @kompass/core test
pnpm typecheck
```

Dann `pnpm --filter @kompass/app test` (der `seed-script.test.ts` und die Seed-Tests der Module laufen mit) und die E2E-Suite als Ganzes: Der `seeded`-Reset ruft `seedDevelopment`, also liegen jetzt sechs Dateien in der Mediathek. Fälle, die auf eine leere Mediathek bauen (`toHaveCount(0)` nach dem Löschen bleibt richtig; „Alle Dateien“-Fall prüft nur eine Zeile), bleiben gültig; prüfe es:

```bash
pnpm --filter @kompass/app e2e
```

- [x] **Step 5: Commit**

```bash
git add packages/core/src/seed/media.ts packages/core/src/seed/seed.ts packages/core/tests/seed-media.test.ts
git commit -m "feat(core): the development seed fills the media library — folders, images in several sizes, a pdf and an svg, none in use"
```

---

### Task 3: Doku

**Files:**
- Modify: `docs/betrieb.md` (Abschnitt „Medien“)
- Modify: `docs/superpowers/specs/2026-09-09-loeschbarkeit-und-mediathek-design.md` (Nachtrag)

- [ ] **Step 1: `betrieb.md`**

Unter „## Medien“ nach dem bestehenden Punkt:

```markdown
- Neben jedem Rasterbild liegt eine Vorschau `<name>.preview.webp` (320 px breit). Sie ist ein Cache: Sie darf jederzeit gelöscht werden, der nächste Abruf in der Verwaltung baut sie neu. Backups nehmen sie mit; ein Backup ohne sie ist ebenfalls vollständig.
```

- [ ] **Step 2: Nachtrag in der alten Spec**

Am Ende von Abschnitt 2 („Entscheidungen“) der Spec vom 09.09., nach dem Nachtrag vom 2026-09-09:

```markdown
**Nachtrag 2026-09-13.** Die Durchsicht vor dem ersten Release ergab, dass die
Mediathek eine Ablage ohne Weg in die Formulare war. Auswahl-Dialog,
Vorschaubilder, Suche/Sortierung/Typfilter und verlinkte Fundstellen stehen
in `2026-09-13-mediathek-auswahl-und-vorschau-design.md`. Die Wurzel heißt am
Asset seither „Ohne Ordner“; „Alle Dateien“ bleibt der oberste Eintrag.
```

- [ ] **Step 3: Commit**

```bash
git add docs/betrieb.md docs/superpowers/specs/2026-09-09-loeschbarkeit-und-mediathek-design.md
git commit -m "docs: preview files are a cache, and the old media spec points to the new one"
```

---

### Task 4: Alle drei Prüfringe

- [ ] **Step 1: `pnpm verify`**

```bash
pnpm verify
```

Erwartung: Typecheck, alle Tests, E2E kalt gegen `next dev`, Image-Build und E2E gegen den Container grün. Der Container-Ring prüft, dass `sharp` im Image für den Kern auflösbar ist — das Site-Modul brachte es schon mit, der Kern nutzt dieselbe Version. Schlägt der Container-Ring wegen `sharp` fehl: `Dockerfile` und `output: 'standalone'` prüfen, ob `packages/core` seine Abhängigkeit im Trace hat (`outputFileTracingRoot` steht auf dem Repo-Stamm).

- [ ] **Step 2: Nichts committen, Joe pusht**

Der Push ist nicht Teil des Plans.

---

## Self-Review

**Spec §8:** Werkzeugleiste als GET-Formular mit `q`, `kind`, `sort`, `folder` (Task 1), Spalten Ordner und Datum (Task 1), Vorschau in Grid, Liste, Dialog (Task 1; das Grid kam mit Plan 2), Tastaturzugang (Knopf im Dateinamen), „Öffnen“ und Links (Task 1), „Ohne Ordner“ statt „Wurzel“ mit Umstellung der Dedup-Meldung (Task 1), `Item.references` als Objekte (Task 1).
**§9:** Ordner, vier Bilder mit Maßen, PDF als Konstante, SVG, nichts referenziert, idempotent, Test (Task 2).
**§3 Betrieb, §11 Doku:** Task 3. `AGENTS.md` kennt die Spec seit dem Spec-Commit.
**Typkonsistenz:** `ListQuery` und `mediaHref` in `types.ts`, genutzt in `page.tsx`, `folder-tree.tsx`, `library-client.tsx`; `Reference { label, href? }` passt zu `MediaListingItem.references` aus Plan 2; `formatBytes` ersetzt `kb` an beiden Stellen.
**Prüfringe:** Task 4 schließt mit `pnpm verify`, wie AGENTS.md es vor dem Push verlangt.
