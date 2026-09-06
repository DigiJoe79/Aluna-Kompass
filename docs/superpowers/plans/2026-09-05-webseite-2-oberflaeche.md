# Webseite Teil 2: Oberfläche der Module — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Kompass-Oberfläche für das Webseiten- und das Tiermodul bauen: zweisprachige Felder mit Markdown-Vorschau, Seiten mit Bausteinen, Artikel, Team, FAQ, Projekte, Downloads, Site-Fakten, Hunde mit Fotos und Erfolgsgeschichte, die Publizieren-Seite in ihrer ersten Stufe (Prüfung) und die Webseiten-Karte auf der Startseite — mit Playwright als treibendem Test je Screen.

**Architecture:** Wie Plan 2: Server Components lesen über Services, Server Actions rufen Services und mappen `Result` über `toActionState`. Neue gemeinsame Bausteine: `LocalizedField` (DE/EN nebeneinander, optional Markdown-Vorschau über eine Server Action mit `@kompass/markdown`), `PublishSwitch`, `ReorderButtons`, `MediaPicker` (Upload in den Medienspeicher + Auswahl). Formulare übergeben zweisprachige Felder als `name.de`/`name.en`; ein Helfer liest sie aus `FormData`. Keine Fachlogik in der App.

**Tech Stack:** wie Plan 2 (Next.js 16, React 19, shadcn, next-intl, Playwright) plus `@kompass/markdown`, `@kompass/module-website`, `@kompass/module-animals`.

**Spec:** `docs/superpowers/specs/2026-09-05-webseite-design.md` — Abschnitt 4 (Oberfläche) vollständig, Abschnitt 3 „Publizieren" nur die Prüfstufe (Vorschau-Build, Diff und Publish kommen in `webseite-3-site-und-publish`, das die Publizieren-Seite erweitert).

**Voraussetzung:** Plan `webseite-1-module` umgesetzt; `pnpm test` grün.

## Global Constraints

- Alle Regeln aus Plan 2: keine Farbliterale in `apps/kompass/src`, kein hartcodierter UI-Text, Rechte serverseitig je Seite und Action, kein Löschen-Knopf (unveröffentlicht = weg von der Seite), Handoff-Maße.
- **Zweisprachige Felder:** DE links, EN rechts, gleiche Höhe; Markdown-Felder mit gerenderter Vorschau (Umschalter DE/EN); fehlendes EN als Hinweis „unübersetzt", nie als Fehler; Zähler offener Übersetzungen im Seitenkopf.
- **Formularkonvention:** zweisprachige Felder heißen `<feld>.de` und `<feld>.en`; Listen (Bausteine, Fotos, Wesensmerkmale) reisen als JSON in einem Hidden-Input `<feld>__json`, gepflegt von einer Client-Komponente.
- **Markdown-Vorschau** nutzt ausschließlich `renderMarkdown` aus `@kompass/markdown`; die Vorschau zeigt HTML mit den Klassen `note` und `cards`, gestylt über Tokens.
- **Sperrwortliste** erscheint im Formular nur als Liste von Begriffen; der Hilfetext erklärt den Zweck, ohne Namen.

---

## Dateistruktur (Ergebnis dieses Plans)

```
apps/kompass/src/
  lib/localized-form.ts                 localizedFromForm, gapCount (rein)
  lib/markdown-preview.ts               'use server' renderMarkdownAction
  components/forms/localized-field.tsx  DE/EN-Paar (input | textarea | markdown mit Vorschau)
  components/forms/publish-switch.tsx   Schalter „veröffentlicht" mit Action
  components/forms/reorder-buttons.tsx  ↑↓ mit Action
  components/forms/media-picker.tsx     Bild wählen/hochladen, zeigt /media/:id
  components/markdown-preview.tsx       gerendertes HTML (Client, debounced)
  components/gap-counter.tsx            „n Übersetzungen offen"
  app/(shell)/website/layout.tsx        Modulgate (website aktiv?) + Rechte
  app/(shell)/website/pages/page.tsx  [key]/page.tsx  [key]/page-form.tsx  [key]/blocks-editor.tsx  actions.ts
  app/(shell)/website/articles/page.tsx  [id]/page.tsx  article-form.tsx  actions.ts
  app/(shell)/website/team/page.tsx  team-form.tsx  actions.ts
  app/(shell)/website/faqs/page.tsx  faq-form.tsx  actions.ts
  app/(shell)/website/projects/page.tsx  [id]/page.tsx  project-form.tsx  actions.ts
  app/(shell)/website/downloads/page.tsx  actions.ts
  app/(shell)/website/facts/page.tsx  facts-form.tsx  actions.ts
  app/(shell)/website/publish/page.tsx  check-card.tsx  actions.ts
  app/(shell)/animals/layout.tsx  page.tsx  [id]/page.tsx  animal-form.tsx  photos-editor.tsx  story-form.tsx  status-dialog.tsx  actions.ts
  app/(shell)/page.tsx                   + Karte „Webseite"
  app/__e2e/reset/route.ts               + modules aktivieren
  tests/localized-form.test.ts
  e2e/website-pages.spec.ts  website-lists.spec.ts  website-facts.spec.ts  animals.spec.ts  website-publish.spec.ts
messages/de.json                         Namensräume website.*, animals.*
```

---

### Task 1: Gemeinsame Bausteine — zweisprachige Felder, Markdown-Vorschau, Schalter, Sortierung, Medienwahl

**Files:**
- Create: `src/lib/localized-form.ts`, `src/lib/markdown-preview.ts`, `src/components/forms/localized-field.tsx`, `src/components/markdown-preview.tsx`, `src/components/forms/publish-switch.tsx`, `src/components/forms/reorder-buttons.tsx`, `src/components/forms/media-picker.tsx`, `src/components/gap-counter.tsx`, `src/app/(shell)/website/layout.tsx`, `src/app/(shell)/animals/layout.tsx`, `src/app/(shell)/website/media-actions.ts`
- Modify: `packages/core/src/seed/seed.ts` (installierte Module aktivieren), `apps/kompass/src/app/__e2e/reset/route.ts` (unverändert nutzbar), `messages/de.json`
- Test: `tests/localized-form.test.ts`, `packages/core/tests/seed.test.ts` (+ Modulaktivierung)

**Interfaces:**
- Produces:
  - `localizedFromForm(formData, name, fallback?) → { de: string; en: string }`; `jsonFromForm<T>(formData, name, fallback: T) → T` (liest `<name>__json`); `gapCount(record, fields) → number`.
  - `renderMarkdownAction(markdown: string) → Promise<string>` (Server Action, kein Recht nötig: reine Transformation ohne Daten).
  - `<LocalizedField name label kind="input"|"textarea"|"markdown" value rows? hint? errors? required?>` — rendert `name.de`/`name.en`; bei `markdown` darunter `<MarkdownPreview>` mit DE/EN-Umschalter.
  - `<PublishSwitch id isPublished action={(id, next) => Promise<ActionState>} />`, `<ReorderButtons ids index action={(ids) => Promise<ActionState>} />`, `<MediaPicker name value accept label />` (Upload über `uploadMediaAction(formData) → ActionState` mit `storeMediaAsset`, zeigt Vorschau `/media/:id`, Hidden-Input `name`).
  - `<GapCounter count />`.
  - `website/layout.tsx` und `animals/layout.tsx`: rendern die Kinder nur, wenn das Modul aktiv ist (`isModuleEnabled`), sonst eine Karte „Modul nicht aktiv" mit Link zu Verwaltung → Module.
  - Seed: aktiviert alle installierten Nicht-Kern-Module (`modules.enabled`), damit Dev und E2E die Modulseiten sehen.

- [x] **Step 1: Tests schreiben**

`apps/kompass/tests/localized-form.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { gapCount, jsonFromForm, localizedFromForm } from '@/lib/localized-form';

describe('localized form helpers', () => {
  it('reads de/en pairs and trims', () => {
    const fd = new FormData();
    fd.set('title.de', ' Hallo ');
    fd.set('title.en', '');
    expect(localizedFromForm(fd, 'title')).toEqual({ de: 'Hallo', en: '' });
    expect(localizedFromForm(fd, 'missing')).toEqual({ de: '', en: '' });
  });
  it('parses json lists with fallback', () => {
    const fd = new FormData();
    fd.set('blocks__json', JSON.stringify([{ id: 'a' }]));
    expect(jsonFromForm(fd, 'blocks', [])).toEqual([{ id: 'a' }]);
    expect(jsonFromForm(fd, 'nope', [1])).toEqual([1]);
    fd.set('broken__json', '{');
    expect(jsonFromForm(fd, 'broken', 'fallback')).toBe('fallback');
  });
  it('counts translation gaps', () => {
    expect(gapCount({ title: { de: 'A', en: '' }, lede: { de: 'B', en: 'C' }, body: { de: '', en: '' } }, ['title', 'lede', 'body'])).toBe(1);
  });
});
```

`packages/core/tests/seed.test.ts` ergänzen:
```ts
it('enables all installed non-core modules', async () => {
  const finance = defineModule({ key: 'finance', version: '0', permissions: ['finance.view'] });
  const deps = createTestDeps({ env: 'development', manifests: [coreModule, finance] });
  await seedDevelopment(deps);
  expect(readSetting(deps, 'modules.enabled')).toEqual(['finance']);
});
```
(`defineModule`, `coreModule`, `readSetting` importieren.)

- [x] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app test tests/localized-form.test.ts; pnpm --filter @kompass/core test tests/seed.test.ts`
Expected: FAIL.

- [x] **Step 3: Helfer und Seed**

`src/lib/localized-form.ts`:
```ts
import { translationGaps, type LocalizedText } from '@kompass/core';

export function localizedFromForm(formData: FormData, name: string): LocalizedText {
  const read = (locale: 'de' | 'en') => String(formData.get(`${name}.${locale}`) ?? '').trim();
  return { de: read('de'), en: read('en') };
}

export function jsonFromForm<T>(formData: FormData, name: string, fallback: T): T {
  const raw = formData.get(`${name}__json`);
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function gapCount(record: Record<string, unknown>, fields: string[]): number {
  return translationGaps(record, fields).length;
}
```

In `packages/core/src/seed/seed.ts` nach dem Setup-Block ergänzen:
```ts
const installed = deps.registry.manifests.map((m) => m.key).filter((k) => k !== 'core').sort();
deps.db.transaction((tx) => { writeSettingInternal(tx, deps, ctx, 'modules.enabled', installed, 'seed.modules'); });
```
(`writeSettingInternal` importieren; `ctx` ist der bereits vorhandene Seed-Kontext.)

`src/lib/markdown-preview.ts`:
```ts
'use server';

import { renderMarkdown } from '@kompass/markdown';
import { requireSession } from '@/lib/request-context';

export async function renderMarkdownAction(markdown: string): Promise<string> {
  await requireSession();
  return renderMarkdown(String(markdown ?? '').slice(0, 40_000));
}
```

- [x] **Step 4: Komponenten**

`src/components/markdown-preview.tsx`:
```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { renderMarkdownAction } from '@/lib/markdown-preview';

export function MarkdownPreview({ markdown }: { markdown: string }) {
  const t = useTranslations('website.common');
  const [html, setHtml] = useState('');
  useEffect(() => {
    const handle = setTimeout(() => { renderMarkdownAction(markdown).then(setHtml).catch(() => setHtml('')); }, 300);
    return () => clearTimeout(handle);
  }, [markdown]);
  if (!markdown.trim()) return <p className="text-[12px] text-muted-ink">{t('previewEmpty')}</p>;
  return <div className="prose-preview rounded-md border border-line bg-surface p-4 text-[14px]" dangerouslySetInnerHTML={{ __html: html }} />;
}
```
In `globals.css` (Layer `base`) die Vorschau-Stile ergänzen, nur mit Tokens:
```css
.prose-preview h1, .prose-preview h2, .prose-preview h3 { font-family: var(--font-heading); margin: 0.8em 0 0.3em; }
.prose-preview h1 em, .prose-preview h2 em, .prose-preview h3 em { font-style: normal; color: var(--color-primary); }
.prose-preview p, .prose-preview ul, .prose-preview ol { margin: 0 0 0.75em; }
.prose-preview .note { border-left: 3px solid var(--color-warning); background: var(--color-warning-bg); padding: 8px 12px; border-radius: var(--radius-sm); }
.prose-preview .cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
.prose-preview .card { border: 1px solid var(--line); border-radius: var(--radius-md); padding: 10px 12px; background: var(--surface-2); }
.prose-preview a { color: var(--link); text-decoration: underline; }
```

`src/components/forms/localized-field.tsx`:
```tsx
'use client';

import type { LocalizedText } from '@kompass/core';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { FieldError } from './field-error';
import { MarkdownPreview } from '../markdown-preview';

export function LocalizedField({ name, label, kind = 'input', value, rows = 4, hint, errors, required }: { name: string; label: string; kind?: 'input' | 'textarea' | 'markdown'; value: LocalizedText; rows?: number; hint?: string; errors?: Record<string, string>; required?: boolean }) {
  const t = useTranslations('website.common');
  const [text, setText] = useState<LocalizedText>(value);
  const [previewLocale, setPreviewLocale] = useState<'de' | 'en'>('de');
  const error = errors?.[name] ?? errors?.[`${name}.de`];
  const field = (locale: 'de' | 'en') => {
    const id = `${name}-${locale}`;
    const props = { id, name: `${name}.${locale}`, value: text[locale], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText({ ...text, [locale]: e.target.value }), required: required && locale === 'de', 'aria-invalid': locale === 'de' && !!error ? true : undefined };
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <Label htmlFor={id} className="flex items-center gap-2 text-[12px] font-semibold text-muted-ink">
          <span className="rounded-sm bg-badge px-1.5 py-0.5 font-mono text-[10px] text-badge-ink">{locale.toUpperCase()}</span>
          {locale === 'en' && text.de.length > 0 && text.en.length === 0 ? <span className="text-warning">{t('untranslated')}</span> : null}
        </Label>
        {kind === 'input' ? <Input {...props} className="h-9" /> : <Textarea {...props} rows={rows} className={cn(kind === 'markdown' && 'font-mono text-[13px]')} />}
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-1.5 md:col-span-2">
      <span className="text-[13px] font-semibold text-ink-2">{label}{required ? ' *' : ''}</span>
      <div className="grid gap-3 md:grid-cols-2">{field('de')}{field('en')}</div>
      {hint && !error ? <p className="text-[12px] text-muted-ink">{hint}</p> : null}
      <FieldError id={`${name}-error`} message={error} />
      {kind === 'markdown' ? (
        <div className="mt-1 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="text-muted-ink">{t('preview')}</span>
            {(['de', 'en'] as const).map((l) => <button key={l} type="button" aria-pressed={previewLocale === l} onClick={() => setPreviewLocale(l)} className={cn('rounded-sm px-2 py-0.5 font-mono', previewLocale === l ? 'bg-brand text-on-brand' : 'bg-badge text-badge-ink')}>{l.toUpperCase()}</button>)}
          </div>
          <MarkdownPreview markdown={text[previewLocale]} />
        </div>
      ) : null}
    </div>
  );
}
```

`src/components/forms/publish-switch.tsx`:
```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import type { ActionState } from '@/lib/actions';

export function PublishSwitch({ id, isPublished, action, label }: { id: string; isPublished: boolean; action: (id: string, next: boolean) => Promise<ActionState>; label?: string }) {
  const t = useTranslations('website.common');
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <Switch checked={isPublished} disabled={pending} aria-label={label ?? t('published')} onCheckedChange={(next) => start(async () => { const s = await action(id, next); if (s.status === 'error') toast.error(s.message); })} />
      <span className={isPublished ? 'text-success' : 'text-muted-ink'}>{isPublished ? t('published') : t('unpublished')}</span>
    </label>
  );
}
```

`src/components/forms/reorder-buttons.tsx`:
```tsx
'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { ActionState } from '@/lib/actions';

export function ReorderButtons({ ids, index, action }: { ids: string[]; index: number; action: (ids: string[]) => Promise<ActionState> }) {
  const t = useTranslations('website.common');
  const [pending, start] = useTransition();
  const move = (delta: number) => {
    const next = [...ids];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    start(async () => { const s = await action(next); if (s.status === 'error') toast.error(s.message); });
  };
  return (
    <span className="inline-flex gap-1">
      <Button variant="ghost" size="icon" aria-label={t('moveUp')} disabled={pending || index === 0} onClick={() => move(-1)}><ArrowUp className="size-4" /></Button>
      <Button variant="ghost" size="icon" aria-label={t('moveDown')} disabled={pending || index === ids.length - 1} onClick={() => move(1)}><ArrowDown className="size-4" /></Button>
    </span>
  );
}
```

`src/app/(shell)/website/media-actions.ts`:
```ts
'use server';

import { storeMediaAsset } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function uploadMediaAction(formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('website.common.noFile'), fieldErrors: {} };
  const result = await storeMediaAsset(deps, ctx, { originalName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), declaredMimeType: file.type });
  return toActionState(result, t);
}
```

`src/components/forms/media-picker.tsx`:
```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { uploadMediaAction } from '@/app/(shell)/website/media-actions';

export function MediaPicker({ name, value, label, accept = 'image/png,image/jpeg,image/webp,image/svg+xml' }: { name: string; value: string | null; label: string; accept?: string }) {
  const t = useTranslations('website.common');
  const [assetId, setAssetId] = useState<string | null>(value);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const upload = (file: File) => start(async () => {
    const fd = new FormData();
    fd.set('file', file);
    const s = await uploadMediaAction(fd);
    if (s.status === 'success') setAssetId((s.data as { id: string }).id);
    else if (s.status === 'error') toast.error(s.message);
  });
  return (
    <div className="flex items-center gap-3">
      <input type="hidden" name={name} value={assetId ?? ''} />
      {assetId ? <img src={`/media/${assetId}`} alt="" className="size-14 rounded-md border border-line object-cover" /> : <div className="size-14 rounded-md border border-dashed border-line-strong bg-surface-2" aria-hidden />}
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-ink-2">{label}</span>
        <div className="flex gap-2">
          <input ref={input} type="file" accept={accept} aria-label={`${label} ${t('chooseFile')}`} className="text-[12px]" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} disabled={pending} />
          {assetId ? <Button type="button" variant="ghost" size="sm" onClick={() => setAssetId(null)}>{t('removeImage')}</Button> : null}
        </div>
      </div>
    </div>
  );
}
```

`src/components/gap-counter.tsx`:
```tsx
import { useTranslations } from 'next-intl';

export function GapCounter({ count }: { count: number }) {
  const t = useTranslations('website.common');
  return <span className={count > 0 ? 'rounded-sm bg-warning-bg px-2 py-0.5 text-[12px] font-semibold text-warning' : 'text-[12px] text-muted-ink'}>{t('gaps', { count })}</span>;
}
```

`src/app/(shell)/website/layout.tsx`:
```tsx
import { isModuleEnabled } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { requireSession } from '@/lib/request-context';

export default async function WebsiteLayout({ children }: { children: ReactNode }) {
  const { deps } = await requireSession();
  if (isModuleEnabled(deps, 'website')) return <>{children}</>;
  const t = await getTranslations('website.common');
  return (
    <section className="max-w-[720px] rounded-lg border border-line bg-surface p-7">
      <h2 className="font-heading text-[20px]">{t('moduleInactiveTitle')}</h2>
      <p className="mt-2 text-[14px] text-ink-2">{t('moduleInactiveText')}</p>
      <Button asChild className="mt-4"><Link href="/admin/modules">{t('openModules')}</Link></Button>
    </section>
  );
}
```
`src/app/(shell)/animals/layout.tsx` identisch mit `'animals'` und Namensraum `animals.common`.

`messages/de.json` — Namensraum `website.common` und `animals.common`:
```json
"website": {
  "common": { "preview": "Vorschau", "previewEmpty": "Noch kein Text.", "untranslated": "unübersetzt", "published": "Veröffentlicht", "unpublished": "Nicht veröffentlicht", "moveUp": "Nach oben", "moveDown": "Nach unten", "chooseFile": "Datei wählen", "removeImage": "Bild entfernen", "noFile": "Bitte eine Datei auswählen.", "gaps": "{count, plural, =0 {Alle Übersetzungen vorhanden} one {# Übersetzung offen} other {# Übersetzungen offen}}", "moduleInactiveTitle": "Modul Webseite ist nicht aktiv", "moduleInactiveText": "Aktivieren Sie das Modul unter Verwaltung → Module. Vorhandene Inhalte bleiben erhalten.", "openModules": "Module öffnen", "save": "Speichern", "saved": "Gespeichert.", "create": "Anlegen", "back": "Zurück zur Liste", "slug": "Slug (URL-Teil)", "slugHint": "Kleinbuchstaben, Ziffern, Bindestrich. Sprachneutral." }
},
"animals": {
  "common": { "moduleInactiveTitle": "Modul Tiere ist nicht aktiv", "moduleInactiveText": "Aktivieren Sie das Modul unter Verwaltung → Module. Vorhandene Daten bleiben erhalten.", "openModules": "Module öffnen" }
}
```

- [x] **Step 5: Tests ausführen**

Run: `pnpm --filter @kompass/core test && pnpm --filter @kompass/app test && pnpm --filter @kompass/app typecheck`
Expected: grün. Der Literal-Scanner bleibt grün (Vorschau-Stile nutzen nur Variablen).

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(app): bilingual field with markdown preview, publish switch, reorder, media picker, module gates"
```

---

### Task 2: Seiten mit Bausteinen

**Files:**
- Create: `src/app/(shell)/website/pages/page.tsx`, `[key]/page.tsx`, `[key]/page-form.tsx`, `[key]/blocks-editor.tsx`, `pages/actions.ts`
- Test: `e2e/website-pages.spec.ts`

**Interfaces:**
- Consumes: `listPages`, `getPage`, `updatePage`, `WEBSITE_PAGE_KEYS`, `LocalizedField`, `MediaPicker`, `localizedFromForm`, `jsonFromForm`.
- Produces: `updatePageAction(prev, formData)`; Seitenlabels über `website.pages.keys.<key>`.

- [x] **Step 1: E2E-Test schreiben**

`apps/kompass/e2e/website-pages.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('website pages', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('lists the twelve fixed pages with gap counters and edits one with preview and blocks', async ({ page }) => {
    await page.goto('/website/pages');
    await expect(page.getByRole('row')).toHaveCount(13);
    await expect(page.getByRole('row', { name: /Helfen/ })).toBeVisible();
    await page.getByRole('link', { name: 'Helfen' }).click();
    await expect(page).toHaveURL('/website/pages/help');
    await page.getByLabel('DE', { exact: true }).first().fill('Es gibt viele Wege, ein Leben zu *verändern.*');
    await page.locator('[name="body.de"]').fill('## Unsere *Spendenboxen.*\n\n> Wir freuen uns über jeden Cent.\n\n:::karten\n### Köln-Porz\nBäckerei am Markt.\n:::');
    await expect(page.locator('.prose-preview .note')).toContainText('Wir freuen uns über jeden Cent.');
    await expect(page.locator('.prose-preview .card h3')).toHaveText('Köln-Porz');
    await page.getByRole('button', { name: 'Baustein hinzufügen' }).click();
    await page.getByLabel('Baustein-ID').fill('donate');
    await page.locator('[name="block-title.de"]').fill('Spenden');
    await page.locator('[name="block-href"]').fill('/spenden/');
    await page.getByRole('button', { name: 'Baustein übernehmen' }).click();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Gespeichert');
    await page.reload();
    await expect(page.locator('[name="title.de"]')).toHaveValue('Es gibt viele Wege, ein Leben zu *verändern.*');
    await expect(page.getByText('Spenden', { exact: true })).toBeVisible();
    await expect(page.getByText(/Übersetzung(en)? offen/)).toBeVisible();
  });

  test('is forbidden without website.view', async ({ page }) => {
    await page.goto('/admin/users');
    await page.getByRole('row', { name: /Peter Lang/ }).getByRole('button', { name: 'Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Neues Startpasswort' }).click();
    const pw = (await page.getByTestId('start-password').textContent())!.trim();
    await page.getByRole('button', { name: 'Ich habe die Daten notiert' }).click();
    await page.request.post('/logout');
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill('peter@kompass.local');
    await page.getByLabel('Passwort').fill(pw);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.getByLabel('Startpasswort').fill(pw);
    await page.getByLabel('Neues Passwort', { exact: true }).fill('peter-hat-ein-neues-passwort');
    await page.getByLabel('Passwort wiederholen').fill('peter-hat-ein-neues-passwort');
    await page.getByRole('button', { name: 'Passwort setzen und fortfahren' }).click();
    await page.goto('/website/pages');
    await expect(page.getByText('website.view')).toBeVisible();
  });
});
```

- [x] **Step 2: E2E ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app e2e e2e/website-pages.spec.ts`
Expected: FAIL — 404.

- [x] **Step 3: Actions, Liste, Formular, Bausteine**

`src/app/(shell)/website/pages/actions.ts`:
```ts
'use server';

import { updatePage } from '@kompass/module-website';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { jsonFromForm, localizedFromForm } from '@/lib/localized-form';
import { requireSession } from '@/lib/request-context';

export async function updatePageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const key = String(formData.get('key') ?? '');
  const result = await updatePage(deps, ctx, {
    key,
    title: localizedFromForm(formData, 'title'),
    lede: localizedFromForm(formData, 'lede'),
    body: localizedFromForm(formData, 'body'),
    metaDescription: localizedFromForm(formData, 'metaDescription'),
    blocks: jsonFromForm(formData, 'blocks', []),
  });
  revalidatePath('/website/pages');
  return toActionState(result, t, t('website.common.saved'));
}
```

`src/app/(shell)/website/pages/page.tsx`:
```tsx
import { requirePermission } from '@kompass/core';
import { listPages } from '@kompass/module-website';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ForbiddenCard } from '@/components/forbidden-card';
import { GapCounter } from '@/components/gap-counter';
import { PageHeader } from '@/components/page-header';
import { gapCount } from '@/lib/localized-form';
import { requireSession } from '@/lib/request-context';

export default async function WebsitePagesPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'website.view')) return <ForbiddenCard permission="website.view" />;
  const t = await getTranslations('website.pages');
  const pages = await listPages(deps, ctx);
  if (!pages.ok) return <ForbiddenCard permission="website.view" />;
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <table className="w-full text-[14px]">
          <thead className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink"><tr className="h-9"><th className="px-4">{t('columns.page')}</th><th className="px-4">{t('columns.key')}</th><th className="px-4">{t('columns.title')}</th><th className="px-4">{t('columns.gaps')}</th></tr></thead>
          <tbody>
            {pages.value.map((p, i) => (
              <tr key={p.key} className={`h-[var(--row-h)] border-b border-line-2 hover:bg-row-hover ${i % 2 === 1 ? 'bg-zebra' : ''}`} aria-label={t(`keys.${p.key}`)}>
                <td className="px-4 font-semibold"><Link href={`/website/pages/${p.key}`} className="text-link underline">{t(`keys.${p.key}`)}</Link></td>
                <td className="px-4 font-mono text-[12px] text-muted-ink">{p.key}</td>
                <td className="px-4 text-ink-2">{p.title.de || '—'}</td>
                <td className="px-4"><GapCounter count={gapCount(p as unknown as Record<string, unknown>, ['title', 'lede', 'body', 'metaDescription'])} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
```

`src/app/(shell)/website/pages/[key]/blocks-editor.tsx`:
```tsx
'use client';

import type { LocalizedText } from '@kompass/core';
import type { PageBlock } from '@kompass/module-website';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { LocalizedField } from '@/components/forms/localized-field';
import { MediaPicker } from '@/components/forms/media-picker';
import { ReorderButtons } from '@/components/forms/reorder-buttons';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const empty = (): PageBlock => ({ id: '', title: { de: '', en: '' }, text: { de: '', en: '' }, imageAssetId: null, href: '', label: { de: '', en: '' } });

export function BlocksEditor({ initial }: { initial: PageBlock[] }) {
  const t = useTranslations('website.pages.blocks');
  const [blocks, setBlocks] = useState<PageBlock[]>(initial);
  const [editing, setEditing] = useState<{ index: number | null; block: PageBlock } | null>(null);
  const readLocalized = (form: HTMLFormElement, name: string): LocalizedText => ({ de: (form.elements.namedItem(`${name}.de`) as HTMLInputElement).value.trim(), en: (form.elements.namedItem(`${name}.en`) as HTMLInputElement).value.trim() });
  const commit = (form: HTMLFormElement) => {
    if (!editing) return;
    const block: PageBlock = {
      id: (form.elements.namedItem('block-id') as HTMLInputElement).value.trim(),
      title: readLocalized(form, 'block-title'),
      text: readLocalized(form, 'block-text'),
      imageAssetId: ((form.elements.namedItem('block-image') as HTMLInputElement).value || null),
      href: (form.elements.namedItem('block-href') as HTMLInputElement).value.trim(),
      label: readLocalized(form, 'block-label'),
    };
    setBlocks((prev) => (editing.index === null ? [...prev, block] : prev.map((b, i) => (i === editing.index ? block : b))));
    setEditing(null);
  };
  return (
    <div className="flex flex-col gap-2 md:col-span-2">
      <input type="hidden" name="blocks__json" value={JSON.stringify(blocks)} />
      <div className="flex items-center justify-between"><span className="text-[13px] font-semibold text-ink-2">{t('title')}</span><Button type="button" variant="secondary" size="sm" onClick={() => setEditing({ index: null, block: empty() })}>{t('add')}</Button></div>
      {blocks.length === 0 ? <p className="text-[12px] text-muted-ink">{t('empty')}</p> : null}
      <ul className="flex flex-col gap-1">
        {blocks.map((b, i) => (
          <li key={`${b.id}-${i}`} className="flex items-center gap-3 rounded-md border border-line bg-surface-2 px-3 py-2 text-[13px]">
            {b.imageAssetId ? <img src={`/media/${b.imageAssetId}`} alt="" className="size-8 rounded-sm object-cover" /> : null}
            <span className="font-semibold">{b.title.de || b.id}</span>
            <span className="font-mono text-[11px] text-muted-ink">{b.id} · {b.href}</span>
            <span className="ml-auto flex items-center gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing({ index: i, block: b })}>{t('edit')}</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}>{t('remove')}</Button>
              <ReorderButtons ids={blocks.map((x, j) => String(j))} index={i} action={async (ids) => { setBlocks(ids.map((j) => blocks[Number(j)]!)); return { status: 'success' }; }} />
            </span>
          </li>
        ))}
      </ul>
      {editing ? (
        <Dialog open onOpenChange={(o) => { if (!o) setEditing(null); }}>
          <DialogContent className="w-[640px] bg-surface shadow-md">
            <form onSubmit={(e) => { e.preventDefault(); commit(e.currentTarget); }} className="grid gap-3 md:grid-cols-2">
              <DialogTitle className="font-heading text-[19px] md:col-span-2">{editing.index === null ? t('add') : t('edit')}</DialogTitle>
              <div className="flex flex-col gap-1"><Label htmlFor="block-id">{t('id')}</Label><Input id="block-id" name="block-id" defaultValue={editing.block.id} required pattern="[a-z0-9][a-z0-9-]{0,40}" /></div>
              <div className="flex flex-col gap-1"><Label htmlFor="block-href">{t('href')}</Label><Input id="block-href" name="block-href" defaultValue={editing.block.href} /></div>
              <LocalizedField name="block-title" label={t('blockTitle')} value={editing.block.title} required />
              <LocalizedField name="block-text" label={t('text')} kind="textarea" rows={3} value={editing.block.text} />
              <LocalizedField name="block-label" label={t('label')} value={editing.block.label} />
              <div className="md:col-span-2"><MediaPicker name="block-image" value={editing.block.imageAssetId} label={t('image')} /></div>
              <DialogFooter className="md:col-span-2"><Button type="submit">{t('apply')}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
```
Hinweis: Bausteine sind Teil des Seitenformulars; Entfernen eines Bausteins ist erlaubt, weil Bausteine kein Rechenschaftsdatum sind (die Änderung selbst wird über `website.pages.update` mit Vorher/Nachher protokolliert). `ReorderButtons` wird hier ohne Server-Action genutzt; die Action-Signatur wird lokal erfüllt.

`src/app/(shell)/website/pages/[key]/page-form.tsx`:
```tsx
'use client';

import type { PageRecord } from '@kompass/module-website';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { LocalizedField } from '@/components/forms/localized-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { idleState } from '@/lib/actions';
import { updatePageAction } from '../actions';
import { BlocksEditor } from './blocks-editor';

export function PageForm({ page }: { page: PageRecord }) {
  const t = useTranslations('website.pages.form');
  const [state, action] = useActionState(updatePageAction, idleState);
  const errors = state.status === 'error' ? state.fieldErrors : {};
  useEffect(() => { if (state.status === 'success') toast.success(state.message ?? ''); else if (state.status === 'error' && Object.keys(errors).length === 0) toast.error(state.message); }, [state, errors]);
  return (
    <form action={action} className="grid gap-5 rounded-lg border border-line bg-surface p-6 md:grid-cols-2">
      <input type="hidden" name="key" value={page.key} />
      <LocalizedField name="title" label={t('title')} value={page.title} hint={t('titleHint')} errors={errors} />
      <LocalizedField name="lede" label={t('lede')} kind="textarea" rows={3} value={page.lede} errors={errors} />
      <LocalizedField name="body" label={t('body')} kind="markdown" rows={14} value={page.body} hint={t('bodyHint')} errors={errors} />
      <LocalizedField name="metaDescription" label={t('meta')} value={page.metaDescription} errors={errors} />
      <BlocksEditor initial={page.blocks} />
      <div className="flex justify-end md:col-span-2"><SubmitButton>{t('save')}</SubmitButton></div>
    </form>
  );
}
```

`src/app/(shell)/website/pages/[key]/page.tsx`:
```tsx
import { requirePermission } from '@kompass/core';
import { getPage } from '@kompass/module-website';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { GapCounter } from '@/components/gap-counter';
import { PageHeader } from '@/components/page-header';
import { gapCount } from '@/lib/localized-form';
import { requireSession } from '@/lib/request-context';
import { PageForm } from './page-form';

export default async function WebsitePageEdit(props: { params: Promise<{ key: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'website.view')) return <ForbiddenCard permission="website.view" />;
  const { key } = await props.params;
  const page = await getPage(deps, ctx, key);
  if (!page.ok) notFound();
  const t = await getTranslations('website.pages');
  return (
    <>
      <PageHeader title={t(`keys.${page.value.key}`)} description={`/${page.value.key}`} actions={<GapCounter count={gapCount(page.value as unknown as Record<string, unknown>, ['title', 'lede', 'body', 'metaDescription'])} />} />
      <PageForm page={page.value} />
    </>
  );
}
```

`messages/de.json` — Namensraum `website.pages`:
```json
"pages": {
  "title": "Seiten", "description": "Feste Seiten der Webseite. Texte und Bausteine werden hier gepflegt; Struktur und Design sind Teil der Seite selbst.",
  "columns": { "page": "Seite", "key": "Schlüssel", "title": "Titel (DE)", "gaps": "Übersetzungen" },
  "keys": { "home": "Startseite", "help": "Helfen", "donate": "Spenden", "sponsor": "Tierpate werden", "membership": "Fördermitglied werden", "about": "Über uns", "partners": "Unsere Partner", "contact": "Kontakt", "imprint": "Impressum", "privacy": "Datenschutz", "statutes": "Satzung", "adoption-process": "Ablauf der Adoption" },
  "form": { "title": "Titel", "titleHint": "Ein *kursives* Wort wird zur Betonung, z. B. „ein *Zuhause.*“", "lede": "Einleitung", "body": "Text", "bodyHint": "Markdown. Überschriften mit #, Aufzählungen mit -, Hinweiskasten mit >, Kartenraster mit :::karten … :::", "meta": "Meta-Beschreibung (Suchmaschinen)", "save": "Speichern" },
  "blocks": { "title": "Bausteine", "add": "Baustein hinzufügen", "empty": "Keine Bausteine. Nicht jede Seite braucht welche.", "edit": "Bearbeiten", "remove": "Entfernen", "id": "Baustein-ID", "href": "Link", "blockTitle": "Titel", "text": "Text", "label": "Beschriftung des Links", "image": "Bild", "apply": "Baustein übernehmen" }
}
```

- [x] **Step 4: E2E ausführen**

Run: `pnpm --filter @kompass/app test && pnpm --filter @kompass/app typecheck && pnpm --filter @kompass/app e2e e2e/website-pages.spec.ts`
Expected: grün. Hinweis: `getByLabel('DE', { exact: true }).first()` trifft das erste DE-Feld (Titel). Beim Umsetzen prüfen, dass die Reihenfolge Titel → Einleitung → Text stimmt.

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(app): website pages with bilingual fields, markdown preview and block editor"
```

---

### Task 3: Artikel

**Files:**
- Create: `src/app/(shell)/website/articles/page.tsx`, `[id]/page.tsx`, `article-form.tsx`, `actions.ts`
- Test: `e2e/website-lists.spec.ts` (Abschnitt Artikel)

**Interfaces:**
- Consumes: `listArticles`, `getArticle`, `createArticle`, `updateArticle`, `setArticlePublished`, `reorderArticles`.
- Produces: `saveArticleAction(prev, formData)` (mit `id` ⇒ update, ohne ⇒ create, danach Redirect auf `/website/articles/<id>`), `setArticlePublishedAction(id, next)`, `reorderArticlesAction(ids)`.

- [x] **Step 1: E2E-Test schreiben (Datei anlegen; Team/FAQ/Projekte/Downloads werden in Task 4 und 5 ergänzt)**

`apps/kompass/e2e/website-lists.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('website lists', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('articles: create, edit with markdown preview, publish, reorder', async ({ page }) => {
    await page.goto('/website/articles');
    await expect(page.getByText('Noch keine Artikel')).toBeVisible();
    await page.getByRole('link', { name: 'Artikel anlegen' }).click();
    await page.getByLabel('Slug (URL-Teil)').fill('ablauf-der-adoption');
    await page.locator('[name="title.de"]').fill('Ablauf der Adoption');
    await page.locator('[name="body.de"]').fill(':::karten\n### Schritt 1\nMelde dich bei uns.\n:::');
    await expect(page.locator('.prose-preview .card')).toHaveCount(1);
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/website\/articles\/[A-Z0-9]+$/);
    await page.goto('/website/articles');
    await page.getByRole('link', { name: 'Artikel anlegen' }).click();
    await page.getByLabel('Slug (URL-Teil)').fill('transport');
    await page.locator('[name="title.de"]').fill('Ablauf des Transportes');
    await page.locator('[name="title.en"]').fill('Transport');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await page.goto('/website/articles');
    const rows = page.getByRole('table').getByRole('row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1)).toContainText('Ablauf der Adoption');
    await rows.nth(1).getByRole('switch').click();
    await expect(rows.nth(1)).toContainText('Veröffentlicht');
    await rows.nth(2).getByRole('button', { name: 'Nach oben' }).click();
    await expect(page.getByRole('table').getByRole('row').nth(1)).toContainText('Ablauf des Transportes');
  });
});
```

- [x] **Step 2: E2E ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app e2e e2e/website-lists.spec.ts`
Expected: FAIL — 404.

- [x] **Step 3: Actions**

`src/app/(shell)/website/articles/actions.ts`:
```ts
'use server';

import { createArticle, reorderArticles, setArticlePublished, updateArticle } from '@kompass/module-website';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { toActionState, type ActionState } from '@/lib/actions';
import { localizedFromForm } from '@/lib/localized-form';
import { requireSession } from '@/lib/request-context';

export async function saveArticleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const id = String(formData.get('id') ?? '');
  const fields = {
    slug: String(formData.get('slug') ?? '').trim(),
    title: localizedFromForm(formData, 'title'),
    lede: localizedFromForm(formData, 'lede'),
    body: localizedFromForm(formData, 'body'),
    publishedAt: String(formData.get('publishedAt') ?? '') || null,
  };
  const result = id ? await updateArticle(deps, ctx, { id, ...fields }) : await createArticle(deps, ctx, fields);
  revalidatePath('/website/articles');
  if (!result.ok) return toActionState(result, t);
  if (!id) redirect(`/website/articles/${result.value.id}`);
  return toActionState(result, t, t('website.common.saved'));
}

export async function setArticlePublishedAction(id: string, isPublished: boolean): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setArticlePublished(deps, ctx, { id, isPublished });
  revalidatePath('/website/articles');
  return toActionState(result, t);
}

export async function reorderArticlesAction(ids: string[]): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await reorderArticles(deps, ctx, { ids });
  revalidatePath('/website/articles');
  return toActionState(result, t);
}
```

- [x] **Step 4: Formular und Seiten**

`src/app/(shell)/website/articles/article-form.tsx`:
```tsx
'use client';

import type { ArticleRecord } from '@kompass/module-website';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { LocalizedField } from '@/components/forms/localized-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { saveArticleAction } from './actions';

const empty = { de: '', en: '' };

export function ArticleForm({ article }: { article: ArticleRecord | null }) {
  const t = useTranslations('website.articles.form');
  const c = useTranslations('website.common');
  const [state, action] = useActionState(saveArticleAction, idleState);
  const errors = state.status === 'error' ? state.fieldErrors : {};
  useEffect(() => { if (state.status === 'success') toast.success(state.message ?? ''); else if (state.status === 'error' && Object.keys(errors).length === 0) toast.error(state.message); }, [state, errors]);
  return (
    <form action={action} className="grid gap-5 rounded-lg border border-line bg-surface p-6 md:grid-cols-2">
      {article ? <input type="hidden" name="id" value={article.id} /> : null}
      <FormField id="slug" label={c('slug')} hint={c('slugHint')} error={errors.slug}><Input id="slug" name="slug" defaultValue={article?.slug ?? ''} required pattern="[a-z0-9][a-z0-9-]{0,80}" className="font-mono" /></FormField>
      <FormField id="publishedAt" label={t('publishedAt')} error={errors.publishedAt}><Input id="publishedAt" name="publishedAt" type="date" defaultValue={article?.publishedAt ?? ''} className="font-mono" /></FormField>
      <LocalizedField name="title" label={t('title')} value={article?.title ?? empty} required errors={errors} />
      <LocalizedField name="lede" label={t('lede')} kind="textarea" rows={3} value={article?.lede ?? empty} errors={errors} />
      <LocalizedField name="body" label={t('body')} kind="markdown" rows={16} value={article?.body ?? empty} errors={errors} />
      <div className="flex justify-end md:col-span-2"><SubmitButton>{c('save')}</SubmitButton></div>
    </form>
  );
}
```

`src/app/(shell)/website/articles/page.tsx`:
```tsx
import { requirePermission } from '@kompass/core';
import { listArticles } from '@kompass/module-website';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PublishSwitch } from '@/components/forms/publish-switch';
import { ReorderButtons } from '@/components/forms/reorder-buttons';
import { GapCounter } from '@/components/gap-counter';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { gapCount } from '@/lib/localized-form';
import { requireSession } from '@/lib/request-context';
import { reorderArticlesAction, setArticlePublishedAction } from './actions';

export default async function ArticlesPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'website.view')) return <ForbiddenCard permission="website.view" />;
  const t = await getTranslations('website.articles');
  const result = await listArticles(deps, ctx);
  if (!result.ok) return <ForbiddenCard permission="website.view" />;
  const ids = result.value.map((a) => a.id);
  return (
    <>
      <PageHeader title={t('title')} actions={<Button asChild><Link href="/website/articles/new">{t('create')}</Link></Button>} />
      {result.value.length === 0 ? <EmptyState title={t('emptyTitle')} text={t('emptyText')} /> : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <table className="w-full text-[14px]">
            <thead className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink"><tr className="h-9"><th className="px-4">{t('columns.title')}</th><th className="px-4">{t('columns.slug')}</th><th className="px-4">{t('columns.gaps')}</th><th className="px-4">{t('columns.status')}</th><th className="px-4" /></tr></thead>
            <tbody>
              {result.value.map((a, i) => (
                <tr key={a.id} className={`h-[var(--row-h)] border-b border-line-2 hover:bg-row-hover ${i % 2 === 1 ? 'bg-zebra' : ''}`}>
                  <td className="px-4 font-semibold"><Link href={`/website/articles/${a.id}`} className="text-link underline">{a.title.de || a.slug}</Link></td>
                  <td className="px-4 font-mono text-[12px] text-muted-ink">{a.slug}</td>
                  <td className="px-4"><GapCounter count={gapCount(a as unknown as Record<string, unknown>, ['title', 'lede', 'body'])} /></td>
                  <td className="px-4"><PublishSwitch id={a.id} isPublished={a.isPublished} action={setArticlePublishedAction} /></td>
                  <td className="px-4 text-right"><ReorderButtons ids={ids} index={i} action={reorderArticlesAction} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
```

`src/app/(shell)/website/articles/[id]/page.tsx`:
```tsx
import { requirePermission } from '@kompass/core';
import { getArticle } from '@kompass/module-website';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { ArticleForm } from '../article-form';

export default async function ArticleEditPage(props: { params: Promise<{ id: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'website.view')) return <ForbiddenCard permission="website.view" />;
  const { id } = await props.params;
  const t = await getTranslations('website.articles');
  if (id === 'new') return (<><PageHeader title={t('create')} /><ArticleForm article={null} /></>);
  const article = await getArticle(deps, ctx, id);
  if (!article.ok) notFound();
  return (<><PageHeader title={article.value.title.de || article.value.slug} description={`/wissenswertes/${article.value.slug}/`} /><ArticleForm article={article.value} /></>);
}
```
(Die Route `/website/articles/new` läuft über dieselbe `[id]`-Seite; `new` ist als Slug im Kern nicht erlaubt, weil Slugs nie in dieser Route auftauchen — Artikel werden über ihre ULID adressiert.)

`messages/de.json` — Namensraum `website.articles`:
```json
"articles": {
  "title": "Artikel", "create": "Artikel anlegen", "emptyTitle": "Noch keine Artikel", "emptyText": "Wissenswertes-Beiträge wie „Ablauf der Adoption“ entstehen hier.",
  "columns": { "title": "Titel", "slug": "Slug", "gaps": "Übersetzungen", "status": "Status" },
  "form": { "title": "Titel", "lede": "Einleitung", "body": "Text", "publishedAt": "Datum (optional)" }
}
```

- [x] **Step 5: E2E ausführen**

Run: `pnpm --filter @kompass/app typecheck && pnpm --filter @kompass/app e2e e2e/website-lists.spec.ts`
Expected: grün.

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(app): website articles list and editor"
```

---

### Task 4: Team und FAQ

**Files:**
- Create: `src/app/(shell)/website/team/page.tsx`, `team-form.tsx`, `actions.ts`, `src/app/(shell)/website/faqs/page.tsx`, `faq-form.tsx`, `actions.ts`
- Modify: `e2e/website-lists.spec.ts`

**Interfaces:**
- Consumes: `listTeam`, `createTeamMember`, `updateTeamMember`, `setTeamMemberPublished`, `reorderTeam`, `listFaqs`, `createFaq`, `updateFaq`, `setFaqPublished`, `reorderFaqs`.
- Produces: `saveTeamMemberAction`, `setTeamPublishedAction`, `reorderTeamAction`, `saveFaqAction`, `setFaqPublishedAction`, `reorderFaqsAction`. Beide Seiten sind Listen mit einem Dialog zum Anlegen und Bearbeiten (kein Unterseiten-Routing, die Datensätze sind klein).

- [x] **Step 1: E2E-Test ergänzen**

In `e2e/website-lists.spec.ts` ergänzen:
```ts
  test('team: create with photo, publish; faq: create in category', async ({ page }) => {
    await page.goto('/website/team');
    await page.getByRole('button', { name: 'Teammitglied anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Nicole Wießner');
    await dialog.locator('[name="position.de"]').fill('Erste Vorsitzende & Fundraising');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    await dialog.getByLabel(/Foto Datei wählen/).setInputFiles({ name: 'nicole.png', mimeType: 'image/png', buffer: png });
    await expect(dialog.locator('img[src^="/media/"]')).toBeVisible();
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    const row = page.getByRole('row', { name: /Nicole Wießner/ });
    await expect(row).toContainText('Nicht veröffentlicht');
    await row.getByRole('switch').click();
    await expect(row).toContainText('Veröffentlicht');

    await page.goto('/website/faqs');
    await page.getByRole('button', { name: 'Frage anlegen' }).click();
    const faq = page.getByRole('dialog');
    await faq.locator('[name="category.de"]').fill('Spenden');
    await faq.locator('[name="question.de"]').fill('Wohin geht meine Spende?');
    await faq.locator('[name="answer.de"]').fill('An den Shelter.');
    await faq.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('row', { name: /Wohin geht meine Spende/ })).toContainText('Spenden');
  });
```

- [x] **Step 2: E2E ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app e2e e2e/website-lists.spec.ts`
Expected: FAIL beim neuen Test.

- [x] **Step 3: Team**

`src/app/(shell)/website/team/actions.ts`:
```ts
'use server';

import { createTeamMember, reorderTeam, setTeamMemberPublished, updateTeamMember } from '@kompass/module-website';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { localizedFromForm } from '@/lib/localized-form';
import { requireSession } from '@/lib/request-context';

export async function saveTeamMemberAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const id = String(formData.get('id') ?? '');
  const fields = { name: String(formData.get('name') ?? '').trim(), position: localizedFromForm(formData, 'position'), photoAssetId: String(formData.get('photoAssetId') ?? '') || null, petPhotoAssetId: String(formData.get('petPhotoAssetId') ?? '') || null };
  const result = id ? await updateTeamMember(deps, ctx, { id, ...fields }) : await createTeamMember(deps, ctx, fields);
  revalidatePath('/website/team');
  return toActionState(result, t, t('website.common.saved'));
}

export async function setTeamPublishedAction(id: string, isPublished: boolean): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setTeamMemberPublished(deps, ctx, { id, isPublished });
  revalidatePath('/website/team');
  return toActionState(result, t);
}

export async function reorderTeamAction(ids: string[]): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await reorderTeam(deps, ctx, { ids });
  revalidatePath('/website/team');
  return toActionState(result, t);
}
```

`src/app/(shell)/website/team/team-form.tsx`:
```tsx
'use client';

import type { TeamMemberRecord } from '@kompass/module-website';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { LocalizedField } from '@/components/forms/localized-field';
import { MediaPicker } from '@/components/forms/media-picker';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { saveTeamMemberAction } from './actions';

export function TeamMemberDialog({ member, trigger }: { member: TeamMemberRecord | null; trigger: React.ReactNode }) {
  const t = useTranslations('website.team.form');
  const c = useTranslations('website.common');
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(saveTeamMemberAction, idleState);
  const errors = state.status === 'error' ? state.fieldErrors : {};
  useEffect(() => { if (state.status === 'success') { toast.success(state.message ?? ''); setOpen(false); } }, [state]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="w-[640px] bg-surface shadow-md">
        <form action={action} className="grid gap-4 md:grid-cols-2">
          <DialogTitle className="font-heading text-[19px] md:col-span-2">{member ? t('editTitle') : t('createTitle')}</DialogTitle>
          {member ? <input type="hidden" name="id" value={member.id} /> : null}
          {state.status === 'error' && Object.keys(errors).length === 0 ? <p role="alert" className="rounded-md border border-error bg-error-bg p-3 text-[13px] text-error md:col-span-2">{state.message}</p> : null}
          <FormField id="name" label={t('name')} error={errors.name} className="md:col-span-2"><Input id="name" name="name" defaultValue={member?.name ?? ''} required /></FormField>
          <LocalizedField name="position" label={t('position')} value={member?.position ?? { de: '', en: '' }} required errors={errors} />
          <div className="md:col-span-2"><MediaPicker name="photoAssetId" value={member?.photoAssetId ?? null} label={t('photo')} /></div>
          <div className="md:col-span-2"><MediaPicker name="petPhotoAssetId" value={member?.petPhotoAssetId ?? null} label={t('petPhoto')} /></div>
          <DialogFooter className="md:col-span-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>{c('back')}</Button><SubmitButton>{c('save')}</SubmitButton></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

`src/app/(shell)/website/team/page.tsx`:
```tsx
import { requirePermission } from '@kompass/core';
import { listTeam } from '@kompass/module-website';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PublishSwitch } from '@/components/forms/publish-switch';
import { ReorderButtons } from '@/components/forms/reorder-buttons';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { requireSession } from '@/lib/request-context';
import { reorderTeamAction, setTeamPublishedAction } from './actions';
import { TeamMemberDialog } from './team-form';

export default async function TeamPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'website.view')) return <ForbiddenCard permission="website.view" />;
  const t = await getTranslations('website.team');
  const result = await listTeam(deps, ctx);
  if (!result.ok) return <ForbiddenCard permission="website.view" />;
  const ids = result.value.map((m) => m.id);
  return (
    <>
      <PageHeader title={t('title')} actions={<TeamMemberDialog member={null} trigger={<Button>{t('create')}</Button>} />} />
      {result.value.length === 0 ? <EmptyState title={t('emptyTitle')} text={t('emptyText')} /> : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <table className="w-full text-[14px]">
            <thead className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink"><tr className="h-9"><th className="px-4">{t('columns.member')}</th><th className="px-4">{t('columns.position')}</th><th className="px-4">{t('columns.status')}</th><th className="px-4" /></tr></thead>
            <tbody>
              {result.value.map((m, i) => (
                <tr key={m.id} className={`h-[52px] border-b border-line-2 hover:bg-row-hover ${i % 2 === 1 ? 'bg-zebra' : ''}`}>
                  <td className="px-4"><span className="flex items-center gap-3">{m.photoAssetId ? <img src={`/media/${m.photoAssetId}`} alt="" className="size-9 rounded-full object-cover" /> : <span className="size-9 rounded-full bg-surface-2" aria-hidden />}<span className="font-semibold">{m.name}</span></span></td>
                  <td className="px-4 text-ink-2">{m.position.de}</td>
                  <td className="px-4"><PublishSwitch id={m.id} isPublished={m.isPublished} action={setTeamPublishedAction} /></td>
                  <td className="px-4 text-right"><span className="inline-flex items-center gap-1"><TeamMemberDialog member={m} trigger={<Button variant="ghost" size="sm">{t('edit')}</Button>} /><ReorderButtons ids={ids} index={i} action={reorderTeamAction} /></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
```

- [x] **Step 4: FAQ**

`src/app/(shell)/website/faqs/actions.ts` — wie Team mit `createFaq`/`updateFaq`/`setFaqPublished`/`reorderFaqs`, Felder `category`, `question`, `answer` über `localizedFromForm`, `revalidatePath('/website/faqs')`; Exporte `saveFaqAction`, `setFaqPublishedAction`, `reorderFaqsAction`.

`src/app/(shell)/website/faqs/faq-form.tsx` — Dialog wie `TeamMemberDialog` mit drei `LocalizedField`s: `category` (input, required), `question` (input, required), `answer` (textarea, rows 4, required); Namensraum `website.faqs.form`; Export `FaqDialog({ faq, trigger })`.

`src/app/(shell)/website/faqs/page.tsx` — Liste wie Team mit Spalten Frage (DE), Kategorie (DE) als `StatusBadge tone="neutral"`, Status-Schalter, Bearbeiten-Dialog, Sortierpfeile; Namensraum `website.faqs`; Aktionen `setFaqPublishedAction`, `reorderFaqsAction`.

`messages/de.json`:
```json
"team": { "title": "Team", "create": "Teammitglied anlegen", "edit": "Bearbeiten", "emptyTitle": "Noch kein Team", "emptyText": "Die Teamseite zeigt Name, Funktion und Foto.", "columns": { "member": "Mitglied", "position": "Funktion", "status": "Status" }, "form": { "createTitle": "Teammitglied anlegen", "editTitle": "Teammitglied bearbeiten", "name": "Name", "position": "Funktion im Verein", "photo": "Foto", "petPhoto": "Foto des Haustiers (optional)" } },
"faqs": { "title": "FAQ", "create": "Frage anlegen", "edit": "Bearbeiten", "emptyTitle": "Noch keine Fragen", "emptyText": "Häufige Fragen zu Spende, Adoption, Transport und Datenschutz.", "columns": { "question": "Frage", "category": "Kategorie", "status": "Status" }, "form": { "createTitle": "Frage anlegen", "editTitle": "Frage bearbeiten", "category": "Kategorie", "question": "Frage", "answer": "Antwort" } }
```

- [x] **Step 5: E2E ausführen**

Run: `pnpm --filter @kompass/app typecheck && pnpm --filter @kompass/app e2e e2e/website-lists.spec.ts`
Expected: grün. Der Datei-Input im Team-Dialog trägt das `aria-label` „Foto Datei wählen" (Label + `chooseFile`), darüber findet ihn der Test.

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(app): website team and faq management"
```

---

### Task 5: Projekte und Downloads

**Files:**
- Create: `src/app/(shell)/website/projects/page.tsx`, `[id]/page.tsx`, `project-form.tsx`, `actions.ts`, `src/app/(shell)/website/downloads/page.tsx`, `actions.ts`, `download-row.tsx`
- Modify: `e2e/website-lists.spec.ts`

**Interfaces:**
- Consumes: `listProjects`, `getProject`, `createProject`, `updateProject`, `setProjectPublished`, `reorderProjects` (Kern), `listDownloads`, `setDownload`, `WEBSITE_DOWNLOAD_KEYS`.
- Produces: `saveProjectAction`, `setProjectPublishedAction`, `reorderProjectsAction`, `setDownloadAction(prev, formData)`.

- [x] **Step 1: E2E-Test ergänzen**

```ts
  test('projects: create with betterplace id and publish; downloads: attach a PDF', async ({ page }) => {
    await page.goto('/website/projects');
    await page.getByRole('link', { name: 'Projekt anlegen' }).click();
    await page.getByLabel('Slug (URL-Teil)').fill('grundversorgung-shelter');
    await page.locator('[name="name.de"]').fill('Grundversorgung des Shelters');
    await page.getByLabel('Typ').selectOption('ongoing');
    await page.getByLabel('Betterplace-Projekt-ID').fill('123456');
    await page.locator('[name="summary.de"]').fill('Futter, Wärme und tierärztliche Versorgung.');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/website\/projects\/[A-Z0-9]+$/);
    await expect(page.getByText('Finanzen folgen in einer späteren Stufe')).toBeVisible();
    await page.goto('/website/projects');
    const row = page.getByRole('row', { name: /Grundversorgung/ });
    await expect(row).toContainText('Dauerprojekt');
    await row.getByRole('switch').click();
    await expect(row).toContainText('Veröffentlicht');

    await page.goto('/website/downloads');
    await expect(page.getByRole('row')).toHaveCount(5);
    const form = page.getByRole('row', { name: /Patenschaftsantrag/ });
    await form.locator('[name="title.de"]').fill('Patenschaftsantrag');
    await form.getByLabel(/PDF/).setInputFiles({ name: 'antrag.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF') });
    await form.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Gespeichert');
    await expect(page.getByRole('row', { name: /Patenschaftsantrag/ }).getByRole('link', { name: 'PDF öffnen' })).toBeVisible();
  });
```

- [x] **Step 2: E2E ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app e2e e2e/website-lists.spec.ts`
Expected: FAIL beim neuen Test.

- [x] **Step 3: Projekte**

`src/app/(shell)/website/projects/actions.ts` — wie Artikel: `saveProjectAction` liest `slug`, `name`, `type`, `status`, `summary`, `body`, `imageAssetId` (aus `MediaPicker`), `betterplaceProjectId`; `create` ⇒ Redirect auf `/website/projects/<id>`; `setProjectPublishedAction`, `reorderProjectsAction`; `revalidatePath('/website/projects')`. Services aus `@kompass/core`.

`src/app/(shell)/website/projects/project-form.tsx`:
```tsx
'use client';

import type { ProjectRecord } from '@kompass/core';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { LocalizedField } from '@/components/forms/localized-field';
import { MediaPicker } from '@/components/forms/media-picker';
import { SubmitButton } from '@/components/forms/submit-button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { idleState } from '@/lib/actions';
import { saveProjectAction } from './actions';

const empty = { de: '', en: '' };

export function ProjectForm({ project }: { project: ProjectRecord | null }) {
  const t = useTranslations('website.projects.form');
  const c = useTranslations('website.common');
  const [state, action] = useActionState(saveProjectAction, idleState);
  const errors = state.status === 'error' ? state.fieldErrors : {};
  useEffect(() => { if (state.status === 'success') toast.success(state.message ?? ''); else if (state.status === 'error' && Object.keys(errors).length === 0) toast.error(state.message); }, [state, errors]);
  const select = 'h-9 rounded-md border border-line-strong bg-field px-2 text-[14px]';
  return (
    <form action={action} className="overflow-hidden rounded-lg border border-line bg-surface">
      {project ? <input type="hidden" name="id" value={project.id} /> : null}
      <Tabs defaultValue="public">
        <TabsList className="border-b border-line bg-surface px-6"><TabsTrigger value="public">{t('tabs.public')}</TabsTrigger><TabsTrigger value="finance" disabled>{t('tabs.finance')}</TabsTrigger></TabsList>
        <TabsContent value="public" className="grid gap-5 p-6 md:grid-cols-2">
          <FormField id="slug" label={c('slug')} hint={c('slugHint')} error={errors.slug}><Input id="slug" name="slug" defaultValue={project?.slug ?? ''} required pattern="[a-z0-9][a-z0-9-]{0,80}" className="font-mono" /></FormField>
          <FormField id="betterplaceProjectId" label={t('betterplace')} hint={t('betterplaceHint')} error={errors.betterplaceProjectId}><Input id="betterplaceProjectId" name="betterplaceProjectId" defaultValue={project?.betterplaceProjectId ?? ''} className="font-mono" /></FormField>
          <FormField id="type" label={t('type')}><select id="type" name="type" defaultValue={project?.type ?? 'ongoing'} className={select}><option value="ongoing">{t('types.ongoing')}</option><option value="shortTerm">{t('types.shortTerm')}</option></select></FormField>
          <FormField id="status" label={t('status')}><select id="status" name="status" defaultValue={project?.status ?? 'active'} className={select}><option value="active">{t('statuses.active')}</option><option value="completed">{t('statuses.completed')}</option></select></FormField>
          <LocalizedField name="name" label={t('name')} value={project?.name ?? empty} required errors={errors} />
          <LocalizedField name="summary" label={t('summary')} kind="textarea" rows={3} value={project?.summary ?? empty} errors={errors} />
          <LocalizedField name="body" label={t('body')} kind="markdown" rows={12} value={project?.body ?? empty} errors={errors} />
          <div className="md:col-span-2"><MediaPicker name="imageAssetId" value={project?.imageAssetId ?? null} label={t('image')} /></div>
          <div className="flex justify-end md:col-span-2"><SubmitButton>{c('save')}</SubmitButton></div>
        </TabsContent>
        <TabsContent value="finance" className="p-6 text-[13px] text-muted-ink">{t('financeLater')}</TabsContent>
      </Tabs>
      <p className="border-t border-line bg-surface-2 px-6 py-2 text-[12px] text-muted-ink">{t('financeLater')}</p>
    </form>
  );
}
```
`page.tsx` (Liste mit Spalten Name, Typ als Badge, Betterplace-ID mono, Status-Schalter, Sortierung, Link zum Bearbeiten, Knopf „Projekt anlegen" → `/website/projects/new`) und `[id]/page.tsx` (wie Artikel, `new` ⇒ leeres Formular) nach dem Muster aus Task 3.

- [x] **Step 4: Downloads**

`src/app/(shell)/website/downloads/actions.ts`:
```ts
'use server';

import { storeMediaAsset } from '@kompass/core';
import { setDownload } from '@kompass/module-website';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { localizedFromForm } from '@/lib/localized-form';
import { requireSession } from '@/lib/request-context';

export async function setDownloadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const key = String(formData.get('key') ?? '');
  let assetId = String(formData.get('assetId') ?? '') || null;
  const file = formData.get('file');
  if (file instanceof File && file.size > 0) {
    const stored = await storeMediaAsset(deps, ctx, { originalName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), declaredMimeType: file.type });
    if (!stored.ok) return toActionState(stored, t);
    assetId = stored.value.id;
  }
  const result = await setDownload(deps, ctx, { key, title: localizedFromForm(formData, 'title'), assetId });
  revalidatePath('/website/downloads');
  return toActionState(result, t, t('website.common.saved'));
}
```

`src/app/(shell)/website/downloads/download-row.tsx`:
```tsx
'use client';

import type { DownloadRecord } from '@kompass/module-website';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { LocalizedField } from '@/components/forms/localized-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { idleState } from '@/lib/actions';
import { setDownloadAction } from './actions';

export function DownloadRow({ download }: { download: DownloadRecord }) {
  const t = useTranslations('website.downloads');
  const c = useTranslations('website.common');
  const [state, action] = useActionState(setDownloadAction, idleState);
  useEffect(() => { if (state.status === 'success') toast.success(state.message ?? ''); else if (state.status === 'error') toast.error(state.message); }, [state]);
  return (
    <tr aria-label={t(`keys.${download.key}`)} className="border-b border-line-2 align-top">
      <td className="px-4 py-3"><div className="font-semibold">{t(`keys.${download.key}`)}</div><div className="font-mono text-[11px] text-muted-ink">{download.key}</div></td>
      <td className="px-4 py-3" colSpan={2}>
        <form action={action} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <input type="hidden" name="key" value={download.key} />
          <input type="hidden" name="assetId" value={download.assetId ?? ''} />
          <LocalizedField name="title" label={t('form.title')} value={download.title} required />
          <div className="flex flex-col gap-2">
            <label className="text-[13px] font-semibold text-ink-2">{t('form.file')}<input type="file" name="file" accept="application/pdf" aria-label={`${t('form.file')} PDF`} className="mt-1 block text-[12px]" /></label>
            {download.assetId ? <a href={`/media/${download.assetId}`} target="_blank" rel="noopener" className="text-[13px] text-link underline">{t('open')}</a> : <span className="text-[12px] text-muted-ink">{t('none')}</span>}
            <SubmitButton variant="secondary">{c('save')}</SubmitButton>
          </div>
        </form>
      </td>
    </tr>
  );
}
```
`page.tsx`: Tabelle mit Kopf (Download, Titel/Datei) und einer `DownloadRow` je Eintrag aus `listDownloads`; Recht `website.view`.

`messages/de.json`:
```json
"projects": { "title": "Projekte", "create": "Projekt anlegen", "emptyTitle": "Noch keine Projekte", "emptyText": "Dauer- und Kurzzeitprojekte mit Betterplace-Anbindung.", "columns": { "name": "Projekt", "type": "Typ", "betterplace": "Betterplace-ID", "status": "Status" }, "types": { "ongoing": "Dauerprojekt", "shortTerm": "Kurzzeitprojekt" }, "form": { "tabs": { "public": "Webseite", "finance": "Finanzen" }, "name": "Name", "summary": "Kurztext", "body": "Langtext", "image": "Bild", "type": "Typ", "status": "Status", "types": { "ongoing": "Dauerprojekt", "shortTerm": "Kurzzeitprojekt" }, "statuses": { "active": "Aktiv", "completed": "Abgeschlossen" }, "betterplace": "Betterplace-Projekt-ID", "betterplaceHint": "Ziffernfolge aus der Betterplace-Projekt-URL.", "financeLater": "Konten, Buchungen und Rücklagen: Finanzen folgen in einer späteren Stufe." } },
"downloads": { "title": "Downloads", "description": "Ausfüllbare PDFs, die die Webseite verlinkt.", "columns": { "download": "Download", "fileAndTitle": "Titel und Datei" }, "keys": { "sponsorship-form": "Patenschaftsantrag", "membership-form": "Aufnahmeantrag Fördermitgliedschaft", "self-disclosure-form": "Selbstauskunft", "statutes-pdf": "Satzung als PDF" }, "form": { "title": "Titel", "file": "PDF-Datei" }, "open": "PDF öffnen", "none": "Noch keine Datei." }
```

- [x] **Step 5: E2E ausführen**

Run: `pnpm --filter @kompass/app typecheck && pnpm --filter @kompass/app e2e e2e/website-lists.spec.ts`
Expected: grün.

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(app): website projects and downloads management"
```

---

### Task 6: Site-Fakten

**Files:**
- Create: `src/app/(shell)/website/facts/page.tsx`, `facts-form.tsx`, `actions.ts`
- Test: `e2e/website-facts.spec.ts`

**Interfaces:**
- Consumes: `readAllSettings`, `setSetting` (Kern), `listAnimals` (Tiermodul, falls aktiv) für die Dropdowns der Startseiten-Auswahl.
- Produces: `saveFactsAction(changes: Record<string, unknown>) → ActionState` (ruft `setSetting` je geändertem Schlüssel wie `saveSettingsAction` aus Plan 2).

- [x] **Step 1: E2E-Test schreiben**

`apps/kompass/e2e/website-facts.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test('site facts: numbers, donation boxes, blocked terms and featured selection', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/website/facts');
  await page.getByLabel('Weiterleitungsquote (%)').fill('97.2');
  await page.getByLabel('Hunde im Shelter').fill('150');
  await page.getByRole('button', { name: 'Standort hinzufügen' }).click();
  await page.getByLabel('Standort 1').fill('Köln-Porz');
  await page.getByRole('button', { name: 'Sperrwort hinzufügen' }).click();
  await page.getByLabel('Sperrwort 1').fill('Popescu');
  await page.getByLabel('Betterplace-Meta-Projekt-ID').fill('999999');
  await expect(page.getByText(/Änderungen noch nicht gespeichert/)).toBeVisible();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Site-Fakten gespeichert');
  await page.reload();
  await expect(page.getByLabel('Hunde im Shelter')).toHaveValue('150');
  await expect(page.getByLabel('Standort 1')).toHaveValue('Köln-Porz');
  await expect(page.getByLabel('Sperrwort 1')).toHaveValue('Popescu');
  await expect(page.getByLabel('Hund auf der Startseite')).toHaveValue('auto');
});
```

- [x] **Step 2: E2E ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app e2e e2e/website-facts.spec.ts`
Expected: FAIL — 404.

- [x] **Step 3: Action und Formular**

`src/app/(shell)/website/facts/actions.ts`:
```ts
'use server';

import { setSetting } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function saveFactsAction(changes: Record<string, unknown>): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const fieldErrors: Record<string, string> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (!key.startsWith('website.')) continue;
    const result = await setSetting(deps, ctx, { key, value });
    if (!result.ok) {
      const state = toActionState(result, t);
      if (state.status === 'error') { if (result.error.type === 'validation') fieldErrors[key] = state.fieldErrors.value ?? state.fieldErrors[''] ?? t('errors.fields.invalid'); else return state; }
    }
  }
  revalidatePath('/website/facts');
  if (Object.keys(fieldErrors).length > 0) return { status: 'error', message: t('errors.validation'), fieldErrors };
  return { status: 'success', message: t('website.facts.saved') };
}
```

`src/app/(shell)/website/facts/facts-form.tsx`:
```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { SaveBar } from '@/components/forms/save-bar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { saveFactsAction } from './actions';

type Values = Record<string, unknown>;
type Option = { slug: string; name: string };

function StringList({ label, itemLabel, add, values, onChange }: { label: string; itemLabel: (i: number) => string; add: string; values: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-col gap-2 md:col-span-2">
      <span className="text-[13px] font-semibold text-ink-2">{label}</span>
      {values.map((v, i) => (
        <div key={i} className="flex gap-2"><Input aria-label={itemLabel(i)} value={v} onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))} /><Button type="button" variant="ghost" onClick={() => onChange(values.filter((_, j) => j !== i))}>×</Button></div>
      ))}
      <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={() => onChange([...values, ''])}>{add}</Button>
    </div>
  );
}

export function FactsForm({ initial, animals, stories }: { initial: Values; animals: Option[]; stories: Option[] }) {
  const t = useTranslations('website.facts');
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, start] = useTransition();
  const changes = useMemo(() => Object.fromEntries(Object.entries(values).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(initial[k]))), [values, initial]);
  const set = (key: string, value: unknown) => setValues((v) => ({ ...v, [key]: value }));
  const str = (key: string) => String(values[key] ?? '');
  const list = (key: string) => (values[key] as string[]) ?? [];
  const links = (values['website.socialLinks'] as { label: string; href: string }[]) ?? [];
  const select = 'h-9 rounded-md border border-line-strong bg-field px-2 text-[14px]';
  const num = (key: string, label: string, step = '1') => (
    <FormField id={key} label={label} error={errors[key]}><Input id={key} type="number" step={step} value={str(key)} onChange={(e) => set(key, e.target.value === '' ? 0 : Number(e.target.value))} className="font-mono" /></FormField>
  );
  return (
    <div className="flex flex-col">
      <section className="grid gap-4 rounded-lg border border-line bg-surface p-6 md:grid-cols-2">
        <h3 className="font-heading text-[17px] md:col-span-2">{t('groups.numbers')}</h3>
        {num('website.forwardingPercent', t('fields.forwardingPercent'), '0.1')}
        {num('website.shelterDogCount', t('fields.shelterDogCount'))}
        <FormField id="section11" label={t('fields.section11Status')}><select id="section11" value={str('website.section11Status')} onChange={(e) => set('website.section11Status', e.target.value)} className={select}><option value="pending">{t('section11.pending')}</option><option value="granted">{t('section11.granted')}</option></select></FormField>
        <FormField id="section11Date" label={t('fields.section11Date')} error={errors['website.section11Date']}><Input id="section11Date" type="date" value={str('website.section11Date')} onChange={(e) => set('website.section11Date', e.target.value)} className="font-mono" /></FormField>
        <StringList label={t('fields.donationBoxLocations')} itemLabel={(i) => t('fields.location', { n: i + 1 })} add={t('addLocation')} values={list('website.donationBoxLocations')} onChange={(v) => set('website.donationBoxLocations', v)} />
      </section>
      <section className="mt-4 grid gap-4 rounded-lg border border-line bg-surface p-6 md:grid-cols-2">
        <h3 className="font-heading text-[17px] md:col-span-2">{t('groups.donations')}</h3>
        <FormField id="bpMeta" label={t('fields.betterplaceMetaProjectId')} error={errors['website.betterplaceMetaProjectId']}><Input id="bpMeta" value={str('website.betterplaceMetaProjectId')} onChange={(e) => set('website.betterplaceMetaProjectId', e.target.value)} className="font-mono" /></FormField>
        {num('website.betterplaceDefaultAmount', t('fields.betterplaceDefaultAmount'))}
      </section>
      <section className="mt-4 grid gap-4 rounded-lg border border-line bg-surface p-6 md:grid-cols-2">
        <h3 className="font-heading text-[17px] md:col-span-2">{t('groups.home')}</h3>
        <FormField id="featuredAnimal" label={t('fields.featuredAnimalSlug')} hint={t('autoHint')}><select id="featuredAnimal" value={str('website.featuredAnimalSlug')} onChange={(e) => set('website.featuredAnimalSlug', e.target.value)} className={select}><option value="auto">{t('auto')}</option>{animals.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}</select></FormField>
        <FormField id="featuredStory" label={t('fields.featuredStorySlug')} hint={t('autoHint')}><select id="featuredStory" value={str('website.featuredStorySlug')} onChange={(e) => set('website.featuredStorySlug', e.target.value)} className={select}><option value="auto">{t('auto')}</option>{stories.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}</select></FormField>
      </section>
      <section className="mt-4 grid gap-4 rounded-lg border border-line bg-surface p-6 md:grid-cols-2">
        <h3 className="font-heading text-[17px] md:col-span-2">{t('groups.social')}</h3>
        {links.map((l, i) => (
          <div key={i} className="flex gap-2 md:col-span-2"><Input aria-label={t('fields.socialLabel', { n: i + 1 })} value={l.label} onChange={(e) => set('website.socialLinks', links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="w-40" /><Input aria-label={t('fields.socialHref', { n: i + 1 })} value={l.href} onChange={(e) => set('website.socialLinks', links.map((x, j) => (j === i ? { ...x, href: e.target.value } : x)))} /><Button type="button" variant="ghost" onClick={() => set('website.socialLinks', links.filter((_, j) => j !== i))}>×</Button></div>
        ))}
        <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={() => set('website.socialLinks', [...links, { label: '', href: 'https://' }])}>{t('addSocial')}</Button>
      </section>
      <section className="mt-4 grid gap-4 rounded-lg border border-warning bg-surface p-6 md:grid-cols-2">
        <h3 className="font-heading text-[17px] md:col-span-2">{t('groups.confidentiality')}</h3>
        <p className="text-[13px] text-ink-2 md:col-span-2">{t('blockedHint')}</p>
        <StringList label={t('fields.blockedTerms')} itemLabel={(i) => t('fields.blockedTerm', { n: i + 1 })} add={t('addBlocked')} values={list('website.blockedTerms')} onChange={(v) => set('website.blockedTerms', v)} />
      </section>
      <SaveBar pendingCount={Object.keys(changes).length} saving={saving} onDiscard={() => { setValues(initial); setErrors({}); }} onSave={() => start(async () => { const s = await saveFactsAction(changes); if (s.status === 'error') { setErrors(s.fieldErrors); toast.error(s.message); } else { toast.success(s.status === 'success' ? s.message ?? '' : ''); setErrors({}); } })} />
    </div>
  );
}
```
Der Claim (`website.claim`) ist zweisprachig und wird in derselben Sektion „Auftritt" mit zwei `Input`s (`claim.de`/`claim.en`) gepflegt, die `set('website.claim', { ...claim, de })` schreiben — beim Umsetzen als kleine Sektion vor „Zahlen" ergänzen.

`src/app/(shell)/website/facts/page.tsx`:
```tsx
import { isModuleEnabled, readAllSettings, requirePermission } from '@kompass/core';
import { listAnimals } from '@kompass/module-animals';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { FactsForm } from './facts-form';

export default async function FactsPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'website.manage')) return <ForbiddenCard permission="website.manage" />;
  const t = await getTranslations('website.facts');
  const all = readAllSettings(deps);
  const initial = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith('website.')));
  let animals: { slug: string; name: string }[] = [];
  let stories: { slug: string; name: string }[] = [];
  if (isModuleEnabled(deps, 'animals') && ctx.permissions.has('animals.view')) {
    const list = await listAnimals(deps, ctx);
    if (list.ok) {
      animals = list.value.filter((a) => a.status !== 'adopted' && a.isPublished).map((a) => ({ slug: a.slug, name: a.name }));
      stories = list.value.filter((a) => a.status === 'adopted' && a.isPublished).map((a) => ({ slug: a.slug, name: a.name }));
    }
  }
  return (<><PageHeader title={t('title')} description={t('description')} /><FactsForm initial={initial} animals={animals} stories={stories} /></>);
}
```
Hinweis: Die App darf `@kompass/module-animals` importieren, weil sie beide Module installiert; zwischen den Modulpaketen selbst bleibt es bei „keine Abhängigkeit".

`messages/de.json` — `website.facts`:
```json
"facts": {
  "title": "Site-Fakten", "description": "Zahlen und Angaben, die an vielen Stellen der Webseite erscheinen. Einmal ändern, überall aktuell.", "saved": "Site-Fakten gespeichert.",
  "groups": { "numbers": "Zahlen und Status", "donations": "Betterplace", "home": "Startseite", "social": "Social-Media-Links", "confidentiality": "Vertraulichkeit" },
  "fields": { "forwardingPercent": "Weiterleitungsquote (%)", "shelterDogCount": "Hunde im Shelter", "section11Status": "§ 11 TSchG", "section11Date": "Datum der Erlaubnis", "donationBoxLocations": "Spendenboxen-Standorte", "location": "Standort {n}", "betterplaceMetaProjectId": "Betterplace-Meta-Projekt-ID", "betterplaceDefaultAmount": "Standardbetrag (€)", "featuredAnimalSlug": "Hund auf der Startseite", "featuredStorySlug": "Erfolgsgeschichte auf der Startseite", "socialLabel": "Bezeichnung {n}", "socialHref": "Adresse {n}", "blockedTerms": "Sperrwörter", "blockedTerm": "Sperrwort {n}" },
  "section11": { "pending": "in Bearbeitung", "granted": "erteilt" },
  "auto": "Automatisch", "autoHint": "Automatisch wählt den neuesten Notfall, sonst den zuletzt angelegten Hund.",
  "addLocation": "Standort hinzufügen", "addSocial": "Link hinzufügen", "addBlocked": "Sperrwort hinzufügen",
  "blockedHint": "Begriffe, die auf keiner öffentlichen Seite und in keinem Dateinamen erscheinen dürfen. Der Publish bricht bei einem Treffer ab."
}
```

- [x] **Step 4: E2E ausführen**

Run: `pnpm --filter @kompass/app typecheck && pnpm --filter @kompass/app test && pnpm --filter @kompass/app e2e e2e/website-facts.spec.ts`
Expected: grün.

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(app): website site facts form with lists, featured selection and blocked terms"
```

---

### Task 7: Hunde

**Files:**
- Create: `src/app/(shell)/animals/page.tsx`, `[id]/page.tsx`, `animal-form.tsx`, `photos-editor.tsx`, `story-form.tsx`, `status-dialog.tsx`, `actions.ts`
- Test: `e2e/animals.spec.ts`

**Interfaces:**
- Consumes: `listAnimals`, `getAnimal`, `createAnimal`, `updateAnimal`, `setAnimalStatus`, `setAnimalPhotos`, `setAnimalStory`, `setAnimalPublished`.
- Produces: `saveAnimalAction(prev, formData)` (Steckbrief + Texte; create ⇒ Redirect), `setAnimalStatusAction(id, status, adoptedYear?)`, `setAnimalPhotosAction(id, photos)`, `saveAnimalStoryAction(prev, formData)`, `setAnimalPublishedAction(id, next)`.

- [x] **Step 1: E2E-Test schreiben**

`apps/kompass/e2e/animals.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test.describe('animals', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('creates a dog, adds photos, publishes, adopts with a story', async ({ page }) => {
    await page.goto('/animals');
    await page.getByRole('link', { name: 'Hund anlegen' }).click();
    await page.getByLabel('Slug (URL-Teil)').fill('chiara');
    await page.getByLabel('Name').fill('Chiara');
    await page.getByLabel('Geschlecht').selectOption('female');
    await page.getByLabel('Größe in cm (für den Filter)').fill('45');
    await page.getByLabel('Notfall').check();
    await page.getByLabel('Patentier').check();
    await page.getByRole('tab', { name: 'Texte' }).click();
    await page.locator('[name="summary.de"]').fill('Sanfte, freundliche Hündin.');
    await page.locator('[name="traits__text.de"]').fill('ruhig, verträglich');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/animals\/[A-Z0-9]+$/);

    await page.getByRole('tab', { name: 'Fotos' }).click();
    await page.getByLabel(/Foto hochladen/).setInputFiles({ name: 'chiara-1.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('[data-testid="animal-photo"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Fotos speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Fotos gespeichert');

    await page.getByRole('switch', { name: 'Veröffentlicht' }).click();
    await page.goto('/animals');
    const row = page.getByRole('row', { name: /Chiara/ });
    await expect(row).toContainText('Sucht ein Zuhause');
    await expect(row).toContainText('Notfall');
    await expect(row).toContainText('Veröffentlicht');

    await row.getByRole('link', { name: 'Chiara' }).click();
    await page.getByRole('button', { name: 'Status ändern' }).click();
    await page.getByRole('dialog').getByLabel('Neuer Status').selectOption('adopted');
    await page.getByRole('dialog').getByLabel('Vermittlungsjahr').fill('2026');
    await page.getByRole('dialog').getByRole('button', { name: 'Status setzen' }).click();
    await expect(page.getByRole('status')).toContainText('Status gesetzt');
    await page.getByRole('tab', { name: 'Geschichte' }).click();
    await page.locator('[name="quote.de"]').fill('Endlich zuhause.');
    await page.getByLabel('Familie').fill('Familie M.');
    await page.getByRole('button', { name: 'Geschichte speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Geschichte gespeichert');
  });

  test('the story tab is locked until the dog is adopted', async ({ page }) => {
    await page.goto('/animals/new');
    await page.getByLabel('Slug (URL-Teil)').fill('bruno');
    await page.getByLabel('Name').fill('Bruno');
    await page.getByLabel('Geschlecht').selectOption('male');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await page.getByRole('tab', { name: 'Geschichte' }).click();
    await expect(page.getByText('Erst nach der Vermittlung')).toBeVisible();
  });
});
```

- [x] **Step 2: E2E ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app e2e e2e/animals.spec.ts`
Expected: FAIL — 404.

- [x] **Step 3: Actions**

`src/app/(shell)/animals/actions.ts`:
```ts
'use server';

import { storeMediaAsset } from '@kompass/core';
import { createAnimal, setAnimalPhotos, setAnimalPublished, setAnimalStatus, setAnimalStory, updateAnimal } from '@kompass/module-animals';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { toActionState, type ActionState } from '@/lib/actions';
import { jsonFromForm, localizedFromForm } from '@/lib/localized-form';
import { requireSession } from '@/lib/request-context';

const splitList = (value: FormDataEntryValue | null) => String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export async function saveAnimalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const id = String(formData.get('id') ?? '');
  const fields = {
    slug: String(formData.get('slug') ?? '').trim(),
    name: String(formData.get('name') ?? '').trim(),
    sex: String(formData.get('sex') ?? 'female'),
    birthText: localizedFromForm(formData, 'birthText'),
    sizeCm: Number(formData.get('sizeCm') ?? 0),
    sizeText: localizedFromForm(formData, 'sizeText'),
    location: String(formData.get('location') ?? 'shelter'),
    isEmergency: formData.get('isEmergency') === 'on',
    isSponsorable: formData.get('isSponsorable') === 'on',
    traits: { de: splitList(formData.get('traits__text.de')), en: splitList(formData.get('traits__text.en')) },
    externalProfileUrl: String(formData.get('externalProfileUrl') ?? '').trim(),
    summary: localizedFromForm(formData, 'summary'),
    body: localizedFromForm(formData, 'body'),
  };
  const result = id ? await updateAnimal(deps, ctx, { id, ...fields }) : await createAnimal(deps, ctx, fields);
  revalidatePath('/animals');
  if (!result.ok) return toActionState(result, t);
  if (!id) redirect(`/animals/${result.value.id}`);
  return toActionState(result, t, t('website.common.saved'));
}

export async function setAnimalStatusAction(id: string, status: string, adoptedYear?: number): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setAnimalStatus(deps, ctx, { id, status, adoptedYear });
  revalidatePath('/animals');
  return toActionState(result, t, t('animals.status.saved'));
}

export async function setAnimalPhotosAction(id: string, photos: { assetId: string; isPrimary: boolean }[]): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setAnimalPhotos(deps, ctx, { id, photos });
  revalidatePath('/animals');
  return toActionState(result, t, t('animals.photos.saved'));
}

export async function uploadAnimalPhotoAction(formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('website.common.noFile'), fieldErrors: {} };
  const result = await storeMediaAsset(deps, ctx, { originalName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), declaredMimeType: file.type });
  return toActionState(result, t);
}

export async function saveAnimalStoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setAnimalStory(deps, ctx, {
    id: String(formData.get('id') ?? ''),
    beforeAssetId: String(formData.get('beforeAssetId') ?? '') || null,
    afterAssetId: String(formData.get('afterAssetId') ?? '') || null,
    quote: localizedFromForm(formData, 'quote'),
    family: String(formData.get('family') ?? '').trim(),
    adoptedYear: Number(formData.get('adoptedYear') ?? 0),
  });
  revalidatePath('/animals');
  return toActionState(result, t, t('animals.story.saved'));
}

export async function setAnimalPublishedAction(id: string, isPublished: boolean): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setAnimalPublished(deps, ctx, { id, isPublished });
  revalidatePath('/animals');
  return toActionState(result, t);
}
```
(`jsonFromForm` wird hier nicht gebraucht — Import weglassen.)

- [x] **Step 4: Formular mit Reitern, Fotos, Geschichte, Status**

`src/app/(shell)/animals/photos-editor.tsx`:
```tsx
'use client';

import type { AnimalPhoto } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { setAnimalPhotosAction, uploadAnimalPhotoAction } from './actions';

export function PhotosEditor({ animalId, initial }: { animalId: string; initial: AnimalPhoto[] }) {
  const t = useTranslations('animals.photos');
  const [photos, setPhotos] = useState(initial.map((p) => ({ assetId: p.assetId, isPrimary: p.isPrimary })));
  const [pending, start] = useTransition();
  const upload = (file: File) => start(async () => {
    const fd = new FormData();
    fd.set('file', file);
    const s = await uploadAnimalPhotoAction(fd);
    if (s.status === 'success') setPhotos((p) => [...p, { assetId: (s.data as { id: string }).id, isPrimary: p.length === 0 }]);
    else if (s.status === 'error') toast.error(s.message);
  });
  const move = (i: number, d: number) => setPhotos((p) => { const n = [...p]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); return n; });
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink-2">{t('upload')}<input type="file" accept="image/png,image/jpeg,image/webp" aria-label={`${t('upload')} Datei`} disabled={pending} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} className="text-[12px] font-normal" /></label>
      <ul className="grid gap-3 md:grid-cols-4">
        {photos.map((p, i) => (
          <li key={p.assetId} data-testid="animal-photo" className={`flex flex-col gap-1 rounded-md border p-2 ${p.isPrimary ? 'border-brand' : 'border-line'}`}>
            <img src={`/media/${p.assetId}`} alt="" className="aspect-[4/3] w-full rounded-sm object-cover" />
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

`src/app/(shell)/animals/status-dialog.tsx`:
```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { setAnimalStatusAction } from './actions';

export function StatusDialog({ animalId, current }: { animalId: string; current: string }) {
  const t = useTranslations('animals.status');
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(current);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="secondary">{t('change')}</Button></DialogTrigger>
      <DialogContent className="bg-surface shadow-md">
        <DialogTitle className="font-heading text-[19px]">{t('title')}</DialogTitle>
        <FormField id="status" label={t('next')}><select id="status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border border-line-strong bg-field px-2 text-[14px]"><option value="lookingForHome">{t('values.lookingForHome')}</option><option value="reserved">{t('values.reserved')}</option><option value="adopted">{t('values.adopted')}</option></select></FormField>
        {status === 'adopted' ? <FormField id="year" label={t('year')} hint={t('yearHint')}><Input id="year" type="number" value={year} onChange={(e) => setYear(e.target.value)} className="font-mono" /></FormField> : null}
        <DialogFooter><Button disabled={pending} onClick={() => start(async () => { const s = await setAnimalStatusAction(animalId, status, status === 'adopted' ? Number(year) : undefined); if (s.status === 'error') toast.error(s.message); else { toast.success(s.status === 'success' ? s.message ?? '' : ''); setOpen(false); } })}>{t('submit')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`src/app/(shell)/animals/story-form.tsx`:
```tsx
'use client';

import type { AnimalRecord } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { LocalizedField } from '@/components/forms/localized-field';
import { MediaPicker } from '@/components/forms/media-picker';
import { SubmitButton } from '@/components/forms/submit-button';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { saveAnimalStoryAction } from './actions';

export function StoryForm({ animal }: { animal: AnimalRecord }) {
  const t = useTranslations('animals.story');
  const [state, action] = useActionState(saveAnimalStoryAction, idleState);
  useEffect(() => { if (state.status === 'success') toast.success(state.message ?? ''); else if (state.status === 'error') toast.error(state.message); }, [state]);
  if (animal.status !== 'adopted') return <p className="rounded-md border border-line bg-surface-2 p-4 text-[13px] text-ink-2">{t('locked')}</p>;
  const story = animal.story;
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="id" value={animal.id} />
      <div><MediaPicker name="beforeAssetId" value={story?.beforeAssetId ?? null} label={t('before')} /></div>
      <div><MediaPicker name="afterAssetId" value={story?.afterAssetId ?? null} label={t('after')} /></div>
      <LocalizedField name="quote" label={t('quote')} kind="textarea" rows={3} value={story?.quote ?? { de: '', en: '' }} />
      <FormField id="family" label={t('family')}><Input id="family" name="family" defaultValue={story?.family ?? ''} /></FormField>
      <FormField id="adoptedYear" label={t('year')}><Input id="adoptedYear" name="adoptedYear" type="number" defaultValue={story?.adoptedYear ?? new Date().getFullYear()} className="font-mono" /></FormField>
      <div className="flex justify-end md:col-span-2"><SubmitButton>{t('save')}</SubmitButton></div>
    </form>
  );
}
```

`src/app/(shell)/animals/animal-form.tsx`:
```tsx
'use client';

import type { AnimalRecord } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { LocalizedField } from '@/components/forms/localized-field';
import { PublishSwitch } from '@/components/forms/publish-switch';
import { SubmitButton } from '@/components/forms/submit-button';
import { StatusBadge } from '@/components/status-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { idleState } from '@/lib/actions';
import { setAnimalPublishedAction, saveAnimalAction } from './actions';
import { PhotosEditor } from './photos-editor';
import { StatusDialog } from './status-dialog';
import { StoryForm } from './story-form';

const empty = { de: '', en: '' };

export function AnimalForm({ animal }: { animal: AnimalRecord | null }) {
  const t = useTranslations('animals.form');
  const c = useTranslations('website.common');
  const [state, action] = useActionState(saveAnimalAction, idleState);
  const errors = state.status === 'error' ? state.fieldErrors : {};
  useEffect(() => { if (state.status === 'success') toast.success(state.message ?? ''); else if (state.status === 'error' && Object.keys(errors).length === 0) toast.error(state.message); }, [state, errors]);
  const select = 'h-9 rounded-md border border-line-strong bg-field px-2 text-[14px]';
  return (
    <div className="flex flex-col gap-4">
      {animal ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
          <StatusBadge tone={animal.status === 'adopted' ? 'success' : animal.status === 'reserved' ? 'warning' : 'info'} dot>{t(`status.${animal.status}`)}</StatusBadge>
          <StatusDialog animalId={animal.id} current={animal.status} />
          <span className="ml-auto"><PublishSwitch id={animal.id} isPublished={animal.isPublished} action={setAnimalPublishedAction} /></span>
        </div>
      ) : null}
      <Tabs defaultValue="profile" className="overflow-hidden rounded-lg border border-line bg-surface">
        <TabsList className="border-b border-line bg-surface px-6"><TabsTrigger value="profile">{t('tabs.profile')}</TabsTrigger><TabsTrigger value="texts">{t('tabs.texts')}</TabsTrigger><TabsTrigger value="photos" disabled={!animal}>{t('tabs.photos')}</TabsTrigger><TabsTrigger value="story" disabled={!animal}>{t('tabs.story')}</TabsTrigger></TabsList>
        <form action={action}>
          {animal ? <input type="hidden" name="id" value={animal.id} /> : null}
          <TabsContent value="profile" className="grid gap-4 p-6 md:grid-cols-2">
            <FormField id="slug" label={c('slug')} hint={c('slugHint')} error={errors.slug}><Input id="slug" name="slug" defaultValue={animal?.slug ?? ''} required pattern="[a-z0-9][a-z0-9-]{0,80}" className="font-mono" /></FormField>
            <FormField id="name" label={t('name')} error={errors.name}><Input id="name" name="name" defaultValue={animal?.name ?? ''} required /></FormField>
            <FormField id="sex" label={t('sex')}><select id="sex" name="sex" defaultValue={animal?.sex ?? 'female'} className={select}><option value="female">{t('sexes.female')}</option><option value="male">{t('sexes.male')}</option></select></FormField>
            <FormField id="location" label={t('location')}><select id="location" name="location" defaultValue={animal?.location ?? 'shelter'} className={select}><option value="shelter">{t('locations.shelter')}</option><option value="germany">{t('locations.germany')}</option></select></FormField>
            <FormField id="sizeCm" label={t('sizeCm')} error={errors.sizeCm}><Input id="sizeCm" name="sizeCm" type="number" defaultValue={animal?.sizeCm ?? 0} className="font-mono" /></FormField>
            <FormField id="externalProfileUrl" label={t('externalProfileUrl')} hint={t('externalHint')} error={errors.externalProfileUrl}><Input id="externalProfileUrl" name="externalProfileUrl" defaultValue={animal?.externalProfileUrl ?? ''} /></FormField>
            <LocalizedField name="birthText" label={t('birthText')} value={animal?.birthText ?? empty} errors={errors} />
            <LocalizedField name="sizeText" label={t('sizeText')} value={animal?.sizeText ?? empty} errors={errors} />
            <div className="flex items-center gap-2"><Checkbox id="isEmergency" name="isEmergency" defaultChecked={animal?.isEmergency ?? false} /><Label htmlFor="isEmergency">{t('isEmergency')}</Label></div>
            <div className="flex items-center gap-2"><Checkbox id="isSponsorable" name="isSponsorable" defaultChecked={animal?.isSponsorable ?? false} /><Label htmlFor="isSponsorable">{t('isSponsorable')}</Label></div>
          </TabsContent>
          <TabsContent value="texts" className="grid gap-4 p-6 md:grid-cols-2">
            <LocalizedField name="summary" label={t('summary')} kind="textarea" rows={2} value={animal?.summary ?? empty} errors={errors} />
            <LocalizedField name="body" label={t('body')} kind="markdown" rows={10} value={animal?.body ?? empty} errors={errors} />
            <LocalizedField name="traits__text" label={t('traits')} hint={t('traitsHint')} value={{ de: (animal?.traits.de ?? []).join(', '), en: (animal?.traits.en ?? []).join(', ') }} />
          </TabsContent>
          <div className="flex justify-end border-t border-line bg-surface-2 px-6 py-3"><SubmitButton>{c('save')}</SubmitButton></div>
        </form>
        <TabsContent value="photos" className="p-6">{animal ? <PhotosEditor animalId={animal.id} initial={animal.photos} /> : null}</TabsContent>
        <TabsContent value="story" className="p-6">{animal ? <StoryForm animal={animal} /> : null}</TabsContent>
      </Tabs>
    </div>
  );
}
```
Hinweis: Die Speicherleiste des Steckbrief-Formulars liegt außerhalb der Reiter-Inhalte, aber innerhalb des `<form>`, damit sie in beiden Text-Reitern sichtbar ist; Fotos und Geschichte haben eigene Formulare und liegen außerhalb.

`src/app/(shell)/animals/page.tsx` — Liste: Spalten Foto (Hauptfoto oder Platzhalter), Name (Link), Status-Badge (`animals.form.status.*`), Kennzeichen (Badges „Notfall", „Patentier"), Aufenthalt, Veröffentlicht-Schalter; Statusfilter über `?status=` als Select in der Filterleiste; Knopf „Hund anlegen" → `/animals/new`. `[id]/page.tsx` wie Artikel (`new` ⇒ leeres Formular), Recht `animals.view`, Titel = Name.

`messages/de.json` — Namensraum `animals`:
```json
"animals": {
  "common": { "…": "(aus Task 1)" },
  "list": { "title": "Hunde", "create": "Hund anlegen", "emptyTitle": "Noch keine Hunde", "emptyText": "Jeder Hund bekommt ein Profil mit Fotos, Status und Texten in Deutsch und Englisch.", "columns": { "animal": "Hund", "status": "Status", "flags": "Kennzeichen", "location": "Aufenthalt", "published": "Webseite" }, "filter": { "all": "Alle", "label": "Status" }, "emergency": "Notfall", "sponsorable": "Patentier" },
  "form": { "tabs": { "profile": "Steckbrief", "texts": "Texte", "photos": "Fotos", "story": "Geschichte" }, "name": "Name", "sex": "Geschlecht", "sexes": { "female": "Hündin", "male": "Rüde" }, "location": "Aufenthalt", "locations": { "shelter": "im Shelter", "germany": "in Deutschland" }, "sizeCm": "Größe in cm (für den Filter)", "sizeText": "Größe als Text", "birthText": "Geburtsangabe", "externalProfileUrl": "Externes Profil (URL)", "externalHint": "z. B. das Profil beim Vermittlungspartner.", "isEmergency": "Notfall", "isSponsorable": "Patentier", "summary": "Kurztext", "body": "Beschreibung", "traits": "Wesensmerkmale", "traitsHint": "Kommagetrennt, z. B. ruhig, verträglich, verspielt", "status": { "lookingForHome": "Sucht ein Zuhause", "reserved": "Reserviert", "adopted": "Vermittelt" } },
  "status": { "change": "Status ändern", "title": "Status ändern", "next": "Neuer Status", "values": { "lookingForHome": "Sucht ein Zuhause", "reserved": "Reserviert", "adopted": "Vermittelt" }, "year": "Vermittlungsjahr", "yearHint": "Erscheint bei den Glücklichen Vermittlungen.", "submit": "Status setzen", "saved": "Status gesetzt." },
  "photos": { "upload": "Foto hochladen", "primary": "Hauptfoto", "remove": "Entfernen", "save": "Fotos speichern", "saved": "Fotos gespeichert." },
  "story": { "locked": "Erst nach der Vermittlung: Setzen Sie den Status auf „Vermittelt“, dann lässt sich die Erfolgsgeschichte pflegen.", "before": "Vorher-Bild", "after": "Nachher-Bild", "quote": "Zitat der Familie", "family": "Familie", "year": "Vermittlungsjahr", "save": "Geschichte speichern", "saved": "Geschichte gespeichert." }
}
```
(`animals.common` aus Task 1 bleibt bestehen; nur die neuen Namensräume ergänzen.)

- [x] **Step 5: E2E ausführen**

Run: `pnpm --filter @kompass/app typecheck && pnpm --filter @kompass/app e2e e2e/animals.spec.ts`
Expected: grün.

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(app): animal profiles with photos, status changes and success stories"
```

---

### Task 8: Publizieren (Prüfstufe) und Startseiten-Karte

**Files:**
- Create: `src/app/(shell)/website/publish/page.tsx`, `check-card.tsx`, `actions.ts`
- Modify: `src/app/(shell)/page.tsx` (Karte „Webseite"), `src/lib/setup-progress.ts` (unverändert), `messages/de.json`
- Test: `e2e/website-publish.spec.ts`

**Interfaces:**
- Consumes: `exportSiteContent`, `readSetting('website.blockedTerms')`, `listPublishes` (neu, klein: `packages/modules/website/src/services/publishes.ts` mit `listPublishes(deps, ctx, { environment }) → Result<PublishRecord[]>`, Recht `website.view`).
- Produces: `runCheckAction() → ActionState` mit `data = { contentHash, gaps, violations }` (Export in ein Temp-Verzeichnis, danach gelöscht). Plan 6 ergänzt Vorschau, Diff und Publish auf derselben Seite.

- [x] **Step 1: E2E-Test schreiben**

`apps/kompass/e2e/website-publish.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test('publish page runs the checks and blocks on a blocked term', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/website/facts');
  await page.getByRole('button', { name: 'Sperrwort hinzufügen' }).click();
  await page.getByLabel('Sperrwort 1').fill('Popescu');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('gespeichert');
  await page.goto('/website/pages/partners');
  await page.locator('[name="body.de"]').fill('Frau Popescu betreibt den Shelter.');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');

  await page.goto('/website/publish');
  await page.getByRole('button', { name: 'Prüfen' }).click();
  const violations = page.getByRole('region', { name: 'Sperrworttreffer' });
  await expect(violations).toContainText('pages');
  await expect(violations).toContainText('Popescu');
  await expect(page.getByRole('button', { name: /publizieren/i })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Übersetzungslücken' })).toContainText('partners');

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Webseite' })).toBeVisible();
});
```

- [x] **Step 2: E2E ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app e2e e2e/website-publish.spec.ts`
Expected: FAIL — 404.

- [x] **Step 3: Publish-Historie im Modul**

`packages/modules/website/src/services/publishes.ts`:
```ts
import { ok, requirePermission, type CallContext, type Deps, type Result } from '@kompass/core';
import { desc, eq } from 'drizzle-orm';
import { websitePublishes } from '../schema';

export type PublishRecord = typeof websitePublishes.$inferSelect;

export async function listPublishes(deps: Deps, ctx: CallContext, input: { environment: string; limit?: number }): Promise<Result<PublishRecord[]>> {
  const denied = requirePermission(ctx, 'website.view');
  if (denied) return denied;
  return ok(deps.db.select().from(websitePublishes).where(eq(websitePublishes.environment, input.environment)).orderBy(desc(websitePublishes.startedAt)).limit(input.limit ?? 20).all());
}
```
Test in `packages/modules/website/tests/lists.test.ts` ergänzen: leere Liste für `test`, `forbidden` ohne Recht. `src/index.ts` exportieren.

- [x] **Step 4: Action, Karte, Seite**

`src/app/(shell)/website/publish/actions.ts`:
```ts
'use server';

import { exportSiteContent } from '@kompass/module-website';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getTranslations } from 'next-intl/server';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function runCheckAction(): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const dir = await mkdtemp(path.join(tmpdir(), 'kompass-check-'));
  try {
    const result = await exportSiteContent(deps, ctx, { jobDir: dir });
    if (!result.ok) return toActionState(result, t);
    return { status: 'success', data: { contentHash: result.value.contentHash, gaps: result.value.gaps, violations: result.value.violations } };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
```

`src/app/(shell)/website/publish/check-card.tsx`:
```tsx
'use client';

import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { runCheckAction } from './actions';

type Check = { contentHash: string; gaps: { collection: string; id: string; field: string }[]; violations: { path: string; term: string; excerpt: string }[] };

const linkFor = (collection: string, id: string) => (collection === 'pages' ? `/website/pages/${id}` : collection === 'animals' ? '/animals' : `/website/${collection}`);

export function CheckCard({ onResult }: { onResult?: (check: Check) => void }) {
  const t = useTranslations('website.publish.check');
  const [check, setCheck] = useState<Check | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div className="flex items-center justify-between"><h3 className="font-heading text-[18px]">{t('title')}</h3><Button disabled={pending} aria-busy={pending} onClick={() => start(async () => { const s = await runCheckAction(); if (s.status === 'error') toast.error(s.message); else if (s.status === 'success') { setCheck(s.data as Check); onResult?.(s.data as Check); } })}>{pending ? t('running') : t('run')}</Button></div>
      {check ? (
        <>
          <p className="font-mono text-[12px] text-muted-ink">{t('hash', { hash: check.contentHash.slice(0, 12) })}</p>
          <section aria-label={t('violationsTitle')} className={`rounded-md border p-3 text-[13px] ${check.violations.length > 0 ? 'border-error bg-error-bg' : 'border-line bg-surface-2'}`}>
            <h4 className="flex items-center gap-2 font-semibold">{check.violations.length > 0 ? <AlertTriangle className="size-4 text-error" aria-hidden /> : null}{t('violationsTitle')} · {check.violations.length}</h4>
            {check.violations.length === 0 ? <p className="text-muted-ink">{t('noViolations')}</p> : <ul className="mt-2 flex flex-col gap-1">{check.violations.map((v, i) => <li key={i}><span className="font-mono">{v.path}</span> · <span className="font-semibold text-error">{v.term}</span> · <span className="text-ink-2">{v.excerpt}</span></li>)}</ul>}
          </section>
          <section aria-label={t('gapsTitle')} className="rounded-md border border-line bg-surface-2 p-3 text-[13px]">
            <h4 className="font-semibold">{t('gapsTitle')} · {check.gaps.length}</h4>
            {check.gaps.length === 0 ? <p className="text-muted-ink">{t('noGaps')}</p> : <ul className="mt-2 flex flex-col gap-1">{check.gaps.map((g, i) => <li key={i}><Link href={linkFor(g.collection, g.id)} className="text-link underline">{g.collection} · {g.id}</Link> · <span className="font-mono">{g.field}</span></li>)}</ul>}
          </section>
        </>
      ) : <p className="text-[13px] text-muted-ink">{t('intro')}</p>}
    </section>
  );
}
```

`src/app/(shell)/website/publish/page.tsx`:
```tsx
import { requirePermission } from '@kompass/core';
import { listPublishes } from '@kompass/module-website';
import { getFormatter, getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { runtimeEnv } from '@/lib/deps';
import { requireSession } from '@/lib/request-context';
import { CheckCard } from './check-card';

export default async function PublishPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'website.publish')) return <ForbiddenCard permission="website.publish" />;
  const t = await getTranslations('website.publish');
  const format = await getFormatter();
  const env = runtimeEnv().env;
  const history = await listPublishes(deps, ctx, { environment: env });
  const last = history.ok ? history.value[0] : undefined;
  return (
    <>
      <PageHeader title={t('title')} description={t(`target.${env}`)} />
      <div className="flex max-w-[880px] flex-col gap-4">
        <section className="rounded-lg border border-line bg-surface p-5 text-[13px]">
          <h3 className="font-heading text-[18px]">{t('state.title')}</h3>
          <p className="mt-2 text-ink-2">{last ? t('state.last', { date: format.dateTime(new Date(last.startedAt), { dateStyle: 'medium', timeStyle: 'short' }), status: last.status }) : t('state.never')}</p>
        </section>
        <CheckCard />
        <p className="text-[12px] text-muted-ink">{t('nextStage')}</p>
      </div>
    </>
  );
}
```

Startseiten-Karte in `src/app/(shell)/page.tsx`: wenn `isModuleEnabled(deps, 'website')` und `website.view`, eine vierte `Card` mit Titel „Webseite", Text aus `home.website.text`, Zähler = Anzahl Publishes dieser Umgebung (`listPublishes`), Hinweis „Letzter Publish: …" oder „noch nie", Knopf „Publizieren öffnen" → `/website/publish`. Das Grid wird `md:grid-cols-2 xl:grid-cols-4`.

`messages/de.json` — `website.publish` und `home.website`:
```json
"publish": {
  "title": "Publizieren", "target": { "development": "Ziel: keine Veröffentlichung in der Entwicklungsumgebung", "test": "Ziel: Staging", "production": "Ziel: Live-Webseite" },
  "state": { "title": "Stand", "last": "Letzter Publish: {date} ({status})", "never": "Noch nie publiziert." },
  "check": { "title": "Prüfen", "intro": "Prüft alle Inhalte auf Sperrwörter und Übersetzungslücken. Ändert nichts.", "run": "Prüfen", "running": "Prüfung läuft …", "hash": "Inhalts-Hash {hash}", "violationsTitle": "Sperrworttreffer", "noViolations": "Keine Treffer.", "gapsTitle": "Übersetzungslücken", "noGaps": "Alle Übersetzungen vorhanden." },
  "nextStage": "Vorschau-Build, Änderungsliste und Publish folgen in der nächsten Ausbaustufe."
},
"home": { "website": { "title": "Webseite", "text": "Inhalte prüfen und die Webseite publizieren.", "count": "{count} Publishes", "cta": "Publizieren öffnen", "never": "Noch nie publiziert" } }
```

- [x] **Step 5: Gesamtlauf**

Run: `pnpm typecheck && pnpm test && pnpm --filter @kompass/app e2e`
Expected: alle grün, inklusive der bestehenden Specs (Startseite zeigt vier Karten; `home.spec.ts` prüft nur die drei bisherigen Überschriften und bleibt gültig).

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(app): website publish page with content checks and home card"
```

---

## Abschluss dieses Plans

Nach Task 8 pflegt das Team alle Inhalte der Webseite in Kompass, zweisprachig, mit Markdown-Vorschau, und kann Sperrwörter und Übersetzungslücken prüfen. Was fehlt, ist die Site selbst: `webseite-3-site-und-publish` portiert den Prototyp nach `apps/site`, baut die Pipeline (Export → Build → Diff → Publish), erweitert die Publizieren-Seite um Vorschau, Änderungsliste und die Publish-Knöpfe, übernimmt die Prototyp-Daten und erweitert Docker und Betrieb.

## Self-Review (durchgeführt beim Schreiben)

**Spec-Abdeckung (Abschnitt 4):** Navigationsgruppen aus Manifesten (Plan 4) mit Labels (Task 1 Vorplan); zweisprachige Felder mit Vorschau und „unübersetzt" → Task 1; Seiten mit Bausteinen und Vorschau-Sprung (Vorschau-Build kommt in Plan 6; der Link auf `/website/preview/` wird dort ergänzt) → Task 2; Artikel, Team, FAQ, Downloads, Projekte mit Veröffentlichen statt Löschen, Reihenfolge, Finanzen-Reiter vorbereitet → Tasks 3–5; Site-Fakten mit Gruppen, Startseiten-Auswahl, Sperrwortliste → Task 6; Hunde mit Reitern, Fotos, Statuswechsel mit Jahr, Geschichte ab „vermittelt" → Task 7; Publizieren-Seite Prüfstufe, Kompass-Startseiten-Karte → Task 8.

**Placeholder-Scan:** Task 4 (FAQ-Dateien), Task 5 (Projekt-Liste/-Unterseite) und Task 7 (Hunde-Liste) verweisen auf das jeweils direkt darüber ausgeschriebene Muster derselben Task bzw. Task 3 mit vollständig benannten Spalten, Actions und Namensräumen. `animals.common` in Task 7 verweist auf Task 1 („aus Task 1"), damit die Schlüssel nicht doppelt gepflegt werden.

**Typkonsistenz:** `LocalizedField(name, label, kind, value, rows, hint, errors, required)` überall gleich; `PublishSwitch(id, isPublished, action(id, next))`, `ReorderButtons(ids, index, action(ids))`, `MediaPicker(name, value, label)` in Tasks 2–7; `localizedFromForm(formData, name)` in allen Actions; `runCheckAction` liefert `data` mit `contentHash/gaps/violations` wie `exportSiteContent` (Plan 4, Task 6).
