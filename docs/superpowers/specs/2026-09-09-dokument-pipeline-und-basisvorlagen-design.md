# Aluna Kompass — Dokument-Pipeline und Basis-Vorlagen (Design)

Stand 2026-09-09. Baut die Dokumenten-Engine aus Stufe 1 (`2026-09-05-fundament-design.md`, §7)
zu einer zweistufigen Architektur aus, bevor Stufe 3 (Finanzen) die ersten echten
Fachvorlagen bringt. Zweistufig wie bei der Webseite: eine generische Pipeline im
Produkt, ein vereinsspezifischer Teil hinter einer Vertrauensgrenze.

## 1. Ausgangslage

Heute: `packages/documents` liefert `base.typ` (Layout), `letterhead.typ` und
`audit-log-export.typ` (zwei Vorlagen), einen Typst-Renderer und
`coreDocumentTemplates()`. Der Kern hat `renderDocument` / `voidDocument` /
`listDocuments`, die `documents`-Tabelle mit lückenloser Nummer, Storno statt
Löschen. Module können über `ModuleManifest.documentTemplates` eigene Vorlagen
beisteuern — bisher tut es keins.

Zwei Probleme:

1. **`base.typ` ist ein Platzhalter.** Es wurde geschrieben, um die Engine zu
   beweisen. Es bringt keinen echten Geschäftsbrief-Kopf, kein Anschriftenfeld,
   keinen Titelblock, keine Fortsetzungsseiten-Logik über das Nötigste hinaus.
   Und: der `DocumentTemplate`-Vertrag verlangt vom Modul eine `render()`, die
   fertiges PDF liefert — also Typst-Code im Modul.

2. **Kein Weg für ein vereinseigenes Layout.** Alunas Briefkopf (Marineblau/Gold,
   „Wimpel"-Logokasten, Cambria/Calibri) ist Corporate Design und gehört **nicht**
   ins Open-Source-Produkt-Repo — genau die Grenze, die bei der Webseite gezogen
   wurde (`no-association-content.test.ts`). Es fehlt der Import-Mechanismus.

## 2. Zielbild: zwei Stufen

**A) Die Pipeline (Kompass, generisch).** Module beschreiben *Dokumentarten* über
einen Vertrag: welche Daten rein (Zod), welcher Fließtext raus (**Markdown**),
welche Basis-Vorlage, welcher rechtlich feste Text. Die Pipeline validiert,
wandelt Markdown deterministisch nach Typst, setzt es in den Rahmen der
Basis-Vorlage, kompiliert, nummeriert, friert ein.

**B) Der Importer für Basis-Vorlagen (vereinsspezifisch).** Ein Verein legt eine
oder mehrere Basis-Vorlagen (`a4-mit-briefkopf`, `a4-ohne-briefkopf`,
`a4-formular` …) als `.typ`-Dateien unter `/data/document-templates/` ab —
Vertrauensgrenze, wie `/data/site-template`. Kompass liest sie beim Rendern auf,
mitgelieferte generische Vorlagen als Rückfallebene. Alunas Briefkopf entsteht im
Vereinsrepo und wird dorthin kopiert.

**Byte-identisch:** Gleicher Markdown-Text + gleiche Basis-Vorlage + gleiches
Branding + gepinnte Typst-Version ⇒ byte-identisches PDF.

## 3. Entscheidungen aus dem Brainstorming (2026-09-09)

| # | Entscheidung | Verworfen |
|---|---|---|
| 1 | Basis-Vorlagen sind **dateibasiert** aufgelöst (Volume = Wahrheit); jedes Dokument merkt sich `base` + Prüfsumme im `inputSnapshot`. | Beim Import in die DB kopieren wie `site_template_state` |
| 2 | Kompass liefert **generische Basis-Vorlagen** mit; der Verein ergänzt/überschreibt seine. | Nur eine feste `base.typ` im Produkt; Alunas Layout ins Repo |
| 3 | Der Dokument-Körper ist **Markdown** (deterministisch nach Typst gewandelt). Datenlastige Dokumente dürfen stattdessen direktes Typst liefern. | Module schreiben immer Typst; Pandoc als Wandler |
| 4 | Die **Basis-Vorlage wählt das Modul** (`base: '…'`); ein Betreiber überschreibt pro Dokumentart in den Einstellungen. | Basis bei jeder Erzeugung im Dialog wählbar |
| 5 | Der `DocumentTemplate`-Vertrag wird **jetzt umgebaut**, samt der zwei vorhandenen Vorlagen — vor Stufe 3. | Erst mit der ersten Fachvorlage |
| 6 | Rechtlich fester Text (amtl. Muster Zuwendungsbestätigung) lebt in der **Modul-Vorlage**, nicht in der Basis. | Fester Text als Slot der Basis |
| 7 | Editor für Basis-Vorlagen: **Phase 2, offen.** Diese Stufe hat nur den Importer (Auflösen + Prüfen). | Editor jetzt mitbauen |

**Nicht-Ziele.** Eine Deklarationsdatei für neue Dokumentarten mit frei
definiertem Schema (Fachmodule bringen ihre Arten als Code mit); Template-Code in
der Oberfläche editieren; Dokumentarten oder Basis-Vorlagen in die DB einlesen;
Serienerzeugung; DIN-5008-Vollkonformität (die generischen Basen halten sich
daran, erzwungen wird nichts); ausfüllbare PDF-Formularfelder (bleiben in der
Pandoc-Pipeline des Vereinsrepos, Fundament §3).

## 4. Der `DocumentTemplate`-Vertrag (neu)

`packages/core/src/modules/manifest.ts`:

```ts
export type DocumentBody = { markdown: string } | { typst: string };

export interface DocumentSlots {
  /** Bestimmt, welche Felder die Basis füllt. */
  kind: 'letter' | 'report' | 'form' | 'plain';
  title?: string;
  subtitle?: string;
  /** „Ort, Datum" — Vorgabe: organization.city + ausgestellt am. */
  place?: string;
  /** Mehrzeiliges Anschriftenfeld (Brief). */
  recipient?: string;
  /** „Betreff" (Brief). */
  subject?: string;
}

export interface DocumentBuildResult {
  /** Überschreibt die Vorgabe-Basis der Vorlage; sonst gilt `DocumentTemplate.base`. */
  base?: string;
  slots: DocumentSlots;
  body: DocumentBody;
}

export interface DocumentTemplate<T = unknown> {
  key: string;
  /** Drei Großbuchstaben, z. B. BRF; Teil der Dokumentnummer. */
  prefix: string;
  schema: z.ZodType<T>;
  /** Zusätzliches Recht neben documents.create. */
  permission?: string;
  /** Vorgabe-Basis, wenn `build` keine nennt und keine Einstellung greift. */
  base: string;
  /**
   * Erzeugt Slots und Körper aus den geprüften Daten. Rein über (data, ctx):
   * keine Uhr, kein Zufall, keine I/O. Determinismus hängt daran.
   */
  build(data: T, ctx: DocumentRenderContext): DocumentBuildResult;
}
```

`DocumentRenderContext` bleibt (`number`, `issuedAt`, `organization`, `theme`,
`logo`) und bekommt die aufgelösten Basis-IDs nicht — die Pipeline wählt.

**`render()` entfällt.** Kein Modul erzeugt mehr PDF-Bytes selbst.

## 5. Markdown → Typst

Ein deterministischer Wandler, `renderMarkdownTypst(md: string): string`, im Paket
`@kompass/markdown` (das schon `remarkParse` + `remarkGfm` + `remarkDirective` +
die Kompass-Konventionen führt, bisher nur nach HTML).

- **Reiner AST-Weg in TypeScript**, kein Typst-seitiges Parsen. Ausgabe ist Typst-
  *Content-Markup*, kein Code.
- **Jeder Textknoten wird escaped**: `#`, `[`, `]`, `\`, `*`, `_`, `$`, `@`, `<`,
  `>`, `` ` ``, `~`, `/` → `\`-Sequenz. Der Schrägstrich gehört dazu, weil Typst
  sonst zwei davon als Zeilenkommentar liest und den Rest der Zeile verschluckt.
  Zusätzlich am **Zeilenanfang**: `=`, `-`, `+` und `2026.` — dort stünde sonst
  eine Überschrift oder eine Aufzählung, wo jemand einen Satz getippt hat.
  Nutzertext kann kein Typst injizieren — dieselbe Härte wie im heutigen
  Renderer-Test „treats user text as literal".
- **Blockelemente auf Typst-Standard**: Überschriften → `= … == …`, Listen →
  `- …` / `+ …` (Folgezeilen eingerückt, sonst verliert ein Unterpunkt seine
  Ebene), Tabellen → `#table(...)` mit der Kopfzeile in `table.header(...)` und
  der Spaltenausrichtung aus dem Markdown, Blockzitat → `#quote(block: true)`,
  das die Basis-Vorlage über `show quote.where(block: true)` als Hinweiskasten
  stylt, `---` → `#line(...)`.
- **Verweise** tragen dieselbe Protokoll-Erlaubnisliste wie der HTML-Weg
  (`http`, `https`, `mailto`, `tel`, dazu alles ohne Schema). Ein abgelehntes
  Schema verliert den Verweis, nicht den Text.
- **Kompass-Konventionen** aus `directives.ts` gelten weiter: `:::karten` →
  Kartenraster, Blockzitat → Hinweis. Jede `###`-Karte wird ein eigener
  Inhaltsblock `[…]` im `#grid`; Text vor der ersten Karte steht davor, statt zu
  verschwinden (der HTML-Weg wirft ihn heute weg).
- Die Basis-Vorlage sieht **nur Typst-Standardelemente** und stylt sie über
  `show heading:`, `show table.cell:`, `show list:` und die `#note`-Definition.
  Sie kennt Markdown nicht.

Determinismus: gleiche Eingabe ⇒ gleiche Zeichenkette (Test: zweimal wandeln,
`===`).

## 6. Basis-Vorlagen

### 6.1 Was eine Basis ist

Eine `.typ`-Datei, die eine Funktion mit fester Signatur exportiert:

```typst
// a4-mit-briefkopf.typ
#let base(payload, slots, body) = {
  // payload: { brand: {...}, organization: {...}, logoFile, number, issuedDate }
  // slots:   DocumentSlots (siehe §4)
  // body:    der geflossene Inhalt (aus MD→Typst oder direkt vom Modul)
  set document(date: none)            // Determinismus: keine Erstellzeit
  // … Seitenrahmen, Kopf/Fuß, Anschriftenfeld, Titelblock, Show-Rules …
  body
}
```

Die Pipeline schreibt pro Render eine winzige Einstiegsdatei ins Job-Verzeichnis:

```typst
#import "bases/a4-mit-briefkopf.typ": base
#import "body.typ": content
#let payload = json("/data.json")
#show: rest => base(payload, payload.slots, content)
```

`body.typ` enthält den MD→Typst-Inhalt bzw. das Modul-Typst.

### 6.2 Auflösung

- **Mitgeliefert**: `packages/documents/templates/bases/*.typ` — die generischen
  Basen. Env `KOMPASS_TEMPLATES_DIR` zeigt darauf (bereits gesetzt).
- **Vereinsvolume**: `KOMPASS_DOCUMENT_TEMPLATES_DIR`, im Container Vorgabe
  `/data/document-templates`. In DEV nicht gesetzt ⇒ nur die generischen.
- Beim Rendern füllt der Renderer das Job-Verzeichnis: erst die mitgelieferten
  `bases/`, dann die aus dem Volume **darüber**. Eine `a4-mit-briefkopf.typ` im
  Volume gewinnt; alles Übrige fällt auf die mitgelieferte Fassung zurück.
- Jedes Dokument hält im `inputSnapshot` fest: `base` (ID) und `baseChecksum`
  (SHA-256 der aufgelösten `.typ`). Ein späterer Render mit geänderter Basis ist
  damit erkennbar — die alte PDF bleibt die Wahrheit.

**Nachtrag 2026-09-09.** Das Volume kann neben `.typ` und `bases.json` tragen:
- `fonts/` — eigene `.ttf`/`.otf`/`.ttc`. Als zusätzlicher `--font-path`
  übergeben (`--ignore-system-fonts` bleibt). Eine Basis nutzt sie über den
  Familiennamen aus `payload.brand.font*` (Theme). `.woff2` unterstützt Typst
  hier nicht.
- `assets/` — Grafiken, die eine Basis fest einbindet. Beim Rendern nach
  `job/assets/` kopiert; die Basis referenziert sie **root-absolut**:
  `#image("/assets/<name>")`, wie `json("/data.json")`. Das Vereinslogo bleibt
  `payload.logoFile` (aus `branding.logoAssetId`).
- `baseChecksum` deckt weiterhin nur die `.typ` — eine geänderte Grafik oder
  Schrift im Volume schlägt sich nicht darin nieder. Bewusst: das Volume ist die
  Vertrauensgrenze, Änderungen daran sind Betriebssache.

### 6.3 IDs, Manifest, Label

- **ID** = Dateiname ohne `.typ`, Muster `^[a-z][a-z0-9-]{1,40}$`.
- Ein optionales `bases.json` je Verzeichnis gibt Labels und Art für die
  Oberfläche: `[{ "id": "a4-mit-briefkopf", "label": "A4 mit Briefkopf", "kind": "letter" }]`.
  Fehlt der Eintrag, ist das Label die ID.
- ID-Kollision mitgeliefert ↔ Volume: das Volume **überschreibt** (gewollt — so
  ersetzt ein Verein die generische `a4-mit-briefkopf` durch seine).

### 6.4 Der Vertrag

Wer eine Basis schreibt oder ersetzt, muss:

- die Funktion `base(payload, slots, body)` mit genau dieser Signatur exportieren,
- `set document(date: none)` setzen und **kein** `datetime.today()` verwenden —
  das Datum kommt aus `payload.issuedDate` / `slots.place`,
- nur Schriften aus `payload.brand.font*` benutzen (die Pipeline reicht die
  konfigurierten OFL-Schriften; Cambria/Calibri gibt es im Container nicht),
- die Slots ignorieren dürfen, die zu `slots.kind` nicht passen.

Ein Prüf-Render beim Import (§6.5) fängt Signatur- und Schriftfehler ab.

### 6.5 Import / Prüfung

Kein „Einlesen" mit DB-Zustand wie bei `site`. Stattdessen:

- Beim Start listet der Kern die auflösbaren Basen (mitgeliefert + Volume) und
  macht je einen **Prüf-Render** mit einem Minimal-Payload in ein Wegwerf-
  Verzeichnis. Schlägt einer fehl, erscheint die Basis in der Oberfläche als
  „fehlerhaft" mit der Typst-Ausgabe und ist nicht wählbar.
- `listDocumentBases(deps): { id, label, kind, ok, error? }[]` — reine
  Lesefunktion, im Admin unter „Dokumente" sichtbar.

### 6.6 Mitgelieferte generische Basen

- **`a4-plain`** — Titel, Untertitel, Fließtext. Kein Briefkopf, dezente
  laufende Kopfzeile (Vereinsname + Nummer) ab Seite 1, Fußzeile mit
  Vereinsstamm + „Seite X von Y". Für Berichte, Bescheinigungen, Auszüge.
- **`a4-mit-briefkopf`** — Geschäftsbrief: Seite 1 mit Logo oben rechts,
  Absenderzeile, Anschriftenfeld (Position fürs Fensterkuvert), „Ort, Datum",
  Betreff; **ab Seite 2 Fortsetzungskopf** (Vereinsname + „Seite 2"), Fußzeile
  durchgehend. Neutral gestaltet — kein „Wimpel", keine Signatur-Linie.
- **`a4-ohne-briefkopf`** — wie `a4-mit-briefkopf`, aber Seite 1 ohne Logo/Kopf
  (für Folgeblätter, Anlagen, interne Vermerke).

Alle drei auf `payload.brand.*`-Tokens; sehen mit jedem Theme stimmig aus.

## 7. `renderDocument` (neu)

`packages/core/src/documents/service.ts`:

1. `requirePermission(ctx, 'documents.create')`, ggf. `template.permission`.
2. Eingabe gegen `template.schema` prüfen.
3. Basis bestimmen: Einstellung `documents.baseFor.<key>` → sonst
   `build()`-Ergebnis `.base` → sonst `template.base`. Existiert die Basis nicht
   oder ist sie „fehlerhaft" → `conflict('documentBaseUnavailable', …)`.
4. `build(data, ctx)` → `{ slots, body }`.
5. Körper aufbereiten: `{ markdown }` → `renderMarkdownTypst`; `{ typst }` →
   unverändert (das Modul trägt die Verantwortung).
6. Nummer reservieren (`nextDocumentNumber`, Unique-Index, drei Versuche — wie
   heute).
7. `renderer.renderDocument({ base, bodyTypst, payload })` → PDF-Bytes.
   `payload` = `buildPayload(...)` erweitert um `slots` und die aufgelöste
   `logoFile`.
8. PDF über `storeMediaInternal` ablegen (Ordner `Dokumente`, analog Seed →
   `Webseite`; siehe `2026-09-08-site-seed-design.md`).
9. In einer Transaktion: Zeile in `documents` mit
   `inputSnapshot = { input, slots, base, baseChecksum }`, `recordAudit`.

`buildContext` löst zusätzlich zum aktiven Logo (`branding.logoAssetId`) das
weiche Farb-Token für die Hinweisbox auf und reicht es im Payload durch
(`brand.primarySoft`).

Determinismus-Test bleibt: zweimal `renderDocument` mit gleicher Eingabe →
gleicher Datei-Hash.

## 8. Umbau der zwei vorhandenen Vorlagen

- **`letterhead` (BRF).** Wird zu einer `build()`: Eingabe `{ title, body,
  base? }` (`body` ist jetzt **Markdown**, nicht Klartext-Absätze). `slots =
  { kind: 'letter', title, subject: title }`, `body = { markdown }`. Vorgabe-Basis
  `a4-mit-briefkopf`. Die `letterhead.typ` entfällt.
- **`audit-log-export` (PRO).** Datenlastig → `body = { typst }`. Das Modul
  erzeugt die Tabelle als Typst (die Logik aus `audit-log-export.typ` wandert in
  eine `build()` in `@kompass/documents`). `slots = { kind: 'report', title }`.
  Vorgabe-Basis `a4-plain`. Die `audit-log-export.typ` entfällt.
- `base.typ` entfällt — sein Inhalt geht in `bases/a4-plain.typ` und
  `bases/a4-mit-briefkopf.typ` auf.

## 9. Alunas Basis-Vorlagen (Vereinsrepo)

Nicht Teil dieser Umsetzung. Im Repo `Aluna Tierhilfe e.V.` entsteht ein
Verzeichnis (z. B. `Vorlagen/kompass-bases/`) mit `a4-mit-briefkopf.typ` (der
Wimpel-Briefkopf, aus `aluna-template.typ` neu geschrieben — nativ, ohne Pandoc-
Platzhalter, `payload.brand.*` statt `navy`/`gold`) und `bases.json`. Der Betrieb
kopiert es nach `/data/document-templates/`. Ein `grep` nach Aluna-Begriffen im
Produkt-Repo bleibt grün.

## 10. Betrieb, Image, Entrypoint

- **`Dockerfile`**: `ENV KOMPASS_DOCUMENT_TEMPLATES_DIR=/data/document-templates`.
  Die mitgelieferten `bases/` liegen schon unter `KOMPASS_TEMPLATES_DIR`.
- **`docker-entrypoint.sh` / ein `seed-document-templates.sh`**: legt beim ersten
  Start `/data/document-templates/` an (leer bis auf ein `README.md` und
  `bases.reference/` — Kopien der generischen Basen als Vorlage zum Abkupfern).
  **Leer ist gültig** — dann gelten alle mitgelieferten Basen. Unterschied zu
  `site`, wo das Volume nicht leer sein darf.
- **`docs/betrieb.md`**: Abschnitt „Dokument-Basisvorlagen unter
  `/data/document-templates`" mit derselben Vertrauensgrenzen-Formulierung wie
  bei `/data/site-template` — beim Rendern läuft der Code im Container.

## 11. Oberfläche

`admin/documents` bekommt oberhalb der Liste einen ausklappbaren Abschnitt
**„Basis-Vorlagen"** (`listDocumentBases`): je Basis ID, Label, Art, Status
(ok / fehlerhaft mit Meldung). Nur Anzeige — Import läuft über das Volume.

Einstellungen: ein Abschnitt „Dokumente" mit `documents.baseFor.<key>` je
registrierter Dokumentart (Auswahl aus den ok-Basen; leer = Vorgabe der Vorlage).

Der Erzeugen-Dialog bleibt wie er ist (Vorlage wählen → Formular aus dem Zod-
Schema); die Basis wird nicht dort gewählt (Entscheidung 4).

## 12. Tests

**`@kompass/markdown`:**
- `renderMarkdownTypst`: Überschriften/Listen/Tabellen/Blockzitat/Regel →
  erwartetes Typst; Sonderzeichen im Text werden escaped, auch die am
  Zeilenanfang; `:::karten` bleibt; zweimal wandeln ist identisch.
- `documents/tests/markdown-render.test.ts`: jede Markdown-Spielart einmal **echt
  bis zum PDF**. Ein Zeichenkettentest sieht nicht, ob Typst das Ergebnis
  übersetzt — `:::karten` lieferte lange gültig aussehendes, nicht übersetzbares
  Markup.

**`@kompass/documents`:**
- `bases/a4-plain` und `bases/a4-mit-briefkopf` rendern mit Minimal-Payload;
  ein Zweiseiten-Brief zeigt Seite 1 Kopf, Seite 2 Fortsetzungskopf (Text im PDF
  bzw. Seitenzahl prüfen).
- `renderer.renderDocument`: gleiche Eingabe → gleicher Hash; unbekannte Basis →
  Fehler; Nutzertext bleibt literal.
- Umgeschriebene `letterhead`- und `audit-log-export`-`build()`: Slots und Körper
  stimmen; Prefix/Recht unverändert.

**Kern (`documents.test.ts`):**
- `renderDocument` end-to-end mit der neuen Pipeline: Nummer lückenlos, PDF im
  Ordner „Dokumente", `inputSnapshot` trägt `base` + `baseChecksum`, Audit.
- `documents.baseFor.<key>` überschreibt die Vorgabe.
- Basis fehlt/fehlerhaft → `conflict('documentBaseUnavailable')`.
- `listDocumentBases`: mitgeliefert ok; eine kaputte Volume-Basis erscheint als
  „fehlerhaft".

**App:**
- `mcp-tools.test.ts`: `documents_render` unverändert erreichbar.
- e2e `documents.spec.ts`: Brief erzeugen (Markdown im Formular), PDF-Vorschau,
  Basis-Vorlagen-Abschnitt sichtbar.

**`no-association-content.test.ts`:** bleibt grün — nichts Aluna-spezifisches in
`packages/documents`.

## 13. Dateien

**Kern:**
- `packages/core/src/modules/manifest.ts` — `DocumentTemplate`-Vertrag, `DocumentSlots`, `DocumentBody`, `DocumentBuildResult`
- `packages/core/src/documents/service.ts` — `renderDocument` neu, `listDocumentBases`, Basis-Auflösung, `documents.baseFor.<key>`
- `packages/core/src/settings/core.ts` — `documents.baseFor.*` (dynamisch je Vorlage) bzw. ein `documents.bases`-Record
- `packages/core/tests/documents.test.ts`

**Dokumente-Paket:**
- `packages/documents/templates/bases/a4-plain.typ`, `a4-mit-briefkopf.typ`, `a4-ohne-briefkopf.typ` (neu)
- `packages/documents/templates/bases/bases.json` (neu)
- Entfällt: `templates/base.typ`, `templates/letterhead.typ`, `templates/audit-log-export.typ`
- `packages/documents/src/renderer.ts` — `renderDocument({ base, bodyTypst, payload })`, Volume-Overlay, Prüf-Render
- `packages/documents/src/templates.ts` — `letterhead`/`audit-log-export` als `build()`; `buildPayload` um `slots` + `primarySoft`
- `packages/documents/src/bases.ts` (neu) — Auflösung, Prüfsumme, Prüf-Render
- `packages/documents/tests/*`

**Markdown-Paket:**
- `packages/markdown/src/typst.ts` (neu) — `renderMarkdownTypst`
- `packages/markdown/src/index.ts`, Tests

**App:**
- `apps/kompass/src/app/(shell)/admin/documents/` — Abschnitt „Basis-Vorlagen"
- `apps/kompass/src/app/(shell)/admin/settings/` — Abschnitt „Dokumente"
- `apps/kompass/messages/de.json`
- `apps/kompass/e2e/documents.spec.ts`

**Betrieb:**
- `Dockerfile` — `KOMPASS_DOCUMENT_TEMPLATES_DIR`
- `scripts/seed-document-templates.sh` (neu), `scripts/docker-entrypoint.sh`
- `apps/kompass/tests/entrypoint.test.ts`
- `docs/betrieb.md` — Vertrauensgrenze `/data/document-templates`
- `AGENTS.md` — Quellenliste

## 14. Self-Review

**Platzhalter.** Keine „TBD". Der Editor (Phase 2) ist als Nicht-Ziel benannt,
nicht offengelassen.

**Konsistenz.** `base` als ID durchgängig: `DocumentTemplate.base`,
`DocumentBuildResult.base`, `documents.baseFor.<key>`, `inputSnapshot.base`,
`listDocumentBases`. Der Körper ist überall `DocumentBody` (`{markdown}` |
`{typst}`). Determinismus an drei Stellen gesichert: `build()` rein,
`renderMarkdownTypst` rein, Basis mit `set document(date: none)` + Prüfsumme.

**Zuschnitt.** Vier Blöcke: Markdown→Typst; Basis-Auflösung + generische Basen;
`renderDocument`-Umbau + zwei Vorlagen; Oberfläche + Betrieb. Der Plan schneidet
die Tasks entlang dieser Blöcke.

**Abgrenzung zur Webseite.** Bewusst *keine* DB-Spur (kein
`document_template_state`), weil es nichts Redaktionelles gibt, das man einliest —
eine Basis-Vorlage ist reiner Rahmen. Die Prüfsumme im Dokument-Snapshot ersetzt
das „Einlesen".

**Mehrdeutigkeit.** „Basis fehlt" heißt: keine `.typ` dieser ID in Volume oder
mitgeliefert. „Basis fehlerhaft" heißt: `.typ` da, aber Prüf-Render scheitert.
Beide führen zu `documentBaseUnavailable` beim Erzeugen, werden in
`listDocumentBases` aber getrennt ausgewiesen.
