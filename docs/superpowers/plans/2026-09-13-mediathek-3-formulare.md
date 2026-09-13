# Mediathek Auswahl und Vorschau, Plan 3: Formulare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jedes Formular, das ein Medium braucht, wählt es über den `MediaChooserDialog`: Projektbild, Vorher/Nachher-Bild, Asset-Felder der Website-Formulare, das Logo in den Einstellungen und die Tierfotos mit Mehrfachauswahl. Die alten Upload-Wege der Formulare verschwinden.

**Architecture:** `MediaPicker` wird ein kontrollierter Baustein „Vorschau, Wählen, Entfernen“ mit verstecktem Feld und optionalem `onChange`; er öffnet den Dialog aus Plan 2. `AssetField` der Schema-Formulare und das Logo in den Einstellungen nutzen ihn. `PhotosEditor` öffnet den Dialog mit Mehrfachauswahl und mischt das Ergebnis in seine geordnete Liste. Der einzige Upload-Weg bleibt `uploadMediaAction` aus `admin/media/actions.ts`.

**Tech Stack:** React 19, next-intl, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-13-mediathek-auswahl-und-vorschau-design.md`, §7.

## Global Constraints

- Setzt Plan 2 voraus: `MediaChooserDialog`, `AssetGrid`, `/media/{id}/preview`.
- Kein UI-Text im Code; Schlüssel in `apps/kompass/messages/de.json`. Entfernte Bausteine nehmen ihre Schlüssel mit (`settings.logo.*`, `animals.photos.upload`, `content.chooseFile`), sonst bleiben tote Einträge.
- E2E-Selektoren nach Rolle und Beschriftung, wie in den bestehenden Specs.
- Commit je Task, kein Push. Vor jedem Commit `pnpm typecheck`, `pnpm --filter @kompass/app test` und die genannten E2E-Dateien grün.
- Commit-Nachrichten englisch, Attributionszeilen der Sitzung am Ende.

---

### Task 1: `MediaPicker` — Vorschau, Wählen, Entfernen

**Files:**
- Modify: `apps/kompass/src/components/forms/media-picker.tsx`
- Delete: `apps/kompass/src/app/(shell)/media-actions.ts`
- Modify: `apps/kompass/messages/de.json` (`content.choose`, `content.chooseFile` raus)
- Test: `apps/kompass/e2e/media.spec.ts` (Fall „opens the detail dialog and blocks deleting…“), `apps/kompass/e2e/projects.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export function MediaPicker(props: { name: string; value: string | null; label: string; kind?: 'image' | 'pdf'; onChange?: (id: string | null) => void })
  ```
  Rendert `<input type="hidden" name={name}>` mit der ID, eine Vorschau (`/media/{id}/preview`), Knopf „Wählen“ (`content.choose`) und bei Wert „Entfernen“ (`content.removeImage`). `onChange` wird bei jeder Änderung gerufen.

- [ ] **Step 1: E2E anpassen**

`apps/kompass/e2e/media.spec.ts`, Fall „opens the detail dialog and blocks deleting an asset that is in use“: die zwei Zeilen

```ts
    await page.getByLabel('Bild Datei wählen').setInputFiles({ name: 'hof.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('button', { name: 'Bild entfernen' })).toBeVisible();
```

ersetzen durch

```ts
    await page.getByRole('button', { name: 'Bild: Wählen' }).click();
    const chooser = page.getByRole('dialog', { name: 'Bild wählen' });
    await chooser.getByLabel('Hochladen').setInputFiles({ name: 'hof.png', mimeType: 'image/png', buffer: PNG });
    await expect(chooser).toBeHidden();
    await expect(page.getByRole('button', { name: 'Bild entfernen' })).toBeVisible();
```

Und in `apps/kompass/e2e/projects.spec.ts` einen Fall anhängen, der aus dem Bestand wählt:

```ts
  test('picks an existing image from the library for a project', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'bestand.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('row', { name: /bestand-/ })).toBeVisible();

    await page.goto('/projects');
    await page.getByRole('link', { name: 'Projekt anlegen' }).click();
    await page.getByLabel('Slug (URL-Teil)').fill('bestandsprojekt');
    await page.locator('[name="name.de"]').fill('Bestandsprojekt');
    await page.getByRole('button', { name: 'Bild: Wählen' }).click();
    const chooser = page.getByRole('dialog', { name: 'Bild wählen' });
    await chooser.getByLabel('Suchen').fill('bestand');
    await chooser.getByRole('button', { name: /bestand-/ }).click();
    await expect(chooser).toBeHidden();
    await expect(page.getByRole('button', { name: 'Bild entfernen' })).toBeVisible();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/projects\/[A-Z0-9]+$/);
    await expect(page.locator('input[name="imageAssetId"]')).toHaveValue(/^[0-9A-Z]{26}$/);
  });
```

`PNG` in `projects.spec.ts` wie in `media.spec.ts` als Konstante anlegen, falls es dort fehlt.

- [ ] **Step 2: Rot sehen**

```bash
pnpm --filter @kompass/app e2e -- media.spec.ts projects.spec.ts
```

Erwartung: FAIL — kein Knopf „Wählen“.

- [ ] **Step 3: Übersetzungen**

In `de.json` unter `content`: `"chooseFile": "Datei wählen"` entfernen, `"choose": "Wählen"` einfügen. `content.removeImage` bleibt.

- [ ] **Step 4: `MediaPicker` neu schreiben**

```tsx
// apps/kompass/src/components/forms/media-picker.tsx
'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { MediaChooserDialog } from '@/components/media/media-chooser-dialog';
import { Button } from '@/components/ui/button';

/**
 * Ein Medienfeld: Vorschau, „Wählen“, „Entfernen“. Hochladen gibt es hier
 * nicht mehr — das macht der Dialog, in den offenen Ordner der Mediathek.
 * Der Wert ist die Asset-ID im versteckten Feld; `onChange` für Formulare,
 * die ihren Zustand selbst halten (Einstellungen, Schema-Formulare).
 */
export function MediaPicker({
  name,
  value,
  label,
  kind = 'image',
  onChange,
}: {
  name: string;
  value: string | null;
  label: string;
  kind?: 'image' | 'pdf';
  onChange?: (id: string | null) => void;
}) {
  const t = useTranslations('content');
  const [assetId, setAssetId] = useState<string | null>(value);
  const [open, setOpen] = useState(false);
  const set = (id: string | null) => {
    setAssetId(id);
    onChange?.(id);
  };
  const isImage = kind === 'image';
  return (
    <div className="flex items-center gap-3">
      <input type="hidden" name={name} value={assetId ?? ''} />
      {assetId && isImage ? (
        <img src={`/media/${assetId}/preview`} alt="" className="size-14 rounded-md border border-line object-cover" />
      ) : assetId ? (
        <span className="grid size-14 place-items-center rounded-md border border-line bg-surface-2 text-[11px] font-semibold uppercase text-ink-2">{kind}</span>
      ) : (
        <div className="size-14 rounded-md border border-dashed border-line-strong bg-surface-2" aria-hidden />
      )}
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-ink-2">{label}</span>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" aria-label={`${label}: ${t('choose')}`} onClick={() => setOpen(true)}>
            {t('choose')}
          </Button>
          {assetId ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => set(null)}>
              {t('removeImage')}
            </Button>
          ) : null}
        </div>
      </div>
      <MediaChooserDialog open={open} onOpenChange={setOpen} kind={kind} multiple={false} selected={assetId ? [assetId] : []} onConfirm={(ids) => set(ids[0] ?? null)} />
    </div>
  );
}
```

Prüfe, dass `variant="secondary"` in `apps/kompass/src/components/ui/button.tsx` existiert (`logo-upload.tsx` nutzt es beim `SubmitButton`); sonst `variant="outline"` oder die Vorgabe.

Der Knopf heißt sichtbar überall „Wählen“; sein `aria-label` ist „<Label>: Wählen“, damit ein Screenreader und die E2E-Tests bei zwei Pickern in einem Formular (Vorher/Nachher) den richtigen treffen. Das Projektbild heißt `projects.form.image` — prüfe in `de.json`, dass es „Bild“ ist, sonst den Selektor in Step 1 anpassen.

- [ ] **Step 5: `media-actions.ts` entfernen**

```bash
git rm "apps/kompass/src/app/(shell)/media-actions.ts"
grep -rn "media-actions" apps/kompass/src
```

Erwartung: kein Treffer mehr.

- [ ] **Step 6: Grün sehen**

```bash
pnpm typecheck
pnpm --filter @kompass/app test
pnpm --filter @kompass/app e2e -- media.spec.ts projects.spec.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/kompass/src/components/forms/media-picker.tsx apps/kompass/messages/de.json apps/kompass/e2e/media.spec.ts apps/kompass/e2e/projects.spec.ts
git commit -m "feat(app): a media field chooses from the library — preview, choose, remove; uploading moved into the chooser"
```

---

### Task 2: Asset-Felder der Website-Formulare

**Files:**
- Modify: `apps/kompass/src/components/schema-form/field.tsx:207-230` (`AssetField`)
- Modify: `apps/kompass/messages/de.json` (`site.form.chooseImage` raus, falls danach ungenutzt)
- Test: `apps/kompass/e2e/site-template.spec.ts`

**Interfaces:**
- Consumes: `MediaPicker` mit `onChange` (Task 1); Feld-Metadaten `field.accept` (`asset()` in `packages/site-template/src/index.ts` schreibt `accept`, Vorgabe `image/*`, Dokumente-Sammlung `application/pdf`).

- [ ] **Step 1: E2E schreiben**

Öffne `apps/kompass/e2e/site-template.spec.ts` und finde den Fall, der die Variablen-Seite oder einen Sammlungseintrag speichert (Suche nach `'/site/variables'` oder `'/site/c/'`). Ergänze einen eigenen Fall:

```ts
  test('a variable of type asset is chosen from the library', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'startbild.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('row', { name: /startbild-/ })).toBeVisible();

    await page.goto('/site/variables');
    await page.getByRole('button', { name: 'Bild auf der Startseite: Wählen' }).click();
    const chooser = page.getByRole('dialog', { name: 'Bild wählen' });
    await chooser.getByRole('button', { name: /startbild-/ }).click();
    await expect(chooser).toBeHidden();
    await expect(page.locator('input[name="heroImage"]')).toHaveValue(/^[0-9A-Z]{26}$/);
  });
```

Die Beschriftung „Bild auf der Startseite“ ist das `label` von `heroImage` in `templates/verein-basis/kompass.template.ts`; die Playwright-Konfiguration setzt `SITE_TEMPLATE_DIR` auf dieses Template. Prüfe im bestehenden Spec, wie das Template eingelesen wird (ein Schritt „Template einlesen“ vor dem Variablen-Aufruf), und übernimm ihn in den `beforeEach` oder an den Anfang des Falls.

- [ ] **Step 2: Rot sehen**

```bash
pnpm --filter @kompass/app e2e -- site-template.spec.ts -g "chosen from the library"
```

- [ ] **Step 3: `AssetField` umstellen**

In `field.tsx` `AssetField` ersetzen:

```tsx
function AssetField({ path, field, value, errors, onChange }: FieldProps) {
  const assetId = typeof value === 'string' ? value : null;
  const accept = (field as { accept?: string }).accept;
  return (
    <div className="flex flex-col gap-1">
      <MediaPicker
        name={path}
        value={assetId}
        label={labelOf(field, path)}
        kind={accept === 'application/pdf' ? 'pdf' : 'image'}
        onChange={(id) => onChange(id)}
      />
      <FieldError id={`${path}-error`} message={errors[path]} />
    </div>
  );
}
```

Import ergänzen: `import { MediaPicker } from '@/components/forms/media-picker';`. Der Import von `useTranslations` bleibt, wenn andere Felder ihn nutzen. Prüfe, ob `accept` im `FieldSchema`-Typ (`packages/modules/site/src/types.ts`) steht; wenn nicht, bleibt der Cast wie oben, weil `asset()` das Feld in die Metadaten schreibt und `load.ts` sie 1:1 in das Schema übernimmt — verifiziere das mit `grep -n accept packages/modules/site/src/load.ts`; steht dort nichts, ist `accept` trotzdem Teil des JSON-Schemas, das `meta()` anhängt.

`site.form.chooseImage` entfernen, wenn es nirgends mehr gelesen wird (`grep -rn "chooseImage" apps/kompass/src`); `site.form.removeImage` ebenso prüfen.

- [ ] **Step 4: Grün sehen**

```bash
pnpm typecheck
pnpm --filter @kompass/app test
pnpm --filter @kompass/app e2e -- site-template.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/kompass/src/components/schema-form/field.tsx apps/kompass/messages/de.json apps/kompass/e2e/site-template.spec.ts
git commit -m "feat(app): asset fields of the website forms choose from the library, pdf fields see only pdfs"
```

---

### Task 3: Das Logo als Einstellungsfeld

**Files:**
- Modify: `apps/kompass/src/app/(shell)/admin/settings/settings-form.tsx:16,181`
- Delete: `apps/kompass/src/app/(shell)/admin/settings/logo-upload.tsx`, `apps/kompass/src/app/(shell)/admin/settings/logo-actions.ts`
- Modify: `apps/kompass/messages/de.json` (`settings.logo.*` → nur `settings.logo.label` und `settings.logo.hint` bleiben)
- Test: `apps/kompass/e2e/settings.spec.ts`

**Interfaces:**
- Consumes: `MediaPicker` mit `onChange`; `set(key, value)` in `SettingsForm`; `saveSettingsAction(changes)` schreibt `branding.logoAssetId` wie jede Einstellung.

- [ ] **Step 1: E2E schreiben**

In `apps/kompass/e2e/settings.spec.ts` anhängen (Setup wie die vorhandenen Fälle dort, `resetDatabase(page, 'seeded')` und `loginAsAdmin`):

```ts
  test('the logo is chosen from the library and saved with the settings', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('row', { name: /logo-/ })).toBeVisible();

    await page.goto('/admin/settings');
    await page.getByRole('tab', { name: 'Erscheinungsbild' }).click();
    await page.getByRole('button', { name: 'Logo: Wählen' }).click();
    const chooser = page.getByRole('dialog', { name: 'Bild wählen' });
    await chooser.getByRole('button', { name: /logo-/ }).click();
    await expect(chooser).toBeHidden();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status')).toContainText('gespeichert');

    await page.goto('/admin/media');
    await page.getByRole('row', { name: /logo-/ }).click();
    await expect(page.getByRole('dialog')).toContainText('Logo des Vereins');
  });
```

Prüfe die Tab-Beschriftung (`settings.tabs.branding` in `de.json`) und den Text der Speichern-Schaltfläche der `SaveBar`, und setze die Selektoren entsprechend.

- [ ] **Step 2: Rot sehen**

```bash
pnpm --filter @kompass/app e2e -- settings.spec.ts -g "logo"
```

- [ ] **Step 3: Umbau**

In `settings-form.tsx`: Import `LogoUpload` entfernen, `MediaPicker` importieren, und die Zeile

```tsx
          {tab.key === 'branding' ? <LogoUpload currentAssetId={String(values['branding.logoAssetId'] ?? '') || null} /> : null}
```

ersetzen durch

```tsx
          {tab.key === 'branding' ? (
            <div className="mb-4 flex flex-col gap-1 rounded-lg border border-line bg-surface p-6">
              <MediaPicker
                name="branding.logoAssetId"
                value={String(values['branding.logoAssetId'] ?? '') || null}
                label={t('logo.label')}
                onChange={(id) => set('branding.logoAssetId', id)}
              />
              <p className="text-[12px] text-muted-ink">{t('logo.hint')}</p>
            </div>
          ) : null}
```

`de.json`, `settings.logo` wird zu:

```json
    "logo": {
      "label": "Logo",
      "hint": "PNG oder SVG, mindestens 256 px. Erscheint in Sidebar, Login und Briefkopf."
    },
```

Dann:

```bash
git rm "apps/kompass/src/app/(shell)/admin/settings/logo-upload.tsx" "apps/kompass/src/app/(shell)/admin/settings/logo-actions.ts"
grep -rn "logo-upload\|logo-actions\|settings.logo\.\(file\|submit\|saved\|noFile\|current\)" apps/kompass/src apps/kompass/e2e
```

Erwartung: kein Treffer. Der Wert `null` für „Logo entfernt“ muss von der Einstellungsdefinition erlaubt sein — prüfe `branding.logoAssetId` in `packages/core/src/settings/` (Definition mit Zod-Schema); erlaubt sie nur `string`, ergänze `.nullable()` dort und einen Kern-Test in `packages/core/tests/settings*.test.ts`, der `null` schreibt.

- [ ] **Step 4: Grün sehen**

```bash
pnpm typecheck
pnpm --filter @kompass/app test
pnpm --filter @kompass/app e2e -- settings.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add "apps/kompass/src/app/(shell)/admin/settings/settings-form.tsx" apps/kompass/messages/de.json apps/kompass/e2e/settings.spec.ts
git commit -m "feat(app): the logo is a settings field chosen from the library; its own upload path is gone"
```

---

### Task 4: Tierfotos mit Mehrfachauswahl

**Files:**
- Modify: `apps/kompass/src/app/(shell)/animals/photos-editor.tsx`
- Modify: `apps/kompass/src/app/(shell)/animals/actions.ts:56-63` (`uploadAnimalPhotoAction` entfernen)
- Modify: `apps/kompass/messages/de.json` (`animals.photos.upload` → `animals.photos.choose`)
- Test: `apps/kompass/e2e/animals.spec.ts`

**Interfaces:**
- Consumes: `MediaChooserDialog` mit `multiple: true`; `setAnimalPhotosAction(id, photos)`.
- Produces: `PhotosEditor` ohne Dateifeld; Knopf „Fotos wählen“ öffnet den Dialog mit den aktuellen IDs.

- [ ] **Step 1: E2E anpassen**

In `apps/kompass/e2e/animals.spec.ts`, Fall „creates a dog, adds photos, publishes…“, die Zeilen

```ts
    await page.getByLabel(/Foto hochladen/).setInputFiles({ name: 'chiara-1.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('[data-testid="animal-photo"]')).toHaveCount(1);
```

ersetzen durch

```ts
    await page.getByRole('button', { name: 'Fotos wählen' }).click();
    const chooser = page.getByRole('dialog', { name: 'Bilder wählen' });
    await chooser.getByLabel('Hochladen').setInputFiles([
      { name: 'chiara-1.png', mimeType: 'image/png', buffer: PNG },
      { name: 'chiara-2.svg', mimeType: 'image/svg+xml', buffer: SVG },
    ]);
    await expect(chooser.getByText('2 ausgewählt')).toBeVisible();
    await chooser.getByRole('button', { name: 'Übernehmen' }).click();
    await expect(chooser).toBeHidden();
    await expect(page.locator('[data-testid="animal-photo"]')).toHaveCount(2);
```

und `SVG` als Konstante anlegen (zwei Dateien mit verschiedenen Bytes, sonst greift das Dedup und es gibt nur ein Asset):

```ts
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>');
```

Dazu einen zweiten Fall, der abwählt:

```ts
  test('unchecking a photo in the chooser removes it from the list', async ({ page }) => {
    await page.goto('/animals');
    await page.getByRole('link', { name: 'Tier anlegen' }).click();
    await page.getByLabel('Slug (URL-Teil)').fill('bo');
    await page.getByLabel('Name').fill('Bo');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/animals\/[A-Z0-9]+$/);
    await page.getByRole('tab', { name: 'Fotos' }).click();

    await page.getByRole('button', { name: 'Fotos wählen' }).click();
    let chooser = page.getByRole('dialog', { name: 'Bilder wählen' });
    await chooser.getByLabel('Hochladen').setInputFiles([
      { name: 'bo-1.png', mimeType: 'image/png', buffer: PNG },
      { name: 'bo-2.svg', mimeType: 'image/svg+xml', buffer: SVG },
    ]);
    await chooser.getByRole('button', { name: 'Übernehmen' }).click();
    await expect(page.locator('[data-testid="animal-photo"]')).toHaveCount(2);

    await page.getByRole('button', { name: 'Fotos wählen' }).click();
    chooser = page.getByRole('dialog', { name: 'Bilder wählen' });
    await chooser.getByRole('button', { name: /bo-2-/ }).click();
    await expect(chooser.getByText('1 ausgewählt')).toBeVisible();
    await chooser.getByRole('button', { name: 'Übernehmen' }).click();
    await expect(page.locator('[data-testid="animal-photo"]')).toHaveCount(1);
  });
```

Übernimm die Pflichtfelder des Tierformulars aus dem ersten Fall der Datei (Slug, Name, ggf. Geschlecht), damit das Speichern durchgeht.

- [ ] **Step 2: Rot sehen**

```bash
pnpm --filter @kompass/app e2e -- animals.spec.ts
```

- [ ] **Step 3: Übersetzung und Editor**

`de.json`, `animals.photos`: `"upload": "Foto hochladen"` → `"choose": "Fotos wählen"`.

`photos-editor.tsx`:

```tsx
'use client';

import type { AnimalPhoto } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { MediaChooserDialog } from '@/components/media/media-chooser-dialog';
import { Button } from '@/components/ui/button';
import { setAnimalPhotosAction } from './actions';

type Photo = { assetId: string; isPrimary: boolean };

/**
 * Neue IDs hängen hinten an, abgewählte fallen weg, die Reihenfolge der
 * bleibenden bleibt. Das Hauptfoto bleibt, wenn es noch dabei ist, sonst
 * wird das erste zum Hauptfoto.
 */
export function mergePhotos(current: Photo[], chosen: string[]): Photo[] {
  const keep = current.filter((p) => chosen.includes(p.assetId));
  const known = new Set(keep.map((p) => p.assetId));
  const added = chosen.filter((id) => !known.has(id)).map((assetId) => ({ assetId, isPrimary: false }));
  const next = [...keep, ...added];
  if (next.length > 0 && !next.some((p) => p.isPrimary)) next[0] = { ...next[0]!, isPrimary: true };
  return next;
}

export function PhotosEditor({ animalId, initial }: { animalId: string; initial: AnimalPhoto[] }) {
  const t = useTranslations('animals.photos');
  const [photos, setPhotos] = useState<Photo[]>(initial.map((p) => ({ assetId: p.assetId, isPrimary: p.isPrimary })));
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const move = (i: number, d: number) => setPhotos((p) => { const n = [...p]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); return n; });
  return (
    <div className="flex flex-col gap-4">
      <Button type="button" variant="secondary" className="w-fit" onClick={() => setOpen(true)}>{t('choose')}</Button>
      <MediaChooserDialog open={open} onOpenChange={setOpen} kind="image" multiple selected={photos.map((p) => p.assetId)} onConfirm={(ids) => setPhotos((p) => mergePhotos(p, ids))} />
      <ul className="grid gap-3 md:grid-cols-4">
        {photos.map((p, i) => (
          <li key={p.assetId} data-testid="animal-photo" className={`flex flex-col gap-1 rounded-md border p-2 ${p.isPrimary ? 'border-brand' : 'border-line'}`}>
            <img src={`/media/${p.assetId}/preview`} alt="" className="aspect-[4/3] w-full rounded-sm object-cover" />
            <div className="flex flex-wrap gap-1 text-[12px]">
              <Button type="button" size="sm" variant={p.isPrimary ? 'default' : 'ghost'} onClick={() => setPhotos(photos.map((x, j) => ({ ...x, isPrimary: j === i })))}>{t('primary')}</Button>
              <Button type="button" size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)}>←</Button>
              <Button type="button" size="sm" variant="ghost" disabled={i === photos.length - 1} onClick={() => move(i, 1)}>→</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setPhotos(photos.filter((_, j) => j !== i))}>{t('remove')}</Button>
            </div>
          </li>
        ))}
      </ul>
      <Button type="button" className="w-fit" disabled={pending} onClick={() => start(async () => { const s = await setAnimalPhotosAction(animalId, photos); if (s.status === 'error') toast.error(s.message); else toast.success(s.status === 'success' ? s.message ?? '' : ''); })}>{t('save')}</Button>
    </div>
  );
}
```

`mergePhotos` ist rein und bekommt einen Vitest in `apps/kompass/tests/animal-photos-merge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mergePhotos } from '@/app/(shell)/animals/photos-editor';

describe('mergePhotos', () => {
  it('keeps order and primary, appends new, drops unchecked, promotes the first when the primary left', () => {
    const current = [{ assetId: 'A', isPrimary: false }, { assetId: 'B', isPrimary: true }, { assetId: 'C', isPrimary: false }];
    expect(mergePhotos(current, ['C', 'A', 'D'])).toEqual([{ assetId: 'A', isPrimary: false }, { assetId: 'C', isPrimary: false }, { assetId: 'D', isPrimary: false }].map((p, i) => (i === 0 ? { ...p, isPrimary: true } : p)));
    expect(mergePhotos(current, ['B', 'A'])).toEqual([{ assetId: 'A', isPrimary: false }, { assetId: 'B', isPrimary: true }]);
    expect(mergePhotos(current, [])).toEqual([]);
  });
});
```

Der Import einer `'use client'`-Datei in einem Node-Vitest funktioniert, weil `'use client'` nur eine Direktive ist; `next-intl` und `sonner` werden aber beim Import geladen. Schlägt der Import fehl, verschiebe `mergePhotos` nach `apps/kompass/src/app/(shell)/animals/photos-merge.ts` (reine Datei ohne React) und importiere sie von dort in Editor und Test.

Aus `actions.ts` `uploadAnimalPhotoAction` samt ungenutzter Imports entfernen.

- [ ] **Step 4: Grün sehen**

```bash
pnpm typecheck
pnpm --filter @kompass/app test
pnpm --filter @kompass/app e2e -- animals.spec.ts
grep -rn "uploadAnimalPhotoAction\|photos.upload" apps/kompass/src apps/kompass/e2e
```

Erwartung: grün, kein Treffer.

- [ ] **Step 5: Commit**

```bash
git add "apps/kompass/src/app/(shell)/animals/photos-editor.tsx" "apps/kompass/src/app/(shell)/animals/actions.ts" apps/kompass/messages/de.json apps/kompass/e2e/animals.spec.ts apps/kompass/tests/animal-photos-merge.test.ts
git commit -m "feat(app): animal photos are chosen from the library, several at once; order and primary photo stay"
```

(Falls `photos-merge.ts` entstanden ist, mit hinzufügen.)

---

## Self-Review

**Spec §7:** `MediaPicker` (Task 1), drei Stellen unverändert außer dem Picker (Task 1 deckt Projekt und Geschichte, weil beide den Picker importieren), `AssetField` mit `kind` aus `accept` (Task 2), Logo als Einstellungsfeld ohne eigenen Upload (Task 3), `PhotosEditor` mit Mehrfachauswahl und Mischregel (Task 4), `media-actions.ts` und `uploadAnimalPhotoAction` entfallen (Task 1, 4).
**Typkonsistenz:** `MediaPicker`-Props (`name, value, label, kind?, onChange?`) in Task 1 definiert, in Task 2 und 3 so genutzt; `MediaChooserDialog`-Props aus Plan 2 (`open, onOpenChange, kind, multiple, selected, onConfirm`) in Task 1 und 4 gleich.
**E2E-Namen:** Dialogtitel „Bild wählen“ / „Bilder wählen“ aus `media.chooser.titleImage/titleMultiple` (Plan 2), Upload-Feld „Hochladen“ aus `media.chooser.upload`, Suchfeld „Suchen“ aus `media.search`, Knöpfe „<Label>: Wählen“ per `aria-label`.
