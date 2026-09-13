# Startseiten-Referenzen, Plan 4: Alunas Template (Vereinsrepo)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alunas Template liest die Startseitenplätze als Referenzvariablen (Hund, Geschichte, zwei Projekte) und zeigt die Bildunterschriften der Vermittlungsgeschichte aus den Daten statt fester Ortsangaben. Danach der Resync auf der Test-Instanz.

**Architecture:** Arbeit im Vereinsrepo `~/Development/Aluna Tierhilfe e.V./Kompass/webseite` (nicht in Aluna-Kompass). Die Deklaration wechselt zwei Textvariablen per `renamedFrom` zu `reference` und ergänzt `references` für Projekte. `featured.ts` bekommt eine dritte Funktion `featuredProjects`, die Startseite liest sie; leer heißt weiter Automatik. Die Unterschriften kommen aus `story.beforeCaption`/`afterCaption` der Sicht (Plan 1); bei leerem Wert entfällt die Ortsangabe.

**Tech Stack:** Astro 7, TypeScript, Vitest (baut die Seite gegen `fixtures/example`), `@kompass/site-template` aus dem Kompass-Repo.

**Spec:** `docs/superpowers/specs/2026-09-13-startseiten-referenzen-und-nacharbeiten-design.md` (im Kompass-Repo), § 5 und § 8. Voraussetzung: Plan 1 (Unterschriften in der Sicht) und Plan 3 (Referenzfelder) sind gebaut und das Image auf der Test-Instanz enthält beides.

## Global Constraints

- Leer heißt Automatik (Spec, Entscheidung 2): ohne Wahl Notfall-Hund oder zuletzt aufgenommener, jüngste Geschichte, erste zwei Projekte nach Sortierung. Der Block fällt nur weg, wenn auch die Automatik nichts findet.
- Keine festen Ortsangaben mehr unter den Geschichte-Bildern. Leer heißt: nur „Vorher" bzw. „Nachher".
- Das Vereinsrepo hat eigene Tests (`pnpm test` dort baut die Seite). Jede Änderung mit Test; `pnpm typecheck` (`astro check`) grün.
- Commit je Task im Vereinsrepo, kein Push.

---

### Task 1: Deklaration und Inhaltstypen

**Files (alle unter `Kompass/webseite/`):**
- Modify: `kompass.template.ts`
- Modify: `src/lib/content.ts` (`Animal.story`)
- Modify: `fixtures/example/content.json`
- Test: `tests/variables.test.ts`

**Interfaces:**
- Produces: `Variables.featuredAnimal: string | null | undefined`, `Variables.featuredStory: string | null | undefined`, `Variables.featuredProjects: string[] | undefined`; `Animal.story` mit `beforeCaption: L`, `afterCaption: L`.

- [ ] **Step 1: Test der Fixture-Variablen**

In `tests/variables.test.ts` den `describe('unfilled variables')`-Test anpassen: `contentWithoutVariables('shelterDogCount', 'featuredAnimal', 'featuredStory', 'featuredProjects')` statt der Slug-Namen. Ergänze im selben `describe`:

```ts
  it('a chosen dog, story and projects override the automatic choice', () => {
    const out = build({ SITE_CONTENT_DIR: contentWithVariables({ featuredAnimal: 'chiara', featuredStory: 'akiko', featuredProjects: ['op-fonds', 'grundversorgung'] }) });
    const home = readFileSync(path.join(out, 'index.html'), 'utf8');
    expect(home).toContain('Chiara sucht');
    expect(home).not.toContain('Bruno sucht');
    expect(home.indexOf('OP-Fonds')).toBeLessThan(home.indexOf('Grundversorgung'));
  });
```

Dafür in `tests/helpers.ts` neben `contentWithoutVariables` einen Helfer:

```ts
export function contentWithVariables(values: Record<string, unknown>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'site-content-'));
  dirs.push(dir);
  cpSync(path.join(ROOT, 'fixtures/example'), dir, { recursive: true });
  const file = path.join(dir, 'content.json');
  const content = JSON.parse(readFileSync(file, 'utf8')) as { variables: Record<string, unknown> };
  Object.assign(content.variables, values);
  writeFileSync(file, JSON.stringify(content, null, 2));
  return dir;
}
```

Die Projektnamen in der Erwartung (`OP-Fonds`, `Grundversorgung`) gegen `fixtures/example/content.json` prüfen (`grep -n '"name"' -A2` bei den Projekten `op-fonds` und `grundversorgung`) und die exakte Schreibweise übernehmen.

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `pnpm test -- variables` (im Vereinsrepo)
Expected: FAIL; die Variablen existieren nicht, die Startseite ignoriert sie.

- [ ] **Step 3: Deklaration**

In `kompass.template.ts` den Import um `reference, references` erweitern und den Block „Redaktionelle Auswahl auf der Startseite" ersetzen:

```ts
    // ---------------------------------------------------------------------
    // Redaktionelle Auswahl auf der Startseite (2026-09-13: Referenzen statt
    // Slugs — die Auswahl in Kompass zeigt nur, was die Bedingung erfüllt,
    // und ein Verweis ins Leere wird beim Export gemeldet). Leer heißt: das
    // Template wählt selbst (Notfall zuerst, jüngste Geschichte, Sortierung).
    // ---------------------------------------------------------------------

    featuredAnimal: reference({ view: 'animals', where: { status: 'lookingForHome' }, label: 'Hund auf der Startseite', renamedFrom: 'featuredAnimalSlug' }),
    featuredStory: reference({ view: 'animals', where: { status: 'adopted', story: { present: true } }, label: 'Geschichte auf der Startseite', renamedFrom: 'featuredStorySlug' }),
    featuredProjects: references({ view: 'projects', max: 2, label: 'Projekte auf der Startseite' }),
```

Den Kommentar über der Sammlung `projects` (der noch von „Reihenfolge bestimmt auch, welche zwei auf der Startseite stehen" spricht) auf die Variable umschreiben: Die zwei Plätze wählt `featuredProjects`, die Sortierung füllt auf.

In `src/lib/content.ts` das `story`-Objekt in `Animal` um `beforeCaption: L; afterCaption: L;` erweitern.

In `fixtures/example/content.json`: `"featuredAnimalSlug": "auto"` und `"featuredStorySlug": "auto"` ersetzen durch

```json
    "featuredAnimal": null,
    "featuredStory": null,
    "featuredProjects": [],
```

und bei Akikos `story` ergänzen: `"beforeCaption": { "de": "Im Shelter in Bukarest", "en": "At the shelter in Bucharest" }, "afterCaption": { "de": "", "en": "" }`. Bei jeder anderen Geschichte im Fixture (`grep -n '"story": {'`) `"beforeCaption": {}, "afterCaption": {}`.

- [ ] **Step 4: Startseite und `featured.ts`**

`src/lib/featured.ts`:

```ts
import type { Animal, Project, Variables } from './content';

/** Der gewählte Hund, sonst Notfall zuerst, sonst der zuletzt aufgenommene. Leer heißt Automatik (2026-09-13). */
export function featuredAnimal(animals: Animal[], facts: Variables): Animal | null {
  const open = animals.filter((a) => a.status !== 'adopted');
  const chosen = facts.featuredAnimal ? open.find((a) => a.slug === facts.featuredAnimal) : undefined;
  return chosen ?? open.find((a) => a.isEmergency) ?? open[open.length - 1] ?? null;
}

/** Die gewählte Geschichte, sonst die jüngste Vermittlung mit Geschichte. */
export function featuredStory(animals: Animal[], facts: Variables): Animal | null {
  const done = animals.filter((a) => a.status === 'adopted' && a.story);
  const chosen = facts.featuredStory ? done.find((a) => a.slug === facts.featuredStory) : undefined;
  return chosen ?? [...done].sort((a, b) => b.story!.adoptedYear - a.story!.adoptedYear)[0] ?? null;
}

/** Die gewählten Projekte in Reihenfolge, aufgefüllt aus der Sortierung bis zwei. */
export function featuredProjects(projects: Project[], facts: Variables, slots = 2): Project[] {
  const bySort = [...projects].sort((a, b) => a.sortOrder - b.sortOrder);
  const chosen = (facts.featuredProjects ?? []).map((slug) => bySort.find((p) => p.slug === slug)).filter((p): p is Project => !!p);
  const rest = bySort.filter((p) => !chosen.includes(p));
  return [...chosen, ...rest].slice(0, slots);
}
```

Das bisherige Verhalten „Slug gesetzt, aber nicht gefunden → `null`" entfällt: Kompass exportiert einen ungültigen Verweis als `null`, und ein Slug, der zwar in der Sicht steht, aber die Bedingung nicht mehr erfüllt (Hund inzwischen vermittelt), wird durch die Bedingung im Template ohnehin nicht gefunden; dann greift die Automatik. Das ist die Entscheidung „nicht still verschwinden": Der Befund steht in Kompass, die Seite bleibt vollständig.

`src/components/HomePage.astro`: Import um `featuredProjects` erweitern und die Zeile

```ts
const featuredProjects = [...projectsOf(content)].sort((a, b) => a.sortOrder - b.sortOrder).slice(0, 2);
```

ersetzen durch

```ts
const teasers = featuredProjects(projectsOf(content), vars);
```

und jede Verwendung von `featuredProjects` im Markup in `teasers` umbenennen (`grep -n featuredProjects src/components/HomePage.astro`).

- [ ] **Step 5: Tests und Typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS. `tests/html.test.ts` (`home shows facts and the featured dog and story`) erwartet Bruno und Akiko aus der Automatik; das Fixture hat `null`, also bleibt das so.

- [ ] **Step 6: Commit (im Vereinsrepo)**

```bash
git add kompass.template.ts src/lib/content.ts src/lib/featured.ts src/components/HomePage.astro fixtures/example/content.json tests/variables.test.ts tests/helpers.ts
git commit -m "feat(webseite): the home page reads its dog, story and projects as references"
```

---

### Task 2: Bildunterschriften aus den Daten

**Files (unter `Kompass/webseite/`):**
- Modify: `src/components/HomePage.astro` (Geschichte-Block)
- Modify: `src/components/StoryList.astro`
- Test: `tests/html.test.ts`

- [ ] **Step 1: Test schreiben**

In `tests/html.test.ts` anhängen (im `describe('rendered html')`, das `read` und `dist` kennt):

```ts
  it('story captions come from the data; without one, only the stage word stands', () => {
    const stories = read('gluecklich-vermittelt/index.html');
    // Akiko: Vorher-Unterschrift gesetzt, Nachher leer (fixtures/example/content.json)
    expect(stories).toContain('Vorher · Im Shelter in Bukarest');
    expect(stories).not.toContain('Vorher · Shelter');
    expect(stories).toMatch(/Nachher<\/figcaption>|Nachher\s*<\/figcaption>/);
    expect(stories).not.toContain('Ihr neues Zuhause');
    const home = read('index.html');
    expect(home).toContain('Im Shelter in Bukarest');
    expect(home).not.toContain('<span class="story-place">Shelter</span>');
  });
```

Den Pfad der Geschichtenseite gegen `src/lib/routes.ts` prüfen (`grep -n stories src/lib/routes.ts`) und die Erwartungen an die tatsächliche Ausgabeform anpassen, nachdem Step 3 steht: Der Test darf nicht auf Zufall passen, er soll das Markup festhalten, das Step 3 erzeugt.

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `pnpm test -- html`
Expected: FAIL (`Vorher · Shelter` steht noch fest im Markup).

- [ ] **Step 3: Markup ändern**

`StoryList.astro`, im `map` über `stories` nach `const quote = pick(story.quote, locale);`:

```ts
        const beforeCaption = pick(story.beforeCaption, locale).value;
        const afterCaption = pick(story.afterCaption, locale).value;
```

und die beiden `figcaption`-Zeilen:

```astro
                <figcaption style="…unverändert…">{t.story.before}{beforeCaption ? ` · ${beforeCaption}` : ''}</figcaption>
```

```astro
                <figcaption style="…unverändert…">{t.story.after}{afterCaption ? ` · ${afterCaption}` : ''}</figcaption>
```

`HomePage.astro`, im Geschichte-Block nach `const quote = pick(st.quote, locale);` dieselben zwei Konstanten, und die beiden `figcaption`:

```astro
              <figcaption class="story-caption"><span class="story-stage">{t.story.before}</span>{beforeCaption ? <span class="story-place">{beforeCaption}</span> : null}</figcaption>
```

```astro
              <figcaption class="story-caption"><span class="story-stage">{t.story.after}</span>{afterCaption ? <span class="story-place">{afterCaption}</span> : null}</figcaption>
```

`pick` liefert `{ value, fallback }`; prüfe in `src/lib/locale.ts`, ob `pick` mit einem leeren Record (`{}`) umgeht und `value: ''` liefert. Tut es das nicht, gib `story.beforeCaption ?? {}` hinein.

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/HomePage.astro src/components/StoryList.astro tests/html.test.ts
git commit -m "feat(webseite): story captions come from Kompass, no fixed place names"
```

---

### Task 3: Resync auf der Test-Instanz

Kein Code; eine Abnahme, die zeigt, dass der Weg vom Template über Kompass bis zum Export trägt.

- [ ] **Step 1: Template auf den Testcontainer**

Run: `Kompass/sync-template.sh` aus dem Vereinsrepo (liest den Zielpfad aus seiner Kopfzeile; `docs/betrieb.md` im Kompass-Repo beschreibt Volume und Besitzer). Vorher sicherstellen, dass das Image auf der Test-Instanz Plan 1 und Plan 3 enthält (`docs/betrieb.md`, Abschnitt Updates).

- [ ] **Step 2: Einlesen**

In Kompass (Test) unter Webseite → Template „Template einlesen". Erwartete Befunde: zwei Umbenennungen (`featuredAnimalSlug → featuredAnimal`, `featuredStorySlug → featuredStory`), beide als Typwechsel `text → reference` verlustfrei, ein neues Feld `featuredProjects`. Übernehmen.

- [ ] **Step 3: Variablen**

Unter Webseite → Variablen: Die beiden Felder zeigen die Warnung „„auto" steht nicht mehr zur Auswahl." mit „Leeren". Beide leeren; für „Hund auf der Startseite" einen Hund wählen, für „Geschichte" einen vermittelten mit Geschichte, für „Projekte" zwei Projekte. Speichern.

- [ ] **Step 4: Prüfen und Vorschau**

Unter Webseite → Publish „Prüfen": keine veralteten Verweise. Vorschau bauen, Startseite ansehen: gewählter Hund, gewählte Geschichte mit den Unterschriften aus der Geschichte-Maske, die zwei gewählten Projekte in Reihenfolge. Danach die Wahl des Hundes leeren, nochmals Vorschau: der Notfall-Hund oder der zuletzt aufgenommene steht dort.

- [ ] **Step 5: Befund festhalten**

Was bei Schritt 2 bis 4 nicht wie beschrieben lief, ist ein Test in Kompass (Plan 3) oder im Vereinsrepo, keine Handkorrektur. Gab es nichts, ist Plan 4 fertig; der Nordstern-Eintrag aus Plan 3, Task 10, bekommt sein Datum.

---

## Selbstprüfung gegen die Spec

- § 5 Deklaration mit `renamedFrom`, `featured.ts` mit `null` statt `auto`, `featuredProjects` aufgefüllt aus der Sortierung, Tests, Fixture: Task 1.
- § 8 Unterschriften im Template, keine festen Texte: Task 2.
- § 5 Resync auf der Test-Instanz, `auto` als Befund, leeren: Task 3.
