# Kontakte 4 — Oberfläche und Fristenbildschirm (Implementierungsplan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kontakte lassen sich im Browser pflegen — mit dem Anschriftsblock als Live-Vorschau und einem Aufbewahrungsblock, der die Halter beim Namen nennt. Dazu ein Fristenbildschirm im Kern, der alle fälligen Löschungen sammelt.

**Architecture:** Liste und Detailseite nach dem Muster des Tiermoduls (`page.tsx`, `[id]/`, `actions.ts`). Der Fristenbildschirm liegt im Kern und wird über `retentionDue` gefüllt; gelöscht wird im Modul, damit der Kern nie fremde Entitäten anfasst.

**Tech Stack:** Next.js (App Router, Server Actions), shadcn/ui, next-intl, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-10-kontakte-design.md` (§ 7 Oberfläche, § 8 Tests)

## Global Constraints

- **Lies vor jeder Änderung an `apps/kompass` die passende Anleitung unter `apps/kompass/node_modules/next/dist/docs/`.** Diese Next-Fassung weicht von verbreiteten Mustern ab; `apps/kompass/AGENTS.md` verlangt das ausdrücklich.
- Kein hartcodierter UI-Text. Alles über `apps/kompass/messages/de.json`, Sie-Form.
- Kein Farbliteral in `apps/kompass/src` — `apps/kompass/tests/no-color-literals.test.ts` scannt darauf. Nur Theme-Tokens.
- Keine vereinsspezifischen Inhalte — `apps/kompass/tests/no-association-content.test.ts` muss grün bleiben. Beispielnamen sind erfunden.
- Rechteprüfung serverseitig; die Oberfläche blendet nur aus, was ohnehin abgelehnt würde.
- TDD: kein Produktionscode ohne zuvor rot gesehenen Test. Auf dieser Ebene ist der rote Test der Playwright-Lauf.
- E2E: `pnpm --filter @kompass/app e2e`; einzelner Test mit `pnpm exec playwright test -g "<Name>"` aus `apps/kompass`.

## File Structure

| Datei | Verantwortung |
|---|---|
| `packages/core/src/permissions/core.ts` | neues Recht `retention.view` |
| `packages/core/src/retention/service.ts` | `listRetentionDue(deps, ctx)` mit Rechteprüfung |
| `packages/mcp/src/core-tools.ts` | `retention_due` |
| `apps/kompass/src/lib/navigation.ts` | Admin-Eintrag „Aufbewahrung" |
| `apps/kompass/src/app/(shell)/admin/retention/page.tsx` | Fristenbildschirm |
| `apps/kompass/src/app/(shell)/contacts/page.tsx` | Liste mit Filtern |
| `apps/kompass/src/app/(shell)/contacts/contact-form.tsx` | Formular mit Anschriftsvorschau |
| `apps/kompass/src/app/(shell)/contacts/actions.ts` | Server Actions |
| `apps/kompass/src/app/(shell)/contacts/[id]/page.tsx` | Detailseite |
| `apps/kompass/src/app/(shell)/contacts/[id]/roles-panel.tsx` | Rollen mit Zeitraum |
| `apps/kompass/src/app/(shell)/contacts/[id]/channels-editor.tsx` | Kommunikationswege |
| `apps/kompass/src/app/(shell)/contacts/[id]/retention-panel.tsx` | Halter und Löschknopf |
| `apps/kompass/messages/de.json` | alle Texte |
| `apps/kompass/e2e/contacts.spec.ts` | E2E |

---

### Task 1: Der Fristenbildschirm im Kern

**Files:**
- Modify: `packages/core/src/permissions/core.ts`, `packages/core/src/retention/service.ts`, `packages/mcp/src/core-tools.ts`
- Modify: `packages/core/tests/retention.test.ts`
- Modify: `apps/kompass/src/lib/navigation.ts`, `apps/kompass/tests/navigation.test.ts`
- Create: `apps/kompass/src/app/(shell)/admin/retention/page.tsx`

**Interfaces:**
- Consumes: `collectRetentionDue(deps)` (Plan 2 Task 3).
- Produces: Recht `retention.view`; `listRetentionDue(deps, ctx): Promise<Result<DueItem[]>>`; MCP-Werkzeug `retention_due`; Navigationseintrag `retention` auf `/admin/retention`.

- [ ] **Step 1: Den Test ergänzen**

An `packages/core/tests/retention.test.ts` anhängen:

```typescript
import { listRetentionDue } from '../src/retention/service';

describe('listRetentionDue', () => {
  it('collects across enabled modules and requires retention.view', async () => {
    const deps = createTestDeps({ manifests: [coreModule, holder('alpha', '2028-12-31')] });
    deps.db.transaction((tx) => {
      writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['alpha'], 'test.enable');
    });
    expect(unwrap(await listRetentionDue(deps, ctxWith(['retention.view']))).map((d) => d.id)).toEqual(['X1']);
    const denied = await listRetentionDue(deps, ctxWith([]));
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
  });
});
```

- [ ] **Step 2: Den Test laufen lassen und das Scheitern sehen**

Run: `pnpm --filter @kompass/core test -- retention`
Expected: FAIL — `listRetentionDue is not a function`.

- [ ] **Step 3: Recht und Service ergänzen**

In `packages/core/src/permissions/core.ts` in die Liste aufnehmen, hinter `'audit.view'`:

```typescript
  // Der Fristenbildschirm sammelt über alle Module; er braucht ein eigenes
  // Recht, weil er zeigt, welche personenbezogenen Daten zur Löschung anstehen.
  'retention.view',
```

An `packages/core/src/retention/service.ts` anhängen:

```typescript
import type { CallContext } from '../context';
import { requirePermission } from '../permissions/check';
import { ok, type Result } from '../result';

/** Alles, was zur Löschung ansteht — über alle aktiven Module hinweg. */
export async function listRetentionDue(deps: Deps, ctx: CallContext): Promise<Result<DueItem[]>> {
  const denied = requirePermission(ctx, 'retention.view');
  if (denied) return denied;
  return ok(collectRetentionDue(deps));
}
```

- [ ] **Step 4: Das MCP-Werkzeug ergänzen**

In `packages/mcp/src/core-tools.ts` in die Liste aufnehmen, nach dem Muster der vorhandenen Einträge:

```typescript
  t({ name: 'retention_due', description: 'List everything whose retention period has run out and that is due for deletion, across all enabled modules. Requires retention.view.', inputSchema: z.object({}), handler: (deps, ctx) => listRetentionDue(deps, ctx) }),
```

mit `listRetentionDue` im Import aus `@kompass/core`.

- [ ] **Step 5: Die Navigation ergänzen**

In `apps/kompass/src/lib/navigation.ts` in die Admin-Liste aufnehmen, zwischen `audit` und `documents`:

```typescript
  { key: 'retention', href: '/admin/retention', icon: 'hourglass', permission: 'retention.view' },
```

**Der Test `apps/kompass/tests/navigation.test.ts` wird dadurch rot** — er zählt die Admin-Einträge namentlich auf. Ergänze `'retention'` an derselben Stelle in der erwarteten Liste:

```typescript
    expect(admin.items.map((i) => i.key)).toEqual(['users', 'roles', 'settings', 'locales', 'themes', 'modules', 'audit', 'retention', 'documents', 'media', 'backup']);
```

- [ ] **Step 6: Den Bildschirm bauen**

`apps/kompass/src/app/(shell)/admin/retention/page.tsx`:

```tsx
import { listRetentionDue, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';

/** Wohin ein fälliger Eintrag führt. Der Kern löscht nie selbst — er verweist. */
const HREF_BY_ENTITY: Record<string, (id: string) => string> = {
  contact: (id) => `/contacts/${id}`,
};

export default async function RetentionPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'retention.view')) return <ForbiddenCard permission="retention.view" />;
  const t = await getTranslations('retention');
  const result = await listRetentionDue(deps, ctx);
  if (!result.ok) return <ForbiddenCard permission="retention.view" />;

  const byEntity = new Map<string, typeof result.value>();
  for (const item of result.value) byEntity.set(item.entity, [...(byEntity.get(item.entity) ?? []), item]);

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {result.value.length === 0 ? (
        <EmptyState title={t('empty.title')} text={t('empty.text')} />
      ) : (
        [...byEntity.entries()].map(([entity, items]) => (
          <section key={entity} className="mb-6">
            <h2 className="mb-2 text-[13px] font-semibold text-muted-ink">{t.has(`entities.${entity}`) ? t(`entities.${entity}`) : entity}</h2>
            <ul className="divide-y divide-line rounded-md border border-line">
              {items.map((item) => {
                const href = HREF_BY_ENTITY[item.entity]?.(item.id);
                return (
                  <li key={`${item.entity}:${item.id}`} className="flex items-center justify-between gap-4 px-3 py-2">
                    <span>{href ? <Link href={href} className="underline underline-offset-2">{item.label}</Link> : item.label}</span>
                    <span className="text-[12px] text-muted-ink">{t('dueSince', { date: item.dueSince })}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      <p className="mt-3 text-[12px] text-muted-ink">{t('footnote')}</p>
    </>
  );
}
```

- [ ] **Step 7: Texte ergänzen**

In `apps/kompass/messages/de.json` einen Abschnitt `retention` anlegen. Sieh dir vorher an, wie `documents` dort aufgebaut ist, und folge dem Muster. Inhalte:

- `title`: „Aufbewahrung und Löschfristen"
- `description`: „Was zur Löschung ansteht, weil die gesetzliche Aufbewahrung abgelaufen ist."
- `empty.title`: „Nichts fällig"
- `empty.text`: „Zurzeit steht keine Löschung an."
- `dueSince`: „fällig seit {date}"
- `entities.contact`: „Kontakte"
- `footnote`: „Gelöscht wird auf der Seite des jeweiligen Eintrags — dort steht, was dabei verschwindet."
- unter `nav`: `retention`: „Aufbewahrung"

- [ ] **Step 8: Alles laufen lassen**

Run: `pnpm typecheck && pnpm test`
Expected: PASS, einschließlich `navigation.test.ts` und `mcp-tools.test.ts`.

- [ ] **Step 9: Commit**

```bash
git add packages/core packages/mcp apps/kompass/src/lib/navigation.ts apps/kompass/src/app/\(shell\)/admin/retention apps/kompass/messages/de.json apps/kompass/tests/navigation.test.ts
git commit -m "feat(retention): one screen for everything due for deletion, fed by the modules"
```

---

### Task 2: Kontaktliste und Anlegen

**Files:**
- Create: `apps/kompass/src/app/(shell)/contacts/page.tsx`, `contact-form.tsx`, `actions.ts`, `contact-list.tsx`
- Create: `apps/kompass/e2e/contacts.spec.ts`
- Modify: `apps/kompass/messages/de.json`

**Interfaces:**
- Consumes: `listContacts`, `createContact`, `formatPostalAddress`, `displayName` aus `@kompass/module-contacts`.
- Produces: Seite `/contacts`; Server Action `createContactAction(prev, formData): Promise<ActionState>`.

- [ ] **Step 1: Den E2E-Test schreiben**

`apps/kompass/e2e/contacts.spec.ts`:

```typescript
import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test.describe('contacts', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('creates a person and finds it again by name', async ({ page }) => {
    await page.goto('/contacts');
    await page.getByRole('button', { name: 'Kontakt anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Art').selectOption('person');
    await dialog.getByLabel('Anrede').fill('Frau');
    await dialog.getByLabel('Vorname').fill('Anna');
    await dialog.getByLabel('Nachname').fill('Berger');
    await dialog.getByLabel('Straße').fill('Musterweg 1');
    await dialog.getByLabel('PLZ').fill('12345');
    await dialog.getByLabel('Ort').fill('Musterstadt');
    await dialog.getByRole('button', { name: 'Anlegen' }).click();

    await expect(page.getByRole('row', { name: /Anna Berger/ })).toBeVisible();
    await page.getByLabel('Suche').fill('berger');
    await expect(page.getByRole('row', { name: /Anna Berger/ })).toBeVisible();
  });
});
```

Sieh dir `apps/kompass/e2e/animals.spec.ts` an, wie `signIn` dort benutzt wird, und übernimm genau diese Form — der Helfer liegt in `apps/kompass/e2e/helpers.ts`.

- [ ] **Step 2: Den Test laufen lassen und das Scheitern sehen**

Aus `apps/kompass`: `pnpm exec playwright test contacts.spec.ts`
Expected: FAIL — `/contacts` liefert 404, der Knopf fehlt.

- [ ] **Step 3: Die Server Action schreiben**

`apps/kompass/src/app/(shell)/contacts/actions.ts`:

```typescript
'use server';

import { createContact } from '@kompass/module-contacts';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/** Leere Formularfelder sollen `null` werden, nicht der leere String. */
const orNull = (value: FormDataEntryValue | null): string | null => {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
};

export async function createContactAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const kind = String(formData.get('kind') ?? 'person');
  const shared = {
    addressExtra: orNull(formData.get('addressExtra')),
    street: orNull(formData.get('street')),
    postalCode: orNull(formData.get('postalCode')),
    city: orNull(formData.get('city')),
    country: orNull(formData.get('country')),
    notes: orNull(formData.get('notes')),
  };
  const input =
    kind === 'organization'
      ? { kind: 'organization', name: String(formData.get('name') ?? ''), legalForm: orNull(formData.get('legalForm')), ...shared }
      : {
          kind: 'person',
          salutation: orNull(formData.get('salutation')),
          firstName: orNull(formData.get('firstName')),
          lastName: String(formData.get('lastName') ?? ''),
          ...shared,
        };
  const result = await createContact(deps, ctx, input);
  revalidatePath('/contacts');
  return toActionState(result, t, t('contacts.toast.created'));
}
```

- [ ] **Step 4: Liste und Formular bauen**

`apps/kompass/src/app/(shell)/contacts/page.tsx`:

```tsx
import { hasPermission, requirePermission } from '@kompass/core';
import { displayName, listContacts } from '@kompass/module-contacts';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { ContactList } from './contact-list';
import { CreateContactDialog } from './contact-form';

export default async function ContactsPage(props: { searchParams: Promise<{ kind?: string; role?: string; text?: string; archived?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'contacts.view')) return <ForbiddenCard permission="contacts.view" />;
  const t = await getTranslations('contacts');
  const q = await props.searchParams;
  const result = await listContacts(deps, ctx, {
    kind: q.kind === 'person' || q.kind === 'organization' ? q.kind : undefined,
    role: q.role || undefined,
    text: q.text || undefined,
    includeArchived: q.archived === '1',
    limit: 200,
  });
  if (!result.ok) return <ForbiddenCard permission="contacts.view" />;

  const rows = result.value.contacts.map((c) => ({
    id: c.id,
    kind: c.kind,
    name: displayName(c),
    affiliation: c.belongsTo ? displayName(c.belongsTo) : null,
    roles: c.roles.filter((r) => r.until === null).map((r) => r.role),
    city: c.city ?? '',
    primaryChannel: c.channels.find((ch) => ch.isPrimary)?.value ?? '',
    status: c.status,
  }));

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={hasPermission(ctx, 'contacts.manage') ? <CreateContactDialog /> : null}
      />
      {rows.length === 0 ? <EmptyState title={t('empty.title')} text={t('empty.text')} /> : <ContactList contacts={rows} />}
    </>
  );
}
```

`contact-list.tsx` ist eine Client-Komponente mit dem Suchfeld (`aria-label` aus `t('search')`, schreibt in den Query-Parameter `text`), den Filtern für Art und Archivierte und einer Tabelle mit `role="row"` je Kontakt. Bau sie nach dem Vorbild der Tabelle in `apps/kompass/src/app/(shell)/admin/documents/document-list.tsx`: dieselbe Tabellenkomponente, dieselben Abstände, dieselbe Verlinkung der Zeile auf die Detailseite.

`contact-form.tsx` enthält `CreateContactDialog`: ein Dialog mit einem Auswahlfeld „Art" (`person` / `organization`), den je nach Art sichtbaren Feldern und rechts daneben der **Live-Vorschau des Anschriftsblocks**. Die Vorschau ruft `formatPostalAddress` aus `@kompass/module-contacts` mit den aktuellen Feldwerten auf und zeigt das Ergebnis in einer `<pre>`-Auszeichnung mit `whitespace-pre-line`. Für „Anrede" ein Freitextfeld mit `<datalist>` als Vorschlagsliste (Frau, Herr, Familie, Dr.) — kein Auswahlfeld, weil sonst „Familie Meier" nicht schreibbar ist.

- [ ] **Step 5: Texte ergänzen**

Abschnitt `contacts` in `apps/kompass/messages/de.json` mit mindestens: `title` („Kontakte"), `description`, `empty.title`, `empty.text`, `search` („Suche"), `create.trigger` („Kontakt anlegen"), `create.submit` („Anlegen"), `toast.created` („Kontakt angelegt"), `fields.kind` („Art"), `fields.person` („Person"), `fields.organization` („Organisation"), `fields.salutation` („Anrede"), `fields.firstName` („Vorname"), `fields.lastName` („Nachname"), `fields.name` („Name"), `fields.legalForm` („Rechtsform"), `fields.street` („Straße"), `fields.postalCode` („PLZ"), `fields.city` („Ort"), `fields.country` („Land"), `fields.addressExtra` („Adresszusatz"), `fields.notes` („Notizen"), `preview` („So fällt die Anschrift").

- [ ] **Step 6: Den E2E-Test laufen lassen**

Aus `apps/kompass`: `pnpm exec playwright test contacts.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/kompass/src/app/\(shell\)/contacts apps/kompass/e2e/contacts.spec.ts apps/kompass/messages/de.json
git commit -m "feat(contacts): list and create with a live postal address preview"
```

---

### Task 3: Detailseite mit Rollen, Wegen und Aufbewahrung

**Files:**
- Create: `apps/kompass/src/app/(shell)/contacts/[id]/page.tsx`, `roles-panel.tsx`, `channels-editor.tsx`, `retention-panel.tsx`
- Modify: `apps/kompass/src/app/(shell)/contacts/actions.ts`
- Modify: `apps/kompass/e2e/contacts.spec.ts`, `apps/kompass/messages/de.json`

**Interfaces:**
- Consumes: `getContact`, `contactRetention`, `addContactRole`, `endContactRole`, `setContactChannels`, `deleteContact`, `updateContact`, `contactRoleDefinitions`.
- Produces: Seite `/contacts/[id]`; Actions `updateContactAction`, `addContactRoleAction`, `endContactRoleAction`, `setContactChannelsAction`, `deleteContactAction`.

- [ ] **Step 1: Den E2E-Test ergänzen**

An `apps/kompass/e2e/contacts.spec.ts` anhängen:

```typescript
  test('gives a role, shows the address block and blocks deletion while a hold runs', async ({ page }) => {
    await page.goto('/contacts');
    await page.getByRole('button', { name: 'Kontakt anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Art').selectOption('person');
    await dialog.getByLabel('Nachname').fill('Klein');
    await dialog.getByLabel('Straße').fill('Musterweg 2');
    await dialog.getByLabel('PLZ').fill('12345');
    await dialog.getByLabel('Ort').fill('Musterstadt');
    await dialog.getByRole('button', { name: 'Anlegen' }).click();
    await page.getByRole('row', { name: /Klein/ }).click();

    // Der Anschriftsblock steht mehrzeilig da, so wie er ins Fensterkuvert fällt.
    await expect(page.getByTestId('postal-address')).toContainText('Musterweg 2');
    await expect(page.getByTestId('postal-address')).toContainText('12345 Musterstadt');

    await page.getByRole('button', { name: 'Rolle hinzufügen' }).click();
    await page.getByRole('dialog').getByLabel('Rolle').selectOption('interested');
    await page.getByRole('dialog').getByLabel('Seit').fill('2026-03-15');
    await page.getByRole('dialog').getByRole('button', { name: 'Übernehmen' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'interested' })).toBeVisible();

    // Solange die Rolle läuft, hält sie den Kontakt — der Löschknopf ist aus und sagt warum.
    await expect(page.getByRole('button', { name: 'Kontakt löschen' })).toBeDisabled();
    await expect(page.getByTestId('retention-holds')).toContainText('interested');
    await expect(page.getByTestId('retention-holds')).toContainText('2028-12-31');
  });
```

- [ ] **Step 2: Den Test laufen lassen und das Scheitern sehen**

Aus `apps/kompass`: `pnpm exec playwright test -g "gives a role"`
Expected: FAIL — die Detailseite gibt es noch nicht.

- [ ] **Step 3: Die Actions ergänzen**

An `apps/kompass/src/app/(shell)/contacts/actions.ts` anhängen — alle nach demselben Muster wie `createContactAction`, mit `revalidatePath(`/contacts/${id}`)`:

```typescript
import { addContactRole, deleteContact, endContactRole, setContactChannels, updateContact } from '@kompass/module-contacts';
import { redirect } from 'next/navigation';

export async function updateContactAction(id: string, changes: Record<string, string | null>): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await updateContact(deps, ctx, { id, ...changes });
  revalidatePath(`/contacts/${id}`);
  return toActionState(result, t, t('contacts.toast.updated'));
}

export async function addContactRoleAction(id: string, role: string, since: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await addContactRole(deps, ctx, { id, role, since });
  revalidatePath(`/contacts/${id}`);
  return toActionState(result, t, t('contacts.toast.roleAdded'));
}

export async function endContactRoleAction(id: string, roleId: string, until: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await endContactRole(deps, ctx, { roleId, until });
  revalidatePath(`/contacts/${id}`);
  return toActionState(result, t, t('contacts.toast.roleEnded'));
}

export async function setContactChannelsAction(id: string, channels: { kind: string; value: string; label: string | null; isPrimary: boolean }[]): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setContactChannels(deps, ctx, { id, channels });
  revalidatePath(`/contacts/${id}`);
  return toActionState(result, t, t('contacts.toast.channelsSaved'));
}

export async function deleteContactAction(id: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await deleteContact(deps, ctx, { id });
  if (!result.ok) return toActionState(result, t);
  revalidatePath('/contacts');
  redirect('/contacts');
}
```

- [ ] **Step 4: Die Detailseite bauen**

`apps/kompass/src/app/(shell)/contacts/[id]/page.tsx` lädt `getContact` und `contactRetention`, prüft `contacts.view` und rendert vier Blöcke. Der Anschriftsblock:

```tsx
<section>
  <h2 className="mb-2 text-[13px] font-semibold text-muted-ink">{t('preview')}</h2>
  <pre data-testid="postal-address" className="whitespace-pre-line rounded-md border border-line bg-code-bg px-3 py-2 font-body text-[14px]">
    {formatPostalAddress(contact, contact.belongsTo, organizationCountry)}
  </pre>
</section>
```

`organizationCountry` kommt aus `readSetting<string>(deps, 'organization.country')` — dadurch wird ein abweichendes Land genannt und das eigene nicht.

Der Aufbewahrungsblock (`retention-panel.tsx`) bekommt `holds`, `until` und `due` aus `contactRetention` und rendert:

```tsx
<ul data-testid="retention-holds" className="space-y-1 text-[13px]">
  {holds.map((h) => (
    <li key={`${h.entity}:${h.id}`}>
      {h.label} — {h.until ? t('heldUntil', { date: h.until }) : t('heldPermanently')}
    </li>
  ))}
</ul>
```

und darunter den Löschknopf: `disabled={!due}`, mit `title` bzw. einem Hinweistext, der `t('deleteBlocked')` zeigt, solange gehalten wird. Ist gar kein Halter da (`holds.length === 0`), steht dort `t('retentionUnknown')` — derselbe Wortlaut wie im `conflict` des Services, damit Oberfläche und Fehlermeldung dasselbe sagen.

`roles-panel.tsx` listet die Rollen als `<li>` mit Rolle, `since`, `until` und einem „Beenden"-Knopf für laufende Rollen; das Hinzufügen-Auswahlfeld wird aus `contactRoleDefinitions(deps)` gefüllt, das die Seite als einfache Liste `{ key, retention }` weiterreicht.

`channels-editor.tsx` bearbeitet die Menge der Kommunikationswege und schickt sie in einem Rutsch an `setContactChannelsAction` — das Ersetzen der ganzen Menge ist die Vertragsform des Services.

- [ ] **Step 5: Texte ergänzen**

Im Abschnitt `contacts` ergänzen: `toast.updated`, `toast.roleAdded`, `toast.roleEnded`, `toast.channelsSaved`, `roles.title` („Rollen"), `roles.add` („Rolle hinzufügen"), `roles.submit` („Übernehmen"), `roles.field` („Rolle"), `roles.since` („Seit"), `roles.until` („Bis"), `roles.end` („Beenden"), `channels.title` („Kommunikationswege"), `retention.title` („Aufbewahrung"), `retention.heldUntil` („gehalten bis {date}"), `retention.heldPermanently` („dauerhaft gehalten"), `retention.delete` („Kontakt löschen"), `retention.deleteBlocked` („Solange etwas diesen Kontakt hält, kann er nicht gelöscht werden."), `retention.unknown` („Für diesen Kontakt ist keine Frist nachgewiesen. Vergeben Sie eine Rolle oder archivieren Sie ihn.").

Ergänze außerdem unter `errors.conflicts` die Codes `retentionHoldActive`, `retentionUnknown`, `belongsToNotAnOrganization`, `multiplePrimaryChannels` und `roleAlreadyRunning` — sieh dir an, wie `documentBaseUnavailable` dort geführt wird, und folge dem Muster. Ohne diese Einträge zeigt `toActionState` den rohen Code.

- [ ] **Step 6: Die ganze Prüfung fahren**

Run: `pnpm verify`
Expected: PASS. Falls `docker: command not found`, ist das Binary nicht im PATH — auf diesem Rechner liegt es unter `/Applications/Docker.app/Contents/Resources/bin`. Dann `export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"` und erneut.

- [ ] **Step 7: Commit**

```bash
git add apps/kompass
git commit -m "feat(contacts): detail page with roles, channels and named retention holds"
```

---

### Task 4: Entwicklungsdaten

**Files:**
- Modify: `packages/core/src/seed/seed.ts` oder die dort eingebundene Beispieldatenquelle

**Interfaces:**
- Consumes: `createContact`, `addContactRole`, `setContactChannels`.

- [ ] **Step 1: Den Test schreiben**

Ergänze in der bestehenden Seed-Testdatei (suche mit `grep -rl seedDevelopment packages/core/tests`) einen Test:

```typescript
  it('seeds a few example contacts with roles', async () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule], env: 'development' });
    await seedDevelopment(deps);
    const rows = deps.db.select().from(contacts).all();
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.some((c) => c.kind === 'organization')).toBe(true);
    expect(deps.db.select().from(contactRoles).all().length).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Den Test laufen lassen und das Scheitern sehen**

Run: `pnpm --filter @kompass/core test -- seed`
Expected: FAIL — noch keine Kontakte im Seed.

- [ ] **Step 3: Die Beispieldaten ergänzen**

In `packages/core/src/seed/seed.ts` nach den Beispielnutzern einen Block ergänzen, der drei Kontakte anlegt — **frei erfunden**, weil das Repo öffentlich ist:

```typescript
// Beispielkontakte: erfunden. Das Repo ist öffentlich; personenbezogene Daten
// haben darin nichts verloren, auch keine harmlos wirkenden.
const EXAMPLE_CONTACTS = [
  { kind: 'person' as const, salutation: 'Frau', firstName: 'Mira', lastName: 'Sandberg', street: 'Ahornweg 4', postalCode: '12345', city: 'Musterstadt', role: 'interested' },
  { kind: 'person' as const, salutation: 'Herr', firstName: 'Tomas', lastName: 'Leitner', street: 'Birkengasse 11', postalCode: '12345', city: 'Musterstadt', role: 'partner' },
  { kind: 'organization' as const, name: 'Amtsgericht Musterstadt', street: 'Gerichtsplatz 1', postalCode: '12345', city: 'Musterstadt', role: 'authority' },
];
```

und sie über `createContact` plus `addContactRole` einspielen, mit `since: '2026-01-01'`. Der Block läuft nur, wenn das Kontaktmodul in der Registry ist — prüfe mit `deps.registry.module('contacts')`, sonst überspringen; sonst bricht der Seed in Installationen ohne das Modul.

Beachte: `seed.ts` liegt im Kern und darf **nicht** aus `@kompass/module-contacts` importieren, sonst hinge der Kern an einem Modul. Der Block gehört deshalb in eine Datei der App oder des Moduls, die der Seed über einen Haken aufruft — sieh nach, wie `seedDevelopment` heute an die Tiere kommt (`pnpm import:prototype` bzw. `dev:reset`), und folge derselben Trennung. Wenn es dafür keinen Haken gibt, lege die Beispielkontakte stattdessen in `packages/modules/contacts/src/seed.ts` an und rufe sie aus dem Reset-Skript der App auf.

- [ ] **Step 4: Test laufen lassen**

Run: `pnpm --filter @kompass/core test -- seed`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core packages/modules/contacts
git commit -m "feat(contacts): invented example contacts for development"
```

---

### Task 5: Spec-Quellen und Regeln nachziehen

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-09-05-fundament-design.md`

**Interfaces:**
- Consumes: nichts. Reine Dokumentation, aber Teil der Umsetzung — `AGENTS.md` ist die kanonische Quelle, und eine Regel, die nur im Code steht, findet niemand.

- [ ] **Step 1: Die Quellenliste ergänzen**

In `AGENTS.md` unter „Quellen" die neue Spec in die Aufzählung aufnehmen, im Stil der vorhandenen Einträge:

```
Kontakte: `2026-09-10-kontakte-design.md`
```

- [ ] **Step 2: Prinzip 3 um die Fristen ergänzen**

In `AGENTS.md`, im Abschnitt „Neun Prinzipien", Prinzip 3 um zwei Sätze erweitern — nach dem Satz, der auf `DELETION_POLICY` verweist:

> Personenbezogene Daten sind die Ausnahme von „nichts wird gelöscht": Nach Ablauf der gesetzlichen Aufbewahrung werden sie zur Löschung **fällig** (DSGVO Art. 17). Fällig heißt nicht gelöscht — ein Mensch bestätigt jede Löschung unter Verwaltung → Aufbewahrung; die Frist selbst wird berechnet, nie gespeichert, und steht als `retentionClass` an der Regel in `DELETION_POLICY`.

- [ ] **Step 3: Den Stufenplan korrigieren**

In `docs/superpowers/specs/2026-09-05-fundament-design.md` im Stufenplan bei Stufe 3 „Kontakte" streichen und stattdessen einen Nachtrag unter dem Stufenplan setzen:

> **Nachtrag 2026-09-10.** Kontakte sind aus Stufe 3 vorgezogen und ein eigenes Modul (`2026-09-10-kontakte-design.md`). Grund: Korrespondenz, Finanzen und Mitglieder hängen alle daran, und ohne sie hat ein Brief keinen Empfänger. Der Abschnitt „Nicht-Ziele" der Stufe 1 nennt Kontakte weiterhin zu Recht — dort ging es um den Umfang jener Stufe.

- [ ] **Step 4: Prüfen, dass nichts anderes bricht**

Run: `pnpm test`
Expected: PASS. `apps/kompass/tests/no-association-content.test.ts` bleibt grün — in den ergänzten Texten steht kein Vereinsname.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md docs/superpowers/specs/2026-09-05-fundament-design.md
git commit -m "docs: contacts spec in the source list, retention added to principle 3"
```

---

## Self-Review

**Spec-Abdeckung.** § 9 Dokumentation (`AGENTS.md`, Nachtrag in der Fundament-Spec): Task 5. § 7 Liste mit Filtern und Suche: Task 2. Detailseite mit vier Blöcken, Live-Anschrift, Halter beim Namen: Task 3. Fristenbildschirm im Kern mit `retentionDue` und Zähler: Task 1. § 8 Seed: Task 4. Der Navigationszähler ist in Task 1 Schritt 5 nur als Eintrag angelegt — die Zahl daneben ist eine Ergänzung, die `buildNavigation` heute nicht trägt; sie ist bewusst nicht Teil dieses Plans, damit die Navigation nicht für einen Zähler umgebaut wird.

**Platzhalter.** Task 2 Schritt 4 und Task 3 Schritt 4 beschreiben Listen- und Panel-Komponenten in Prosa statt in vollständigem JSX, weil sie vorhandene Hauskomponenten spiegeln, die gelesen werden müssen (`document-list.tsx`, `photos-editor.tsx`). Beide nennen die Vorlage namentlich, die Testkennzeichen (`data-testid`) und die Beschriftungen, an denen der E2E-Test greift — daran ist die Umsetzung eindeutig geprüft. Task 4 Schritt 3 hat bewusst eine Verzweigung: Die Trennung Kern/Modul lässt sich erst am Code entscheiden.

**Typkonsistenz.** `formatPostalAddress(contact, belongsTo, homeCountry)` wird in Task 2 und Task 3 mit derselben Signatur aus Plan 1 Task 2 aufgerufen. `contactRetention` liefert `{ holds, until, due }` wie in Plan 3 Task 3 definiert; das Panel liest genau diese drei. `DueItem.dueSince` heißt im Fristenbildschirm genauso.

**Ein bewusster Bruch mit der Bequemlichkeit.** Der Löschknopf ist aus, solange gehalten wird — und der Grund steht daneben, nicht in einem Tooltip. Wer nicht löschen darf, soll ohne Mausbewegung lesen können, warum.
