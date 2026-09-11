# Volltext 4 — Oberfläche, Zustand und E2E (Implementierungsplan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die vorhandene Liste wird die Suche: Treffer aus dem Volltext zeigen die Passage und die Seite, und jedes Dokument sagt, ob sein Text gelesen wurde.

**Architecture:** Kein neuer Bildschirm (Entscheidung 28). Das Filterfeld der Akte bleibt, wo es ist; Treffer aus dem Volltext wachsen um eine zweite Zeile. Die Hervorhebung wird aus Steuerzeichen **gebaut**, nie als Markup eingesetzt — der Text stammt aus einem PDF, das jemand von außen geschickt hat.

**Tech Stack:** Next 16 (App Router, Server Components), next-intl, Playwright, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-volltext-und-texterkennung-design.md` (§ 10 Oberfläche, § 12 Tests, § 13 Seed)

## Global Constraints

- Code Englisch, **jeder** Oberflächentext über `apps/kompass/messages/de.json`, Sie-Form (Prinzip 7).
- Kein `dangerouslySetInnerHTML` für Inhalte, die aus einer Datei stammen — ohne Ausnahme.
- Deutsche Anführungszeichen schließen mit `“`, nicht mit `"`; `apps/kompass/tests/german-quotes.test.ts` erzwingt das für alles, was ausgeliefert wird.
- Rechteprüfung serverseitig; die Oberfläche versteckt nur, was der Server ohnehin verweigert.
- Einen E2E-Test nie entkernen, um ihn grün zu bekommen.
- TDD: kein Produktionscode ohne zuvor rot gesehenen Test.

**Voraussetzung:** Plan 3 ist abgeschlossen: `listDocuments` liefert `hits` und `fulltextTooShort`, `reindexAllDocuments` steht.

---

### Task 1: Die Passage sicher darstellen

Der kleinste Baustein und der einzige mit Sicherheitsgewicht. Deshalb zuerst, und allein.

**Files:**
- Create: `apps/kompass/src/components/snippet-text.tsx`
- Test: `apps/kompass/tests/snippet-text.test.tsx`

**Interfaces:**
- Consumes: `SNIPPET_MARK_START`, `SNIPPET_MARK_END` (Plan 3, `@kompass/module-dms`)
- Produces:
  - `splitSnippet(raw: string): { text: string; marked: boolean }[]`
  - `<SnippetText value={string} />`

- [ ] **Step 1: Failing Test schreiben**

`apps/kompass/tests/snippet-text.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SnippetText, splitSnippet } from '@/components/snippet-text';

const START = '';
const END = '';

describe('splitSnippet', () => {
  it('trennt markierte von unmarkierten Stücken', () => {
    expect(splitSnippet(`vom 14. ${START}Oktober${END} 2026`)).toEqual([
      { text: 'vom 14. ', marked: false },
      { text: 'Oktober', marked: true },
      { text: ' 2026', marked: false },
    ]);
  });

  it('kommt mit mehreren Markierungen zurecht', () => {
    const parts = splitSnippet(`${START}Praxis${END} Dr. ${START}Sommer${END}`);

    expect(parts.filter((p) => p.marked).map((p) => p.text)).toEqual(['Praxis', 'Sommer']);
  });

  it('lässt Text ohne Markierung unangetastet', () => {
    expect(splitSnippet('nichts markiert')).toEqual([{ text: 'nichts markiert', marked: false }]);
  });
});

describe('SnippetText', () => {
  it('hebt das gefundene Wort hervor', () => {
    render(<SnippetText value={`vom ${START}Oktober${END} 2026`} />);

    expect(screen.getByText('Oktober').tagName).toBe('MARK');
  });

  it('zeigt Markup aus dem Dokument als Text, nicht als Markup', () => {
    // Der Inhalt kommt aus einem PDF, das jemand geschickt hat. Er darf nichts
    // ausloesen — nur dastehen.
    render(<SnippetText value={`<script>alert(1)</script> ${START}Rechnung${END}`} />);

    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeTruthy();
    expect(document.querySelector('script')).toBeNull();
  });
});
```

**Hinweis:** Ob `@testing-library/react` im Projekt eingerichtet ist, in `apps/kompass/package.json` und `vitest.config.ts` prüfen. Fehlt es, den reinen Funktionstest für `splitSnippet` behalten und die beiden Darstellungstests durch den E2E-Test in Task 5 ersetzen — **nicht** ungetestet lassen.

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/app test -- snippet-text`
Expected: FAIL — `@/components/snippet-text` gibt es nicht.

- [ ] **Step 3: Den Helfer schreiben**

`apps/kompass/src/components/snippet-text.tsx`:

```tsx
import { SNIPPET_MARK_END, SNIPPET_MARK_START } from '@kompass/module-dms';

export interface SnippetPart {
  text: string;
  marked: boolean;
}

/**
 * Zerlegt die Passage aus `snippet()` in markierte und unmarkierte Stücke.
 *
 * Die Markierung kommt als Steuerzeichen und nicht als `<mark>`, damit hier
 * zerlegt statt entschärft werden muss: Der Inhalt stammt aus einem PDF, das
 * jemand von außen geschickt hat. React setzt Zeichenketten als Text; damit ist
 * die Frage „was, wenn im Dokument Markup steht?“ gar nicht erst eine.
 */
export function splitSnippet(raw: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let rest = raw;

  while (rest.length > 0) {
    const start = rest.indexOf(SNIPPET_MARK_START);
    if (start === -1) {
      parts.push({ text: rest, marked: false });
      break;
    }
    if (start > 0) parts.push({ text: rest.slice(0, start), marked: false });

    const end = rest.indexOf(SNIPPET_MARK_END, start);
    if (end === -1) {
      parts.push({ text: rest.slice(start + 1), marked: false });
      break;
    }
    parts.push({ text: rest.slice(start + 1, end), marked: true });
    rest = rest.slice(end + 1);
  }

  return parts;
}

export function SnippetText({ value }: { value: string }) {
  return (
    <>
      {splitSnippet(value).map((part, index) =>
        part.marked ? (
          <mark key={index} className="rounded-sm bg-accent px-0.5 text-accent-foreground">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}
```

**Hinweis:** Die Klassennamen an die Theme-Tokens des Projekts anpassen — kein statischer Farbwert im Anwendungscode (Prinzip 2). Welche Tokens es gibt, in `apps/kompass/src/components/ui/` nachsehen.

- [ ] **Step 4: Tests grün sehen**

Run: `pnpm --filter @kompass/app test -- snippet-text`
Expected: PASS (5 Tests)

- [ ] **Step 5: Commit**

```bash
git add apps/kompass/src/components/snippet-text.tsx apps/kompass/tests/snippet-text.test.tsx
git commit -m "feat(ui): show the passage, and nothing the document tries to run"
```

---

### Task 2: Die Liste wird die Suche

**Files:**
- Modify: `apps/kompass/src/app/(shell)/dms/document-list.tsx`, `apps/kompass/src/app/(shell)/dms/page.tsx`, `apps/kompass/messages/de.json`
- Test: `apps/kompass/e2e/dms.spec.ts` (erweitern, in Task 5)

**Interfaces:**
- Consumes: `hits`, `fulltextTooShort` (Plan 3), `SnippetText` (Task 1)
- Produces: `DocumentListProps` um `hits: Record<string, { page: number; snippet: string }>` und `fulltextTooShort: boolean` erweitert.

- [ ] **Step 1: Texte anlegen**

In `apps/kompass/messages/de.json` unter `dms`:

```json
      "searchPlaceholder": "Betreff, Nummer oder Inhalt",
      "searchTooShort": "Für die Suche im Inhalt braucht es mindestens drei Zeichen. Gesucht wurde nur in Betreff und Nummer.",
      "hitOnPage": "Seite {page}",
      "textPending": "Der Inhalt wird noch gelesen",
```

- [ ] **Step 2: Die Liste erweitern**

In `apps/kompass/src/app/(shell)/dms/page.tsx` die beiden neuen Felder aus `listDocuments` an die Komponente durchreichen.

In `document-list.tsx` die Props erweitern und unter der Trefferzeile eine zweite Zeile zeichnen — nur, wenn es eine Passage gibt:

```tsx
{hits[doc.id] ? (
  <TableRow className="border-0">
    <TableCell colSpan={columnCount} className="pt-0 text-sm text-muted-foreground">
      <SnippetText value={hits[doc.id]!.snippet} />{' '}
      <Link
        href={`/dms/${doc.id}/preview#page=${hits[doc.id]!.page}`}
        className="underline underline-offset-2"
      >
        {t('hitOnPage', { page: hits[doc.id]!.page })}
      </Link>
    </TableCell>
  </TableRow>
) : null}
```

Über dem `Link` der Kommentar, der die Sprungmarke erklärt:

```tsx
{/* `#page=` versteht jeder Browser-PDF-Betrachter; wir brauchen dafuer keinen
    eigenen Betrachter und keine Bibliothek. */}
```

Und über der Tabelle, wenn `fulltextTooShort`:

```tsx
{fulltextTooShort ? <p className="text-sm text-muted-foreground">{t('searchTooShort')}</p> : null}
```

- [ ] **Step 3: Von Hand ansehen**

```bash
pnpm dev:reset && pnpm --filter @kompass/app dev
```

Ein PDF mit Textebene über `/dms/receive` ablegen, warten, bis der Zustand steht, dann im Filterfeld ein Wort aus dem Inhalt eingeben.

Expected: Die Zeile erscheint, darunter die Passage mit hervorgehobenem Wort und „Seite 1“. Der Klick öffnet die Vorschau an der Stelle. Eingabe „ab“: Der Hinweis erscheint, keine leere Liste.

- [ ] **Step 4: Übersetzungstest laufen lassen**

Run: `pnpm --filter @kompass/app test`
Expected: PASS — insbesondere die Tests, die fehlende i18n-Schlüssel und gerade Anführungszeichen finden.

- [ ] **Step 5: Commit**

```bash
git add apps/kompass/src/app/\(shell\)/dms apps/kompass/messages/de.json
git commit -m "feat(dms): the list says where in the document it found the word"
```

---

### Task 3: Der Zustand am Dokument

Fünf Fälle, fünf Sätze. Der Unterschied zwischen „wartet“ und „wird gelesen“ ist kein Wortklauben: Bei einem 200-Seiten-Scan steht der zweite minutenlang.

**Files:**
- Modify: `apps/kompass/src/app/(shell)/dms/[id]/document-detail.tsx`, `apps/kompass/src/app/(shell)/dms/[id]/page.tsx`, `apps/kompass/src/app/(shell)/dms/actions.ts`, `apps/kompass/messages/de.json`
- Test: `apps/kompass/tests/permission-labels.test.ts` (läuft mit)

**Interfaces:**
- Consumes: `extractDocumentText` (Plan 2), `textStatus` (Plan 2)
- Produces: Server Action `rereadDocumentAction(documentId)` unter `dms.manage`.

- [ ] **Step 1: Texte anlegen**

```json
      "text": {
        "heading": "Volltext",
        "pending": "Wartet auf Erkennung",
        "running": "Wird gelesen",
        "done": "Gelesen am {date}",
        "failed": "Fehlgeschlagen: {reason}",
        "unavailable": "Texterkennung nicht verfügbar",
        "unavailableHint": "Die Werkzeuge fehlen in dieser Umgebung. Sobald sie da sind, wird das Dokument von selbst gelesen.",
        "reread": "Neu lesen",
        "rereadQueued": "Das Dokument wurde zum Neu-Lesen vorgemerkt."
      },
```

- [ ] **Step 2: Die Aktion schreiben**

In `apps/kompass/src/app/(shell)/dms/actions.ts`, nach dem Muster der vorhandenen Aktionen (Rechteprüfung im Service, `revalidatePath` danach):

```ts
export async function rereadDocumentAction(documentId: string) {
  const { deps, ctx } = await requireSession();
  const result = await extractDocumentText(deps, ctx, { documentId });
  if (!result.ok) return toActionError(result);
  revalidatePath(`/dms/${documentId}`);
  return { ok: true as const };
}
```

**Hinweis:** Wie `requireSession` und die Fehlerübersetzung in dieser Datei heißen, dort nachlesen. `extractDocumentText` verlangt `dms.manage` — die Prüfung bleibt im Service, der Knopf wird nur zusätzlich ausgeblendet.

- [ ] **Step 3: Den Block auf der Detailseite zeichnen**

In `document-detail.tsx` nach dem Aufbewahrungsblock, nach dessen Muster. Ein Entwurf hat `textStatus === null` und bekommt den Block gar nicht.

```tsx
{document.textStatus ? (
  <section>
    <h2>{t('text.heading')}</h2>
    <p>
      {document.textStatus === 'done'
        ? t('text.done', { date: formatDate(document.textExtractedAt) })
        : document.textStatus === 'failed'
          ? t('text.failed', { reason: document.textError ?? '' })
          : t(`text.${document.textStatus}`)}
    </p>
    {document.textStatus === 'unavailable' ? <p>{t('text.unavailableHint')}</p> : null}
    {permissions.canManage ? <RereadButton documentId={document.id} /> : null}
  </section>
) : null}
```

`permissions.canManage` in `page.tsx` ergänzen: `hasPermission(ctx, 'dms.manage')`.

- [ ] **Step 4: In der Liste ein Zeichen setzen**

In `document-list.tsx` an Dokumenten, deren `textStatus` weder `done` noch `null` ist, ein unauffälliges Zeichen mit `title={t('textPending')}`. Kein eigener Spaltenkopf — es ist eine Randnotiz, keine Information, nach der jemand sortiert.

- [ ] **Step 5: Von Hand ansehen**

Dev-Server starten, ein Dokument ablegen und die Detailseite während und nach dem Lesen ansehen.

Expected: Erst „Wartet auf Erkennung“, dann „Wird gelesen“, dann „Gelesen am …“. Der Knopf „Neu lesen“ setzt es zurück und der Lauf beginnt von vorn.

- [ ] **Step 6: Tests laufen lassen**

Run: `pnpm --filter @kompass/app test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/kompass
git commit -m "feat(dms): a document says whether it has been read, and why not"
```

---

### Task 4: Alles neu lesen

**Files:**
- Modify: `apps/kompass/src/app/(shell)/admin/dms/page.tsx`, neue `text-panel.tsx`, `apps/kompass/src/app/(shell)/admin/dms/actions.ts`, `apps/kompass/messages/de.json`

**Interfaces:**
- Consumes: `reindexAllDocuments` (Plan 3)

- [ ] **Step 1: Texte anlegen**

```json
        "textPanel": {
          "heading": "Volltext",
          "description": "Liest alle abgelegten Dokumente erneut ein. Das geschieht im Hintergrund, eins nach dem anderen; die Suche bleibt währenddessen benutzbar.",
          "languages": "Sprachen der Texterkennung",
          "reindex": "Alles neu lesen",
          "queued": "{count} Dokumente wurden zum Neu-Lesen vorgemerkt.",
          "open": "{count} warten noch"
        },
```

- [ ] **Step 2: Die Tafel bauen**

`text-panel.tsx` nach dem Muster von `rules-panel.tsx` in demselben Verzeichnis: die Einstellung `dms.ocrLanguages` zum Bearbeiten, der Knopf „Alles neu lesen“, und ein Zähler, wie viele Dokumente nicht auf `done` stehen.

Die Einstellung prüft ihre Werte gegen `deps.textExtraction.probe()` — was der Container meldet, ist die Auswahl. Meldet `probe()` einen Fehler, steht statt der Auswahl der Hinweis aus `text.unavailableHint`.

- [ ] **Step 3: Von Hand ansehen**

Dev-Server starten, `/admin/dms` öffnen.

Expected: Die Sprachliste zeigt, was lokal installiert ist (mit `tesseract-lang` über 160 Einträge). „Alles neu lesen“ meldet die Zahl und die Dokumente laufen durch.

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/app test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/kompass
git commit -m "feat(dms): read the whole file again, from the admin screen"
```

---

### Task 5: Seed und der Weg von vorn bis hinten

Zum Schluss der Test, der alles zusammen prüft — und der Seed, der dafür sorgt, dass eine frische Entwicklungsumgebung etwas zu suchen hat.

**Files:**
- Modify: `packages/modules/dms/src/seed.ts`, `packages/modules/dms/tests/seed.test.ts`
- Modify: `apps/kompass/e2e/dms.spec.ts`

**Interfaces:**
- Consumes: alles Vorherige

- [ ] **Step 1: Den Seed-Test erweitern**

In `packages/modules/dms/tests/seed.test.ts`:

```ts
  it('lässt die Beispieldokumente vom Worker lesen, statt den Index selbst zu füllen', async () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule], env: 'development' });
    insertUser(deps, { id: 'USER-TEST' });

    await seedDms(deps, systemContext());

    const withFile = deps.db.select().from(documents).where(isNotNull(documents.fileName)).all();
    expect(withFile.length).toBeGreaterThan(0);
    for (const row of withFile) {
      expect(row.textStatus).toBe('pending');
      expect(countDocumentText(deps, row.id)).toBe(0);
    }
  });
```

**Hinweis:** Die echte Signatur von `seedDms` in `packages/modules/dms/src/seed.ts` nachlesen.

- [ ] **Step 2: Test laufen lassen**

Run: `pnpm --filter @kompass/module-dms test -- seed`
Expected: Läuft womöglich sofort grün — der Seed legt über `receiveDocument` ab, und das setzt seit Plan 2 `pending`. Dann ist der Test die Absicherung dagegen, dass jemand später eine Abkürzung in den Index einbaut. Schlägt er fehl, den Seed anpassen, **nicht** den Test.

- [ ] **Step 3: Den E2E-Test schreiben**

In `apps/kompass/e2e/dms.spec.ts`, nach dem Muster der vorhandenen Tests dort:

```ts
test('ein abgelegter Scan wird gelesen und über seinen Inhalt gefunden', async ({ page }) => {
  await login(page, 'vorstand');

  await page.goto('/dms/receive');
  await page.getByLabel('Datei').setInputFiles('e2e/fixtures/brief-digital.pdf');
  await page.getByLabel('Betreff').fill('Ohne sprechenden Betreff');
  await page.getByLabel('Datum').fill('2026-09-11');
  await page.getByRole('button', { name: 'Ablegen' }).click();

  // Der Worker laeuft im Hintergrund; gewartet wird auf den Zustand, nicht auf
  // eine feste Zeit — sonst ist der Test auf einer langsamen Maschine rot.
  await expect(page.getByText(/Gelesen am/)).toBeVisible({ timeout: 60_000 });

  await page.goto('/dms');
  await page.getByPlaceholder('Betreff, Nummer oder Inhalt').fill('rechnung');
  await expect(page.getByText('Ohne sprechenden Betreff')).toBeVisible();
  await expect(page.getByRole('link', { name: /Seite 1/ })).toBeVisible();

  await page.getByRole('link', { name: /Seite 1/ }).click();
  await expect(page).toHaveURL(/\/dms\/.+\/preview#page=1/);
});

test('ein zu kurzer Begriff sagt, warum er nichts findet', async ({ page }) => {
  await login(page, 'vorstand');

  await page.goto('/dms');
  await page.getByPlaceholder('Betreff, Nummer oder Inhalt').fill('ab');

  await expect(page.getByText(/mindestens drei Zeichen/)).toBeVisible();
});
```

**Hinweis:** Die Beschriftungen (`Datei`, `Betreff`, `Ablegen`) und den Anmeldehelfer aus den vorhandenen Tests derselben Datei übernehmen, nicht raten. Die Beispieldatei nach `apps/kompass/e2e/fixtures/brief-digital.pdf` kopieren (aus `packages/text-extraction/tests/fixtures/`, Plan 1 Task 2).

- [ ] **Step 4: E2E gegen den Dev-Server**

Run: `pnpm --filter @kompass/app e2e -- dms`
Expected: PASS. Schlägt der Zustandswechsel fehl, prüfen, ob Poppler lokal installiert ist (`pdftotext -v`).

- [ ] **Step 5: E2E gegen den Container**

Run: `pnpm e2e:image`
Expected: PASS — hier läuft echtes Tesseract im Image.

- [ ] **Step 6: Commit**

```bash
git add packages/modules/dms apps/kompass/e2e
git commit -m "test(dms): file a letter, wait for it to be read, find it by its content"
```

---

## Abschluss der Reihe

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm verify` — alle drei Ringe
- [ ] `docs/backlog.md`: Einsortierregeln auf dem Volltext eintragen, mit der Begründung aus § 15 der Spec (nützt erst, wenn ein Agent nachträglich vorschlägt).
- [ ] Ein Blick auf die Datenbankgröße nach dem ersten vollen Lauf — die Spec rechnet mit Faktor 2,8 gegenüber dem reinen Text. Weicht es stark ab, gehört die Zahl in der Spec korrigiert.
