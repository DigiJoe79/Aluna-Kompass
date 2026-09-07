# Basis-Template, Migration und Ablösung — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kompass liefert ein allgemeines Vereins-Template mit und richtet es beim ersten Start im Volume ein.

**Architecture:** Das Basis-Template liegt als eigenes Astro-Projekt im Repo und wird beim ersten Start ins Volume kopiert, samt Modulauflösung. Die Publish-Pipeline bleibt vorerst bei `website` — ihr Umzug gehört in Plan 5, weil `website` sonst sein Publish-Recht verlöre, bevor Aluna umgezogen ist.

**Tech Stack:** Astro 7, TypeScript, Drizzle/SQLite, Vitest, Playwright, Docker.

**Spec:** `docs/superpowers/specs/2026-09-07-site-template-design.md`, Abschnitte 8 und 9.

**Danach:** `2026-09-07-site-5-cutover.md` — Alunas Umzug und die Ablösung von `website`. Der wartet auf Voraussetzungen ausserhalb dieses Repos und ist deshalb ein eigener Plan.

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

Das Template im Volume braucht `astro` für den Build und `@kompass/site-template` schon beim Lesen der Deklaration; beide liegen unter `/app/node_modules`. Symlink im Entrypoint anlegen:

```sh
[ -e /data/site-template/node_modules ] || ln -s /app/node_modules /data/site-template/node_modules
```

Dieselbe Wirkung hat `ensureModuleResolution` aus Plan 2 Task 3, das beim Einlesen läuft. Der Entrypoint kommt ihm zuvor, damit schon der erste Build ohne vorheriges Einlesen funktioniert; beide sind idempotent.

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

## Abschluss dieses Plans

Danach bringt Kompass ein neutrales Template mit, das beim ersten Start im
Volume landet und dort baubar ist. Publiziert wird weiterhin über `website`;
Pipeline-Umzug und Ablösung sind Plan 5.

## Self-Review (durchgeführt beim Schreiben)

**Spec-Abdeckung:** Basis-Template mit den üblichen Vereinsseiten (Abschnitt 9)
→ Task 1. Kopie ins Volume beim ersten Start und Modulauflösung (Abschnitt 8)
→ Task 2. Der Pipeline-Umzug stand hier und ist nach Plan 5 gewandert: Er nimmt
`website` das Publish-Recht, was vor Alunas Umzug nicht geht.

**Platzhalter:** Task 1 Step 2 nennt die elf Seiten und verweist für Aufbau und
Mechanik auf `apps/site` als Vorlage, statt sie abzuschreiben — die Dateien
liegen im Repo und sind benannt.

**Typkonsistenz:** Die Sammlungsschlüssel `news`, `team`, `faq`, `documents`
stammen aus Task 1 Step 1 und werden in Plan 5 als E2E-Fixture wieder benutzt.
Alunas Template hat eigene Schlüssel; sie entstehen dort und müssen mit diesen
nicht übereinstimmen.
