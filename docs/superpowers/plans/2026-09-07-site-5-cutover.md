# Cutover: Aluna zieht um, `website` verschwindet — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alunas Inhalte laufen auf dem Modul `site`, ihre Seite lebt im Vereins-Repo, und `website` ist aus diesem Repo verschwunden.

**Architecture:** Ein einmaliges Skript überführt den Bestand aus den `website_*`-Tabellen nach `site_values` und `site_entries`. Erst wenn Alunas Installation nachweislich auf `site` läuft und von dort publiziert, entfallen Modul, Tabellen und `apps/site`.

**Tech Stack:** Astro 7, TypeScript, Drizzle/SQLite, Vitest, Playwright, Docker.

**Spec:** `docs/superpowers/specs/2026-09-07-site-template-design.md`, Abschnitt 10.

**Voraussetzung:** `2026-09-07-site-4-basis-template.md` ist abgeschlossen.

## Voraussetzungen ausserhalb dieses Repos

Dieser Plan wartet auf drei Dinge, die kein Test hier herstellen kann. Wer ihn
beginnt, prüft sie zuerst:

1. **Alunas Template existiert** im Repo von Aluna Tierhilfe e.V. — `apps/site`
   dorthin überführt und um `kompass.template.ts` ergänzt. Erst damit stehen die
   Sammlungsschlüssel und die Variablen fest, auf die Task 1 abbildet.
2. **Es publiziert von dort**, geprüft gegen die Testumgebung.
3. **Alunas Installation läuft in der Testumgebung auf `site`** und publiziert
   von dort. Vorher wird `website` nicht angefasst: Seine Tabellen sind bis dahin
   die einzige vollständige Kopie der Inhalte.

Fehlt eines davon, ist der richtige nächste Schritt, es herzustellen — nicht,
diesen Plan anzufangen.

## Global Constraints

- Nichts Rechenschaftsrelevantes wird gelöscht; redaktionelle Inhalte dürfen weg (`AGENTS.md`, Prinzip 3).
- Migrationen über `pnpm --filter @kompass/core db:generate`; erzeugte Dateien werden committet und nie editiert.
- Der Umzug läuft gegen Testdaten, nie gegen Prod (`AGENTS.md`, Prinzip 9).
- Zielplattform des Images ist amd64; unter Apple Silicon `--platform linux/amd64`.

---

### Task 1: Alunas Inhalte übernehmen

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

### Task 2: Alunas Seite herauslösen

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

### Task 3: Das Modul `website` entfernen

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

Migration, die `website_pages`, `website_articles`, `website_team`, `website_faqs` und `website_downloads` entfernt. `website_publishes` ist zu diesem Zeitpunkt bereits als `site_publishes` umbenannt (Task 3).

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

Danach ist Kompass ein Produkt, das man einem anderen Verein geben kann: Es
bringt ein neutrales Template mit, und nichts im Image erinnert an Tierschutz.
Alunas Seite lebt in ihrem eigenen Repo und wird von derselben Kompass-Fassung
publiziert wie jede andere.

## Self-Review (durchgeführt beim Schreiben)

**Spec-Abdeckung:** Migration gegen Testdaten, danach löschbar (Abschnitt 10)
→ Task 1. `apps/site` verlässt das Repo → Task 2. Ablösung von `website`
inklusive Tabellen → Task 3.

**Platzhalter:** Task 1 Step 3 nennt die Zuordnung als Tabellenkopf statt
vollständig. Sie hängt an Alunas Template-Deklaration, die ausserhalb dieses
Repos entsteht — deshalb steht sie unter den Voraussetzungen und wird beim
Ausführen gefüllt, nicht geraten. Die Zielschlüssel im Beispiel (`articles`,
`team`, `faq`, `documents`) sind genau das: ein Beispiel. Sie müssen mit den
Sammlungen des Basis-Templates nicht übereinstimmen, weil Aluna ein eigenes
Template hat.

**Reihenfolge:** Task 3 hängt an einer Bedingung, die kein Test prüfen kann —
dass Alunas Installation wirklich läuft. Deshalb steht sie als erster Schritt
dieses Tasks und zusätzlich unter den Voraussetzungen.

**Typkonsistenz:** `migrateWebsiteToSite(deps, opts)` liefert `MigrationReport`
mit einer Zeile je Quelltabelle; der Bericht wird in Task 1 Step 1 geprüft und in
Step 4 gelesen.
