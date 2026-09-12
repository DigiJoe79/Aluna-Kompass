# Akte fertig 3 — Oberfläche der Akte (Implementierungsplan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alles, was Plan 2 auf Service-Ebene kann, ist in der Akte bedienbar: Eingangskorb mit Ausgang, Bezüge und Dokumentbezüge am Dokument, Versandvermerk, Wiedervorlagen, Notizjournal, Textbausteine im Editor, ein Kontakt-Suchfeld mit „Neu anlegen“, sortierbare Spalten, und Verwaltung für Bausteine und Versandwege.

**Architecture:** Server Actions bleiben dünne Adapter auf die Services (`toActionState`), jede Änderung ruft `revalidatePath`. Neue Kästen der Detailseite sind je eine Client-Komponente mit eigener Datei; die Detailseite reicht ihnen die Daten aus `getDocumentRecord`. Zwei neue gemeinsame Bausteine: `sortable-head.tsx` (Spaltenkopf mit Zustand in der URL) und `contact-picker.tsx` (Suchfeld auf `cmdk`, mit Overlay aus dem vorhandenen Kontaktformular). Texte ausschließlich über `messages/de.json`.

**Tech Stack:** Next.js App Router (Server Components, Server Actions), React 19, Tailwind, next-intl, cmdk (`components/ui/command.tsx`), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-12-akte-fertig-design.md` (§ 7.1–7.5, § 7.8, § 7.9, § 8 E2E)

## Global Constraints

- Kein hartcodierter UI-Text: jeder String über `useTranslations`/`getTranslations` und `apps/kompass/messages/de.json`, Sie-Form. Der Test `no-hardcoded-ui-text` bleibt grün.
- Keine Farbliterale; nur Theme-Tokens (`bg-surface`, `text-ink-2`, `border-line`, `bg-info-bg`, …). Feldhöhe kommt aus `--field-h`, Zeilenhöhe aus `--row-h` (Handoff).
- Pflichtfelder tragen `required` am `Label`; Vorbelegungen tragen ein Herkunftsfähnchen (`SuggestionFlag`).
- Rechte werden serverseitig geprüft (`requireSession` + Service); die Oberfläche blendet nur aus, was der Service ohnehin verweigert.
- E2E gegen `pnpm --filter @kompass/app e2e` (Dev-Server auf 3100 läuft selbst), Seed-Daten über `resetDatabase(page, 'seeded')`. Vor dem Push `pnpm verify`.
- Nach jedem Task ein Commit; nicht pushen.

**Voraussetzung:** Plan 2 vollständig (inkl. Task 11 und 12), damit `DocumentRecord` Bezüge, Notizen, Wiedervorlagen und Versand trägt.

---

### Task 1: Sortierbarer Spaltenkopf und sortierbare Dokumentliste

**Files:**
- Create: `apps/kompass/src/components/sortable-head.tsx`
- Modify: `apps/kompass/src/app/(shell)/dms/document-list.tsx`, `dms-view.tsx`, `page.tsx`, `receive/page.tsx` (Query-Typ)
- Modify: `apps/kompass/messages/de.json`
- Test: `apps/kompass/tests/sortable-head.test.tsx`, E2E in `apps/kompass/e2e/dms.spec.ts`

**Interfaces:**
- Produces: `<SortableHead field="subject" label=… />` — liest `sort`/`dir` aus der URL, schreibt sie per `router.replace`, zeigt Pfeil; `readSort(params, allowed): { field, direction } | undefined` als reine Funktion für Seiten.

- [ ] **Step 1: Failing Test für die reine Funktion**

`apps/kompass/tests/sortable-head.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { readSort } from '@/components/sortable-head';

describe('readSort', () => {
  it('liest Feld und Richtung aus den Parametern, nur wenn das Feld erlaubt ist', () => {
    const allowed = ['subject', 'documentDate'] as const;
    expect(readSort({ sort: 'subject', dir: 'asc' }, allowed)).toEqual({ field: 'subject', direction: 'asc' });
    expect(readSort({ sort: 'subject' }, allowed)).toEqual({ field: 'subject', direction: 'desc' });
    expect(readSort({ sort: 'draftBody', dir: 'asc' }, allowed)).toBeUndefined();
    expect(readSort({}, allowed)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/app test -- sortable-head`
Expected: FAIL

- [ ] **Step 3: Komponente schreiben**

`apps/kompass/src/components/sortable-head.tsx`:

```tsx
'use client';

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export type SortDirection = 'asc' | 'desc';

/**
 * Sortierung lebt in der URL (`sort`, `dir`), damit sie Blättern und den
 * Zurück-Knopf überlebt. Serverseitig sortiert, weil die Listen blättern —
 * im Browser sortiert wäre nur die sichtbare Seite umgedreht (Backlog 6).
 */
export function readSort<F extends string>(
  params: Record<string, string | undefined>,
  allowed: readonly F[],
): { field: F; direction: SortDirection } | undefined {
  const field = params.sort;
  if (!field || !allowed.includes(field as F)) return undefined;
  return { field: field as F, direction: params.dir === 'asc' ? 'asc' : 'desc' };
}

export function SortableHead({ field, label, className }: { field: string; label: string; className?: string }) {
  const t = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const active = params.get('sort') === field;
  const direction: SortDirection = active && params.get('dir') === 'asc' ? 'asc' : 'desc';

  const toggle = () => {
    const next = new URLSearchParams(params.toString());
    next.set('sort', field);
    // Erster Klick: absteigend (wie die Vorgabe der Listen), zweiter: aufsteigend.
    next.set('dir', active && direction === 'desc' ? 'asc' : 'desc');
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  };

  const Icon = !active ? ArrowUpDown : direction === 'asc' ? ArrowUp : ArrowDown;

  return (
    <TableHead className={cn('px-4', className)} aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={toggle} className="inline-flex items-center gap-1 hover:text-ink" aria-label={t('sortBy', { column: label })}>
        {label}
        <Icon className={cn('size-3', !active && 'opacity-50')} aria-hidden />
      </button>
    </TableHead>
  );
}
```

`de.json`, unter `common`: `"sortBy": "Sortieren nach {column}"`.

- [ ] **Step 4: Dokumentliste anbinden**

`document-list.tsx`: die sechs Spaltenköpfe `Nummer`, `Betreff`, `Dokumentart`, `Datum`, `Ordner` werden `<SortableHead field="number" label={t('columns.number')} />` usw. (`typeKey` für die Art, `documentDate` für das Datum); `Richtung` und `Status` bleiben `TableHead`. `applyFilters` behält `sort` und `dir` bei: `const next = new URLSearchParams(); …; for (const k of ['sort', 'dir']) { const v = params.get(k); if (v) next.set(k, v); }`.

`dms-view.tsx`: `DmsQuery` bekommt `sort?: string; dir?: string`; der Aufruf von `listDocuments` bekommt `orderBy: readSort(query, ['number', 'subject', 'documentDate', 'typeKey', 'folder', 'createdAt'] as const)`.

- [ ] **Step 5: E2E**

Anhängen an `apps/kompass/e2e/dms.spec.ts` (im `describe('dms')`):

```ts
  test('ein Klick auf den Spaltenkopf dreht die Reihenfolge, und die URL trägt sie', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await page.getByRole('button', { name: 'Sortieren nach Betreff' }).click();
    await expect(page).toHaveURL(/sort=subject&dir=desc/);
    const first = await page.getByRole('row').nth(1).getByRole('link').first().textContent();
    await page.getByRole('button', { name: 'Sortieren nach Betreff' }).click();
    await expect(page).toHaveURL(/dir=asc/);
    const afterFlip = await page.getByRole('row').nth(1).getByRole('link').first().textContent();
    expect(afterFlip).not.toBe(first);
    await page.reload();
    await expect(page.getByRole('columnheader', { name: /Betreff/ })).toHaveAttribute('aria-sort', 'ascending');
  });
```

Run: `pnpm --filter @kompass/app test -- sortable-head && pnpm --filter @kompass/app e2e -- --grep "Spaltenkopf"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/kompass
git commit -m "feat(ui): a column head that sorts, and the file's list uses it"
```

---

### Task 2: Kontakt-Suchfeld mit „Neu anlegen“

**Files:**
- Modify: `apps/kompass/src/app/(shell)/contacts/contact-form.tsx` (steuerbar von außen, `onCreated`)
- Modify: `apps/kompass/src/app/(shell)/contacts/actions.ts` (`createContactAction` liefert die ID im `data`)
- Create: `apps/kompass/src/components/contact-picker.tsx`
- Create: `apps/kompass/src/app/(shell)/contacts/search-action.ts`
- Modify: `apps/kompass/src/app/(shell)/dms/new/draft-form.tsx`, `dms/receive/receive-form.tsx`, `dms/new/page.tsx`, `dms/[id]/edit/page.tsx`, `dms/dms-view.tsx` (keine 200er-Kontaktliste mehr; nur noch der gewählte Kontakt als `{ id, name }`)
- Modify: `apps/kompass/messages/de.json`
- Test: E2E in `dms.spec.ts`

**Interfaces:**
- Produces:
  - `searchContactsAction(text: string): Promise<{ id: string; name: string }[]>` — bis zu 20 Treffer über `listContacts({ text, limit: 20 })`
  - `<ContactPicker name="recipientId" value={…} onChange={(c) => …} label=… required? canCreate />` — schreibt die ID in ein verstecktes `<input name>`; `canCreate` zeigt „Neu anlegen …“ und öffnet `CreateContactDialog` mit `onCreated`
  - `CreateContactDialog` bekommt optionale Props `open`, `onOpenChange`, `onCreated(contact: { id: string; name: string })`, `withTrigger` (Vorgabe `true`)
  - `createContactAction` liefert `data: { id, name }`

- [ ] **Step 1: Failing E2E schreiben**

```ts
  test('legt aus dem Entwurf heraus einen neuen Kontakt an und wählt ihn als Empfänger', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new');
    const picker = page.getByRole('combobox', { name: 'Empfänger' });
    await picker.click();
    await page.getByRole('option', { name: 'Neu anlegen …' }).click();
    const dialog = page.getByRole('dialog', { name: 'Kontakt anlegen' });
    await dialog.getByLabel('Nachname').fill('Neuland');
    await dialog.getByLabel('Vorname').fill('Nora');
    await dialog.getByRole('button', { name: 'Anlegen' }).click();
    await expect(dialog).toBeHidden();
    await expect(picker).toHaveValue('Nora Neuland');
    await page.getByLabel('Betreff').fill('An Nora');
    await page.getByLabel('Text').fill('Hallo');
    await page.getByRole('button', { name: 'Entwurf speichern' }).click();
    await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}\/edit$/);
    await expect(page.getByRole('combobox', { name: 'Empfänger' })).toHaveValue('Nora Neuland');
  });

  test('findet einen Kontakt über das Suchfeld', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new');
    const picker = page.getByRole('combobox', { name: 'Empfänger' });
    await picker.fill('Mus');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.getByRole('option').first().click();
    await expect(page.locator('input[name="recipientId"]')).not.toHaveValue('');
  });
```

(Der Seed der Kontakte enthält erfundene Namen; „Mus“ trifft einen davon — den Suchbegriff beim Schreiben des Tests am Seed prüfen: `packages/modules/contacts/src/seed.ts`.)

- [ ] **Step 2: E2E laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/app e2e -- --grep "Suchfeld|neuen Kontakt"`
Expected: FAIL — es gibt keine Combobox.

- [ ] **Step 3: Server Action für die Suche**

`apps/kompass/src/app/(shell)/contacts/search-action.ts`:

```ts
'use server';

import { displayName, listContacts } from '@kompass/module-contacts';
import { requireSession } from '@/lib/request-context';

/** Bis zu zwanzig Treffer für ein Suchfeld — mehr sieht in einer Liste niemand an. */
export async function searchContactsAction(text: string): Promise<{ id: string; name: string }[]> {
  const { deps, ctx } = await requireSession();
  const trimmed = text.trim();
  const res = await listContacts(deps, ctx, trimmed ? { text: trimmed, limit: 20 } : { limit: 20 });
  if (!res.ok) return [];
  return res.value.contacts.map((c) => ({ id: c.id, name: displayName(c) }));
}
```

`createContactAction`: statt `return toActionState(result, t, …)`:

```ts
  const state = toActionState(result, t, t('contacts.toast.created'));
  return result.ok ? { ...state, data: { id: result.value.id, name: displayName(result.value) } } : state;
```

(`displayName` aus `@kompass/module-contacts` importieren.)

- [ ] **Step 4: `CreateContactDialog` steuerbar machen**

In `contact-form.tsx`:

```tsx
export function CreateContactDialog({
  open: controlledOpen,
  onOpenChange,
  onCreated,
  withTrigger = true,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCreated?: (contact: { id: string; name: string }) => void;
  withTrigger?: boolean;
} = {}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = (next: boolean) => {
    setInnerOpen(next);
    onOpenChange?.(next);
  };
  …
  useEffect(() => {
    if (state.status === 'success') {
      const created = state.data as { id: string; name: string } | undefined;
      if (created) onCreated?.(created);
      setOpen(false);
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  …
      {withTrigger ? <DialogTrigger render={…} /> : null}
```

Alle `setOpen(false)`-Aufrufe im Formular bleiben, sie gehen jetzt durch die Hülle.

- [ ] **Step 5: Der Picker**

`apps/kompass/src/components/contact-picker.tsx`:

```tsx
'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Label } from '@/components/ui/label';
import { CreateContactDialog } from '@/app/(shell)/contacts/contact-form';
import { searchContactsAction } from '@/app/(shell)/contacts/search-action';
import { cn } from '@/lib/utils';

export interface PickedContact {
  id: string;
  name: string;
}

/**
 * Ein Suchfeld statt einer Auswahlliste über die ersten 200 Kontakte
 * (Spec § 7.3). Die ID reist in einem versteckten Feld mit, damit die
 * Formulare unverändert per FormData arbeiten. „Neu anlegen“ öffnet das
 * vorhandene Kontaktformular als Overlay; der neue Kontakt ist danach gewählt.
 */
export function ContactPicker({
  id,
  name,
  label,
  value,
  onChange,
  required,
  canCreate,
  hint,
}: {
  id: string;
  name: string;
  label: string;
  value: PickedContact | null;
  onChange: (contact: PickedContact | null) => void;
  required?: boolean;
  canCreate?: boolean;
  hint?: string;
}) {
  const t = useTranslations('contacts.picker');
  const [query, setQuery] = useState(value?.name ?? '');
  const [options, setOptions] = useState<PickedContact[]>([]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    setQuery(value?.name ?? '');
  }, [value?.id, value?.name]);

  useEffect(() => {
    if (!open) return;
    const run = ++latest.current;
    const handle = setTimeout(async () => {
      const found = await searchContactsAction(query);
      if (run === latest.current) setOptions(found);
    }, 150);
    return () => clearTimeout(handle);
  }, [query, open]);

  const pick = (contact: PickedContact | null) => {
    onChange(contact);
    setQuery(contact?.name ?? '');
    setOpen(false);
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} required={required}>{label}</Label>
      <input type="hidden" name={name} value={value?.id ?? ''} />
      <Command shouldFilter={false} className="relative overflow-visible rounded-md border border-line-strong bg-field">
        <CommandInput
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          value={query}
          onValueChange={(next) => {
            setQuery(next);
            if (value && next !== value.name) onChange(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder={t('placeholder')}
          className="h-[var(--field-h)]"
        />
        {open ? (
          <CommandList className={cn('absolute left-0 right-0 top-full z-20 mt-1 max-h-64 rounded-md border border-line bg-surface shadow-md')}>
            <CommandEmpty>{t('empty')}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem key={option.id} value={option.id} onSelect={() => pick(option)}>
                  {option.name}
                </CommandItem>
              ))}
              {value ? (
                <CommandItem value="__clear" onSelect={() => pick(null)} className="text-muted-ink">
                  {t('clear')}
                </CommandItem>
              ) : null}
              {canCreate ? (
                <CommandItem value="__create" onSelect={() => { setOpen(false); setCreating(true); }} className="border-t border-line-2 font-semibold">
                  <Plus className="size-3.5" aria-hidden />
                  {t('create')}
                </CommandItem>
              ) : null}
            </CommandGroup>
          </CommandList>
        ) : null}
      </Command>
      {hint ? <p className="text-[12px] text-muted-ink">{hint}</p> : null}
      {canCreate ? (
        <CreateContactDialog withTrigger={false} open={creating} onOpenChange={setCreating} onCreated={(contact) => pick(contact)} />
      ) : null}
    </div>
  );
}
```

`CommandItem` setzt `role="option"` (cmdk), `CommandInput` ist ein `<input>` — die Rollen im E2E passen. Prüfen, ob `CommandInput` in `command.tsx` `id`, `role` und `aria-label` durchreicht; sonst dort `...props` an das Input weitergeben.

`de.json`, unter `contacts`: `"picker": { "placeholder": "Name eingeben …", "empty": "Kein Kontakt gefunden.", "clear": "— Kein Kontakt —", "create": "Neu anlegen …" }`.

- [ ] **Step 6: Formulare umstellen**

`draft-form.tsx`: `contacts: { id; name }[]` wird `recipient: PickedContact | null` in `DraftFormProps.draft` und als Prop `canCreateContact: boolean`; das `<Select id="recipientId">` wird:

```tsx
        <ContactPicker id="recipientId" name="recipientId" label={t('fields.recipient')} value={recipient} onChange={setRecipient} canCreate={canCreateContact} />
```

mit `const [recipient, setRecipient] = useState<PickedContact | null>(draft?.recipient ?? null);`.

`receive-form.tsx`: Absender genauso (`senderId`), `handleSenderChange` wird zu `onChange={(c) => { setSender(c); void refreshSuggestion(c?.id ?? ''); }}` — die Logik, die beim Absenderwechsel den Vorschlag neu holt, bleibt.

Die Seiten (`dms/new/page.tsx`, `dms/[id]/edit/page.tsx`, `dms-view.tsx`) laden keine Kontaktliste mehr; `edit/page.tsx` löst den gewählten Empfänger über `getContact` + `displayName` zu `{ id, name }` auf. `canCreateContact = hasPermission(ctx, 'contacts.manage')`.

Bestehende E2E, die `selectOption` am Empfänger/Absender benutzen (`grep -n "Empfänger\|Absender" apps/kompass/e2e/dms.spec.ts`), auf das Suchfeld umstellen: `fill('<Name>')` + `getByRole('option', { name })`.

- [ ] **Step 7: E2E laufen lassen**

Run: `pnpm --filter @kompass/app e2e -- --grep "dms"`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/kompass
git commit -m "feat(ui): a contact is found by typing, and made on the spot if missing"
```

---

### Task 3: Detailseite — Ordner, Bezüge, Dokumentbezüge

**Files:**
- Modify: `apps/kompass/src/app/(shell)/dms/actions.ts` (neue Actions)
- Create: `apps/kompass/src/app/(shell)/dms/[id]/folder-panel.tsx`, `links-panel.tsx`, `relations-panel.tsx`
- Create: `apps/kompass/src/app/(shell)/dms/search-action.ts` (`searchDocumentsAction`)
- Modify: `apps/kompass/src/app/(shell)/dms/[id]/page.tsx`, `document-detail.tsx`
- Modify: `apps/kompass/messages/de.json`
- Test: E2E

**Interfaces:**
- Produces Actions: `moveDocumentAction(id, folder: string | null)`, `linkDocumentAction(id, entityType, entityId, role)`, `unlinkDocumentAction(id, linkId)`, `relateDocumentsAction(id, relatedId, kind)`, `unrelateDocumentsAction(id, relationId)`, `searchDocumentsAction(text): { id, number, subject, phase }[]` (bis 20, über `listDocuments({ text, limit: 20 })`).

- [ ] **Step 1: Failing E2E schreiben**

```ts
  test('holt ein Dokument aus dem Eingangskorb in einen Ordner', async ({ page }) => {
    await login(page);
    await page.goto('/dms?inbox=1');
    await page.getByRole('row').nth(1).click();
    await page.getByLabel('Ordner').selectOption('behoerden/finanzamt');
    await page.getByRole('button', { name: 'Ordner speichern' }).click();
    await expect(page.getByText('Dokument verschoben')).toBeVisible();
    await page.goto('/dms?inbox=1');
    await expect(page.getByRole('row')).toHaveCount(1); // nur die Kopfzeile
  });

  test('legt am Dokument einen Bezug zu einem Kontakt an und entfernt ihn wieder', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await page.getByRole('link', { name: /BRF-\d{4}-\d{3}/ }).first().click();
    await page.getByRole('button', { name: 'Bezug hinzufügen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Bezug hinzufügen' });
    await dialog.getByRole('combobox', { name: 'Kontakt' }).fill('Mus');
    await page.getByRole('option').first().click();
    await dialog.getByLabel('Rolle').selectOption('about');
    await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
    const links = page.getByTestId('document-links');
    await expect(links.getByText('Betrifft')).toBeVisible();
    await links.getByRole('button', { name: 'Entfernen' }).last().click();
    await expect(links.getByText('Betrifft')).toBeHidden();
  });

  test('ein Eingang ist Anlage zu einem Brief, und beide Seiten sagen es', async ({ page }) => {
    await login(page);
    await page.goto('/dms?direction=incoming');
    await page.getByRole('row').nth(1).click();
    await page.getByRole('button', { name: 'Dokumentbezug hinzufügen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Dokumentbezug hinzufügen' });
    // Der Seed setzt „Antwort auf“ schon; hier eine zweite Art.
    await dialog.getByLabel('Art').selectOption('attachmentOf');
    await dialog.getByRole('combobox', { name: 'Dokument' }).fill('BRF');
    await page.getByRole('option', { name: /BRF-/ }).first().click();
    await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
    const relations = page.getByTestId('document-relations');
    await expect(relations.getByText('Anlage zu')).toBeVisible();
    await relations.getByRole('link', { name: /BRF-/ }).last().click();
    await expect(page.getByTestId('document-relations').getByText('Anlage:')).toBeVisible();
  });
```

- [ ] **Step 2: E2E laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/app e2e -- --grep "Eingangskorb in einen Ordner|Bezug zu einem Kontakt|Anlage zu einem Brief"`
Expected: FAIL

- [ ] **Step 3: Actions**

In `dms/actions.ts` anfügen (Imports: `moveDocument`, `linkDocument`, `unlinkDocument`, `relateDocuments`, `unrelateDocuments` aus `@kompass/module-dms`):

```ts
export async function moveDocumentAction(id: string, folder: string | null): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await moveDocument(deps, ctx, { id, folder });
  if (!result.ok) return toActionState(result, t);
  revalidatePath(`/dms/${id}`);
  revalidatePath('/dms');
  return toActionState(result, t, t('dms.toast.moved'));
}

export async function linkDocumentAction(id: string, entityType: string, entityId: string, role: 'sender' | 'recipient' | 'about'): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await linkDocument(deps, ctx, { documentId: id, entityType, entityId, role });
  revalidatePath(`/dms/${id}`);
  return toActionState(result, t, t('dms.toast.linked'));
}

export async function unlinkDocumentAction(id: string, linkId: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await unlinkDocument(deps, ctx, { id: linkId });
  revalidatePath(`/dms/${id}`);
  return toActionState(result, t, t('dms.toast.unlinked'));
}

export async function relateDocumentsAction(id: string, relatedDocumentId: string, kind: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await relateDocuments(deps, ctx, { documentId: id, relatedDocumentId, kind });
  revalidatePath(`/dms/${id}`);
  revalidatePath(`/dms/${relatedDocumentId}`);
  return toActionState(result, t, t('dms.toast.related'));
}

export async function unrelateDocumentsAction(id: string, relationId: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await unrelateDocuments(deps, ctx, { id: relationId });
  revalidatePath(`/dms/${id}`);
  return toActionState(result, t, t('dms.toast.unrelated'));
}
```

`apps/kompass/src/app/(shell)/dms/search-action.ts`:

```ts
'use server';

import { listDocuments } from '@kompass/module-dms';
import { requireSession } from '@/lib/request-context';

export interface PickedDocument {
  id: string;
  number: string | null;
  subject: string;
  phase: 'draft' | 'issued';
}

export async function searchDocumentsAction(text: string, exceptId?: string): Promise<PickedDocument[]> {
  const { deps, ctx } = await requireSession();
  const trimmed = text.trim();
  const res = await listDocuments(deps, ctx, trimmed ? { text: trimmed, limit: 20 } : { limit: 20 });
  if (!res.ok) return [];
  return res.value.documents.filter((d) => d.id !== exceptId).map((d) => ({ id: d.id, number: d.number, subject: d.subject, phase: d.phase }));
}
```

In `lib/actions.ts`, `KNOWN_CONFLICTS` erweitern um `documentIsDraft`, `notOutgoing`, `notDispatched`, `relationSelf`, `relationExists`, `snippetExists`, `documentNotVoided`, `followUpDone`, `followUpOpen`, `linkExists`. `de.json`, `errors.conflict`: je ein Satz, z. B. `"relationSelf": "Ein Dokument kann sich nicht auf sich selbst beziehen."`, `"documentIsDraft": "Das ist noch ein Entwurf."`, `"notOutgoing": "Eingegangene Post wird nicht versandt."`, `"notDispatched": "Es gibt keinen Versandvermerk."`, `"relationExists": "Dieser Bezug besteht bereits."`, `"snippetExists": "Ein Baustein mit diesem Namen existiert bereits."`, `"documentNotVoided": "Ein Ersatz gibt es nur für ein storniertes Dokument."`, `"followUpDone": "Die Wiedervorlage ist bereits erledigt."`, `"followUpOpen": "Die Wiedervorlage ist noch offen."`, `"linkExists": "Dieser Bezug besteht bereits."`.

- [ ] **Step 4: Ordner-Kasten**

`dms/[id]/folder-panel.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { moveDocumentAction } from '../actions';

/** Der Ausgang aus dem Eingangskorb: der Ordner ist am Dokument änderbar. */
export function FolderPanel({ documentId, folder, folders, canEdit }: { documentId: string; folder: string | null; folders: string[]; canEdit: boolean }) {
  const t = useTranslations('dms');
  const [value, setValue] = useState(folder ?? '');
  const [pending, start] = useTransition();
  const changed = (value || null) !== folder;

  return (
    <div className="space-y-1.5">
      <Label htmlFor="document-folder">{t('columns.folder')}</Label>
      <div className="flex gap-2">
        <Select id="document-folder" value={value} onChange={(e) => setValue(e.target.value)} disabled={!canEdit}>
          <option value="">{t('inbox')}</option>
          {folders.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </Select>
        {canEdit ? (
          <Button type="button" variant="outline" disabled={!changed || pending} onClick={() => start(async () => {
            const s = await moveDocumentAction(documentId, value || null);
            if (s.status === 'error') toast.error(s.message);
            else if (s.status === 'success' && s.message) toast.success(s.message);
          })}>
            {t('folderSave')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
```

`de.json`, `dms`: `"folderSave": "Ordner speichern"`, `toast.moved: "Dokument verschoben"`.

Die Detailseite reicht `folders` (über `listDocumentFolders`) an `DocumentDetail`, die den Kasten an Stelle der bisherigen `dt/dd`-Zeile „Ordner“ im Details-Abschnitt rendert.

- [ ] **Step 5: Bezüge-Kasten mit Hinzufügen und Entfernen**

`dms/[id]/links-panel.tsx` ersetzt den Abschnitt „Links / Bezüge“ in `document-detail.tsx`. Er zeigt die aufgelösten Bezüge wie bisher (`data-testid="document-links"`), je Zeile „Entfernen“ (nur mit `canEdit`), und einen Knopf „Bezug hinzufügen“, der einen Dialog öffnet:

- `Entitätstyp` als `Select` (`contact`, und, wenn die Seite sie mitgibt, `animal`, `project`),
- bei `contact` der `ContactPicker` (Label „Kontakt“, `canCreate` nach `contacts.manage`), bei `animal`/`project` ein `Select` über die Listen, die die Seite mitgibt (`animals: { id, name }[]`, `projects: { id, name }[]`, geladen mit `listAnimals` bzw. `listProjects`, wenn das Modul eingeschaltet und das Recht da ist),
- `Rolle` als `Select` mit `sender`, `recipient`, `about` (Texte aus `dms.roles`),
- Fußzeile mit `Abbrechen` und `Hinzufügen` (`SubmitButton`).

Beim Absenden `linkDocumentAction(documentId, entityType, entityId, role)`, bei Erfolg Dialog schließen und `router.refresh()`. Fehler als `toast.error`. Die Rollen-Vorbelegung: `about`.

`de.json`, `dms`: `"links": { "add": "Bezug hinzufügen", "addTitle": "Bezug hinzufügen", "addDescription": "Ein Kontakt, Tier oder Projekt, zu dem dieses Dokument gehört.", "entityType": "Art des Bezugs", "contact": "Kontakt", "role": "Rolle", "submit": "Hinzufügen", "remove": "Entfernen" }`, `toast.linked: "Bezug angelegt"`, `toast.unlinked: "Bezug entfernt"`.

- [ ] **Step 6: Dokumentbezüge-Kasten**

`dms/[id]/relations-panel.tsx`: Liste aus `document.relations` (`data-testid="document-relations"`), jede Zeile mit gedrehtem Text nach Art und Richtung und einem Link auf das andere Dokument (`/dms/<otherId>`, Text `otherNumber ?? otherSubject`), dazu „Entfernen“. Der Text je Art und Richtung kommt aus `dms.relations.kinds.<kind>.<direction>`:

```json
"relations": {
  "title": "Dokumentbezüge",
  "add": "Dokumentbezug hinzufügen",
  "addDescription": "Ein anderes Dokument der Akte, zu dem dieses gehört.",
  "kind": "Art",
  "document": "Dokument",
  "submit": "Hinzufügen",
  "remove": "Entfernen",
  "kinds": {
    "repliesTo": { "out": "Antwort auf {other}", "in": "beantwortet durch {other}" },
    "signedCopyOf": { "out": "unterschriebene Fassung von {other}", "in": "unterschrieben zurück als {other}" },
    "replaces": { "out": "ersetzt {other}", "in": "ersetzt durch {other}" },
    "attachmentOf": { "out": "Anlage zu {other}", "in": "Anlage: {other}" }
  },
  "kindLabels": { "repliesTo": "Antwort auf", "signedCopyOf": "Unterschriebene Fassung von", "replaces": "Ersetzt", "attachmentOf": "Anlage zu" }
}
```

Der Dialog „Dokumentbezug hinzufügen“: `Art` als `Select` über die vier Arten, `Dokument` als Suchfeld nach demselben Muster wie `ContactPicker`, aber gegen `searchDocumentsAction(text, documentId)` (eine kleine `DocumentPicker`-Komponente in derselben Datei; Optionen zeigen `number · subject`, Entwürfe mit Badge). Beim Absenden `relateDocumentsAction`.

`t.rich` ist nicht nötig; `{other}` wird als Text eingesetzt und der Link separat davor gesetzt — einfacher: Zeile = `<Link>{other}</Link>` + Text ohne Platzhalter. Dann lauten die Schlüssel ohne `{other}`: `"out": "Antwort auf"`, `"in": "beantwortet durch"`, und die Zeile rendert `{t(kinds.kind.direction)} <Link>…</Link>`. Diese Variante nehmen; die JSON-Werte entsprechend ohne `{other}`.

Aktualisierung nach jeder Aktion über `router.refresh()`.

- [ ] **Step 7: Detailseite verdrahten**

`dms/[id]/page.tsx`: lädt `folders` (`listDocumentFolders`), `animals` (`isModuleEnabled(deps, 'animals') && hasPermission(ctx, 'animals.view')` → `listAnimals`, nur `{ id, name }`), `projects` (`hasPermission(ctx, 'projects.view')` → `listProjects`), `canCreateContact`, und gibt `relations` aus `doc.relations` mit. `document-detail.tsx` rendert `FolderPanel` im Details-Kasten, `LinksPanel` und `RelationsPanel` in der rechten Spalte.

- [ ] **Step 8: E2E laufen lassen**

Run: `pnpm --filter @kompass/app e2e -- --grep "dms"`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/kompass
git commit -m "feat(dms): the document can be moved, linked, and related to another document from its own page"
```

---

### Task 4: Detailseite — Versand, Wiedervorlagen, Notizen, Ersatz

**Files:**
- Modify: `apps/kompass/src/app/(shell)/dms/actions.ts`
- Create: `apps/kompass/src/app/(shell)/dms/[id]/dispatch-panel.tsx`, `follow-ups-panel.tsx`, `notes-panel.tsx`
- Modify: `apps/kompass/src/app/(shell)/dms/[id]/page.tsx`, `document-detail.tsx` (Storno-Dialog)
- Modify: `apps/kompass/messages/de.json`
- Test: E2E

**Interfaces:**
- Produces Actions: `recordDispatchAction(id, formData)` (Felder `sentAt`, `sentVia`, `note`), `clearDispatchAction(id)`, `createFollowUpAction(id, formData)` (`dueAt`, `title`, `assigneeUserId`), `completeFollowUpAction(id, followUpId)`, `reopenFollowUpAction(id, followUpId)`, `addNoteAction(id, formData)` (`body`), `deleteNoteAction(id, noteId)`, `voidDocumentAction(id, reason, withReplacement: boolean)` (erweitert; bei Ersatz `redirect` in den Editor).

- [ ] **Step 1: Failing E2E schreiben**

```ts
  test('vermerkt den Versand eines Briefs, und die Markierung verschwindet', async ({ page }) => {
    await login(page);
    await page.goto('/dms?unsent=1');
    const row = page.getByRole('row').nth(1);
    await expect(row.getByText('nicht versandt')).toBeVisible();
    await row.click();
    await page.getByRole('button', { name: 'Als versandt vermerken' }).click();
    const dialog = page.getByRole('dialog', { name: 'Als versandt vermerken' });
    await dialog.getByLabel('Versandt am').fill('2026-09-06');
    await dialog.getByLabel('Weg').selectOption('email');
    await dialog.getByRole('button', { name: 'Vermerken' }).click();
    await expect(page.getByTestId('dispatch-panel')).toContainText('E-Mail');
    await page.goto('/dms?unsent=1');
    await expect(page.getByRole('row')).toHaveCount(1);
  });

  test('legt eine Wiedervorlage an und hakt sie ab', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await page.getByRole('link', { name: /BRF-\d{4}-\d{3}/ }).first().click();
    await page.getByRole('button', { name: 'Neue Wiedervorlage' }).click();
    const dialog = page.getByRole('dialog', { name: 'Neue Wiedervorlage' });
    await dialog.getByLabel('Fällig am').fill('2026-10-01');
    await dialog.getByLabel('Anlass').fill('Nachfragen');
    await dialog.getByRole('button', { name: 'Anlegen' }).click();
    const panel = page.getByTestId('follow-ups-panel');
    await expect(panel.getByText('Nachfragen')).toBeVisible();
    await panel.getByRole('checkbox', { name: 'Nachfragen erledigen' }).check();
    await expect(panel.getByText('Nachfragen')).toHaveClass(/line-through/);
  });

  test('fügt eine Notiz an, sieht Name und Zeit, löscht sie', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await page.getByRole('row').nth(1).click();
    await page.getByLabel('Notiz anfügen').fill('Original liegt im Schrank');
    await page.getByRole('button', { name: 'Anfügen' }).click();
    const journal = page.getByTestId('notes-panel');
    await expect(journal.getByText('Original liegt im Schrank')).toBeVisible();
    await expect(journal.getByText('Anna Berger')).toBeVisible();
    await journal.getByRole('button', { name: 'Notiz löschen' }).last().click();
    await page.getByRole('button', { name: 'Löschen' }).click();
    await expect(journal.getByText('Original liegt im Schrank')).toBeHidden();
  });

  test('storniert mit Ersatz und landet im Editor des Ersatzes', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await page.getByRole('link', { name: 'Einladung zur ordentlichen Mitgliederversammlung' }).click();
    await page.getByRole('button', { name: 'Stornieren' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Grund für die Stornierung').fill('Falsches Datum');
    await dialog.getByLabel('Ersatz als Entwurf anlegen').check();
    await dialog.getByRole('button', { name: 'Stornieren' }).click();
    await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}\/edit$/);
    await expect(page.getByLabel('Betreff')).toHaveValue('Einladung zur ordentlichen Mitgliederversammlung');
  });
```

- [ ] **Step 2: E2E laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/app e2e -- --grep "Versand eines Briefs|Wiedervorlage an|Notiz an|mit Ersatz"`
Expected: FAIL

- [ ] **Step 3: Actions**

In `dms/actions.ts` (Imports: `recordDispatch`, `clearDispatch`, `createDocumentFollowUp`, `addNote`, `deleteNote`, `createReplacementDraft` aus `@kompass/module-dms`; `completeFollowUp`, `reopenFollowUp` aus `@kompass/core`):

```ts
export async function recordDispatchAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await recordDispatch(deps, ctx, {
    id,
    sentAt: String(formData.get('sentAt') ?? ''),
    sentVia: String(formData.get('sentVia') ?? ''),
    note: orNull(formData.get('note')) ?? undefined,
  });
  revalidatePath(`/dms/${id}`);
  revalidatePath('/dms');
  return toActionState(result, t, t('dms.toast.dispatched'));
}

export async function clearDispatchAction(id: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await clearDispatch(deps, ctx, { id });
  revalidatePath(`/dms/${id}`);
  revalidatePath('/dms');
  return toActionState(result, t, t('dms.toast.dispatchCleared'));
}

export async function createFollowUpAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await createDocumentFollowUp(deps, ctx, {
    documentId: id,
    dueAt: String(formData.get('dueAt') ?? ''),
    title: String(formData.get('title') ?? '').trim(),
    assigneeUserId: orNull(formData.get('assigneeUserId')),
  });
  revalidatePath(`/dms/${id}`);
  revalidatePath('/dms');
  revalidatePath('/');
  return toActionState(result, t, t('dms.toast.followUpCreated'));
}

export async function completeFollowUpAction(id: string, followUpId: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await completeFollowUp(deps, ctx, { id: followUpId });
  revalidatePath(`/dms/${id}`);
  revalidatePath('/dms');
  revalidatePath('/');
  return toActionState(result, t);
}

export async function reopenFollowUpAction(id: string, followUpId: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await reopenFollowUp(deps, ctx, { id: followUpId });
  revalidatePath(`/dms/${id}`);
  revalidatePath('/dms');
  revalidatePath('/');
  return toActionState(result, t);
}

export async function addNoteAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await addNote(deps, ctx, { documentId: id, body: String(formData.get('body') ?? '') });
  revalidatePath(`/dms/${id}`);
  return toActionState(result, t, t('dms.toast.noteAdded'));
}

export async function deleteNoteAction(id: string, noteId: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await deleteNote(deps, ctx, { id: noteId });
  revalidatePath(`/dms/${id}`);
  return toActionState(result, t, t('dms.toast.noteDeleted'));
}
```

`voidDocumentAction` erweitern:

```ts
export async function voidDocumentAction(id: string, reason: string, withReplacement = false): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await voidDocument(deps, ctx, { id, reason });
  if (!result.ok) return toActionState(result, t);
  revalidatePath(`/dms/${id}`);
  revalidatePath('/dms');
  if (withReplacement) {
    const replacement = await createReplacementDraft(deps, ctx, { voidedId: id });
    if (!replacement.ok) return toActionState(replacement, t);
    redirect(`/dms/${replacement.value.id}/edit`);
  }
  return toActionState(result, t, t('dms.toast.voided'));
}
```

- [ ] **Step 4: Versand-Kasten**

`dms/[id]/dispatch-panel.tsx` (`data-testid="dispatch-panel"`): nur gerendert, wenn `direction === 'outgoing' && phase === 'issued'`. Zeigt entweder „Noch nicht versandt“ mit Knopf „Als versandt vermerken“, oder Datum (formatiert), Weg (Beschriftung aus `channels`, sonst der Schlüssel) und Bemerkung, mit Knöpfen „Ändern“ und „Vermerk entfernen“ (Bestätigung über `ConfirmDialog`). Der Dialog „Als versandt vermerken“ ist ein Formular mit `useActionState(recordDispatchAction.bind(null, documentId), idleState)`: `sentAt` (`type="date"`, Vorgabe heute, `required`), `sentVia` (`Select` über `channels`, `required`), `note` (`Input`). Props: `documentId`, `sentAt`, `sentVia`, `sentNote`, `channels: { key; label }[]`, `today`, `canEdit`.

`de.json`, `dms.dispatch`: `"title": "Versand"`, `"none": "Noch nicht versandt."`, `"record": "Als versandt vermerken"`, `"change": "Ändern"`, `"clear": "Vermerk entfernen"`, `"clearTitle": "Versandvermerk entfernen"`, `"clearDescription": "Der Vermerk wird entfernt; das Protokoll behält ihn."`, `"clearConfirm": "Entfernen"`, `"sentAt": "Versandt am"`, `"sentVia": "Weg"`, `"note": "Bemerkung"`, `"submit": "Vermerken"`, `"summary": "Versandt am {date} per {via}"`, `"unsentBadge": "nicht versandt"`. `toast.dispatched: "Versand vermerkt"`, `toast.dispatchCleared: "Versandvermerk entfernt"`. `errors.fields`: `"unknownDispatchChannel": "Unbekannter Versandweg."`, `"sentBeforeDocumentDate": "Der Versand liegt vor dem Datum des Dokuments."`, `"sentInFuture": "Der Versand liegt in der Zukunft."` — und in `lib/actions.ts` `fieldMessage` diese drei Codes wie die Medien-Codes auf `errors.fields.<code>` abbilden.

- [ ] **Step 5: Wiedervorlagen-Kasten**

`dms/[id]/follow-ups-panel.tsx` (`data-testid="follow-ups-panel"`): offene Wiedervorlagen als Liste mit `Checkbox` (`aria-label={t('complete', { title })}`), Datum (überfällig in `text-warning`), Anlass, zuständige Person (Name aus `users`, den die Seite auflöst); erledigte in einem `Disclosure` („{count} erledigt“), jede mit Häkchen zum Wiederöffnen. Knopf „Neue Wiedervorlage“ → Dialog mit `dueAt` (`type="date"`, `required`), `title` (`required`), `assigneeUserId` (`Select` über die aktiven Nutzer, Vorgabe leer = alle). Props: `documentId`, `followUps: { id, dueAt, title, assigneeName: string | null, doneAt: string | null }[]`, `users: { id, name }[]`, `today`, `canManage` (= `followUps.manage`). Nur gerendert, wenn `followUps.view`.

Die Seite lädt `users` über `listUsers` nur, wenn `users.manage` — sonst über eine schmale Abfrage `deps.db.select({ id, name }).from(schema.users).where(eq(isActive, true))`: Namen der Kolleginnen sind keine Verwaltungsdaten, und ohne sie kann niemand eine Zuständigkeit setzen. Diese Abfrage steht in der Seite, nicht in einem Service, weil sie keinen Vorgang abbildet.

`de.json`, `dms.followUps`: `"title": "Wiedervorlagen"`, `"none": "Keine offenen Wiedervorlagen."`, `"add": "Neue Wiedervorlage"`, `"addDescription": "Ein Datum und ein Anlass; die Startseite erinnert daran."`, `"dueAt": "Fällig am"`, `"titleField": "Anlass"`, `"assignee": "Zuständig"`, `"everyone": "— Alle —"`, `"submit": "Anlegen"`, `"complete": "{title} erledigen"`, `"reopen": "{title} wieder öffnen"`, `"done": "{count, plural, one {# erledigt} other {# erledigt}}"`, `"overdue": "überfällig"`. `toast.followUpCreated: "Wiedervorlage angelegt"`.

- [ ] **Step 6: Notizjournal**

`dms/[id]/notes-panel.tsx` (`data-testid="notes-panel"`): unter der Vorschau, volle Breite. Liste chronologisch: Name (aufgelöst über `users`), Zeit (`format.dateTime`), Text (`whitespace-pre-line`), Knopf „Notiz löschen“ (Icon-Knopf mit `aria-label`) nur bei eigener Notiz oder `canManage`, mit `ConfirmDialog`. Darunter ein Formular: `Textarea` (`aria-label={t('add')}`, `rows={3}`, `required`) und `SubmitButton` „Anfügen“; nach Erfolg Feld leeren. Props: `documentId`, `notes: { id, body, authorName, createdAt, mine: boolean }[]`, `canEdit`, `canManage`.

`de.json`, `dms.notes`: `"title": "Notizen"`, `"none": "Noch keine Notiz."`, `"add": "Notiz anfügen"`, `"submit": "Anfügen"`, `"delete": "Notiz löschen"`, `"deleteTitle": "Notiz löschen"`, `"deleteDescription": "Die Notiz wird entfernt; das Protokoll behält den Vorgang."`, `"deleteConfirm": "Löschen"`, `"hint": "Notizen stehen nie im Dokument, nie im Volltext, nie in einem Export."`. `toast.noteAdded`, `toast.noteDeleted`.

- [ ] **Step 7: Storno mit Ersatz**

In `document-detail.tsx`, im Storno-Dialog unter dem Grund eine `Checkbox` mit Label `t('voidWithReplacement')` (`"Ersatz als Entwurf anlegen"`), nur bei `permissions.canEdit`; der Knopf ruft `voidDocumentAction(doc.id, voidReason, withReplacement)`. Bei Ersatz übernimmt die Action die Weiterleitung.

- [ ] **Step 8: Seite verdrahten**

`dms/[id]/page.tsx` lädt zusätzlich: `dispatchChannels(deps)`, die Nutzerliste, `hasPermission(ctx, 'followUps.view' | 'followUps.manage')`, die Namen der Notiz- und Wiedervorlage-Autoren (eine Abfrage über `users` mit `inArray` der IDs), und reicht alles an `DocumentDetail`, die die drei Kästen platziert: Versand und Wiedervorlagen in der rechten Spalte zwischen Details und Aufbewahrung, Notizen unter der Vorschau in der linken Spalte.

- [ ] **Step 9: E2E laufen lassen**

Run: `pnpm --filter @kompass/app e2e -- --grep "dms"`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add apps/kompass
git commit -m "feat(dms): dispatch, follow-ups, notes and a replacement, all on the document's page"
```

---

### Task 5: Liste — Zeile auf Ordner ziehen, Markierungen, Filter

**Files:**
- Modify: `apps/kompass/src/app/(shell)/dms/document-list.tsx`, `dms-workspace.tsx`, `folder-column.tsx`, `dms-view.tsx`
- Modify: `apps/kompass/messages/de.json`
- Test: E2E

- [ ] **Step 1: Failing E2E schreiben**

```ts
  test('zieht eine Zeile der Liste auf einen Ordner und verschiebt sie', async ({ page }) => {
    await login(page);
    await page.goto('/dms?inbox=1');
    await expect(page.locator('[data-drop="ready"]')).toBeAttached();
    const rowId = await page.getByRole('row').nth(1).getAttribute('data-document-id');
    await page.evaluate(({ id }) => {
      const transfer = new DataTransfer();
      transfer.setData('application/x-kompass-document', id!);
      const target = document.querySelector('[data-folder="behoerden/finanzamt"]')!;
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
      }
    }, { id: rowId });
    await expect(page.getByText('Dokument verschoben')).toBeVisible();
    await expect(page.getByRole('row')).toHaveCount(1);
  });

  test('markiert nicht versandte Ausgänge und offene Wiedervorlagen in der Liste', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await expect(page.getByRole('row').filter({ hasText: 'nicht versandt' }).first()).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Wiedervorlage' }).first()).toBeVisible();
    await page.getByLabel('Wiedervorlage').selectOption('open');
    await expect(page).toHaveURL(/followUp=open/);
    await expect(page.getByRole('row').filter({ hasText: 'Wiedervorlage' })).toHaveCount(await page.getByRole('row').count() - 1);
  });
```

Der Seed (Plan 2, Task 10) enthält einen versandten und einen nicht versandten Brief; die Wiedervorlage kommt aus Plan 2, Task 11.

- [ ] **Step 2: E2E laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/app e2e -- --grep "Zeile der Liste|markiert nicht versandte"`
Expected: FAIL

- [ ] **Step 3: Zeile ziehbar, Spalte nimmt Zeilen an**

`document-list.tsx`: jede `TableRow` bekommt `data-document-id={doc.id}`, `draggable={canMove}`, `onDragStart={(e) => { e.dataTransfer.setData('application/x-kompass-document', doc.id); e.dataTransfer.effectAllowed = 'move'; }}`. `canMove` kommt als Prop (`dms.create`).

`dms-workspace.tsx`: `carriesFiles` bleibt für Dateien; ein zweiter Prüfer `carriesDocument = (e) => e.dataTransfer?.types?.includes('application/x-kompass-document')`. Das Fenster-Overlay reagiert nur auf Dateien. `FolderColumn` bekommt `onDropDocument(folder, documentId)`; in `onDrop` der Zeile: wenn `carriesDocument`, `onDropDocument(row.folder, e.dataTransfer.getData('application/x-kompass-document'))`, sonst wie bisher Dateien. Der Workspace ruft `moveDocumentAction(documentId, folder)` in einer `startTransition`, zeigt `toast.success`/`toast.error`, dann `router.refresh()`. Beim Ziehen einer Zeile heben sich die Ordnerzeilen wie bei Dateien hervor (`dragging`-Zustand über `dragenter`/`dragleave` am Fenster auch für den Dokument-Typ setzen, ohne das Overlay).

- [ ] **Step 4: Markierungen und Filter**

`DocumentListItem` bekommt `sentAt: string | null`, `openFollowUp: { dueAt: string } | null`. `dms-view.tsx` befüllt sie aus `d.sentAt` und `d.followUps.find((f) => !f.doneAt)`. Hinter dem Betreff, neben dem Entwurf-Badge:

```tsx
{doc.direction === 'outgoing' && doc.phase === 'issued' && doc.status !== 'voided' && !doc.sentAt ? (
  <StatusBadge tone="neutral">{t('dispatch.unsentBadge')}</StatusBadge>
) : null}
{doc.openFollowUp ? (
  <StatusBadge tone={doc.openFollowUp.dueAt < today ? 'warning' : 'info'}>{t('followUpBadge', { date: doc.openFollowUp.dueAt })}</StatusBadge>
) : null}
```

`today` als Prop aus `deps.clock`. Zwei neue Filter in der Filterzeile: `Select` „Versand“ (`aria-label={t('filters.dispatch')}`, Optionen `alle`, `unsent`) und `Select` „Wiedervorlage“ (`aria-label={t('filters.followUp')}`, Optionen `alle`, `open`); Zustand in der URL (`unsent=1`, `followUp=open`), `dms-view.tsx` übersetzt in `unsent: true` bzw. `withOpenFollowUp: true`.

`de.json`, `dms`: `"followUpBadge": "Wiedervorlage {date}"`, `"filters": { "dispatch": "Versand", "dispatchAll": "Versand: alle", "unsent": "nicht versandt", "followUp": "Wiedervorlage", "followUpAll": "Wiedervorlage: alle", "followUpOpen": "offen" }`.

- [ ] **Step 5: E2E laufen lassen**

Run: `pnpm --filter @kompass/app e2e -- --grep "dms"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/kompass
git commit -m "feat(dms): a row moves to a folder by dragging, and the list says what is unsent or due"
```

---

### Task 6: Ablegen-Dialog — „Antwort auf“; Editor — Bausteine

**Voraussetzung:** `receiveDocument` nimmt `relations` (Plan 2, Task 4b).

**Files:**
- Modify: `apps/kompass/src/app/(shell)/dms/receive/receive-form.tsx`, `dms/actions.ts` (`receiveDocumentAction` liest `repliesToId`)
- Create: `apps/kompass/src/app/(shell)/dms/document-picker.tsx` (aus Task 3 herausgelöst, damit Dialog und Detailseite dieselbe Komponente nutzen)
- Modify: `apps/kompass/src/app/(shell)/dms/new/draft-form.tsx`, `draft-screen.tsx`, `new/page.tsx`, `[id]/edit/page.tsx` (Bausteine laden)
- Modify: `apps/kompass/messages/de.json`
- Test: E2E

- [ ] **Step 1: Failing E2E schreiben**

```ts
  test('legt Post als Antwort auf einen Brief ab', async ({ page }) => {
    await login(page);
    await page.goto('/dms/receive');
    const dialog = receiveDialog(page);
    await dialog.getByLabel('Datei').setInputFiles(FIXTURE_PDF);
    await dialog.getByLabel('Betreff').fill('Antwort der Praxis');
    await dialog.getByLabel('Datum auf dem Dokument').fill('2026-09-10');
    await dialog.getByRole('combobox', { name: 'Antwort auf' }).fill('BRF');
    await page.getByRole('option', { name: /BRF-/ }).first().click();
    await dialog.getByRole('button', { name: 'Ablegen' }).click();
    await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}$/);
    await expect(page.getByTestId('document-relations').getByText(/Antwort auf/)).toBeVisible();
  });

  test('fügt einen Baustein an der Schreibmarke ein und übernimmt den Betreff in einen leeren Entwurf', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new');
    await page.getByLabel('Baustein einfügen').selectOption({ label: 'Bitte um Rückmeldung' });
    await expect(page.getByLabel('Betreff')).toHaveValue('Bitte um Rückmeldung');
    await expect(page.getByLabel('Text')).toHaveValue(/Rückmeldung/);
    const body = page.getByLabel('Text');
    await body.fill('Anfang ');
    await body.evaluate((el: HTMLTextAreaElement) => { el.setSelectionRange(el.value.length, el.value.length); });
    await page.getByLabel('Baustein einfügen').selectOption({ label: 'Grußformel' });
    await expect(body).toHaveValue(/^Anfang Mit freundlichen Grüßen/);
  });
```

- [ ] **Step 2: E2E laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/app e2e -- --grep "Antwort auf einen Brief ab|Baustein"`
Expected: FAIL

- [ ] **Step 3: „Antwort auf“ im Dialog**

`document-picker.tsx`: die Komponente aus Task 3 (Suchfeld gegen `searchDocumentsAction`, `name`-Prop für das versteckte Feld, `aria-label` = Label). `receive-form.tsx`: unter Ordner/Absender ein `DocumentPicker` mit `name="repliesToId"`, Label `t('fields.repliesTo')`. Ist ein Absender gewählt, holt das Formular über eine kleine Action `lastOutgoingToAction(contactId)` (in `dms/search-action.ts`: `listDocuments({ linkedTo: { entityType: 'contact', entityId }, direction: 'outgoing', phase: 'issued', limit: 1 })`) das jüngste Schreiben an diesen Kontakt und belegt das Feld vor, mit `SuggestionFlag` `t('suggest.fromSender')` — nur, solange das Feld nicht angefasst wurde (dasselbe `touched`-Muster).

`receiveDocumentAction`: `const repliesToId = orNull(formData.get('repliesToId'));` und `relations: repliesToId ? [{ relatedDocumentId: repliesToId, kind: 'repliesTo' as const }] : []` an `receiveDocument`.

`de.json`, `dms.fields`: `"repliesTo": "Antwort auf"`, `"noRepliesTo": "— Kein Bezug —"`.

- [ ] **Step 4: Bausteine im Editor**

`draft-form.tsx` bekommt `snippets: { id; name; subject: string | null; body: string }[]`. Über dem Textfeld ein `Select` (`aria-label={t('draft.insertSnippet')}`, erste Option `t('draft.insertSnippetNone')`, Wert zurück auf leer nach dem Einfügen):

```tsx
const insertSnippet = (id: string) => {
  const snippet = snippets.find((s) => s.id === id);
  if (!snippet) return;
  const el = bodyRef.current;
  const start = el?.selectionStart ?? body.length;
  const end = el?.selectionEnd ?? body.length;
  const next = body.slice(0, start) + snippet.body + body.slice(end);
  setBody(next);
  if (!subject.trim() && snippet.subject) setSubject(snippet.subject);
  requestAnimationFrame(() => {
    if (!el) return;
    const cursor = start + snippet.body.length;
    el.focus();
    el.setSelectionRange(cursor, cursor);
  });
};
```

mit `const bodyRef = useRef<HTMLTextAreaElement>(null)` am `Textarea`. Die Seiten laden `listSnippets(deps, ctx, {})`.

`de.json`, `dms.draft`: `"insertSnippet": "Baustein einfügen"`, `"insertSnippetNone": "Baustein einfügen …"`.

- [ ] **Step 5: E2E laufen lassen**

Run: `pnpm --filter @kompass/app e2e -- --grep "dms"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/kompass
git commit -m "feat(dms): post is filed as an answer, and the editor drops in the sentences that always come"
```

---

### Task 7: Verwaltung — Bausteine und Versandwege

**Files:**
- Create: `apps/kompass/src/app/(shell)/admin/dms/snippets-panel.tsx`, `dispatch-channels-panel.tsx`
- Modify: `apps/kompass/src/app/(shell)/admin/dms/actions.ts`, `page.tsx`
- Modify: `apps/kompass/messages/de.json`
- Test: E2E

- [ ] **Step 1: Failing E2E schreiben**

```ts
  test('verwaltet Textbausteine und Versandwege', async ({ page }) => {
    await login(page);
    await page.goto('/admin/dms');
    await page.getByRole('button', { name: 'Baustein anlegen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Baustein anlegen' });
    await dialog.getByLabel('Name').fill('Absage');
    await dialog.getByLabel('Text').fill('Leider müssen wir absagen.');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Absage' })).toBeVisible();

    await page.getByRole('button', { name: 'Versandweg anlegen' }).click();
    const channel = page.getByRole('dialog', { name: 'Versandweg anlegen' });
    await channel.getByLabel('Schlüssel').fill('courier');
    await channel.getByLabel('Beschriftung').fill('Kurier');
    await channel.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Kurier' })).toBeVisible();
  });
```

- [ ] **Step 2: E2E laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/app e2e -- --grep "Textbausteine und Versandwege"`
Expected: FAIL

- [ ] **Step 3: Actions**

In `admin/dms/actions.ts`:

```ts
export async function createSnippetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await createSnippet(deps, ctx, {
    name: String(formData.get('name') ?? '').trim(),
    subject: orNull(formData.get('subject')),
    body: String(formData.get('body') ?? ''),
    sortOrder: Number(formData.get('sortOrder') ?? 0),
  });
  revalidatePath('/admin/dms');
  return toActionState(result, t, t('dms.admin.toast.snippetCreated'));
}

export async function updateSnippetAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await updateSnippet(deps, ctx, {
    id,
    name: String(formData.get('name') ?? '').trim(),
    subject: orNull(formData.get('subject')),
    body: String(formData.get('body') ?? ''),
    sortOrder: Number(formData.get('sortOrder') ?? 0),
    isActive: formData.get('isActive') === 'on' || formData.get('isActive') === 'true',
  });
  revalidatePath('/admin/dms');
  return toActionState(result, t, t('dms.admin.toast.snippetUpdated'));
}

export async function deleteSnippetAction(id: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await deleteSnippet(deps, ctx, { id });
  revalidatePath('/admin/dms');
  return toActionState(result, t, t('dms.admin.toast.snippetDeleted'));
}

/** Die ganze Liste wird gesetzt — sie ist eine Einstellung, kein Datensatz je Zeile. */
export async function saveDispatchChannelsAction(channels: { key: string; label: string }[]): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setSetting(deps, ctx, { key: 'dms.dispatchChannels', value: channels });
  revalidatePath('/admin/dms');
  return toActionState(result, t, t('dms.admin.toast.channelsSaved'));
}
```

- [ ] **Step 4: Panels**

`snippets-panel.tsx` nach dem Muster von `folders-panel.tsx`: Tabelle (Name, Betreff, aktiv, Aktionen), Dialog „Baustein anlegen“ / „Baustein bearbeiten“ mit `name` (`required`), `subject`, `body` (`Textarea`, `required`, `font-mono`), `sortOrder`, beim Bearbeiten `isActive` (`Checkbox`); Löschen mit Bestätigungsdialog.

`dispatch-channels-panel.tsx`: Tabelle (Schlüssel `font-mono`, Beschriftung, Aktionen), Dialog „Versandweg anlegen“ mit `key` (`pattern="[a-z][a-zA-Z0-9]*"`, `required`) und `label` (`required`), „Umbenennen“ (nur `label`), „Entfernen“ mit Bestätigung. Jede Aktion baut die neue Liste im Client und ruft `saveDispatchChannelsAction(list)`; nur mit `settings.manage` bedienbar (Prop `canManageSettings`, wie beim `TextPanel`).

`page.tsx`: `listSnippets(deps, ctx, { includeInactive: true })` und `dispatchChannels(deps)` laden, Panels unter dem `FoldersPanel` einhängen.

`de.json`, `dms.admin`: `"snippetsTitle": "Textbausteine"`, `"snippetsDescription": "Absätze und Standardbriefe, die der Editor auf Wunsch einfügt. Ohne Platzhalter."`, `"createSnippet": "Baustein anlegen"`, `"createSnippetTitle": "Baustein anlegen"`, `"editSnippetTitle": "Baustein bearbeiten"`, `"snippetColumns": { "name": "Name", "subject": "Betreff", "active": "Aktiv", "actions": "Aktionen" }`, `"snippetFields": { "name": "Name", "subject": "Betreff (optional)", "body": "Text", "sortOrder": "Reihenfolge" }`, `"deleteSnippetTitle": "Baustein löschen"`, `"deleteSnippetDescription": "„{name}“ wird gelöscht. Briefe, die ihn benutzt haben, behalten ihren Text."`, `"deleteSnippetConfirm": "Löschen"`, `"emptySnippets": "Noch kein Baustein."`, `"channelsTitle": "Versandwege"`, `"channelsDescription": "Die Wege, die ein Versandvermerk kennt. Ein entfernter Weg bleibt an alten Vermerken lesbar."`, `"createChannel": "Versandweg anlegen"`, `"createChannelTitle": "Versandweg anlegen"`, `"renameChannelTitle": "Versandweg umbenennen"`, `"channelFields": { "key": "Schlüssel", "label": "Beschriftung" }`, `"channelColumns": { "key": "Schlüssel", "label": "Beschriftung", "actions": "Aktionen" }`, `"removeChannelTitle": "Versandweg entfernen"`, `"removeChannelDescription": "„{label}“ steht danach nicht mehr zur Wahl."`, `"removeChannelConfirm": "Entfernen"`, `"lastChannel": "Mindestens ein Weg muss bleiben."`, `toast.snippetCreated/-Updated/-Deleted`, `toast.channelsSaved`.

- [ ] **Step 5: E2E laufen lassen**

Run: `pnpm --filter @kompass/app e2e -- --grep "dms"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/kompass
git commit -m "feat(dms): text blocks and dispatch channels are kept under administration"
```

---

### Task 8: Abschluss

- [ ] **Step 1: Ringe**

Run: `pnpm typecheck && pnpm test && pnpm --filter @kompass/app e2e`
Expected: PASS. Dann `pnpm verify` vor dem Push.

- [ ] **Step 2: Handoff-Abgleich**

Alle neuen Felder auf `--field-h` (Input, Select, Textarea, Button ohne `size="sm"` in Formularen), Zeilen auf `var(--row-h)`, Pflichtsternchen an Pflichtfeldern, `* Pflichtfeld`-Legende in Dialogen mit Pflichtfeldern (`FormActionBar` bringt sie mit; die Dialoge aus Task 3, 4 und 7 nutzen `DialogFooter` — dort `<span className="mr-auto text-[12px] text-muted-ink">{c('requiredLegend')}</span>` wie im Kontaktformular).

```bash
git add apps/kompass
git commit -m "fix(dms): the new fields keep the measures of the foundation"
```

---

## Self-Review

**Spec-Abdeckung.** § 7.1 Detailseite: Task 3 und 4 (Ordner, Bezüge, Dokumentbezüge, Versand, Wiedervorlagen, Notizen, Storno mit Ersatz). § 7.2 Liste: Task 1 (Spaltenköpfe) und 5 (Ziehen, Markierungen, Filter). § 7.3 Suchfeld: Task 2. § 7.4 Dialog: Task 6. § 7.5 Editor: Task 6. § 7.8 Verwaltung: Task 7. § 7.9 Handoff: Task 8. § 7.6 und 7.7 (Kontaktseiten, Startseite): Plan 4.

**Placeholder.** Die Panels in Task 4 und 7 sind als Aufbau mit Feldern, Props und Texten beschrieben und folgen den vorhandenen Dateien (`folders-panel.tsx`, `text-panel.tsx`); die Actions und die Picker-Komponente stehen vollständig da. Keine offenen Textschlüssel: jeder Schlüssel, den eine Komponente ruft, steht im Task mit Wert.

**Typen.** `PickedContact`, `PickedDocument`, `DocumentListItem` (erweitert um `sentAt`, `openFollowUp`), `DocumentRelationView` (Plan 2) und `FollowUpRecord` (Plan 1) sind die Formen, die durch Seiten und Panels laufen; die Actions nehmen `id` zuerst, dann die Nutzlast, wie die vorhandenen.

## Nachtrag zur Ausführung (2026-09-12)

Vierzehn Abweichungen, vier davon mehr als Tippfehler:

**1. `readSort` durfte nicht in einer `'use client'`-Datei liegen.** Eine
Server Component rief sie, Next verbietet das. Sie sitzt jetzt in
`apps/kompass/src/lib/sort.ts`; `sortable-head.tsx` importiert sie von dort.
Bemerkenswert ist, wann es auffiel: Der E2E-Lauf nach Task 1 war grün, weil
`.next` warm war; erst der kalte Lauf in Task 2 zeigte den Verstoß — genau
der Fall, für den `pnpm e2e:cold` in `AGENTS.md` steht.

**2. `CommandInput` erzwang `h-8!` an seiner Hülle.** Die Klasse aus dem Plan
landete am inneren `input` und wirkte nicht. Die geteilte Komponente nimmt
jetzt `wrapperClassName` und `fieldClassName`, das `!` ist weg, und ein
Maßtest hält die 38 px fest.

**3. `getByRole('option')` ist auf diesen Seiten mehrdeutig.** Native
`<select>`-Optionen tragen dieselbe Rolle; die Tests des Plans trafen das
Dokumentart-Feld statt der Suchliste, und klickten teils „Neu anlegen …“, das
schon dasteht, bevor die Suche antwortet. Kontakt- und Dokumenteinträge
tragen jetzt `data-testid="contact-option"` bzw. `"document-option"`; Tests
greifen darüber zu, oder über `getByRole('listbox').getByRole('option', …)`.

**4. Task 4 setzte Task 5 voraus.** Der Versand-Test fuhr `?unsent=1` an und
erwartete die Markierung — beides entsteht erst in Task 5. Der Versand wird
in Task 4 am Dokument geprüft, Filter und Markierung in Task 5.

**Die übrigen zehn:** Testdateien heißen `.test.ts`, vitest nimmt hier kein
`.tsx`; `resolveLinks` liefert die Link-ID mit, sonst lässt sich nichts
lösen; „Bezug hinzufügen“ ist Teilkette von „Dokumentbezug hinzufügen“
(`exact: true`); der Eingangskorb enthält seit Plan 2 mehr als ein Dokument;
`format.dateTime(…, 'short')` gibt es in next-intl nicht, Optionen ausschreiben;
`drizzle-orm` ist keine App-Abhängigkeit, die Nutzerabfrage filtert in JS;
`Disclosure` hat eine andere API als angenommen; das Budget des Volltext-Tests
(60 s) deckte die längere Worker-Schlange des neuen Seeds nicht, jetzt 150 s;
zwei Maßtests statt Augenmaß beim Handoff-Abgleich; `FieldError` verlangt
eine `id`.

**Vorab:** `site_publishes` als Werkzeug ergänzt (Entscheidung aus Plan 2),
Commit `c74bc84`.
