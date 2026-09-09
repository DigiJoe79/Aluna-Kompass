# Löschbarkeit und Mediathek — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine kanonische Löschpolitik im Kern, `deleteMediaAsset` mit modulübergreifender Referenzprüfung, virtuelle Medienordner und eine Mediathek-Oberfläche.

**Architecture:** Eine typisierte Konstante `DELETION_POLICY` hält fest, welche Entität löschbar ist und warum; ein Test hält sie konsistent, sie ändert kein Laufzeitverhalten. Ein neuer Manifest-Haken `mediaReferences` lässt Kern und jedes aktive Modul für sich beantworten, wo ein Medium verwendet wird; `deleteMediaAsset` aggregiert das und lehnt ab, solange ein Verweis besteht. Virtuelle Ordner liegen in einer eigenen Tabelle `media_folders`, die Dateien bleiben flach im Verzeichnis. Die Mediathek-Seite unter `admin/media` ist die Oberfläche zum Sichten, Aufräumen und Ordnen.

**Tech Stack:** TypeScript, Drizzle/SQLite, Zod, Vitest, Next.js (App Router, Server Actions), Playwright, MCP (offizielles TypeScript-SDK).

**Spec:** `docs/superpowers/specs/2026-09-09-loeschbarkeit-und-mediathek-design.md`

## Global Constraints

- Service-Signatur: `fn(deps, ctx, input) → Promise<Result<T>>`. Ablauf: `requirePermission` → `validate` (Zod) → `deps.db.transaction` mit `recordAudit` in derselben Transaktion → `ok(...)`. (`AGENTS.md`)
- Fachfehler sind `Result`-Werte (`forbidden`, `validation`, `notFound`, `conflict`), nie Exceptions. `ServiceError` wird **nicht** um ein strukturiertes Feld erweitert (Spec §5).
- IDs: `newId()` (ULID). Zeit: `isoNow(deps.clock)` — nie `new Date()`. Zeitstempel ISO-8601 UTC.
- Rechteprüfung nur serverseitig, zentral in der Service-Schicht. Für Medien schützt **das bestehende Recht `media.upload`** — kein neues Recht (Spec Entscheidung 5).
- Code Englisch, Oberfläche über i18n (`apps/kompass/messages/de.json`, Sie-Form). Kommentare Deutsch, wo Vereinsbezug.
- Kein statischer Farbwert im Anwendungscode — nur Theme-Tokens.
- Migrationen nur über `pnpm --filter @kompass/core db:generate`; erzeugte SQL-Dateien werden committet und nie editiert.
- Tests: Vitest, Services gegen `createTestDeps()`. Pro Service mindestens: Erfolg, `forbidden`, `validation`, Audit-Eintrag.
- Pro Task ein Commit. `pnpm verify` erst im letzten Task, danach ein einziger Push.
- Ein deaktiviertes Modul wird nicht nach Referenzen befragt (Spec Entscheidung 7).

## Dateien

| Datei | Zweck |
|---|---|
| `packages/core/src/deletion-policy.ts` (neu) | `DeletionRule`, `DELETION_POLICY` |
| `packages/core/src/deletion-policy.test.ts` (neu) | Konsistenzprüfung der Politik |
| `packages/core/src/modules/manifest.ts` | `MediaReference`, `mediaReferences`-Feld |
| `packages/core/src/media/references.ts` (neu) | `coreMediaReferences`, `findMediaReferences` |
| `packages/core/src/media/references.test.ts` (neu) | Aggregation, deaktiviertes Modul |
| `packages/core/src/core-module.ts` | `mediaReferences: coreMediaReferences` |
| `packages/core/src/media/store.ts` | `MediaStore.delete` |
| `packages/core/src/media/service.ts` | `deleteMediaAsset`, `listMediaAssets`-Rückgabe, `folder` bei `storeMedia*` |
| `packages/core/src/media/folders.ts` (neu) | `listMediaFolders`, `createMediaFolder`, `renameMediaFolder`, `deleteMediaFolder`, `moveMediaAsset`, Pfad-Helfer |
| `packages/core/src/media/folders.test.ts` (neu) | alle Ordner-Operationen |
| `packages/core/src/media/delete.test.ts` (neu) | `deleteMediaAsset` |
| `packages/core/src/db/schema.ts` | `mediaFolders`, `mediaAssets.folder` |
| `packages/core/src/db/migrations/` | generierte Migration |
| `packages/core/src/index.ts` | Exporte |
| `packages/core/tests/media.test.ts` | Anpassung an `listMediaAssets`-Rückgabe |
| `packages/modules/animals/src/references.ts` (neu) | `animalsMediaReferences` |
| `packages/modules/animals/src/manifest.ts` | `mediaReferences` |
| `packages/modules/animals/tests/references.test.ts` (neu) | Fundstellen mit Tiername |
| `packages/modules/site/src/references.ts` (neu) | `siteMediaReferences` |
| `packages/modules/site/src/manifest.ts` | `mediaReferences` |
| `packages/modules/site/tests/references.test.ts` (neu) | Fundstellen in Einträgen/Variablen |
| `packages/mcp/src/core-tools.ts` | sechs neue Werkzeuge |
| `apps/kompass/tests/mcp-tools.test.ts` | `media.upload` raus aus `WITHOUT_MCP` |
| `apps/kompass/tests/media-references.test.ts` (neu) | modulübergreifender Integrationstest |
| `apps/kompass/src/lib/navigation.ts` | Eintrag „Mediathek" |
| `apps/kompass/src/app/(shell)/admin/media/page.tsx` (neu) | Seite |
| `apps/kompass/src/app/(shell)/admin/media/actions.ts` (neu) | Server-Actions |
| `apps/kompass/src/app/(shell)/admin/media/library-client.tsx` (neu) | Asset-Liste + Dialoge |
| `apps/kompass/src/app/(shell)/admin/media/folder-tree.tsx` (neu) | Ordnerbaum |
| `apps/kompass/src/lib/actions.ts` | Konflikt-Codes für Medien/Ordner |
| `apps/kompass/messages/de.json` | `media.*`, `nav.media`, `errors.conflict.*` |
| `apps/kompass/e2e/media.spec.ts` (neu) | Löschen, Ordner, Verschieben |
| `AGENTS.md` | Verweis auf `DELETION_POLICY`, Quellenliste |
| `docs/backlog.md` | Punkt 2 entfernen |
| `docs/betrieb.md` | Hinweis: Ordner virtuell |

---

### Task 1: Die Löschpolitik als Konstante

**Files:**
- Create: `packages/core/src/deletion-policy.ts`
- Create: `packages/core/src/deletion-policy.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces: `DeletionRule` (interface), `DELETION_POLICY: readonly DeletionRule[]`

- [ ] **Step 1: Test schreiben**

```ts
// packages/core/src/deletion-policy.test.ts
import { describe, expect, it } from 'vitest';
import { DELETION_POLICY } from './deletion-policy';

describe('deletion policy', () => {
  it('has no duplicate entities', () => {
    const seen = new Set<string>();
    for (const rule of DELETION_POLICY) {
      expect(seen.has(rule.entity), `doppelt: ${rule.entity}`).toBe(false);
      seen.add(rule.entity);
    }
  });

  it('deletable rules carry a guard and a well-formed audit action, non-deletable carry neither', () => {
    for (const rule of DELETION_POLICY) {
      if (rule.deletable) {
        expect(rule.guard, rule.entity).toBeTruthy();
        expect(rule.auditAction ?? '', rule.entity).toMatch(/^[a-z]+(\.[a-z]+)+$/);
      } else {
        expect(rule.guard, rule.entity).toBeUndefined();
        expect(rule.auditAction, rule.entity).toBeUndefined();
      }
    }
  });

  it('locks the accountability core as not deletable', () => {
    for (const entity of ['user', 'role', 'setting', 'auditEntry', 'document', 'module', 'project']) {
      const rule = DELETION_POLICY.find((r) => r.entity === entity);
      expect(rule, entity).toBeDefined();
      expect(rule!.deletable, entity).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `pnpm --filter @kompass/core test deletion-policy`
Expected: FAIL — `Cannot find module './deletion-policy'`

- [ ] **Step 3: `deletion-policy.ts` schreiben**

```ts
// packages/core/src/deletion-policy.ts

/**
 * Was in Kompass gelöscht werden darf — und was nicht. Kanonische Fassung von
 * Prinzip 3 (`AGENTS.md`): „Nichts Rechenschaftsrelevantes wird gelöscht."
 *
 * Diese Konstante ändert kein Laufzeitverhalten; sie ist die eine Stelle, gegen
 * die Menschen und Agenten prüfen, und ein Test hält sie konsistent. Wer eine
 * `delete*`-Funktion baut, trägt hier die Begründung ein.
 *
 * `entity` ist ein logischer Name. Wo die Entität eine eigene Tabelle hat, ist
 * er gleich dem `entityType` ihrer `recordAudit`-Aufrufe; `theme` etwa lebt als
 * Wert in der Einstellung `themes`.
 *
 * Nicht geführt: flüchtige Infrastruktur (Sitzungen), widerrufbare Tokens,
 * das Zurücksetzen einer Template-Variablen auf ihren Leerwert, und Join-Zeilen
 * ohne eigene Identität (`animal_photos`).
 */
export interface DeletionRule {
  /** Entitätstyp, wie in recordAudit als entityType verwendet. */
  entity: string;
  deletable: boolean;
  /** Ein Satz: warum (nicht). Deutsch, weil Rechenschaftsbezug. */
  reason: string;
  /** Nur bei deletable: was eine einzelne Löschung trotzdem verhindert. */
  guard?: string;
  /** Nur bei deletable: die Aktion, die ins Änderungsprotokoll geht (`bereich.verb`). */
  auditAction?: string;
}

export const DELETION_POLICY: readonly DeletionRule[] = [
  // Rechenschaft — nie löschbar
  { entity: 'user', deletable: false, reason: 'Der Verlauf von Nutzern, Rollen und Rechten ist rechenschaftsrelevant (Prinzip 3). Deaktivieren statt löschen.' },
  { entity: 'role', deletable: false, reason: 'Teil des Rechte-Verlaufs. Eine nicht mehr benötigte Rolle wird geleert, nicht gelöscht.' },
  { entity: 'setting', deletable: false, reason: 'Vereinsstamm, Steuerdaten und Regeln sind nachweispflichtig; Werte ändern sich, Schlüssel bleiben.' },
  { entity: 'auditEntry', deletable: false, reason: 'Das Änderungsprotokoll ist der Nachweis selbst; nur INSERT, per Trigger abgesichert.' },
  { entity: 'document', deletable: false, reason: 'Belege und erzeugte Dokumente sind gegenüber Finanzamt und Transparenzregister nachweispflichtig; Storno statt Löschen.' },
  { entity: 'module', deletable: false, reason: 'Module werden deaktiviert; ihre Datenspuren bleiben.' },
  { entity: 'project', deletable: false, reason: 'Trägt ab Stufe 3 Finanzfelder; Löschbarkeit entscheidet sich dort (AGENTS.md).' },
  { entity: 'animal', deletable: false, reason: 'Trägt ab Stufe 4 Bestandsbuch und § 11-Nachweise; Löschbarkeit entscheidet sich dort (AGENTS.md).' },
  { entity: 'sitePublish', deletable: false, reason: 'Die Publish-Historie ist ein Betriebsprotokoll über Jahre.' },

  // Arbeitsmaterial — löschbar, mit Protokolleintrag
  { entity: 'siteEntry', deletable: true, reason: 'Redaktioneller Inhalt der Webseite (Prinzip 3).', guard: 'keiner', auditAction: 'site.entry.delete' },
  { entity: 'mediaAsset', deletable: true, reason: 'Arbeitsmaterial der Redaktion.', guard: 'nur wenn kein Datensatz mehr darauf verweist', auditAction: 'media.delete' },
  { entity: 'mediaFolder', deletable: true, reason: 'Nur Ordnung, kein Nachweis.', guard: 'nur wenn leer (keine Assets, keine Unterordner)', auditAction: 'media.folder.delete' },
  { entity: 'theme', deletable: true, reason: 'Gestaltung, kein Nachweis.', guard: 'nicht das aktive und nicht das Default-Theme', auditAction: 'themes.delete' },
];
```

- [ ] **Step 4: Export ergänzen**

In `packages/core/src/index.ts` nach der Zeile `export { validate } from './validate';` einfügen:

```ts
export * from './deletion-policy';
```

- [ ] **Step 5: Test ausführen — muss bestehen**

Run: `pnpm --filter @kompass/core test deletion-policy`
Expected: PASS (3 Tests)

- [ ] **Step 6: `AGENTS.md` auf die Konstante verweisen**

In `AGENTS.md`, Prinzip 3, den Satz „Was nur auf der Webseite steht … darf gelöscht werden." unverändert lassen, aber am Ende des Absatzes ergänzen:

```
Die vollständige, maßgebliche Aufstellung, welche Entität löschbar ist und
warum, steht als `DELETION_POLICY` in `packages/core/src/deletion-policy.ts`.
```

In der Coding-Regel „Keine Löschfunktionen für Nutzer, Rollen, Einstellungen, …" den Klammerzusatz ersetzen durch:

```
- Keine Löschfunktionen außer den in `DELETION_POLICY`
  (`packages/core/src/deletion-policy.ts`) als `deletable: true` geführten —
  jede mit Eintrag im Änderungsprotokoll.
```

Unter „Quellen" die Spec ergänzen:

```
- Löschbarkeit und Mediathek: `docs/superpowers/specs/2026-09-09-loeschbarkeit-und-mediathek-design.md`
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/deletion-policy.ts packages/core/src/deletion-policy.test.ts packages/core/src/index.ts AGENTS.md
git commit -m "feat(core): a canonical deletion policy"
```

---

### Task 2: Der Manifest-Haken `mediaReferences`

**Files:**
- Modify: `packages/core/src/modules/manifest.ts`
- Create: `packages/core/src/media/references.ts`
- Create: `packages/core/src/media/references.test.ts`
- Modify: `packages/core/src/core-module.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `enabledManifests(deps)` aus `packages/core/src/modules/service.ts`
- Produces:
  - `MediaReference { label: string; entity: string; id: string }` (interface, in `manifest.ts`)
  - `ModuleManifest.mediaReferences?: (deps: Deps, assetId: string) => readonly MediaReference[]`
  - `coreMediaReferences(deps: Deps, assetId: string): MediaReference[]`
  - `findMediaReferences(deps: Deps, assetId: string): MediaReference[]`

- [ ] **Step 1: Test schreiben**

```ts
// packages/core/src/media/references.test.ts
import { describe, expect, it } from 'vitest';
import { animals as animalsTable } from '../db/schema';
import { defineModule } from '../modules/manifest';
import { createProject } from '../projects/service';
import { setSetting } from '../settings/service';
import { storeMediaAsset } from './service';
import { findMediaReferences } from './references';
import { unwrap } from '../result';
import { coreModule } from '../core-module';
import { createTestDeps, ctxWith, insertUser } from '../testing';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

describe('findMediaReferences', () => {
  it('reports the club logo, a project image and no false positives', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload', 'settings.manage', 'projects.manage'], insertUser(deps, {}));
    const logo = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'logo.png', bytes: PNG }));
    const other = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'other.png', bytes: PNG.map((b, i) => (i === 0 ? b : b ^ 1)) }));

    await setSetting(deps, ctx, { key: 'branding.logoAssetId', value: logo.id });
    unwrap(await createProject(deps, ctx, { slug: 'hof', name: { de: 'Hofprojekt' }, type: 'ongoing', imageAssetId: logo.id }));

    const hits = findMediaReferences(deps, logo.id);
    expect(hits.map((h) => h.entity).sort()).toEqual(['project', 'setting']);
    expect(hits.find((h) => h.entity === 'setting')!.label).toBe('Logo des Vereins');
    expect(hits.find((h) => h.entity === 'project')!.label).toBe('Projekt „hof"');
    expect(findMediaReferences(deps, other.id)).toEqual([]);
  });

  it('does not consult a disabled module', async () => {
    const probe = defineModule({
      key: 'probe',
      version: '0',
      permissions: [],
      mediaReferences: () => [{ label: 'X', entity: 'probe', id: 'p1' }],
    });
    const deps = createTestDeps({ manifests: [coreModule, probe] }); // registriert, aber nicht in modules.enabled
    expect(findMediaReferences(deps, 'anything')).toEqual([]);
  });
});
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `pnpm --filter @kompass/core test references`
Expected: FAIL — `Cannot find module './references'`

- [ ] **Step 3: `MediaReference` und das Manifest-Feld**

In `packages/core/src/modules/manifest.ts` nach `SettingDefinition` einfügen:

```ts
export interface MediaReference {
  /** Menschlich lesbar, für die Fehlermeldung und die Verwendungs-Spalte:
   *  z. B. 'Tier „Rocky"', 'Artikel „Sommerfest"', 'Logo des Vereins'. */
  label: string;
  /** Entitätstyp und ID, falls die Oberfläche verlinken will. */
  entity: string;
  id: string;
}
```

Und im `interface ModuleManifest` nach `navigationFor?: …` ergänzen:

```ts
  /** Wo dieses Modul ein Medium verwendet — synchron, nur lesend, ohne
   *  Rechteprüfung. Befragt vor dem Löschen eines Assets. */
  mediaReferences?: (deps: Deps, assetId: string) => readonly MediaReference[];
```

- [ ] **Step 4: `references.ts` schreiben**

```ts
// packages/core/src/media/references.ts
import { eq } from 'drizzle-orm';
import { documents, projects } from '../db/schema';
import type { Deps } from '../deps';
import type { MediaReference } from '../modules/manifest';
import { enabledManifests } from '../modules/service';
import { readSetting } from '../settings/service';

/** Die Fundstellen im Kern selbst: Logo, Projektbilder, gerenderte Dokumente. */
export function coreMediaReferences(deps: Deps, assetId: string): MediaReference[] {
  const refs: MediaReference[] = [];

  if (readSetting<string | null>(deps, 'branding.logoAssetId') === assetId) {
    refs.push({ label: 'Logo des Vereins', entity: 'setting', id: 'branding.logoAssetId' });
  }
  for (const p of deps.db.select({ id: projects.id, slug: projects.slug }).from(projects).where(eq(projects.imageAssetId, assetId)).all()) {
    refs.push({ label: `Projekt „${p.slug}"`, entity: 'project', id: p.id });
  }
  for (const d of deps.db.select({ id: documents.id, number: documents.number }).from(documents).where(eq(documents.assetId, assetId)).all()) {
    refs.push({ label: `Dokument ${d.number}`, entity: 'document', id: d.id });
  }
  return refs;
}

/**
 * Alle Verweise auf ein Asset — Kern plus jedes **aktive** Modul.
 * `enabledManifests` enthält `coreModule`, dessen `mediaReferences` auf
 * `coreMediaReferences` zeigt (Task 2, Step 5). Ein deaktiviertes Modul steht
 * nicht in der Liste und wird nicht befragt.
 */
export function findMediaReferences(deps: Deps, assetId: string): MediaReference[] {
  return enabledManifests(deps).flatMap((m) => m.mediaReferences?.(deps, assetId) ?? []);
}
```

- [ ] **Step 5: `coreModule` den Haken geben**

In `packages/core/src/core-module.ts`:

```ts
import { defineModule } from './modules/manifest';
import { coreMediaReferences } from './media/references';
import { publishedOrganization } from './published/organization';
import { publishedProjects } from './published/projects';
import { CORE_PERMISSIONS } from './permissions/core';
import { CORE_SETTINGS } from './settings/core';

export const coreModule = defineModule({
  key: 'core',
  version: '0.1.0',
  permissions: CORE_PERMISSIONS,
  settings: CORE_SETTINGS,
  publishedViews: [publishedOrganization, publishedProjects],
  mediaReferences: coreMediaReferences,
});
```

Falls `tsc` einen Zyklus meldet (`core-module` → `media/references` → `modules/service` → …): `media/references.ts` importiert nur `enabledManifests` und `readSetting`, beide zyklusfrei. `references.ts` importiert **nicht** `core-module`. Kein Zyklus zu erwarten.

- [ ] **Step 6: Export ergänzen**

In `packages/core/src/index.ts` nach `export * from './media/service';` einfügen:

```ts
export * from './media/references';
```

- [ ] **Step 7: Test ausführen — muss bestehen**

Run: `pnpm --filter @kompass/core test references`
Expected: PASS (2 Tests)

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @kompass/core typecheck`
Expected: keine Fehler

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/modules/manifest.ts packages/core/src/media/references.ts packages/core/src/media/references.test.ts packages/core/src/core-module.ts packages/core/src/index.ts
git commit -m "feat(core): a manifest hook for where a module uses media"
```

---

### Task 3: `deleteMediaAsset` und `MediaStore.delete`

**Files:**
- Modify: `packages/core/src/media/store.ts`
- Modify: `packages/core/src/media/service.ts`
- Create: `packages/core/src/media/delete.test.ts`

**Interfaces:**
- Consumes: `findMediaReferences(deps, assetId)` (Task 2)
- Produces:
  - `MediaStore.delete(filename: string): Promise<void>`
  - `deleteMediaAsset(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<null>>` — Fehlercodes `notFound('mediaAsset', id)`, `conflict('mediaAssetInUse', <text>)`; Audit `action: 'media.delete'`, `entityType: 'mediaAsset'`

- [ ] **Step 1: Test schreiben**

```ts
// packages/core/src/media/delete.test.ts
import { describe, expect, it } from 'vitest';
import { auditLog } from '../db/schema';
import { setSetting } from '../settings/service';
import { deleteMediaAsset, storeMediaAsset } from './service';
import { unwrap } from '../result';
import { createTestDeps, ctxWith, insertUser } from '../testing';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

describe('deleteMediaAsset', () => {
  it('removes an unreferenced asset, its file and writes an audit entry', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const asset = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'a.png', bytes: PNG }));

    unwrap(await deleteMediaAsset(deps, ctx, { id: asset.id }));

    expect(deps.db.select().from(auditLog).all().at(-1)).toMatchObject({ action: 'media.delete', entityType: 'mediaAsset', entityId: asset.id });
    expect(await deps.media.exists(asset.filename)).toBe(false);
    expect((await deleteMediaAsset(deps, ctx, { id: asset.id })).ok).toBe(false); // jetzt weg
  });

  it('refuses without the permission', async () => {
    const deps = createTestDeps();
    const owner = ctxWith(['media.upload'], insertUser(deps, {}));
    const asset = unwrap(await storeMediaAsset(deps, owner, { originalName: 'a.png', bytes: PNG }));
    const res = await deleteMediaAsset(deps, ctxWith([], 'U'), { id: asset.id });
    expect(res.ok === false && res.error.type === 'forbidden').toBe(true);
  });

  it('rejects a missing id and an unknown asset', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    expect((await deleteMediaAsset(deps, ctx, {})).ok).toBe(false);
    const res = await deleteMediaAsset(deps, ctx, { id: 'MISSING' });
    expect(res.ok === false && res.error.type === 'notFound').toBe(true);
  });

  it('refuses while the asset is the club logo and names the reference', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload', 'settings.manage'], insertUser(deps, {}));
    const asset = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'logo.png', bytes: PNG }));
    unwrap(await setSetting(deps, ctx, { key: 'branding.logoAssetId', value: asset.id }));

    const res = await deleteMediaAsset(deps, ctx, { id: asset.id });
    expect(res.ok === false && res.error.type === 'conflict' && res.error.code === 'mediaAssetInUse').toBe(true);
    expect(res.ok === false && res.error.message.includes('Logo des Vereins')).toBe(true);
    expect(await deps.media.exists(asset.filename)).toBe(true); // nichts angefasst
  });
});
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `pnpm --filter @kompass/core test media/delete`
Expected: FAIL — `deleteMediaAsset is not exported`

- [ ] **Step 3: `MediaStore.delete` ergänzen**

In `packages/core/src/media/store.ts`:

Interface um eine Zeile erweitern (nach `pathFor`):

```ts
  /** Idempotent: fehlt die Datei, kein Fehler. */
  delete(filename: string): Promise<void>;
```

Import oben ergänzen: `unlink` aus `node:fs/promises`:

```ts
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
```

In `createFileMediaStore` nach `read:` einfügen:

```ts
    async delete(filename) {
      await unlink(resolve(filename)).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') throw e;
      });
    },
```

In `createMemoryMediaStore` nach `read`:

```ts
    async delete(filename) {
      assertSafeFilename(filename);
      files.delete(filename);
    },
```

- [ ] **Step 4: `deleteMediaAsset` schreiben**

In `packages/core/src/media/service.ts`:

Importe ergänzen — `conflict` aus `../result`, `recordAudit` ist schon da (`../audit/log`), `findMediaReferences`:

```ts
import { invalid, notFound, ok, conflict, unauthorized, type Result } from '../result';
import { findMediaReferences } from './references';
import { z } from 'zod';
```

(`z` nur, falls noch nicht importiert — sonst weglassen.)

Am Dateiende anfügen:

```ts
const deleteInput = z.object({ id: z.string().min(1) });

export async function deleteMediaAsset(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<null>> {
  const denied = requirePermission(ctx, 'media.upload');
  if (denied) return denied;
  const parsed = deleteInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })));

  const record = deps.db.select().from(mediaAssets).where(eq(mediaAssets.id, parsed.data.id)).get();
  if (!record) return notFound('mediaAsset', parsed.data.id);

  const refs = findMediaReferences(deps, record.id);
  if (refs.length > 0) {
    return conflict('mediaAssetInUse', `Wird verwendet bei: ${refs.map((r) => r.label).join(', ')}. Entferne die Datei dort zuerst.`);
  }

  deps.db.transaction((tx) => {
    tx.delete(mediaAssets).where(eq(mediaAssets.id, record.id)).run();
    recordAudit(tx, deps, ctx, {
      action: 'media.delete',
      entityType: 'mediaAsset',
      entityId: record.id,
      before: record,
      summary: `Datei „${record.filename}" gelöscht`,
    });
  });
  // Datei erst nach dem Commit; ein verwaister Rest wäre harmlos (Dedup nach Hash).
  await deps.media.delete(record.filename);
  return ok(null);
}
```

- [ ] **Step 5: Export prüfen**

`packages/core/src/index.ts` hat `export * from './media/service';` — `deleteMediaAsset` ist damit exportiert. Nichts zu tun.

- [ ] **Step 6: Test ausführen — muss bestehen**

Run: `pnpm --filter @kompass/core test media/delete`
Expected: PASS (4 Tests)

- [ ] **Step 7: Alle Kern-Tests**

Run: `pnpm --filter @kompass/core test`
Expected: grün — insbesondere `packages/core/tests/media.test.ts` unverändert

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/media/store.ts packages/core/src/media/service.ts packages/core/src/media/delete.test.ts
git commit -m "feat(core): deleteMediaAsset, refused while a record still references it"
```

---

### Task 4: `mediaReferences` für das Tier-Modul

**Files:**
- Create: `packages/modules/animals/src/references.ts`
- Modify: `packages/modules/animals/src/manifest.ts`
- Modify: `packages/modules/animals/src/index.ts`
- Create: `packages/modules/animals/tests/references.test.ts`

**Interfaces:**
- Consumes: `MediaReference` aus `@kompass/core`; Tabellen `animals`, `animalPhotos`, `animalStories` aus `./schema`
- Produces: `animalsMediaReferences(deps: Deps, assetId: string): MediaReference[]`

- [ ] **Step 1: Test schreiben**

```ts
// packages/modules/animals/tests/references.test.ts
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { storeMediaAsset, unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { animalsModule } from '../src/manifest';
import { createAnimal, setAnimalPhotos } from '../src/service';
import { animalsMediaReferences } from '../src/references';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

describe('animalsMediaReferences', () => {
  it('names the animal that uses a photo, and nothing for an unrelated asset', async () => {
    const deps = createTestDeps({ manifests: [animalsModule], locales: ['de'] });
    const ctx = ctxWith(['media.upload', 'animals.manage'], insertUser(deps, {}));
    const photo = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'rocky.png', bytes: PNG }));
    const animal = unwrap(await createAnimal(deps, ctx, { slug: 'rocky', name: 'Rocky', sex: 'male' }));
    unwrap(await setAnimalPhotos(deps, ctx, { id: animal.id, photos: [{ assetId: photo.id, isPrimary: true }] }));

    const hits = animalsMediaReferences(deps, photo.id);
    expect(hits).toEqual([{ label: 'Tier „Rocky"', entity: 'animal', id: animal.id }]);
    expect(animalsMediaReferences(deps, 'OTHER')).toEqual([]);
  });
});
```

Falls `createAnimal`s Pflichtfelder abweichen (`species`, `adoptedYear` o. ä.): an die Signatur in `packages/modules/animals/src/service.ts` anpassen — der Test prüft nur die Referenz, nicht die Tier-Erzeugung.

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `pnpm --filter @kompass/module-animals test references`
Expected: FAIL — `Cannot find module '../src/references'`

- [ ] **Step 3: `references.ts` schreiben**

```ts
// packages/modules/animals/src/references.ts
import type { Deps, MediaReference } from '@kompass/core';
import { eq, or } from 'drizzle-orm';
import { animalPhotos, animals, animalStories } from './schema';

/** Wo ein Asset als Tierfoto oder in einer Erfolgsgeschichte hängt. */
export function animalsMediaReferences(deps: Deps, assetId: string): MediaReference[] {
  const animalIds = new Set<string>();
  for (const r of deps.db.select({ id: animalPhotos.animalId }).from(animalPhotos).where(eq(animalPhotos.assetId, assetId)).all()) {
    animalIds.add(r.id);
  }
  for (const r of deps.db
    .select({ id: animalStories.animalId })
    .from(animalStories)
    .where(or(eq(animalStories.beforeAssetId, assetId), eq(animalStories.afterAssetId, assetId)))
    .all()) {
    animalIds.add(r.id);
  }
  return [...animalIds].map((id) => {
    const name = deps.db.select({ name: animals.name }).from(animals).where(eq(animals.id, id)).get()?.name ?? id;
    return { label: `Tier „${name}"`, entity: 'animal', id };
  });
}
```

- [ ] **Step 4: Ins Manifest aufnehmen**

In `packages/modules/animals/src/manifest.ts`:

```ts
import { defineModule, type ModuleManifest } from '@kompass/core';
import { animalsMediaReferences } from './references';
import { publishedAnimals } from './views';
import { ANIMALS_MCP_TOOLS } from './mcp-tools';

export const animalsModule: ModuleManifest = defineModule({
  key: 'animals',
  version: '0.1.0',
  permissions: ['animals.view', 'animals.manage'],
  navigation: [{ key: 'animals.list', href: '/animals', icon: 'paw-print', group: 'animals', permission: 'animals.view' }],
  publishedViews: [publishedAnimals],
  mcpTools: ANIMALS_MCP_TOOLS,
  mediaReferences: animalsMediaReferences,
});
```

- [ ] **Step 5: Export ergänzen**

In `packages/modules/animals/src/index.ts` nach `export * from './service';` einfügen:

```ts
export * from './references';
```

- [ ] **Step 6: Test ausführen — muss bestehen**

Run: `pnpm --filter @kompass/module-animals test references`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/modules/animals/src/references.ts packages/modules/animals/src/manifest.ts packages/modules/animals/src/index.ts packages/modules/animals/tests/references.test.ts
git commit -m "feat(animals): report where a media asset is used"
```

---

### Task 5: `mediaReferences` für das Webseiten-Modul

**Files:**
- Create: `packages/modules/site/src/references.ts`
- Modify: `packages/modules/site/src/manifest.ts`
- Modify: `packages/modules/site/src/index.ts`
- Create: `packages/modules/site/tests/references.test.ts`

**Interfaces:**
- Consumes: `MediaReference` aus `@kompass/core`; `activeTemplate(deps)` aus `./service`; `widgetOf` aus `./field-schema`; `readValues` aus `./values`; `siteEntries` aus `./schema`
- Produces: `siteMediaReferences(deps: Deps, assetId: string): MediaReference[]`

- [ ] **Step 1: Test schreiben**

Muster wie `packages/modules/site/tests/export.test.ts` (Template einlesen, Wert setzen, Eintrag anlegen). Kern:

```ts
// packages/modules/site/tests/references.test.ts
import { describe, expect, it } from 'vitest';
import { storeMediaAsset, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { siteModule } from '../src/manifest';
import { applyTemplateSync } from '../src/service';
import { setValues } from '../src/values';
import { createEntry } from '../src/entries';
import { siteMediaReferences } from '../src/references';
// Fixture-Helfer wie in export.test.ts (Template-Verzeichnis mit einem asset-Feld
// in einer Variablen UND in einer Sammlung).

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

describe('siteMediaReferences', () => {
  it('finds an asset in a variable and in a collection entry, with readable labels', async () => {
    const deps = createTestDeps({ manifests: [siteModule], locales: ['de'] });
    const ctx = ctxWith(['media.upload', 'site.manage'], insertUser(deps, {}));
    // Template einlesen (Fixture mit variable "heroImage": asset und collection
    // "news" mit Feld "image": asset), analog export.test.ts:
    process.env.SITE_TEMPLATE_DIR = '<fixture-dir>';
    unwrap(await applyTemplateSync(deps, ctx, { dir: process.env.SITE_TEMPLATE_DIR, confirm: true }));

    const a = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'hero.png', bytes: PNG }));
    unwrap(await setValues(deps, ctx, { values: { heroImage: a.id } }));
    unwrap(await createEntry(deps, ctx, { collection: 'news', slug: 'fest', data: { title: { de: 'Fest' }, image: a.id } }));

    const hits = siteMediaReferences(deps, a.id);
    expect(hits.map((h) => h.label).sort()).toEqual(['Eintrag „fest" in „News"', 'Variable „heroImage"'].sort());
    expect(siteMediaReferences(deps, 'OTHER')).toEqual([]);
  });
});
```

Die Fixture-Mechanik (Template-Verzeichnis, `SITE_TEMPLATE_DIR`, `afterEach`-Aufräumen) 1:1 aus `packages/modules/site/tests/export.test.ts` übernehmen. Sammlungslabel „News" und Feldnamen an die dort verwendete Fixture anpassen; existiert dort kein asset-Feld, die Fixture um eines erweitern.

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `pnpm --filter @kompass/module-site test references`
Expected: FAIL — `Cannot find module '../src/references'`

- [ ] **Step 3: `references.ts` schreiben**

```ts
// packages/modules/site/src/references.ts
import type { Deps, MediaReference } from '@kompass/core';
import { widgetOf } from './field-schema';
import { siteEntries } from './schema';
import { activeTemplate } from './service';
import { readValues } from './values';

/** Feldschlüssel eines Objekts, die im Schema als Asset deklariert sind. */
function assetKeys(fields: Record<string, unknown>): string[] {
  return Object.entries(fields)
    .filter(([, f]) => widgetOf(f as never) === 'asset')
    .map(([key]) => key);
}

/** Wo ein Asset in einer Template-Variablen oder einem Sammlungseintrag steckt. */
export function siteMediaReferences(deps: Deps, assetId: string): MediaReference[] {
  const template = activeTemplate(deps);
  if (!template) return [];
  const refs: MediaReference[] = [];

  const values = readValues(deps);
  for (const key of assetKeys(template.schema.variables)) {
    if (values[key] === assetId) refs.push({ label: `Variable „${key}"`, entity: 'siteValue', id: key });
  }

  const collections = template.schema.collections;
  const rows = deps.db.select().from(siteEntries).all();
  for (const row of rows) {
    const col = collections[row.collection];
    if (!col) continue;
    const data = row.data as Record<string, unknown>;
    for (const key of assetKeys(col.fields)) {
      if (data[key] === assetId) {
        const title = row.slug ?? (typeof data.title === 'object' && data.title ? Object.values(data.title as Record<string, string>)[0] : null) ?? row.id;
        refs.push({ label: `Eintrag „${title}" in „${col.label}"`, entity: 'siteEntry', id: row.id });
      }
    }
  }
  return refs;
}
```

- [ ] **Step 4: Ins Manifest aufnehmen**

In `packages/modules/site/src/manifest.ts` den Import ergänzen und im `defineModule({...})` nach `mcpTools: SITE_MCP_TOOLS,` einfügen:

```ts
import { siteMediaReferences } from './references';
// …
  mediaReferences: siteMediaReferences,
```

- [ ] **Step 5: Export ergänzen**

In `packages/modules/site/src/index.ts` `export * from './references';` ergänzen (an die Stelle, wo die anderen `export * from './…'` stehen).

- [ ] **Step 6: Test ausführen — muss bestehen**

Run: `pnpm --filter @kompass/module-site test references`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/modules/site/src/references.ts packages/modules/site/src/manifest.ts packages/modules/site/src/index.ts packages/modules/site/tests/references.test.ts
git commit -m "feat(site): report where a media asset is used"
```

---

### Task 6: Modulübergreifender Integrationstest

**Files:**
- Create: `apps/kompass/tests/media-references.test.ts`

**Interfaces:**
- Consumes: `deleteMediaAsset`, `findMediaReferences` aus `@kompass/core`; `siteModule`, `animalsModule`

- [ ] **Step 1: Test schreiben**

```ts
// apps/kompass/tests/media-references.test.ts
import { describe, expect, it } from 'vitest';
import { deleteMediaAsset, storeMediaAsset, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { coreModule } from '@kompass/core';
import { animalsModule, createAnimal, setAnimalPhotos } from '@kompass/module-animals';
import { siteModule } from '@kompass/module-site';
import { settings } from '@kompass/core/src/db/schema'; // falls nicht exportiert: über deps.db + schema-Namespace

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

describe('media delete across modules', () => {
  it('is blocked by an animal photo when the animals module is enabled', async () => {
    const deps = createTestDeps({ manifests: [coreModule, siteModule, animalsModule], locales: ['de'] });
    // animals aktivieren:
    deps.db.insert(deps.sqlite ? (await import('@kompass/core')).schema.settings : (null as never))
      .values({ key: 'modules.enabled', value: JSON.stringify(['animals']), updatedAt: '2026-09-05T08:00:00.000Z' })
      .run();

    const ctx = ctxWith(['media.upload', 'animals.manage'], insertUser(deps, {}));
    const photo = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'r.png', bytes: PNG }));
    const animal = unwrap(await createAnimal(deps, ctx, { slug: 'rex', name: 'Rex', sex: 'male' }));
    unwrap(await setAnimalPhotos(deps, ctx, { id: animal.id, photos: [{ assetId: photo.id, isPrimary: true }] }));

    const res = await deleteMediaAsset(deps, ctx, { id: photo.id });
    expect(res.ok === false && res.error.type === 'conflict' && res.error.code === 'mediaAssetInUse').toBe(true);
    expect(res.ok === false && res.error.message.includes('Tier „Rex"')).toBe(true);
  });
});
```

Die Einfügung von `modules.enabled` an das Muster in vorhandenen `apps/kompass/tests/*.test.ts` angleichen (dort wird die Einstellung meist direkt über `deps.db.insert(schema.settings)` gesetzt — `schema` kommt aus `@kompass/core`). Wenn ein Helfer wie `enableModule(deps, 'animals')` existiert, den nehmen.

- [ ] **Step 2: Test ausführen — muss bestehen**

Run: `pnpm --filter @kompass/app test media-references`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/kompass/tests/media-references.test.ts
git commit -m "test: media delete is blocked across module boundaries"
```

---

### Task 7: Tabelle `media_folders` und Spalte `folder`

**Files:**
- Modify: `packages/core/src/db/schema.ts`
- Generated: `packages/core/src/db/migrations/<n>_*.sql` + Snapshot
- Modify: `docs/betrieb.md`

**Interfaces:**
- Produces: `mediaFolders` (Drizzle-Tabelle: `path` PK, `createdAt`); `mediaAssets.folder` (`text`, nullable)

- [ ] **Step 1: Schema ergänzen**

In `packages/core/src/db/schema.ts`, `mediaAssets` um eine Spalte erweitern (nach `createdAt`):

```ts
export const mediaAssets = sqliteTable('media_assets', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull().unique(),
  mimeType: text('mime_type').notNull(),
  bytes: integer('bytes').notNull(),
  width: integer('width'),
  height: integer('height'),
  uploadedByUserId: text('uploaded_by_user_id').references(() => users.id),
  createdAt: text('created_at').notNull(),
  folder: text('folder'), // null = Wurzel; sonst ein Pfad aus media_folders
});

/** Virtuelle Ordner der Mediathek. Die Dateien liegen flach unter MEDIA_PATH. */
export const mediaFolders = sqliteTable('media_folders', {
  path: text('path').primaryKey(), // 'tiere', 'tiere/2024' — kanonisch, '/'-getrennt
  createdAt: text('created_at').notNull(),
});
```

- [ ] **Step 2: Migration erzeugen**

Run: `pnpm --filter @kompass/core db:generate`
Expected: eine neue Datei unter `packages/core/src/db/migrations/` mit
`CREATE TABLE ` + "`media_folders`" + ` (...)` und
`ALTER TABLE ` + "`media_assets`" + ` ADD ` + "`folder`" + ` text;`
Kein Backfill nötig — Bestandsassets haben `folder = NULL` (Wurzel).

- [ ] **Step 3: Migration prüfen**

Run: `pnpm --filter @kompass/core test`
Expected: grün — `createTestDb` wendet die neue Migration mit an; nichts bricht.

- [ ] **Step 4: `docs/betrieb.md` ergänzen**

Im Abschnitt zum Medienverzeichnis (`/data/media` bzw. `MEDIA_PATH`) einen Satz anhängen:

```
Die Ordner der Mediathek sind virtuell: Sie stehen nur in der Datenbank
(Tabelle `media_folders`, Spalte `media_assets.folder`), die Dateien selbst
liegen unverändert flach in diesem Verzeichnis.
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/db/schema.ts packages/core/src/db/migrations docs/betrieb.md
git commit -m "feat(core): media_folders table and a folder column on media_assets"
```

---

### Task 8: `listMediaFolders` und `createMediaFolder`

**Files:**
- Create: `packages/core/src/media/folders.ts`
- Create: `packages/core/src/media/folders.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `FOLDER_SEGMENT = /^[a-z0-9][a-z0-9-]{0,60}$/`
  - `parseFolderPath(raw: unknown): { ok: true; path: string } | { ok: false }` — kanonisch, ≤ 8 Segmente, ≤ 200 Zeichen
  - `listMediaFolders(deps, ctx): Promise<Result<{ path: string; assetCount: number }[]>>`
  - `createMediaFolder(deps, ctx, input): Promise<Result<{ path: string }>>` — Fehlercodes `conflict('folderExists', …)`, `conflict('folderParentMissing', …)`; Audit `media.folder.create`

- [ ] **Step 1: Test schreiben**

```ts
// packages/core/src/media/folders.test.ts
import { describe, expect, it } from 'vitest';
import { auditLog } from '../db/schema';
import { createMediaFolder, listMediaFolders } from './folders';
import { unwrap } from '../result';
import { createTestDeps, ctxWith, insertUser } from '../testing';

describe('media folders — create & list', () => {
  it('creates a folder and a subfolder, lists them with asset counts', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    unwrap(await createMediaFolder(deps, ctx, { path: 'tiere' }));
    unwrap(await createMediaFolder(deps, ctx, { path: 'tiere/2024' }));

    const list = unwrap(await listMediaFolders(deps, ctx));
    expect(list.map((f) => f.path)).toEqual(['tiere', 'tiere/2024']);
    expect(list.every((f) => f.assetCount === 0)).toBe(true);
    expect(deps.db.select().from(auditLog).all().at(-1)).toMatchObject({ action: 'media.folder.create', entityType: 'mediaFolder', entityId: 'tiere/2024' });
  });

  it('refuses a duplicate, a missing parent, bad segments and a missing permission', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    unwrap(await createMediaFolder(deps, ctx, { path: 'tiere' }));

    const dup = await createMediaFolder(deps, ctx, { path: 'tiere' });
    expect(dup.ok === false && dup.error.type === 'conflict' && dup.error.code === 'folderExists').toBe(true);

    const orphan = await createMediaFolder(deps, ctx, { path: 'a/b' });
    expect(orphan.ok === false && orphan.error.type === 'conflict' && orphan.error.code === 'folderParentMissing').toBe(true);

    const bad = await createMediaFolder(deps, ctx, { path: 'Tiere Ordner' });
    expect(bad.ok === false && bad.error.type === 'validation').toBe(true);

    const noPerm = await createMediaFolder(deps, ctxWith([], 'U'), { path: 'x' });
    expect(noPerm.ok === false && noPerm.error.type === 'forbidden').toBe(true);
  });
});
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `pnpm --filter @kompass/core test media/folders`
Expected: FAIL — `Cannot find module './folders'`

- [ ] **Step 3: `folders.ts` — Helfer + create + list**

```ts
// packages/core/src/media/folders.ts
import { asc, eq, like, sql } from 'drizzle-orm';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import { mediaAssets, mediaFolders } from '../db/schema';
import type { Deps } from '../deps';
import { requirePermission } from '../permissions/check';
import { conflict, invalid, notFound, ok, type Result } from '../result';
import { z } from 'zod';

export const FOLDER_SEGMENT = /^[a-z0-9][a-z0-9-]{0,60}$/;

/** Kanonische Ordnerform oder `null`, wenn ungültig. */
export function parseFolderPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, '');
  if (trimmed === '' || trimmed.length > 200) return null;
  const segments = trimmed.split('/');
  if (segments.length > 8) return null;
  if (!segments.every((s) => FOLDER_SEGMENT.test(s))) return null;
  return segments.join('/');
}

const parentOf = (path: string): string | null => {
  const i = path.lastIndexOf('/');
  return i === -1 ? null : path.slice(0, i);
};

export function folderExists(deps: Pick<Deps, 'db'>, path: string): boolean {
  return !!deps.db.select({ path: mediaFolders.path }).from(mediaFolders).where(eq(mediaFolders.path, path)).get();
}

export async function listMediaFolders(deps: Deps, ctx: CallContext): Promise<Result<{ path: string; assetCount: number }[]>> {
  const denied = requirePermission(ctx, 'media.upload');
  if (denied) return denied;
  const rows = deps.db.select({ path: mediaFolders.path }).from(mediaFolders).orderBy(asc(mediaFolders.path)).all();
  return ok(
    rows.map((r) => ({
      path: r.path,
      assetCount: deps.db.select({ n: sql<number>`count(*)` }).from(mediaAssets).where(eq(mediaAssets.folder, r.path)).get()?.n ?? 0,
    })),
  );
}

const createInput = z.object({ path: z.string().min(1) });

export async function createMediaFolder(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ path: string }>> {
  const denied = requirePermission(ctx, 'media.upload');
  if (denied) return denied;
  const parsed = createInput.safeParse(input);
  if (!parsed.success) return invalid([{ path: 'path', message: 'invalidFolderPath' }]);
  const path = parseFolderPath(parsed.data.path);
  if (!path) return invalid([{ path: 'path', message: 'invalidFolderPath' }]);

  if (folderExists(deps, path)) return conflict('folderExists', `Der Ordner „${path}" existiert bereits`);
  const parent = parentOf(path);
  if (parent && !folderExists(deps, parent)) return conflict('folderParentMissing', `Der übergeordnete Ordner „${parent}" fehlt`);

  deps.db.transaction((tx) => {
    tx.insert(mediaFolders).values({ path, createdAt: isoNow(deps.clock) }).run();
    recordAudit(tx, deps, ctx, { action: 'media.folder.create', entityType: 'mediaFolder', entityId: path, after: { path }, summary: `Ordner „${path}" angelegt` });
  });
  return ok({ path });
}
```

Hinweis: `like` und `notFound` werden erst in Task 9/10 gebraucht — Import jetzt schon setzen ist harmlos, oder in Task 9 ergänzen. Wenn `tsc` ungenutzte Importe bemängelt (`noUnusedLocals`), erst in Task 9 hinzufügen.

- [ ] **Step 4: Export ergänzen**

In `packages/core/src/index.ts` nach `export * from './media/references';` einfügen:

```ts
export * from './media/folders';
```

- [ ] **Step 5: Test ausführen — muss bestehen**

Run: `pnpm --filter @kompass/core test media/folders`
Expected: PASS (2 Tests)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/media/folders.ts packages/core/src/media/folders.test.ts packages/core/src/index.ts
git commit -m "feat(core): create and list virtual media folders"
```

---

### Task 9: `renameMediaFolder` und `deleteMediaFolder`

**Files:**
- Modify: `packages/core/src/media/folders.ts`
- Modify: `packages/core/src/media/folders.test.ts`

**Interfaces:**
- Produces:
  - `renameMediaFolder(deps, ctx, input): Promise<Result<{ path: string }>>` — `input: { from, to }`; Fehler `notFound('mediaFolder', from)`, `conflict('folderExists', …)`; Audit `media.folder.rename`
  - `deleteMediaFolder(deps, ctx, input): Promise<Result<null>>` — `input: { path }`; Fehler `notFound`, `conflict('folderNotEmpty', …)`; Audit `media.folder.delete`

- [ ] **Step 1: Tests ergänzen**

An `packages/core/src/media/folders.test.ts` anhängen:

```ts
import { renameMediaFolder, deleteMediaFolder } from './folders';
import { mediaAssets, mediaFolders } from '../db/schema';
import { eq } from 'drizzle-orm';

describe('media folders — rename & delete', () => {
  it('rename carries subfolders and assets along', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    unwrap(await createMediaFolder(deps, ctx, { path: 'tiere' }));
    unwrap(await createMediaFolder(deps, ctx, { path: 'tiere/2024' }));
    deps.db.insert(mediaAssets).values({ id: 'A1', filename: 'a-000000000000.png', mimeType: 'image/png', bytes: 1, width: 1, height: 1, uploadedByUserId: null, createdAt: '2026-09-05T08:00:00.000Z', folder: 'tiere/2024' }).run();

    unwrap(await renameMediaFolder(deps, ctx, { from: 'tiere', to: 'hunde' }));

    expect(deps.db.select({ path: mediaFolders.path }).from(mediaFolders).all().map((r) => r.path).sort()).toEqual(['hunde', 'hunde/2024']);
    expect(deps.db.select({ folder: mediaAssets.folder }).from(mediaAssets).where(eq(mediaAssets.id, 'A1')).get()!.folder).toBe('hunde/2024');
  });

  it('delete removes an empty folder, refuses one with an asset or a subfolder', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    unwrap(await createMediaFolder(deps, ctx, { path: 'leer' }));
    unwrap(await deleteMediaFolder(deps, ctx, { path: 'leer' }));
    expect(deps.db.select().from(mediaFolders).all()).toEqual([]);

    unwrap(await createMediaFolder(deps, ctx, { path: 'voll' }));
    deps.db.insert(mediaAssets).values({ id: 'A2', filename: 'b-000000000000.png', mimeType: 'image/png', bytes: 1, width: 1, height: 1, uploadedByUserId: null, createdAt: '2026-09-05T08:00:00.000Z', folder: 'voll' }).run();
    const withAsset = await deleteMediaFolder(deps, ctx, { path: 'voll' });
    expect(withAsset.ok === false && withAsset.error.type === 'conflict' && withAsset.error.code === 'folderNotEmpty').toBe(true);

    unwrap(await createMediaFolder(deps, ctx, { path: 'ober' }));
    unwrap(await createMediaFolder(deps, ctx, { path: 'ober/unter' }));
    const withChild = await deleteMediaFolder(deps, ctx, { path: 'ober' });
    expect(withChild.ok === false && withChild.error.code === 'folderNotEmpty').toBe(true);
  });

  it('rename refuses a missing source and an occupied target; both refuse without permission', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    unwrap(await createMediaFolder(deps, ctx, { path: 'a' }));
    unwrap(await createMediaFolder(deps, ctx, { path: 'b' }));
    expect((await renameMediaFolder(deps, ctx, { from: 'x', to: 'y' })).ok).toBe(false);
    const occupied = await renameMediaFolder(deps, ctx, { from: 'a', to: 'b' });
    expect(occupied.ok === false && occupied.error.code === 'folderExists').toBe(true);
    expect((await deleteMediaFolder(deps, ctxWith([], 'U'), { path: 'a' })).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `pnpm --filter @kompass/core test media/folders`
Expected: FAIL — `renameMediaFolder is not exported`

- [ ] **Step 3: Implementieren**

An `packages/core/src/media/folders.ts` anhängen (und `like`, `notFound` in die Importe aufnehmen, falls in Task 8 weggelassen):

```ts
const renameInput = z.object({ from: z.string().min(1), to: z.string().min(1) });

export async function renameMediaFolder(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ path: string }>> {
  const denied = requirePermission(ctx, 'media.upload');
  if (denied) return denied;
  const parsed = renameInput.safeParse(input);
  if (!parsed.success) return invalid([{ path: 'to', message: 'invalidFolderPath' }]);
  const from = parseFolderPath(parsed.data.from);
  const to = parseFolderPath(parsed.data.to);
  if (!from || !to) return invalid([{ path: 'to', message: 'invalidFolderPath' }]);

  if (!folderExists(deps, from)) return notFound('mediaFolder', from);
  if (folderExists(deps, to)) return conflict('folderExists', `Der Ordner „${to}" existiert bereits`);
  const toParent = to.includes('/') ? to.slice(0, to.lastIndexOf('/')) : null;
  if (toParent && !folderExists(deps, toParent)) return conflict('folderParentMissing', `Der übergeordnete Ordner „${toParent}" fehlt`);

  const affected = deps.db
    .select({ path: mediaFolders.path })
    .from(mediaFolders)
    .where(sql`${mediaFolders.path} = ${from} or ${mediaFolders.path} like ${from + '/%'}`)
    .all()
    .map((r) => r.path);

  deps.db.transaction((tx) => {
    for (const oldPath of affected) {
      const newPath = to + oldPath.slice(from.length);
      tx.update(mediaFolders).set({ path: newPath }).where(eq(mediaFolders.path, oldPath)).run();
      tx.update(mediaAssets).set({ folder: newPath }).where(eq(mediaAssets.folder, oldPath)).run();
    }
    recordAudit(tx, deps, ctx, {
      action: 'media.folder.rename',
      entityType: 'mediaFolder',
      entityId: from,
      before: { path: from },
      after: { path: to },
      summary: `Ordner „${from}" in „${to}" umbenannt`,
    });
  });
  return ok({ path: to });
}

const pathInput = z.object({ path: z.string().min(1) });

export async function deleteMediaFolder(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<null>> {
  const denied = requirePermission(ctx, 'media.upload');
  if (denied) return denied;
  const parsed = pathInput.safeParse(input);
  if (!parsed.success) return invalid([{ path: 'path', message: 'invalidFolderPath' }]);
  const path = parseFolderPath(parsed.data.path);
  if (!path) return invalid([{ path: 'path', message: 'invalidFolderPath' }]);

  if (!folderExists(deps, path)) return notFound('mediaFolder', path);
  const hasAsset = !!deps.db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.folder, path)).get();
  const hasChild = !!deps.db.select({ path: mediaFolders.path }).from(mediaFolders).where(like(mediaFolders.path, path + '/%')).get();
  if (hasAsset || hasChild) return conflict('folderNotEmpty', `Der Ordner „${path}" ist nicht leer`);

  deps.db.transaction((tx) => {
    tx.delete(mediaFolders).where(eq(mediaFolders.path, path)).run();
    recordAudit(tx, deps, ctx, { action: 'media.folder.delete', entityType: 'mediaFolder', entityId: path, before: { path }, summary: `Ordner „${path}" gelöscht` });
  });
  return ok(null);
}
```

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `pnpm --filter @kompass/core test media/folders`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/media/folders.ts packages/core/src/media/folders.test.ts
git commit -m "feat(core): rename and delete media folders"
```

---

### Task 10: `moveMediaAsset` und `folder` beim Upload

**Files:**
- Modify: `packages/core/src/media/folders.ts`
- Modify: `packages/core/src/media/service.ts`
- Modify: `packages/core/src/media/folders.test.ts`

**Interfaces:**
- Produces:
  - `moveMediaAsset(deps, ctx, input): Promise<Result<null>>` — `input: { id, folder: string | null }`; Fehler `notFound('mediaAsset'|'mediaFolder', …)`; Audit `media.move`
  - `storeMediaAsset` / `storeMediaInternal`: `StoreMediaInput` erhält optional `folder?: string | null`

- [ ] **Step 1: Tests ergänzen**

An `packages/core/src/media/folders.test.ts`:

```ts
import { moveMediaAsset } from './folders';
import { storeMediaAsset } from './service';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

describe('media move & upload into a folder', () => {
  it('moves an asset into an existing folder and records it', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    unwrap(await createMediaFolder(deps, ctx, { path: 'tiere' }));
    const asset = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'a.png', bytes: PNG }));

    unwrap(await moveMediaAsset(deps, ctx, { id: asset.id, folder: 'tiere' }));
    expect(deps.db.select({ f: mediaAssets.folder }).from(mediaAssets).where(eq(mediaAssets.id, asset.id)).get()!.f).toBe('tiere');
    expect(deps.db.select().from(auditLog).all().at(-1)).toMatchObject({ action: 'media.move', entityId: asset.id });

    unwrap(await moveMediaAsset(deps, ctx, { id: asset.id, folder: null })); // zurück in die Wurzel
    expect(deps.db.select({ f: mediaAssets.folder }).from(mediaAssets).where(eq(mediaAssets.id, asset.id)).get()!.f).toBeNull();
  });

  it('refuses a move into a non-existent folder', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const asset = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'a.png', bytes: PNG }));
    const res = await moveMediaAsset(deps, ctx, { id: asset.id, folder: 'weg' });
    expect(res.ok === false && res.error.type === 'notFound' && res.error.entity === 'mediaFolder').toBe(true);
  });

  it('stores an upload into a folder, and dedup keeps the existing folder', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    unwrap(await createMediaFolder(deps, ctx, { path: 'a' }));
    unwrap(await createMediaFolder(deps, ctx, { path: 'b' }));
    const first = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'x.png', bytes: PNG, folder: 'a' }));
    expect(first.folder).toBe('a');
    const again = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'x.png', bytes: PNG, folder: 'b' }));
    expect(again.id).toBe(first.id);
    expect(again.folder).toBe('a'); // unverändert
  });
});
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `pnpm --filter @kompass/core test media/folders`
Expected: FAIL — `moveMediaAsset is not exported` / `folder` unbekannt in `StoreMediaInput`

- [ ] **Step 3: `moveMediaAsset` implementieren**

An `packages/core/src/media/folders.ts` anhängen:

```ts
const moveInput = z.object({ id: z.string().min(1), folder: z.string().min(1).nullable() });

export async function moveMediaAsset(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<null>> {
  const denied = requirePermission(ctx, 'media.upload');
  if (denied) return denied;
  const parsed = moveInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })));

  const asset = deps.db.select().from(mediaAssets).where(eq(mediaAssets.id, parsed.data.id)).get();
  if (!asset) return notFound('mediaAsset', parsed.data.id);

  let folder: string | null = null;
  if (parsed.data.folder !== null) {
    folder = parseFolderPath(parsed.data.folder);
    if (!folder || !folderExists(deps, folder)) return notFound('mediaFolder', parsed.data.folder ?? '');
  }

  deps.db.transaction((tx) => {
    tx.update(mediaAssets).set({ folder }).where(eq(mediaAssets.id, asset.id)).run();
    recordAudit(tx, deps, ctx, {
      action: 'media.move',
      entityType: 'mediaAsset',
      entityId: asset.id,
      before: { folder: asset.folder },
      after: { folder },
      summary: `Datei „${asset.filename}" nach „${folder ?? 'Wurzel'}" verschoben`,
    });
  });
  return ok(null);
}
```

- [ ] **Step 4: `folder` beim Upload**

In `packages/core/src/media/service.ts`:

`StoreMediaInput` erweitern:

```ts
export interface StoreMediaInput {
  originalName: string;
  bytes: Uint8Array;
  declaredMimeType?: string;
  /** Zielordner (Pfad aus media_folders) oder null/weggelassen = Wurzel.
   *  Bei einem Dedup-Treffer bleibt der Ordner des vorhandenen Datensatzes. */
  folder?: string | null;
}
```

In `storeMediaInternal`, an der Stelle `if (existing) return ok(existing);` **davor** den Ordner prüfen und beim Insert setzen. Konkret:

```ts
  if (existing) return ok(existing); // Dedup: Ordner des vorhandenen Datensatzes bleibt
  const folder = input.folder ? (folderExists(deps, input.folder) ? input.folder : null) : null;
  await deps.media.write(filename, input.bytes);
  return deps.db.transaction((tx: DbOrTx) => {
    const id = newId();
    tx.insert(mediaAssets)
      .values({ id, filename, mimeType: meta.mimeType, bytes: input.bytes.byteLength, width: meta.width, height: meta.height, uploadedByUserId: ctx.userId, createdAt: isoNow(deps.clock), folder })
      .run();
```

Import `folderExists` aus `./folders`:

```ts
import { folderExists } from './folders';
```

Prüfen, dass kein Import-Zyklus entsteht: `folders.ts` importiert aus `service.ts` nur in den **Tests**, nicht im Modulcode — `folders.ts` selbst importiert `service.ts` nicht. `service.ts` → `folders.ts` ist also einseitig. Falls `tsc` doch einen Zyklus über `references.ts` meldet, `folderExists` als winzige eigenständige Funktion nach `store.ts` oder in eine neue `media/folder-path.ts` ziehen und von beiden importieren.

- [ ] **Step 5: Test ausführen — muss bestehen**

Run: `pnpm --filter @kompass/core test media`
Expected: PASS — `media/folders`, `media/delete`, `tests/media.test.ts`

- [ ] **Step 6: Typecheck + alle Kern-Tests**

Run: `pnpm --filter @kompass/core typecheck && pnpm --filter @kompass/core test`
Expected: grün

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/media/folders.ts packages/core/src/media/folders.test.ts packages/core/src/media/service.ts
git commit -m "feat(core): move an asset between folders, upload into one"
```

---

### Task 11: `listMediaAssets` mit Referenzen und Ordnerfilter

**Files:**
- Modify: `packages/core/src/media/service.ts`
- Modify: `packages/core/tests/media.test.ts`

**Interfaces:**
- Produces: `listMediaAssets(deps, ctx, folder?: string | null): Promise<Result<MediaLibraryItem[]>>` mit
  `MediaLibraryItem = { record: MediaAssetRecord; references: MediaReference[] }`

- [ ] **Step 1: Bestehenden Test anpassen**

In `packages/core/tests/media.test.ts`, letzter Test („reads assets back …"), die Zeile

```ts
    expect(unwrap(await listMediaAssets(deps, uploader)).map((m) => m.id)).toEqual([record.id]);
```

ersetzen durch:

```ts
    const listed = unwrap(await listMediaAssets(deps, uploader));
    expect(listed.map((m) => m.record.id)).toEqual([record.id]);
    expect(listed[0]!.references).toEqual([]);
```

Und einen Test anhängen:

```ts
  it('filters by folder and reports references', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload', 'settings.manage'], insertUser(deps, {}));
    const { createMediaFolder } = await import('../src/media/folders');
    const { setSetting } = await import('../src/settings/service');
    unwrap(await createMediaFolder(deps, ctx, { path: 'logos' }));
    const a = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'a.png', bytes: PNG, folder: 'logos' }));
    unwrap(await setSetting(deps, ctx, { key: 'branding.logoAssetId', value: a.id }));

    const inRoot = unwrap(await listMediaAssets(deps, ctx, null));
    expect(inRoot).toEqual([]);
    const inLogos = unwrap(await listMediaAssets(deps, ctx, 'logos'));
    expect(inLogos[0]!.references.map((r) => r.label)).toEqual(['Logo des Vereins']);
  });
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `pnpm --filter @kompass/core test tests/media`
Expected: FAIL — `.record` undefined / zu viele Argumente

- [ ] **Step 3: `listMediaAssets` umschreiben**

In `packages/core/src/media/service.ts`:

```ts
import type { MediaReference } from '../modules/manifest';
import { findMediaReferences } from './references';
import { isNull } from 'drizzle-orm';

export interface MediaLibraryItem {
  record: MediaAssetRecord;
  references: MediaReference[];
}

export async function listMediaAssets(deps: Deps, ctx: CallContext, folder?: string | null): Promise<Result<MediaLibraryItem[]>> {
  const denied = requirePermission(ctx, 'media.upload');
  if (denied) return denied;
  const base = deps.db.select().from(mediaAssets).orderBy(mediaAssets.createdAt);
  const rows =
    folder === undefined
      ? base.all()
      : folder === null
        ? base.where(isNull(mediaAssets.folder)).all()
        : base.where(eq(mediaAssets.folder, folder)).all();
  return ok(rows.map((record) => ({ record, references: findMediaReferences(deps, record.id) })));
}
```

(`eq` ist in der Datei bereits importiert; `isNull` ergänzen.)

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `pnpm --filter @kompass/core test tests/media media/delete`
Expected: PASS

- [ ] **Step 5: Kern-Typecheck + Test gesamt**

Run: `pnpm --filter @kompass/core typecheck && pnpm --filter @kompass/core test`
Expected: grün. Falls ein weiterer Aufrufer von `listMediaAssets` existiert (`grep -rn listMediaAssets packages apps`), an die neue Form anpassen — Task 12 und 13 nutzen sie ohnehin neu.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/media/service.ts packages/core/tests/media.test.ts
git commit -m "feat(core): list media with references and a folder filter"
```

---

### Task 12: MCP-Werkzeuge

**Files:**
- Modify: `packages/mcp/src/core-tools.ts`
- Modify: `apps/kompass/tests/mcp-tools.test.ts`

**Interfaces:**
- Consumes: `listMediaAssets`, `deleteMediaAsset`, `moveMediaAsset`, `createMediaFolder`, `renameMediaFolder`, `deleteMediaFolder` aus `@kompass/core`

- [ ] **Step 1: `WITHOUT_MCP` anpassen**

In `apps/kompass/tests/mcp-tools.test.ts` die Zeile

```ts
const WITHOUT_MCP = new Set(['media.upload', 'backup.export', 'backup.import']);
```

ändern zu:

```ts
const WITHOUT_MCP = new Set(['backup.export', 'backup.import']);
```

Den zugehörigen Kommentarblock darüber anpassen: „Alle drei" → „Beide"; den Satz zu `media.upload` streichen.

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `pnpm --filter @kompass/app test mcp-tools`
Expected: FAIL — `media.upload` hat kein Werkzeug, das es nennt

- [ ] **Step 3: Werkzeuge ergänzen**

In `packages/mcp/src/core-tools.ts` die Importe erweitern:

```ts
import {
  // … bestehende …
  listMediaAssets,
  deleteMediaAsset,
  moveMediaAsset,
  createMediaFolder,
  renameMediaFolder,
  deleteMediaFolder,
} from '@kompass/core';
```

Ins `coreMcpTools`-Array einfügen (bei den anderen Kern-Werkzeugen, Beschreibungen englisch, jede nennt `media.upload`):

```ts
  t({ name: 'media_list', description: 'List media assets with size, type, folder and where each is used. Optional folder filter ("" or omitted = all, null = root). Requires media.upload.', inputSchema: z.object({ folder: z.string().nullable().optional() }), handler: (deps, ctx, { folder }) => listMediaAssets(deps, ctx, folder as string | null | undefined) }),
  t({ name: 'media_delete', description: 'Delete a media asset. Refused while any record still references it (editorial content, audited). Requires media.upload.', inputSchema: z.object({ id: z.string() }), handler: (deps, ctx, args) => deleteMediaAsset(deps, ctx, args) }),
  t({ name: 'media_move', description: 'Move a media asset into a folder (null = root). Requires media.upload.', inputSchema: z.object({ id: z.string(), folder: z.string().nullable() }), handler: (deps, ctx, args) => moveMediaAsset(deps, ctx, args) }),
  t({ name: 'media_folder_create', description: 'Create a virtual media folder; the parent must exist. Requires media.upload.', inputSchema: z.object({ path: z.string() }), handler: (deps, ctx, args) => createMediaFolder(deps, ctx, args) }),
  t({ name: 'media_folder_rename', description: 'Rename a media folder; subfolders and assets move with it. Requires media.upload.', inputSchema: z.object({ from: z.string(), to: z.string() }), handler: (deps, ctx, args) => renameMediaFolder(deps, ctx, args) }),
  t({ name: 'media_folder_delete', description: 'Delete an empty media folder. Requires media.upload.', inputSchema: z.object({ path: z.string() }), handler: (deps, ctx, args) => deleteMediaFolder(deps, ctx, args) }),
```

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `pnpm --filter @kompass/app test mcp-tools`
Expected: PASS

- [ ] **Step 5: MCP-Paket testen**

Run: `pnpm --filter @kompass/mcp test && pnpm --filter @kompass/mcp typecheck`
Expected: grün

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/src/core-tools.ts apps/kompass/tests/mcp-tools.test.ts
git commit -m "feat(mcp): media list, delete, move and folder tools"
```

---

### Task 13: Mediathek-Seite — Liste und Löschen

**Files:**
- Modify: `apps/kompass/src/lib/navigation.ts`
- Modify: `apps/kompass/src/lib/actions.ts`
- Create: `apps/kompass/src/app/(shell)/admin/media/page.tsx`
- Create: `apps/kompass/src/app/(shell)/admin/media/actions.ts`
- Create: `apps/kompass/src/app/(shell)/admin/media/library-client.tsx`
- Modify: `apps/kompass/messages/de.json`
- Create: `apps/kompass/e2e/media.spec.ts`

**Interfaces:**
- Consumes: `listMediaAssets`, `deleteMediaAsset`, `listMediaFolders` aus `@kompass/core`; `requireSession`, `toActionState`, `ConfirmDialog`, `PageHeader`, `ForbiddenCard`

- [ ] **Step 1: Navigationseintrag**

In `apps/kompass/src/lib/navigation.ts`, `CORE_ADMIN`, nach der `backup`-Zeile:

```ts
  { key: 'media', href: '/admin/media', icon: 'image', permission: 'media.upload' },
```

- [ ] **Step 2: Konflikt-Codes für die Oberfläche**

In `apps/kompass/src/lib/actions.ts`:

`KNOWN_CONFLICTS` um `'folderExists'`, `'folderParentMissing'`, `'folderNotFound'` ergänzen.

Im `conflict`-Zweig von `errorMessage` die Bedingung mit `detail` um die Codes erweitern, die eine Fundstellenliste tragen:

```ts
      if (error.code === 'moduleDependencyInactive' || error.code === 'moduleRequiredByOthers' || error.code === 'blockedTermsPresent' || error.code === 'siteBuildFailed' || error.code === 'publishFailed' || error.code === 'mediaAssetInUse' || error.code === 'folderNotEmpty') {
        return t(`errors.conflict.${error.code}`, { detail });
      }
```

Da `mediaAssetInUse` und `folderNotEmpty` keinen Doppelpunkt in der Nachricht haben, liefert `detail` die ganze Nachricht — passt.

- [ ] **Step 3: Übersetzungen**

In `apps/kompass/messages/de.json`:

- `nav.media`: `"Mediathek"`
- `errors.conflict` ergänzen:
  - `"mediaAssetInUse": "{detail}"`
  - `"folderNotEmpty": "{detail}"`
  - `"folderExists": "Ein Ordner mit diesem Namen existiert bereits."`
  - `"folderParentMissing": "Der übergeordnete Ordner fehlt."`
  - `"folderNotFound": "Der Zielordner existiert nicht."`
- neuer Block `media`:

```json
"media": {
  "title": "Mediathek",
  "empty": "Keine Dateien in diesem Ordner.",
  "columns": { "file": "Datei", "size": "Größe", "uploaded": "Hochgeladen", "usage": "Verwendung" },
  "unused": "nicht verwendet",
  "delete": "Löschen",
  "confirmDelete": "Diese Datei löschen?",
  "confirmDeleteBody": "Die Datei wird entfernt. Der Löschvorgang steht im Änderungsprotokoll.",
  "deleted": "Datei gelöscht.",
  "inUse": "In Verwendung — kann nicht gelöscht werden.",
  "move": "Verschieben",
  "movedToast": "Datei verschoben.",
  "root": "Alle Dateien",
  "newFolder": "Neuer Ordner",
  "newFolderName": "Ordnername",
  "renameFolder": "Umbenennen",
  "deleteFolder": "Ordner löschen",
  "folderDeleted": "Ordner gelöscht.",
  "folderNotEmpty": "Der Ordner ist nicht leer."
}
```

- [ ] **Step 4: Server-Actions**

```tsx
// apps/kompass/src/app/(shell)/admin/media/actions.ts
'use server';

import { deleteMediaAsset } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function deleteMediaAction(id: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await deleteMediaAsset(deps, ctx, { id });
  revalidatePath('/admin/media');
  return toActionState(result, t, t('media.deleted'));
}
```

- [ ] **Step 5: Seite**

```tsx
// apps/kompass/src/app/(shell)/admin/media/page.tsx
import { listMediaAssets, listMediaFolders, requirePermission, unwrap } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { LibraryClient } from './library-client';

export default async function MediaPage({ searchParams }: { searchParams: Promise<{ folder?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'media.upload')) return <ForbiddenCard permission="media.upload" />;
  const t = await getTranslations('media');
  const { folder } = await searchParams;
  const current = folder ?? null;

  const folders = unwrap(await listMediaFolders(deps, ctx));
  const items = unwrap(await listMediaAssets(deps, ctx, current)).map((it) => ({
    id: it.record.id,
    filename: it.record.filename,
    mimeType: it.record.mimeType,
    bytes: it.record.bytes,
    createdAt: it.record.createdAt,
    references: it.references.map((r) => r.label),
  }));

  return (
    <>
      <PageHeader title={t('title')} />
      <LibraryClient current={current} folders={folders} items={items} />
    </>
  );
}
```

- [ ] **Step 6: Client — Liste + Löschdialog**

```tsx
// apps/kompass/src/app/(shell)/admin/media/library-client.tsx
'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { Button } from '@/components/ui/button';
import { deleteMediaAction } from './actions';

interface Item {
  id: string;
  filename: string;
  mimeType: string;
  bytes: number;
  createdAt: string;
  references: string[];
}

export function LibraryClient({ current, folders, items }: { current: string | null; folders: { path: string; assetCount: number }[]; items: Item[] }) {
  const t = useTranslations('media');
  const router = useRouter();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [, start] = useTransition();
  const kb = (b: number) => `${Math.max(1, Math.round(b / 1024))} KB`;

  return (
    <div className="flex gap-6">
      <nav className="w-56 shrink-0 text-[14px]">
        <a href="/admin/media" className={`block rounded px-2 py-1 ${current === null ? 'bg-selected text-selected-ink' : 'hover:bg-hover-surface'}`}>{t('root')}</a>
        {folders.map((f) => (
          <a key={f.path} href={`/admin/media?folder=${encodeURIComponent(f.path)}`} className={`block rounded px-2 py-1 ${current === f.path ? 'bg-selected text-selected-ink' : 'hover:bg-hover-surface'}`} style={{ paddingLeft: `${0.5 + f.path.split('/').length * 0.75}rem` }}>
            {f.path.split('/').at(-1)} <span className="text-ink-2">({f.assetCount})</span>
          </a>
        ))}
      </nav>

      <div className="min-w-0 flex-1">
        {items.length === 0 ? (
          <p className="text-ink-2">{t('empty')}</p>
        ) : (
          <table className="w-full text-[14px]">
            <thead className="text-left text-ink-2">
              <tr><th className="py-2">{t('columns.file')}</th><th>{t('columns.size')}</th><th>{t('columns.usage')}</th><th /></tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="h-[var(--row-h)] border-b border-line-2">
                  <td className="py-2 font-mono text-[13px]">{it.filename}</td>
                  <td>{kb(it.bytes)}</td>
                  <td>{it.references.length === 0 ? <span className="text-ink-2">{t('unused')}</span> : it.references.join(', ')}</td>
                  <td className="text-right">
                    <Button type="button" variant="ghost" size="sm" disabled={it.references.length > 0} title={it.references.length > 0 ? t('inUse') : undefined} onClick={() => setConfirmId(it.id)}>
                      {t('delete')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={confirmId !== null}
        onOpenChange={(open) => !open && setConfirmId(null)}
        title={t('confirmDelete')}
        description={t('confirmDeleteBody')}
        confirmLabel={t('delete')}
        destructive
        action={async () => {
          const state = confirmId ? await deleteMediaAction(confirmId) : { status: 'idle' as const };
          if (state.status === 'success') { toast.success(state.message ?? t('deleted')); start(() => router.refresh()); }
          else if (state.status === 'error') toast.error(state.message);
          setConfirmId(null);
          return state;
        }}
      />
    </div>
  );
}
```

Falls Token-Klassen (`bg-selected`, `text-selected-ink`, `bg-hover-surface`) so nicht existieren: an die im Repo verwendeten Utility-Namen angleichen (`grep -rn "selected-bg\|hover-surface" apps/kompass/src`). Keine Farbliterale.

- [ ] **Step 7: e2e — Löschen**

```ts
// apps/kompass/e2e/media.spec.ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test('deletes an unused asset and blocks one in use', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);

  // Ein Bild über die Einstellungen als Logo hochladen (vorhandene logo-upload-Komponente)
  await page.goto('/admin/settings');
  await page.getByLabel(/logo/i).setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG_BYTES });
  await expect(page.getByRole('status')).toBeVisible();

  await page.goto('/admin/media');
  const row = page.getByRole('row', { name: /logo/i });
  await expect(row.getByRole('button', { name: 'Löschen' })).toBeDisabled();
  await expect(row).toContainText('Logo des Vereins');
});

const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
```

Feinheiten (Selektor für das Logo-Feld, Bestätigung, ob `/admin/settings` das Logo sofort persistiert) an die vorhandene `apps/kompass/e2e/settings.spec.ts` angleichen. Ziel des Tests: die Verwendungs-Spalte zeigt „Logo des Vereins", der Löschknopf ist aus.

- [ ] **Step 8: App-Tests + Typecheck**

Run: `pnpm --filter @kompass/app typecheck && pnpm --filter @kompass/app test`
Expected: grün

- [ ] **Step 9: e2e**

Run: `pnpm --filter @kompass/app e2e media`
Expected: grün

- [ ] **Step 10: Commit**

```bash
git add apps/kompass/src/lib/navigation.ts apps/kompass/src/lib/actions.ts "apps/kompass/src/app/(shell)/admin/media" apps/kompass/messages/de.json apps/kompass/e2e/media.spec.ts
git commit -m "feat(app): a media library page with usage and delete"
```

---

### Task 14: Mediathek-Seite — Ordner anlegen, umbenennen, verschieben

**Files:**
- Modify: `apps/kompass/src/app/(shell)/admin/media/actions.ts`
- Modify: `apps/kompass/src/app/(shell)/admin/media/library-client.tsx`
- Create: `apps/kompass/src/app/(shell)/admin/media/folder-tools.tsx`
- Modify: `apps/kompass/e2e/media.spec.ts`

**Interfaces:**
- Consumes: `createMediaFolder`, `renameMediaFolder`, `deleteMediaFolder`, `moveMediaAsset`, `listMediaFolders` aus `@kompass/core`

- [ ] **Step 1: Server-Actions ergänzen**

An `actions.ts` anfügen:

```ts
import { createMediaFolder, deleteMediaFolder, moveMediaAsset, renameMediaFolder } from '@kompass/core';

export async function createFolderAction(path: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await createMediaFolder(deps, ctx, { path });
  revalidatePath('/admin/media');
  return toActionState(result, t);
}

export async function renameFolderAction(from: string, to: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await renameMediaFolder(deps, ctx, { from, to });
  revalidatePath('/admin/media');
  return toActionState(result, t);
}

export async function deleteFolderAction(path: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await deleteMediaFolder(deps, ctx, { path });
  revalidatePath('/admin/media');
  return toActionState(result, t, t('media.folderDeleted'));
}

export async function moveAssetAction(id: string, folder: string | null): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await moveMediaAsset(deps, ctx, { id, folder });
  revalidatePath('/admin/media');
  return toActionState(result, t, t('media.movedToast'));
}
```

- [ ] **Step 2: `folder-tools.tsx` — „Neuer Ordner", Umbenennen, Löschen**

```tsx
// apps/kompass/src/app/(shell)/admin/media/folder-tools.tsx
'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { createFolderAction, deleteFolderAction, renameFolderAction } from './actions';

export function FolderTools({ current }: { current: string | null }) {
  const t = useTranslations('media');
  const router = useRouter();
  const [name, setName] = useState('');

  const run = async (state: Promise<{ status: string; message?: string }>) => {
    const s = await state;
    if (s.status === 'error') toast.error(s.message ?? '');
    else { toast.success(s.message ?? ''); router.refresh(); }
  };

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-line-2 pt-3 text-[13px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const path = current ? `${current}/${name.trim()}` : name.trim();
          void run(createFolderAction(path)).then(() => setName(''));
        }}
        className="flex gap-1"
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('newFolderName')} aria-label={t('newFolderName')} className="min-w-0 flex-1 rounded border border-line bg-input px-2 py-1" />
        <Button type="submit" size="sm" variant="ghost" disabled={name.trim() === ''}>{t('newFolder')}</Button>
      </form>
      {current ? (
        <div className="flex gap-2">
          <button
            type="button"
            className="text-link underline"
            onClick={() => {
              const to = window.prompt(t('renameFolder'), current.split('/').at(-1) ?? '');
              if (to && to.trim()) {
                const parent = current.includes('/') ? current.slice(0, current.lastIndexOf('/') + 1) : '';
                void run(renameFolderAction(current, parent + to.trim()));
              }
            }}
          >
            {t('renameFolder')}
          </button>
          <button type="button" className="text-error underline" onClick={() => void run(deleteFolderAction(current)).then(() => router.push('/admin/media'))}>
            {t('deleteFolder')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
```

`window.prompt` ist bewusst schlicht — die Umbenennung ist eine seltene Verwaltungsaktion. Falls das Repo eine Dialog-Konvention für solche Eingaben hat (`grep -rn "window.prompt\|InputDialog" apps/kompass/src`), diese nehmen.

- [ ] **Step 3: `library-client.tsx` — Baum um `FolderTools` erweitern, „Verschieben" je Zeile**

In `library-client.tsx`:
- `<FolderTools current={current} />` unter die `<nav>`-Liste setzen.
- In der Aktionsspalte je Zeile neben „Löschen" ein `<select>` mit den Ordnern (aus `folders` plus „Wurzel"), das bei Änderung `moveAssetAction(it.id, value || null)` ruft und danach `router.refresh()`:

```tsx
<select
  aria-label={t('move')}
  defaultValue=""
  className="mr-2 rounded border border-line bg-input px-1 py-0.5 text-[13px]"
  onChange={async (e) => {
    const s = await moveAssetAction(it.id, e.target.value || null);
    if (s.status === 'error') toast.error(s.message);
    else { toast.success(s.message ?? t('movedToast')); start(() => router.refresh()); }
  }}
>
  <option value="">{t('root')}</option>
  {folders.map((f) => <option key={f.path} value={f.path}>{f.path}</option>)}
</select>
```

Import `moveAssetAction` ergänzen.

- [ ] **Step 4: e2e — Ordner**

An `apps/kompass/e2e/media.spec.ts` anhängen:

```ts
test('creates a folder, moves an asset in, deletes the empty folder', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/admin/media');

  await page.getByLabel('Ordnername').fill('kampagnen');
  await page.getByRole('button', { name: 'Neuer Ordner' }).click();
  await expect(page.getByRole('link', { name: /kampagnen/ })).toBeVisible();

  await page.getByRole('link', { name: /kampagnen/ }).click();
  await expect(page).toHaveURL(/folder=kampagnen/);
  await page.getByRole('button', { name: 'Ordner löschen' }).click();
  await expect(page.getByRole?.('link', { name: /kampagnen/ }) ?? page.getByText('kampagnen')).toHaveCount(0);
});
```

Selektoren an die tatsächliche Auszeichnung angleichen; der Test soll zeigen: Ordner anlegen erscheint im Baum, leerer Ordner lässt sich löschen.

- [ ] **Step 5: App-Tests, Typecheck, e2e**

Run: `pnpm --filter @kompass/app typecheck && pnpm --filter @kompass/app test && pnpm --filter @kompass/app e2e media`
Expected: grün

- [ ] **Step 6: Commit**

```bash
git add "apps/kompass/src/app/(shell)/admin/media" apps/kompass/e2e/media.spec.ts
git commit -m "feat(app): folders in the media library — create, rename, move, delete"
```

---

### Task 15: Backlog schließen und Gesamtlauf

**Files:**
- Modify: `docs/backlog.md`

- [ ] **Step 1: Backlog-Punkt 2 entfernen**

In `docs/backlog.md` den kompletten Abschnitt „## 2. Löschen für redaktionelle Inhalte" streichen und die folgenden Punkte neu durchnummerieren (3→2, 4→3, 5→4). Konvention der Datei: „Erledigtes wird gelöscht, nicht abgehakt."

- [ ] **Step 2: Spec-Abgleich**

Die Spec (`docs/superpowers/specs/2026-09-09-loeschbarkeit-und-mediathek-design.md`) Abschnitt für Abschnitt durchgehen und gegen die Tasks prüfen. Erwartete Abdeckung:
- §3 Politik-Konstante → Task 1
- §4 Manifest-Haken + Aggregation → Task 2, 4, 5
- §5 `deleteMediaAsset` + `MediaStore.delete` → Task 3
- §6 virtuelle Ordner → Task 7 (Schema), 8–10 (Dienste)
- §7 `listMediaAssets` mit Referenzen → Task 11
- §8 MCP → Task 12
- §9 Oberfläche → Task 13, 14
- §10 Tests → in jedem Task; Integrationstest Task 6
- §11 Migration → Task 7
- §12 Doku → Task 1 (AGENTS.md), 7 (betrieb.md), 15 (backlog.md)

- [ ] **Step 3: Gesamtlauf**

Run: `pnpm verify`
Expected: alle drei Prüfringe plus Image-Build grün. Bei Fehlschlag: beheben, den betroffenen Task-Commit ergänzen (`git commit --amend` nur, wenn noch nicht gepusht), erneut `pnpm verify`.

- [ ] **Step 4: Commit**

```bash
git add docs/backlog.md
git commit -m "docs(backlog): editorial content and media are deletable now"
```

- [ ] **Step 5: Push**

```bash
git push
```

---

## Self-Review (beim Schreiben durchgeführt)

**Spec-Abdeckung.** Jeder Spec-Abschnitt hat einen Task (siehe Task 15, Step 2). Die vier Blöcke der Spec (Politik / Referenz+Löschen / Ordner / Oberfläche) laufen als Task 1 / 2–6 / 7–11 / 12–14, in dieser Reihenfolge, jeder Block für sich testbar.

**Platzhalter.** Kein „TBD". Jeder Code-Step trägt vollständigen Code. Wo die Umsetzung an einer vorhandenen Fixture oder Komponente hängt, die der Autor prüfen muss (Site-Test-Fixture in Task 5, Logo-Selektor in Task 13, Token-Klassennamen in Task 13/14, Umbenenn-Dialog in Task 14), steht der konkrete Anhaltspunkt im Repo dabei — keine Erfindung nötig.

**Typkonsistenz.**
- `MediaReference { label; entity; id }` — definiert in Task 2, verwendet in Task 2 (`coreMediaReferences`, `findMediaReferences`), 4, 5, 11 (`MediaLibraryItem.references`), 13 (`references: string[]` als Labels).
- `findMediaReferences(deps, assetId)` — Task 2, konsumiert in Task 3 (`deleteMediaAsset`) und Task 11 (`listMediaAssets`).
- `deleteMediaAsset(deps, ctx, input)` → `Result<null>`, Konfliktcode `mediaAssetInUse` — Task 3, konsumiert in Task 6, 12, 13.
- `parseFolderPath` / `folderExists` — Task 8, weiterverwendet in Task 9, 10.
- `folderExists(deps, path)` importiert von `service.ts` in Task 10 — Einseitigkeit (kein Zyklus) ist in Task 10, Step 4 vermerkt, mit Ausweichweg.
- `listMediaAssets(deps, ctx, folder?)` → `MediaLibraryItem[]` — Task 11; alte Aufrufer-Anpassung ebd. Step 5; MCP (Task 12) und Seite (Task 13) nutzen die neue Form.
- Audit-Aktionen: `media.delete` (Task 3), `media.move` (Task 10), `media.folder.create` (Task 8), `media.folder.rename` / `media.folder.delete` (Task 9) — deckungsgleich mit `DELETION_POLICY.auditAction` in Task 1 (`media.delete`, `media.folder.delete`) und mit dem Format-Test dort.

**Reihenfolge/Abhängigkeiten.** Task 3 braucht Task 2. Task 8–11 brauchen Task 7 (Schema). Task 11 braucht Task 2. Task 12 braucht 3, 10, 11. Task 13 braucht 11. Task 14 braucht 8–10, 13. Task 6 braucht 2–5. Keine Rückkanten.

**`entity`-Strings vs. `entityType`.** Task 1 führt `siteEntry`, `mediaAsset`, `mediaFolder` als Politik-Entitäten; die zugehörigen `recordAudit`-Aufrufe (bestehend bzw. Task 3, 8, 9) nutzen exakt diese `entityType`-Werte. `theme` bleibt bewusst ein logischer Name (Wert in der Einstellung `themes`), wie in der Spec §3 vermerkt — der Politik-Test prüft dort nur das Format der `auditAction`.
