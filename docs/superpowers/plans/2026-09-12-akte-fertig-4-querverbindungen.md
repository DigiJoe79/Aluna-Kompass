# Akte fertig 4 — Querverbindungen: Beziehungsakte, Startseite, Kontaktliste (Implementierungsplan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Akte ist von der anderen Seite erreichbar: Kontakt, Tier und Projekt zeigen ihre Dokumente und führen mit einem Klick in Entwurf oder Ablage; die Startseite zeigt, was fällig ist; die Kontaktliste sortiert nach Spalte. Danach ist Roadmap-Schritt 1 abgeschlossen.

**Architecture:** Ein Kasten `RelatedDocuments` in der App-Schicht (Entscheidung 37), der prüft, ob die Akte eingeschaltet ist, und `listDocuments({ linkedTo })` ruft. Die Zielseiten der Akte lesen Vorbelegungen aus Query-Parametern. Der Startseiten-Kasten ruft `listDueFollowUpsWithTargets` aus dem Kern (Plan 1). Die Kontaktliste bekommt den Spaltenkopf aus Plan 3.

**Tech Stack:** Next.js App Router, React 19, next-intl, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-12-akte-fertig-design.md` (§ 7.6, § 7.7, § 5.8, § 8, § 12)

## Global Constraints

- Wie Plan 3: kein hartcodierter Text, nur Theme-Tokens, Rechte serverseitig, Vorbelegungen mit Herkunftsfähnchen.
- Aus dem Nachtrag zu Plan 3: `readSort` liegt in `@/lib/sort` (nicht in `sortable-head.tsx`); Einträge der Suchfelder werden über `getByTestId('contact-option')` bzw. `getByTestId('document-option')` angesprochen, nie über `getByRole('option')` — die Rolle tragen auch native `<select>`-Optionen; Testdateien heißen `.test.ts`; jeder E2E-Lauf vor dem Commit ist ein kalter (`pnpm e2e:cold`), weil ein warmer `.next` Server/Client-Verstöße verdeckt.
- Kontakte, Tiere und Projekte hängen **nicht** von der Akte ab; die Verbindung lebt in `apps/kompass`.
- Nach jedem Task ein Commit; nicht pushen.

**Voraussetzung:** Plan 1, 2 und 3 vollständig.

---

### Task 1: Der Kasten „Dokumente“ an Kontakt, Tier und Projekt

**Files:**
- Create: `apps/kompass/src/components/related-documents.tsx`
- Modify: `apps/kompass/src/app/(shell)/contacts/[id]/page.tsx`, `animals/[id]/page.tsx`, `projects/[id]/page.tsx`
- Modify: `apps/kompass/src/app/(shell)/dms/new/page.tsx`, `dms/new/draft-form.tsx` (Vorbelegung Empfänger), `dms/dms-view.tsx`, `dms/receive/receive-form.tsx`, `dms/receive/receive-dialog.tsx`, `dms/dms-workspace.tsx` (Vorbelegung Absender/Bezug), `dms/actions.ts` (`receiveDocumentAction` liest `aboutType`/`aboutId`)
- Modify: `apps/kompass/messages/de.json`
- Test: E2E in `apps/kompass/e2e/dms.spec.ts`

**Interfaces:**
- Produces:
  - `<RelatedDocuments entityType="contact" entityId={id} entityLabel={name} />` — Server Component; rendert nichts, wenn die Akte aus ist oder `dms.view` fehlt
  - Query-Parameter: `/dms/new?recipient=<contactId>`, `/dms/receive?sender=<contactId>`, `/dms/receive?about=<entityType>:<entityId>`

- [ ] **Step 1: Failing E2E schreiben**

```ts
  test('die Kontaktseite zeigt die Dokumente des Kontakts und beginnt von dort einen Brief', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await page.getByRole('link', { name: 'Einladung zur ordentlichen Mitgliederversammlung' }).click();
    const contactLink = page.getByTestId('document-links').getByRole('link').first();
    const contactName = await contactLink.textContent();
    await contactLink.click();
    await expect(page).toHaveURL(/\/contacts\//);
    const box = page.getByTestId('related-documents');
    await expect(box.getByRole('link', { name: /BRF-/ })).toBeVisible();
    await box.getByRole('link', { name: 'Brief schreiben' }).click();
    await expect(page).toHaveURL(/\/dms\/new\?recipient=/);
    await expect(page.getByRole('combobox', { name: 'Empfänger' })).toHaveValue(contactName!.trim());
    await expect(page.getByText('von der Kontaktseite')).toBeVisible();
  });

  test('von der Kontaktseite aus Post ablegen belegt den Absender vor', async ({ page }) => {
    await login(page);
    await page.goto('/contacts');
    await page.getByRole('row').nth(1).click();
    await page.getByTestId('related-documents').getByRole('link', { name: 'Post ablegen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Post ablegen' });
    await expect(dialog.getByRole('combobox', { name: 'Absender' })).not.toHaveValue('');
  });

  test('ein Tier zeigt seine Dokumente und legt Post mit Bezug „betrifft“ ab', async ({ page }) => {
    await login(page);
    await page.goto('/animals');
    await page.getByRole('row').nth(1).click();
    await page.getByTestId('related-documents').getByRole('link', { name: 'Post ablegen' }).click();
    const dialog = receiveDialog(page);
    await dialog.getByLabel('Datei').setInputFiles(FIXTURE_PDF);
    await dialog.getByLabel('Betreff').fill('Impfpass');
    await dialog.getByLabel('Datum auf dem Dokument').fill('2026-09-10');
    await dialog.getByRole('button', { name: 'Ablegen' }).click();
    await expect(page.getByTestId('document-links').getByText('Betrifft')).toBeVisible();
    await page.getByTestId('document-links').getByRole('link').first().click();
    await expect(page.getByTestId('related-documents').getByText('Impfpass')).toBeVisible();
  });
```

- [ ] **Step 2: E2E laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/app e2e -- --grep "Kontaktseite|ein Tier zeigt"`
Expected: FAIL

- [ ] **Step 3: Der Kasten**

`apps/kompass/src/components/related-documents.tsx`:

```tsx
import { hasPermission, isModuleEnabled, type CallContext, type Deps } from '@kompass/core';
import { listDocuments } from '@kompass/module-dms';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { StatusBadge } from '@/components/status-badge';
import { buttonVariants } from '@/components/ui/button';

/**
 * Die Beziehungsakte von der anderen Seite (Spec § 7.6). Lebt in der
 * App-Schicht, weil Kontakte, Tiere und Projekte nicht von der Akte abhängen
 * dürfen (Entscheidung 37) — die App kennt alle Module, wie sie heute Bezüge
 * zu Namen auflöst. Ist die Akte aus oder das Recht fehlt, gibt es den
 * Kasten nicht.
 */
export async function RelatedDocuments({
  deps,
  ctx,
  entityType,
  entityId,
}: {
  deps: Deps;
  ctx: CallContext;
  entityType: 'contact' | 'animal' | 'project';
  entityId: string;
}) {
  if (!isModuleEnabled(deps, 'dms') || !hasPermission(ctx, 'dms.view')) return null;
  const t = await getTranslations('dms.related');
  const res = await listDocuments(deps, ctx, { linkedTo: { entityType, entityId }, limit: 50 });
  if (!res.ok) return null;
  const canCreate = hasPermission(ctx, 'dms.create');

  const receiveHref = entityType === 'contact' ? `/dms/receive?sender=${entityId}` : `/dms/receive?about=${entityType}:${entityId}`;

  return (
    <section data-testid="related-documents" className="rounded-md border border-line bg-surface p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-ink">{t('title')}</h2>
        {canCreate ? (
          <div className="flex gap-2">
            {entityType === 'contact' ? (
              <Link href={`/dms/new?recipient=${entityId}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                {t('writeLetter')}
              </Link>
            ) : null}
            <Link href={receiveHref} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              {t('receivePost')}
            </Link>
          </div>
        ) : null}
      </div>
      {res.value.documents.length === 0 ? (
        <p className="text-[13px] text-muted-ink">{t('none')}</p>
      ) : (
        <ul className="divide-y divide-line-2 text-[13px]">
          {res.value.documents.map((doc) => {
            const role = doc.links.find((l) => l.entityType === entityType && l.entityId === entityId)?.role;
            return (
              <li key={doc.id} className="flex items-center gap-3 py-2">
                <Link href={`/dms/${doc.id}`} className="font-mono font-semibold underline underline-offset-2 hover:text-link">
                  {doc.number ?? t('draft')}
                </Link>
                <Link href={`/dms/${doc.id}`} className="min-w-0 flex-1 truncate text-ink hover:underline">
                  {doc.subject}
                </Link>
                <span className="font-mono text-[12px] text-ink-2">{doc.documentDate}</span>
                {role ? <StatusBadge tone="neutral">{t(`roles.${role}`)}</StatusBadge> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
```

`de.json`, `dms.related`: `"title": "Dokumente"`, `"none": "Noch kein Dokument mit Bezug hierher."`, `"writeLetter": "Brief schreiben"`, `"receivePost": "Post ablegen"`, `"draft": "Entwurf"`, `"roles": { "sender": "Absender", "recipient": "Empfänger", "about": "Betrifft" }`.

Einhängen: `contacts/[id]/page.tsx` als fünftes Element im Grid (`<RelatedDocuments deps={deps} ctx={ctx} entityType="contact" entityId={contact.id} />`); `animals/[id]/page.tsx` und `projects/[id]/page.tsx` unter dem Formular (nur, wenn `id !== 'new'`).

- [ ] **Step 4: Vorbelegungen in der Akte**

`dms/new/page.tsx`: `searchParams.recipient` → `getContact`; bei Erfolg `initialRecipient = { id, name: displayName(c) }` und `recipientOrigin = t('suggest.fromContactPage')` an `DraftScreen`/`DraftForm` (`draft-form.tsx` zeigt unter dem `ContactPicker` ein `SuggestionFlag`, solange der Wert unverändert ist).

`dms-view.tsx` (bedient `/dms` und `/dms/receive`): `query.sender` → Kontakt auflösen → `initialSender`; `query.about` → `[type, id]` trennen, `type` gegen `contact|animal|project` prüfen und den Namen auflösen (`getContact`/`getAnimal`/`getProject`, wie in `dms/[id]/links.ts`) → `initialAbout = { entityType, entityId, label }`. Beides an `DmsWorkspace` → `ReceiveDialog` → `ReceiveForm`; der Dialog ist offen, wenn `receive` oder einer der beiden Parameter gesetzt ist. `ReceiveForm` zeigt für den Absender das Fähnchen `suggest.fromContactPage`, und für `about` eine Zeile „Betrifft: {label}“ mit demselben Fähnchen und verstecktem `aboutType`/`aboutId`.

`receiveDocumentAction`: `const aboutType = orNull(formData.get('aboutType')); const aboutId = orNull(formData.get('aboutId'));` → `links` um `{ entityType: aboutType, entityId: aboutId, role: 'about' }` ergänzen, wenn beide gesetzt.

`de.json`, `dms.suggest`: `"fromContactPage": "von der Kontaktseite"`, `"fromEntityPage": "von der Seite des Bezugs"`; `dms.fields.about: "Betrifft"`.

- [ ] **Step 5: E2E laufen lassen**

Run: `pnpm --filter @kompass/app e2e -- --grep "dms|contacts|animals"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/kompass
git commit -m "feat(ui): a contact, an animal and a project show their documents, and lead into the file"
```

---

### Task 2: Startseite — „Fällig“

**Files:**
- Modify: `apps/kompass/src/app/(shell)/page.tsx`
- Create: `apps/kompass/src/app/(shell)/due-panel.tsx`, `apps/kompass/src/app/(shell)/due-actions.ts`
- Modify: `apps/kompass/src/lib/preferences.ts` (`dueOnlyMine: boolean`)
- Modify: `apps/kompass/messages/de.json`
- Test: `apps/kompass/e2e/follow-ups.spec.ts`

**Interfaces:**
- Produces: `completeDueAction(followUpId)` (ruft `completeFollowUp`, `revalidatePath('/')`), `<DuePanel items userId canManage />`.

- [ ] **Step 1: Failing E2E schreiben**

`apps/kompass/e2e/follow-ups.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('follow-ups', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
  });

  test('die Startseite zeigt, was fällig ist, und hakt es ab', async ({ page }) => {
    await loginAsAdmin(page);
    const panel = page.getByTestId('due-panel');
    await expect(panel.getByRole('heading', { name: 'Fällig' })).toBeVisible();
    await expect(panel.getByText('Antwort abwarten')).toBeVisible();
    await panel.getByRole('link', { name: /BRF-/ }).first().click();
    await expect(page).toHaveURL(/\/dms\//);
    await page.goto('/');
    await panel.getByRole('checkbox', { name: 'Antwort abwarten erledigen' }).check();
    await expect(panel.getByText('Antwort abwarten')).toBeHidden();
    await expect(panel.getByText('Nichts fällig.')).toBeVisible();
  });

  test('„nur meine“ blendet aus, was anderen gehört, und merkt sich die Wahl', async ({ page }) => {
    await loginAsAdmin(page);
    const panel = page.getByTestId('due-panel');
    await panel.getByLabel('Nur meine').check();
    await expect(panel.getByText('Antwort abwarten')).toBeHidden(); // Seed: ohne Zuständige = alle, nicht „meine“
    await page.reload();
    await expect(panel.getByLabel('Nur meine')).toBeChecked();
  });
});
```

Der Seed (Plan 2, Task 11) legt „Antwort abwarten“ in fünf Tagen an — innerhalb des Sieben-Tage-Fensters. `dueOnlyMine` filtert auf `assigneeUserId === userId`; eine Wiedervorlage ohne Zuständige gilt allen, erscheint aber unter „nur meine“ nicht — das ist die Bedeutung des Schalters.

- [ ] **Step 2: E2E laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/app e2e -- follow-ups`
Expected: FAIL

- [ ] **Step 3: Action und Panel**

`due-actions.ts`:

```ts
'use server';

import { completeFollowUp } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function completeDueAction(followUpId: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await completeFollowUp(deps, ctx, { id: followUpId });
  revalidatePath('/');
  revalidatePath('/dms');
  return toActionState(result, t, t('home.due.completed'));
}
```

`due-panel.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { usePreference } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { completeDueAction } from './due-actions';

export interface DueItemView {
  id: string;
  dueAt: string;
  title: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  target: { label: string; href: string | null } | null;
}

export function DuePanel({ items, userId, today, canManage }: { items: DueItemView[]; userId: string; today: string; canManage: boolean }) {
  const t = useTranslations('home.due');
  const router = useRouter();
  const [onlyMine, setOnlyMine] = usePreference('dueOnlyMine');
  const [, start] = useTransition();
  const shown = onlyMine ? items.filter((i) => i.assigneeUserId === userId) : items;

  return (
    <section data-testid="due-panel" className="rounded-lg border border-line bg-surface p-[18px]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-heading text-[17px]">{t('title')}</h3>
        <div className="flex items-center gap-2">
          <Switch id="due-only-mine" checked={onlyMine} onCheckedChange={setOnlyMine} />
          <Label htmlFor="due-only-mine" className="cursor-pointer text-[13px] text-ink-2">{t('onlyMine')}</Label>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="text-[13px] text-muted-ink">{t('none')}</p>
      ) : (
        <ul className="divide-y divide-line-2">
          {shown.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-2 text-[13px]">
              {canManage ? (
                <Checkbox
                  aria-label={t('complete', { title: item.title })}
                  onCheckedChange={() => start(async () => {
                    const s = await completeDueAction(item.id);
                    if (s.status === 'error') toast.error(s.message);
                    else router.refresh();
                  })}
                />
              ) : null}
              <span className={cn('font-mono text-[12px]', item.dueAt < today ? 'text-warning' : 'text-ink-2')}>{item.dueAt}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{item.title}</span>
              {item.target ? (
                item.target.href ? (
                  <Link href={item.target.href} className="truncate font-mono text-[12px] underline underline-offset-2 hover:text-link">{item.target.label}</Link>
                ) : (
                  <span className="truncate font-mono text-[12px] text-muted-ink">{item.target.label}</span>
                )
              ) : null}
              {item.assigneeName ? <span className="text-[12px] text-muted-ink">{item.assigneeName}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

`preferences.ts`: `dueOnlyMine: boolean` in `Prefs` und `DEFAULTS` (`false`).

`page.tsx`: wenn `hasPermission(ctx, 'followUps.view')`, `listDueFollowUpsWithTargets(deps, ctx, { until: <heute + 7 Tage> })` laden, Zuständigen-Namen über eine Abfrage auf `schema.users` auflösen, und `<DuePanel>` **über** den Karten rendern, mit `today = deps.clock.now().toISOString().slice(0, 10)`, `canManage = hasPermission(ctx, 'followUps.manage')`.

`de.json`, `home.due`: `"title": "Fällig"`, `"none": "Nichts fällig."`, `"onlyMine": "Nur meine"`, `"complete": "{title} erledigen"`, `"completed": "Wiedervorlage erledigt"`.

Der Startseiten-E2E `home.spec.ts` prüft Überschriften der Karten — er bleibt gültig, der Kasten kommt dazu.

- [ ] **Step 4: E2E laufen lassen**

Run: `pnpm --filter @kompass/app e2e -- follow-ups home`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/kompass
git commit -m "feat(home): the start page says what is due, and lets it be ticked off"
```

---

### Task 3: Kontaktliste sortierbar

**Files:**
- Modify: `apps/kompass/src/app/(shell)/contacts/contact-list.tsx`, `contacts/page.tsx`
- Test: E2E in `apps/kompass/e2e/contacts.spec.ts`

- [ ] **Step 1: Failing E2E schreiben**

```ts
  test('sortiert die Kontakte über den Spaltenkopf', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/contacts');
    await page.getByRole('button', { name: 'Sortieren nach Ort' }).click();
    await expect(page).toHaveURL(/sort=city&dir=desc/);
    await page.getByRole('button', { name: 'Sortieren nach Ort' }).click();
    await expect(page).toHaveURL(/dir=asc/);
    const cities = await page.getByRole('row').locator('td:nth-child(4)').allTextContents();
    expect([...cities].sort((a, b) => a.localeCompare(b, 'de'))).toEqual(cities);
  });
```

- [ ] **Step 2: E2E laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/app e2e -- contacts`
Expected: FAIL

- [ ] **Step 3: Umstellen**

`contact-list.tsx`: die Köpfe `Name`, `Art`, `Ort` werden `<SortableHead field="name" | "kind" | "city" label=… />`; `Rollen` und `Kontakt` bleiben. `applyFilters` behält `sort`/`dir` (wie in der Dokumentliste). `contacts/page.tsx`: `searchParams` um `sort`, `dir` erweitern und `orderBy: readSort(q, ['name', 'kind', 'city', 'createdAt'] as const)` an `listContacts`, mit `readSort` aus `@/lib/sort`.

- [ ] **Step 4: E2E laufen lassen**

Run: `pnpm --filter @kompass/app e2e -- contacts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/kompass
git commit -m "feat(contacts): the list sorts by name, kind and city"
```

---

### Task 4: Abschluss von Schritt 1

**Files:**
- Modify: `docs/backlog.md` (Punkt 6 entfällt)
- Modify: `docs/nordstern.md` (Schritt 1: Datum und Fertig-Satz)
- Modify: `AGENTS.md` (Quellen: Pläne dieses Vorhabens bleiben unerwähnt — die Spec steht schon)

- [ ] **Step 1: Alle Ringe**

Run: `pnpm verify`
Expected: PASS (alle drei Ringe und der Image-Build).

- [ ] **Step 2: Backlog**

In `docs/backlog.md` Punkt 6 „Sortierbare Tabellen für Kontakte und Dokumente“ entfernen; die folgenden Punkte behalten ihre Nummern nicht neu — die Datei nummeriert fortlaufend, also die verbleibenden neu durchzählen (1–5).

- [ ] **Step 3: Nordstern**

In `docs/nordstern.md`, Abschnitt „Schritt 1: Akte fertig“, unter dem Fertig-Kriterium einen Absatz:

> **Abgeschlossen am JJJJ-MM-TT.** Woran erkannt: Die E2E-Liste aus § 8 der Spec `2026-09-12-akte-fertig-design.md` läuft grün — Einsortieren aus dem Eingangskorb, Antwort auf einen Eingang, Versandvermerk, Wiedervorlage bis zur Startseite, Notiz, Baustein, Kontakt aus dem Overlay, Beziehungsakte am Kontakt, Sortierung, Storno mit Ersatz.

Das Datum ist das des Tages, an dem `pnpm verify` grün war. Bleibt vom Handoff (Punkt 1 des Schritts) noch etwas offen, das Joe global nachzieht, steht das als Satz dazu: „Der Handoff-Abgleich außerhalb der Akte läuft weiter, gehört aber nicht mehr zu diesem Schritt.“

- [ ] **Step 4: Commit**

```bash
git add docs/backlog.md docs/nordstern.md
git commit -m "docs: step 1 of the roadmap is done, and backlog 6 with it"
```

---

## Self-Review

**Spec-Abdeckung.** § 7.6 Kontakt/Tier/Projekt samt Vorbelegungen: Task 1. § 7.7 Startseite: Task 2. § 5.8 Sortierung der Kontaktliste in der Oberfläche: Task 3. § 12 „Fertig heißt“: Task 4. Das Fertig-Kriterium des Nordsterns (Schriftwechsel vollständig, Oberfläche nach Handoff) ist mit den E2E-Listen aus Plan 3 und 4 belegt.

**Placeholder.** Das Datum in Task 4 ist bewusst offen — es ist der Tag des grünen Laufs; die Anweisung sagt, welches.

**Typen.** `DueItemView` deckt `FollowUpWithTarget` aus Plan 1 (`target: { label, href }`) plus die aufgelöste `assigneeName`. `RelatedDocuments` nutzt `listDocuments({ linkedTo })` aus Plan 2 und `doc.links` wie die Detailseite.
