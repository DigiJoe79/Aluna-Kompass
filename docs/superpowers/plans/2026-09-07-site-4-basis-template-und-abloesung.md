# Basis-Template, Migration und Ablösung — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kompass liefert ein allgemeines Vereins-Template mit, Alunas Inhalte ziehen in das neue Modell um, und das Modul `website` verschwindet samt Alunas Seite aus diesem Repo.

**Architecture:** Das Basis-Template liegt als eigenes Astro-Projekt im Repo und wird beim ersten Start ins Volume kopiert. Ein einmaliges Skript überführt den Bestand aus den `website_*`-Tabellen nach `site_values` und `site_entries`. Erst wenn das nachweislich läuft, entfallen Modul, Tabellen und `apps/site`.

**Tech Stack:** Astro 7, TypeScript, Drizzle/SQLite, Vitest, Playwright, Docker.

**Spec:** `docs/superpowers/specs/2026-09-07-site-template-design.md`, Abschnitte 9 und 10.

**Voraussetzung:** Pläne 1 bis 3 sind abgeschlossen; `site` ist bedienbar und publiziert.

## Global Constraints

- Kein Vereinsspezifikum im mitgelieferten Template. Faustregel aus `AGENTS.md`: Würde ein anderer Verein bei einem Namen stutzen, ist er zu spezifisch.
- Nichts Rechenschaftsrelevantes wird gelöscht; redaktionelle Inhalte dürfen weg (`AGENTS.md`, Prinzip 3).
- Migrationen über `pnpm --filter @kompass/core db:generate`; erzeugte Dateien werden committet und nie editiert.
- Der Umzug läuft gegen Testdaten, nie gegen Prod (`AGENTS.md`, Prinzip 9).
- Zielplattform des Images ist amd64; unter Apple Silicon `--platform linux/amd64`.

---

### Task 1: Das Basis-Template

**Files:**
- Create: `templates/verein-basis/` — `kompass.template.ts`, `astro.config.mjs`, `package.json`, `src/pages/[...path].astro`, `src/layouts/Base.astro`, `src/components/*.astro`, `src/styles/*.css`, `src/lib/content.ts`, `src/lib/routes.ts`
- Test: `templates/verein-basis/tests/build.test.ts`

**Interfaces:**
- Consumes: `defineTemplate` und die Feldhelfer aus Plan 2 Task 1
- Produces: ein lauffähiges Template mit Deklaration

- [ ] **Step 1: Deklaration schreiben**

```ts
// templates/verein-basis/kompass.template.ts
import { asset, defineTemplate, markdown, number, text } from '@kompass/site-template';

export default defineTemplate({
  name: 'Verein Basis',
  locales: ['de'],
  variables: {
    claim: text({ max: 120, localized: true, label: 'Claim' }),
    intro: markdown({ max: 2000, localized: true, label: 'Text auf der Startseite' }),
    heroImage: asset({ label: 'Bild auf der Startseite' }),
    donationAccount: text({ max: 200, localized: false, label: 'Hinweis zur Bankverbindung' }),
    memberFee: number({ min: 0, label: 'Mitgliedsbeitrag im Jahr (Euro)' }),
  },
  collections: {
    news: { label: 'Aktuelles', slug: true, publishable: true, fields: { title: text({ localized: true, label: 'Titel' }), body: markdown({ localized: true, label: 'Text' }), image: asset({ label: 'Bild' }) } },
    team: { label: 'Team', sortable: true, max: 60, fields: { name: text({ label: 'Name' }), role: text({ localized: true, label: 'Aufgabe' }), photo: asset({ label: 'Foto' }) } },
    faq: { label: 'Fragen und Antworten', sortable: true, fields: { question: text({ localized: true, label: 'Frage' }), answer: markdown({ localized: true, label: 'Antwort' }) } },
    documents: { label: 'Dokumente', fields: { title: text({ localized: true, label: 'Titel' }), file: asset({ accept: 'application/pdf', label: 'PDF' }) } },
  },
});
```

Eine Sprache als Vorgabe, keine zweite: Der einsprachige Verein ist der Normalfall, und wer mehr braucht, legt sie an und ergänzt sie hier.

- [ ] **Step 2: Seiten bauen**

Elf Seiten als Astro-Routen: Start, Über uns, Team, Aktuelles (Liste und Einzelseite), Fragen und Antworten, Spenden, Mitglied werden, Kontakt, Impressum, Datenschutz, Satzung. Vorlage für Aufbau und Mechanik ist `apps/site`; Inhalte, Farben und Texte sind neutral. Kein Tierbezug, keine Spendenplattform, keine Kennzahlen mit Vorgabewerten.

- [ ] **Step 3: Test schreiben**

```ts
// templates/verein-basis/tests/build.test.ts
describe('verein-basis', () => {
  it('declares only fields any club could fill', () => {
    const keys = Object.keys(template.variables).concat(Object.keys(template.collections));
    expect(keys).not.toContain('shelterDogCount');
    for (const key of keys) expect(key).not.toMatch(/dog|animal|shelter|tier|betterplace/i);
  });

  it('builds against a fixture and renders every declared collection', async () => { /* Astro-Build gegen fixtures/example, danach index.html und /aktuelles/ prüfen */ });
});
```

- [ ] **Step 4: Tests ausführen und Commit**

```bash
pnpm --filter verein-basis test
git add templates/verein-basis
git commit -m "feat(templates): ship a plain club template"
```

---

### Task 2: Erstinbetriebnahme

**Files:**
- Modify: `scripts/docker-entrypoint.sh`, `Dockerfile`
- Test: `apps/kompass/tests/entrypoint.test.ts` (Shell-Logik als Skripttest) oder ein Containerlauf, siehe Step 3

- [ ] **Step 1: Kopie beim Start**

Im Entrypoint: Ist `/data/site-template` leer oder fehlt, wird `/app/templates/verein-basis` dorthin kopiert. Existiert dort etwas, bleibt es unberührt — ein Update darf ein gepflegtes Template nie überschreiben.

```sh
if [ ! -f /data/site-template/kompass.template.ts ]; then
  mkdir -p /data/site-template
  cp -R /app/templates/verein-basis/. /data/site-template/
fi
```

- [ ] **Step 2: Abhängigkeiten auflösen**

Das Template im Volume braucht `astro` und `@kompass/site-template` aus `/app/node_modules`. Symlink im Entrypoint anlegen:

```sh
[ -e /data/site-template/node_modules ] || ln -s /app/node_modules /data/site-template/node_modules
```

- [ ] **Step 3: Im Container prüfen**

```bash
docker build --platform linux/amd64 -t kompass-local .
docker run --rm -v "$(mktemp -d):/data" kompass-local sh -c 'ls /data/site-template && node -e "import(\"/data/site-template/kompass.template.ts\").then(m => console.log(m.default.name))"'
```

Expected: `Verein Basis`. Schlägt der Import fehl, greift der Rückfall aus Plan 2 Task 3 Step 1 — dann wird `kompass.template.mjs` als zweiter Name akzeptiert und die Vorlage entsprechend ausgeliefert.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile scripts/docker-entrypoint.sh
git commit -m "feat(docker): seed the volume with the base template"
```

---

### Task 3: Alunas Inhalte übernehmen

**Files:**
- Create: `scripts/migrate-website-to-site.ts`
- Test: `scripts/tests/migrate-website-to-site.test.ts`

**Interfaces:**
- Produces: `migrateWebsiteToSite(deps, opts): MigrationReport`

- [ ] **Step 1: Tests schreiben**

```ts
describe('migrate website to site', () => {
  it('carries page texts into variables named after their page and field', async () => { /* website_pages.about.body → variables.aboutBody */ });
  it('carries articles, team, faqs and downloads into entries with their slug and order', async () => { /* … */ });
  it('keeps the published flag where the collection is publishable', async () => { /* … */ });
  it('reports one line per source table with counts', async () => { /* Bericht als Rückgabewert */ });
  it('refuses to run twice and leaves the second attempt untouched', async () => { /* conflict alreadyMigrated, wenn site_entries nicht leer ist */ });
  it('refuses to run in production', async () => { /* env production → conflict */ });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Expected: FAIL

- [ ] **Step 3: Skript schreiben**

Das Ziel ist Alunas Template, dessen Deklaration zu diesem Zeitpunkt feststeht. Die Zuordnung steht als Tabelle im Skript, nicht als Automatik:

```ts
const PAGE_FIELDS: { page: string; field: 'title' | 'lede' | 'body'; variable: string }[] = [
  { page: 'about', field: 'body', variable: 'aboutBody' },
  // … je Seite und Feld ein Eintrag, so viele wie Alunas Template Variablen deklariert
];
const COLLECTIONS = [
  { from: 'website_articles', to: 'articles', fields: ['title', 'lede', 'body'] },
  { from: 'website_team', to: 'team', fields: ['name', 'position', 'photoAssetId'] },
  { from: 'website_faqs', to: 'faq', fields: ['category', 'question', 'answer'] },
  { from: 'website_downloads', to: 'documents', fields: ['title', 'assetId'] },
];
```

Was Alunas Template fest codiert, wandert nicht mit: Diese Texte stehen künftig im Template und werden beim Umzug einmal von Hand übertragen. Das Skript nennt am Ende, welche Seitenfelder es *nicht* übernommen hat, damit nichts unbemerkt zurückbleibt.

- [ ] **Step 4: Gegen echte Daten proben**

```bash
pnpm dev:reset
pnpm tsx scripts/migrate-website-to-site.ts --dry-run
```

Expected: Bericht ohne Schreibvorgang; Zahlen stimmen mit den Listen in der Oberfläche überein.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-website-to-site.ts scripts/tests
git commit -m "feat(migration): move Aluna's content into the template model"
```

---

### Task 4: Alunas Seite herauslösen

**Files:**
- Delete: `apps/site/`
- Modify: `Dockerfile`, `pnpm-workspace.yaml`, `AGENTS.md`, `docs/betrieb.md`
- Modify: `apps/kompass/playwright.config.ts` (`SITE_DIR` → Testtemplate)

- [ ] **Step 1: Ins Vereins-Repo überführen**

`apps/site` wird als Alunas Template in das Repo von Aluna Tierhilfe e.V. übernommen, dort um `kompass.template.ts` ergänzt und gegen die Testumgebung geprüft. Erst wenn es dort publiziert, geht es hier weg.

- [ ] **Step 2: Aus diesem Repo entfernen**

Löschen, aus dem Workspace nehmen, aus dem Dockerfile die Zeilen für `apps/site` entfernen und stattdessen `templates/verein-basis` kopieren. `AGENTS.md` unter „Befehle" die Site-Zeilen ersetzen.

- [ ] **Step 3: Prüfen, dass nichts von Aluna übrig ist**

Run: `grep -rniE "aluna|tierhilfe|shelter|zuhause-gesucht|betterplace" --include='*.ts' --include='*.tsx' --include='*.astro' --include='*.json' packages apps templates | grep -v node_modules`
Expected: nur Treffer in `docs/` und in Commit-Nachrichten. Jeder Treffer in Code ist ein Fund und gehört behoben.

- [ ] **Step 4: Gesamtlauf**

Run: `pnpm typecheck && pnpm test && pnpm --filter @kompass/app e2e && docker build --platform linux/amd64 -t kompass-local .`
Expected: alles grün, Image ohne Aluna-Inhalte

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move Aluna's site out of the product repo"
```

---

### Task 5: Das Modul `website` entfernen

**Files:**
- Delete: `packages/modules/website/`
- Modify: `apps/kompass/src/modules.ts`, `apps/kompass/src/app/(shell)/website/` (Seiten entfernen), `apps/kompass/messages/de.json`
- Create: eine Migration, die die `website_*`-Tabellen entfernt

- [ ] **Step 1: Erst wenn der Umzug steht**

Voraussetzung: Alunas Installation läuft in der Testumgebung auf `site`, publiziert von dort, und die Inhalte stimmen. Vorher wird hier nichts gelöscht — die alten Tabellen sind bis dahin die einzige vollständige Kopie.

- [ ] **Step 2: Modul und Seiten entfernen**

Run: `grep -rn "module-website\|@kompass/module-website\|websiteModule" --include='*.ts' --include='*.tsx' --include='*.json' packages apps | grep -v node_modules`

Jede Stelle entfernen. `installedModules` enthält danach `[siteModule, animalsModule]`.

- [ ] **Step 3: Tabellen entfernen**

Migration, die `website_pages`, `website_articles`, `website_team`, `website_faqs`, `website_downloads` und `website_publishes` entfernt. Die Publish-Historie zieht vorher mit: Sie ist ein Betriebsprotokoll und gehört zu `site`.

Run: `pnpm --filter @kompass/core db:generate`

- [ ] **Step 4: Backlog und Doku nachziehen**

`docs/backlog.md`: Punkt zu den Übersetzungen der Webseite prüfen — er bezieht sich auf das alte Modell. `docs/betrieb.md`: Abschnitt „Webseite" auf das Template-Verzeichnis umschreiben, inklusive des Satzes, dass `/data/site-template` eine Vertrauensgrenze ist. `AGENTS.md`: Quellenliste um die neue Spec ergänzen.

- [ ] **Step 5: Gesamtlauf und Commit**

```bash
pnpm typecheck && pnpm test && pnpm --filter @kompass/app e2e
git add -A
git commit -m "refactor: retire the website module"
```

---

## Abschluss dieses Plans

Danach ist Kompass ein Produkt, das man einem anderen Verein geben kann: Es bringt ein neutrales Template mit, das er umbaut oder ersetzt, und nichts im Image erinnert an Tierschutz. Alunas Seite lebt in ihrem eigenen Repo und wird von derselben Kompass-Fassung publiziert wie jede andere.

## Self-Review (durchgeführt beim Schreiben)

**Spec-Abdeckung:** Basis-Template mit den üblichen Vereinsseiten (Abschnitt 9) → Task 1. Kopie ins Volume beim ersten Start → Task 2. Symlink für die Abhängigkeiten (Abschnitt 8, offener Punkt) → Task 2 Step 2 und 3, mit dem Rückfall aus Plan 2. Migration gegen Testdaten, danach löschbar (Abschnitt 10) → Task 3. `apps/site` verlässt das Repo → Task 4. Ablösung von `website` inklusive Tabellen → Task 5.

**Platzhalter:** Task 1 Step 2 und Task 3 Step 3 nennen die Zuordnung als Tabellenkopf statt vollständig — beide hängen von Alunas endgültiger Template-Deklaration ab, die erst in Task 1 entsteht. Das ist der einzige Punkt, an dem der Plan bewusst offen bleibt, und er ist als solcher benannt: Die Liste wird beim Schreiben des Templates gefüllt, nicht beim Ausführen geraten.

**Reihenfolge:** Task 5 hängt an einer Bedingung, die kein Test prüfen kann — dass Alunas Installation wirklich läuft. Deshalb steht sie als erster Schritt dieses Tasks und nicht im Fliesstext.

**Typkonsistenz:** `migrateWebsiteToSite(deps, opts)` liefert `MigrationReport` mit einer Zeile je Quelltabelle; der Bericht wird in Task 3 Step 1 geprüft und in Step 4 gelesen. Die Sammlungsschlüssel `articles`, `team`, `faq`, `documents` stimmen mit Task 1 überein.
