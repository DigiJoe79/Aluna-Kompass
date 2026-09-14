# Aluna Kompass — Handbuch und Hilfe in der App (Design)

Stand 2026-09-14. Säule „Fundament", Querschnitt für alle Säulen. Kein
Roadmap-Schritt; Voraussetzung für das erste Release, weil ein Verein ohne
Handbuch nicht anfangen kann. Baut auf der Navigations-Spec vom selben Tag auf
(`2026-09-14-navigation-schiene-und-zweitebene-design.md`): Die Hilfe findet
ihre Seite über dieselbe Ortsbestimmung wie Schiene und Brotkrume.

**Umfang:** die Mechanik (Dateien, Route, Panel, Manifest-Haken, Palette) und
das Gerüst des Handbuchs mit allen Seiten für die heutigen Bildschirme. Die
Texte schreibt der Plan mit; Screenshots fügt Joe ein. Nicht im Umfang: eine
Übersetzung des Handbuchs, ein Editor in der App, Hilfe für Seiten, die es
noch nicht gibt.

## 1. Ausgangslage

Es gibt keine Hilfe in der App und kein Handbuch. `docs/betrieb.md` erklärt
den Betrieb auf dem NAS, `docs/briefe-formatieren.md` die Formatierungen eines
Briefs — beide liegen nur im Repo; die zweite ist zugleich Test-Fixture
(`packages/documents/tests/markdown-render.test.ts` liest den Beispielbrief
daraus). Die `README.md` verlinkt `betrieb.md`.

Wer Kompass benutzt, ist ein ehrenamtlicher Vorstand am Laptop. Er braucht
zwei Dinge: an der Stelle, an der er steht, in zwei Sätzen „Was tue ich
hier?", und ein Handbuch, das er vorher oder nachher in Ruhe liest — auch auf
GitHub, bevor er Kompass überhaupt installiert.

## 2. Entscheidungen (Brainstorming 2026-09-14)

| # | Entscheidung | Verworfen |
|---|---|---|
| 1 | **Eine Quelle.** Das Handbuch sind Markdown-Dateien in `docs/handbuch/`. Auf GitHub gelesen und in der App gerendert — derselbe Text. | Kurze Hilfetexte in der App und daneben ein Handbuch. Zwei Texte über dieselbe Seite laufen auseinander; das Handbuch wäre das erste, was veraltet. |
| 2 | **Der Kniff: Kurzabsatz zuerst.** Jede Seite beginnt mit einer Überschrift und einem Absatz, der in zwei bis vier Sätzen sagt, was man hier tut. Das Panel zeigt zuerst nur den, mit „Ganze Seite lesen". | Panel zeigt die ganze Seite (zu lang neben der Arbeit); Panel zeigt gar nichts, nur einen Link (ein Klick zu viel für zwei Sätze). |
| 3 | **Zuordnung über das Manifest**, wie die Navigation: `help: [{ href, doc }]`. Kernseiten melden ihre Hilfe im Kern der App. Längster Treffer gewinnt, dieselbe Regel wie `locate()`. | Zuordnung per Namenskonvention (`/dms/receive` → `akte/receive`): koppelt Dateinamen an Routen und zwingt deutschen Dateien englische Namen. |
| 4 | **Panel, dann Seite.** Das „?" in der Kopfleiste öffnet rechts ein Panel (Kurzabsatz); „Ganze Seite lesen" führt auf `/help/<pfad>` in der Schale mit Inhaltsverzeichnis links. Ohne Treffer zeigt das Panel das Inhaltsverzeichnis. | Nur eine Hilfeseite (kein Kontext); nur ein Panel (kein Inhaltsverzeichnis, nicht verlinkbar). |
| 5 | **Der Vertrag ist der Dateipfad.** Kein Datenbankeintrag, keine Pflege in der App. Die Dateien werden ins Image kopiert; ein Test prüft, dass jeder `doc` aus einem Manifest existiert und jede Seite im Inhaltsverzeichnis steht. | Hilfetexte in der Datenbank oder in `de.json`: dann sind sie weder auf GitHub lesbar noch mit Screenshots. |
| 6 | **Deutsch, Sie-Form, wie die Oberfläche.** Eine Sprache, keine `de/`-Ebene im Pfad. | Mehrsprachiges Handbuch: die Oberfläche hat eine Sprachdatei; ein Handbuch in Sprachen, die die App nicht spricht, wäre ein Widerspruch. |
| 7 | **Die Befehlspalette findet Hilfeseiten** als vierte Gruppe („Hilfe"), mit dem Seitentitel als Text und dem Kapitel als Hinweis. | Später — der Index steht schon, die Gruppe kostet zwanzig Zeilen. |
| 8 | **Hilfe ist für jeden Angemeldeten sichtbar**, ohne Rechteprüfung. Das Handbuch liegt ohnehin öffentlich im Repo; wer eine Seite nicht öffnen darf, darf trotzdem lesen, was sie tut. | Hilfeseiten am Recht der Seite filtern (versteckt, was ohnehin öffentlich ist, und nimmt dem Nutzer die Erklärung, warum er etwas nicht darf). |
| 9 | **`betrieb.md` und `briefe-formatieren.md` ziehen ins Handbuch** um. Der Fixture-Test folgt dem Pfad; AGENTS.md und README zeigen auf die neuen Stellen. | Doppelte Kopien (zwei Quellen). |

## 3. Das Handbuch

`docs/handbuch/`. Ein Kapitel je Bereich der Schiene, eine Seite je
Bildschirm. Dateinamen deutsch, klein, mit Bindestrich, ohne Umlaute
(`post-ablegen.md`, nicht `Post ablegen.md`), weil sie in URLs stehen.

```
docs/handbuch/
  inhalt.md                       Inhaltsverzeichnis: verschachtelte Liste mit Links, die Reihenfolge des Handbuchs
  einstieg/
    erster-start.md               Einrichtung beim ersten Aufruf, Admin, Vereinsname
    anmelden.md                   Login, Startpasswort, Passwort ändern
    oberflaeche.md                Schiene, Zweitebene, Kopfleiste, Suche ⌘K, Hilfe
  startseite.md                   Fällig, Wiedervorlagen, Einrichtung vervollständigen
  webseite/
    template-einlesen.md
    variablen.md
    sammlungen.md
    publizieren.md
    template-schreiben.md         für Template-Autoren: der Vertrag aus packages/site-template, für Menschen erklärt
  projekte.md
  tiere.md
  kontakte.md                     anlegen, Rollen über die Zeit, Aufbewahrung, Beziehungsakte
  akte/
    dokumente-und-ordner.md
    post-ablegen.md               Eingang, Ablage per Drag-and-drop, Einsortierhilfe
    brief-schreiben.md            Entwurf, Bausteine, Vorschau — nimmt docs/briefe-formatieren.md auf
    festschreiben-und-versand.md  Nummer, Storno, Versandvermerk
    bezuege-und-wiedervorlage.md
    volltext.md                   Suche, Texterkennung
  mediathek.md
  einstellungen/
    verein.md
    nutzer-und-rollen.md
    aenderungsprotokoll.md
    aufbewahrung.md
    backup.md
    sprachen.md
    themes.md
    module.md
    dokumente.md                  Basis-Vorlagen
    akte-einrichten.md            Dokumentarten, Einsortierregeln, Ordner
  profil.md                       Passwort, API-Tokens, Kompass mit einem KI-Assistenten verbinden (MCP)
  betrieb.md                      nimmt docs/betrieb.md auf
  bilder/                         Screenshots, je Kapitel ein Unterordner: bilder/akte/post-ablegen-eingang.png
```

**Form einer Seite** — verbindlich, ein Test prüft die ersten beiden Punkte:

1. Erste Zeile `# <Titel>`. Der Titel ist der Name des Bildschirms, wie er in
   der Zweitebene oder Brotkrume steht („Post ablegen", „Themes").
2. Direkt danach **ein** Absatz, der Kurzabsatz: zwei bis vier Sätze, was man
   hier tut und was dabei entsteht. Kein Bild, keine Liste, keine Überschrift
   dazwischen.
3. Danach frei: Abschnitte mit `##`, Listen, Tabellen, Bilder. Bilder als
   `![Beschreibung](../bilder/akte/post-ablegen-eingang.png)` — relativer
   Pfad, Alt-Text Pflicht.
4. Links auf andere Handbuchseiten relativ (`../kontakte.md`); der Renderer
   schreibt `.md`-Links auf `/help/…` um.
5. Sie-Form. Anführungszeichen „so“. Keine Bezeichner aus dem Code, außer wo
   sie auf dem Bildschirm stehen (ein Permission-Key steht in der
   Rechte-Matrix, also darf er hier stehen).

**`inhalt.md`** ist eine verschachtelte Markdown-Liste mit Links; die
Reihenfolge dort ist die Reihenfolge im Inhaltsverzeichnis der App. Jede
Seite außer `inhalt.md` steht genau einmal darin (Test).

## 4. Zuordnung: `help` im Manifest und im Kern

`packages/core/src/modules/manifest.ts`, neben `navigation`:

```ts
export interface HelpEntry {
  /** Routenpräfix, an der Segmentgrenze verglichen wie `locate()`. */
  href: string;
  /** Pfad der Handbuchseite ohne `.md`, relativ zu `docs/handbuch/`: 'akte/post-ablegen'. */
  doc: string;
}

export interface ModuleManifest {
  …
  /** Welche Handbuchseite zu welchen Routen des Moduls gehört. Längster `href` gewinnt. */
  help?: readonly HelpEntry[];
}
```

Die Module tragen ein:

| Modul | `help` |
|---|---|
| `site` | `/site/template` → `webseite/template-einlesen`, `/site/variables` → `webseite/variablen`, `/site/c` → `webseite/sammlungen`, `/site/publish` → `webseite/publizieren` |
| `projects` | `/projects` → `projekte` |
| `animals` | `/animals` → `tiere` |
| `contacts` | `/contacts` → `kontakte` |
| `dms` | `/dms` → `akte/dokumente-und-ordner`, `/dms/receive` → `akte/post-ablegen`, `/dms/new` → `akte/brief-schreiben`, `/admin/dms` → `einstellungen/akte-einrichten` |

Kernseiten in `apps/kompass/src/lib/help.ts` als `CORE_HELP: HelpEntry[]`:
`/` → `startseite`, `/profile` → `profil`, `/admin/media` → `mediathek`,
`/admin/settings` → `einstellungen/verein`, `/admin/users` und `/admin/roles`
→ `einstellungen/nutzer-und-rollen`, `/admin/audit` →
`einstellungen/aenderungsprotokoll`, `/admin/retention` →
`einstellungen/aufbewahrung`, `/admin/backup` → `einstellungen/backup`,
`/admin/locales` → `einstellungen/sprachen`, `/admin/themes` →
`einstellungen/themes`, `/admin/modules` → `einstellungen/module`,
`/admin/documents` → `einstellungen/dokumente`.

Die Seite für ein Dokument (`/dms/<id>`) fällt auf `/dms` zurück — das ist
die Regel „längster Treffer", kein Sonderfall. Einträge unter `/help` haben
keine Hilfe (das Panel wäre die Seite selbst).

```ts
// apps/kompass/src/lib/help.ts
export function helpEntries(manifests: readonly ModuleManifest[], enabledKeys: ReadonlySet<string>): HelpEntry[];
export function helpDocFor(entries: HelpEntry[], pathname: string): string | null;
```

`helpEntries` = `CORE_HELP` plus `help` aller **eingeschalteten** Module
(ein abgeschaltetes Modul hat keine Seiten, also keine Hilfe dazu — sein
Handbuchkapitel bleibt über das Inhaltsverzeichnis lesbar). `helpDocFor`
vergleicht wie `matches()` in `navigation.ts` (Segmentgrenze, längster
Treffer); die Funktion wird aus `navigation.ts` exportiert, nicht kopiert.

## 5. Dateien lesen: `packages/core/src/help/`

Der Kern liest das Handbuch; die App rendert es. So kann später auch MCP eine
Handbuchseite liefern („Wie lege ich Post ab?"), ohne dass die App gefragt
wird. Die **Zuordnung** Route → Seite (§ 4) bleibt dagegen in der App, wie
`CORE_ADMIN` bei der Navigation — der Kern kennt keine Routen.

```ts
// packages/core/src/help/handbook.ts
export interface HandbookPage {
  doc: string;          // 'akte/post-ablegen'
  title: string;        // aus der ersten Zeile
  lead: string;         // der Kurzabsatz, Markdown
  body: string;         // alles ab dem Kurzabsatz, Markdown (schließt lead ein)
}
export function handbookDir(env: RuntimeEnv): string;
export function readHandbookPage(env: RuntimeEnv, doc: string): HandbookPage | null;
export function readHandbookIndex(env: RuntimeEnv): string;          // inhalt.md, Markdown
export interface HandbookChapter { title: string; pages: { doc: string; title: string }[] }
export function parseHandbookIndex(markdown: string): HandbookChapter[]; // Struktur aus inhalt.md
export function readHandbookAsset(env: RuntimeEnv, rel: string): { bytes: Uint8Array; mimeType: string } | null;
export function listHandbookDocs(env: RuntimeEnv): string[];         // alle doc-Pfade außer 'inhalt'
```

- `handbookDir`: `env.handbookDir` (neu in `RuntimeEnv`, aus
  `KOMPASS_HANDBOOK_DIR`), sonst `<repo>/docs/handbuch`, aufgelöst wie
  `packages/documents` es für `KOMPASS_TEMPLATES_DIR` tut. Der Container setzt
  `KOMPASS_HANDBOOK_DIR=/app/docs/handbuch`; das `Dockerfile` kopiert
  `docs/handbuch` in den Runner wie `templates/verein-basis`.
- `doc` und `rel` werden gegen `..`, absolute Pfade und alles außerhalb des
  Verzeichnisses geprüft (`path.resolve` muss unter `handbookDir` bleiben);
  sonst `null`. Erlaubte Asset-Endungen: `png`, `jpg`, `jpeg`, `webp`, `svg`,
  `gif`; alles andere `null`.
- Synchron (`readFileSync`), wie `readSetting` — die Dateien sind klein und
  liegen im Image.
- `readHandbookPage` parst nur die Form aus § 3: Zeile 1 `# Titel`, dann
  Leerzeilen, dann der erste Absatz bis zur nächsten Leerzeile. Alles Weitere
  ist `body`.
- `parseHandbookIndex` liest die verschachtelte Liste aus `inhalt.md`: Ein
  Eintrag der obersten Ebene ist ein Kapitel (Text ohne Link, etwa
  `- Akte`, oder mit Link auf eine Seite, etwa `- [Mediathek](mediathek.md)`
  — dann ist das Kapitel zugleich seine einzige Seite); eingerückte Einträge
  sind seine Seiten, `[Titel](pfad.md)`. Daraus beziehen Brotkrume (§ 7),
  Paletten-Hinweis (§ 7) und die Markierung im Verzeichnis ihr Kapitel; die
  Seite selbst nimmt ihren Titel aus der Datei, nicht aus der Liste (Test:
  beide gleich).

## 6. Rendern: `packages/markdown`

`renderMarkdown` streicht `img` (Briefe haben keine Bilder). Das Handbuch
braucht sie. Neue Funktion, gleiche Pipeline, anderes Schema:

```ts
// packages/markdown/src/help.ts
export async function renderHandbook(markdown: string, options: { base: string }): Promise<string>;
```

- Schema: wie `schema` in `sanitize.ts`, plus `img` mit `src`, `alt`; `src`
  nur relativ (kein Protokoll), wird zu `${base}/<aufgelöster Pfad>`
  umgeschrieben (`../bilder/akte/x.png` von `akte/post-ablegen` →
  `/help-bilder/akte/x.png`). Eigener Pfad, damit er nicht mit der
  Handbuchseite `/help/[[...doc]]` konkurriert.
- Links auf `*.md` relativ → `/help/<doc>`; `#`-Anker bleiben; `http(s)`
  bleibt und bekommt `rel="noopener"`.
- **Alle Überschriften eine Stufe tiefer** (`#` → `<h2>`, `##` → `<h3>`):
  Das einzige `<h1>` der Seite bleibt die Brotkrume der Schale.
- Überschriften bekommen `id` aus dem Text (klein, Bindestrich, Umlaute zu
  ae/oe/ue/ss), damit `inhalt.md` und das Panel auf Abschnitte verlinken
  können.
- Die Kompass-Konventionen aus `directives.ts` gelten auch hier — ein Zitat
  (`> …`) wird zum Hinweiskasten, `:::karten` zum Kartenraster — dieselbe
  Schreibweise wie im Brief.

## 7. Routen und Oberfläche

**Seite** `apps/kompass/src/app/(shell)/help/[[...doc]]/page.tsx` — Server
Component in der Schale (Login nötig wie jede Schalen-Seite).

- `/help` → Inhaltsverzeichnis als Seite (`readHandbookIndex`, gerendert).
- `/help/<doc>` → zwei Spalten: links `w-60` das Inhaltsverzeichnis mit der
  aktuellen Seite markiert (`aria-current="page"`), rechts der Text in
  `max-w-[72ch]` mit `prose`-Klassen aus dem Theme (Tokens, kein Farbwert).
  Unbekannter `doc` → `notFound()`.
- Brotkrume: `Hilfe / <Kapitel> / <Titel>`; `crumbsFor` bekommt dafür einen
  Zweig: Pfade unter `/help` liefern `[t('nav.help'), …]` aus `inhalt.md`
  (Kapitel = oberster Listeneintrag, unter dem die Seite steht). Kein
  Schienen-Eintrag: `activeRailKey` liefert `null`, die Zweitebene entfällt.

**Route Handler** `apps/kompass/src/app/help-bilder/[...path]/route.ts` —
`GET`, liefert `readHandbookAsset`, `Cache-Control: private, max-age=3600`,
404 sonst. Login nötig (gleiche Prüfung wie `/media/<id>`).

**Route Handler** `apps/kompass/src/app/api/help/route.ts` — `GET
?path=<pathname>`: `{ doc, title, leadHtml, href }` für die Seite zum Pfad,
oder `{ doc: null, indexHtml }` ohne Treffer. Login nötig (gleiche Prüfung
wie `/media/<id>`; ohne Sitzung 401). Das Panel holt sich das beim Öffnen; so
bleibt `ShellFrame` frei von Handbuch-Wissen und die Hilfe folgt weichen
Navigationen ohne Neuladen des Layouts.

**Panel** `apps/kompass/src/components/shell/help-panel.tsx`:

- Trigger: Knopf in der Topbar zwischen Suche und Nutzermenü, `CircleQuestionMark`
  (`lucide-react`, vorhanden), 30 × 30, `aria-label` `shell.topbar.help`
  („Hilfe zu dieser Seite"). Tastenkürzel `?` (`e.key === '?'`), außer wenn
  der Fokus in `input`, `textarea`, `select` oder einem `contenteditable`
  liegt — der Brief-Editor ist eines.
- `Sheet` `side="right"`, `w-[400px]`, `SheetTitle` = Seitentitel. Inhalt:
  `leadHtml`, darunter ein Link „Ganze Seite lesen" auf `/help/<doc>`, der
  das Panel schließt. Ohne Treffer: „Zu dieser Seite gibt es noch keine
  Hilfe." plus das Inhaltsverzeichnis.
- Lädt beim Öffnen (`fetch('/api/help?path=…')`), zeigt derweil das Skelett-Muster
  aus der Fundament-Spec. Ein Fehler zeigt den Text `shell.help.unavailable`.

**Befehlspalette**: `buildCommandIndex` bekommt `helpPages: { doc, title,
chapter }[]` (aus `inhalt.md`, im Layout gelesen) und liefert sie als Gruppe
`help` mit `href: /help/<doc>`, `label: title`, `hint: chapter`. `CommandPalette`
rendert die vierte Gruppe (`palette.groups.help` = „Hilfe").

## 8. Umzüge

| Von | Nach | Nachziehen |
|---|---|---|
| `docs/betrieb.md` | `docs/handbuch/betrieb.md` | README (zwei Links), AGENTS.md (Befehle: „Betrieb: `docs/betrieb.md`"), `tests/german-quotes.test.ts` (`SCOPE` bekommt `docs/handbuch` statt `docs/betrieb.md`), Nordstern (Säule Betrieb: Quellen) |
| `docs/briefe-formatieren.md` | `docs/handbuch/akte/brief-schreiben.md` | `packages/documents/tests/markdown-render.test.ts` (Pfad; der `<!-- beispielbrief -->`-Block bleibt), AGENTS.md (Quellen), die Seite bekommt Kurzabsatz und Titel nach § 3, der bisherige Inhalt wird ihr Abschnitt „Formatierungen" |

## 9. Texte (`de.json`)

| Schlüssel | Text |
|---|---|
| `nav.help` | „Hilfe" |
| `shell.topbar.help` | „Hilfe zu dieser Seite" |
| `shell.help.readAll` | „Ganze Seite lesen" |
| `shell.help.none` | „Zu dieser Seite gibt es noch keine Hilfe." |
| `shell.help.unavailable` | „Die Hilfe ist gerade nicht erreichbar." |
| `palette.groups.help` | „Hilfe" |
| `help.title` | „Handbuch" |

## 10. Tests

**Kern, `packages/core/tests/handbook.test.ts`** — gegen ein Fixture-Verzeichnis
unter `packages/core/tests/fixtures/handbuch/` (drei Seiten, ein Bild, ein
`inhalt.md`), `handbookDir` über `KOMPASS_HANDBOOK_DIR` in `readEnv`:

- `readHandbookPage`: Titel und Kurzabsatz richtig getrennt; Seite ohne
  Kurzabsatz → `lead` leer; unbekannter `doc` → `null`; `../` und absoluter
  Pfad → `null`.
- `readHandbookAsset`: PNG mit MIME; `.md` als Asset → `null`; außerhalb →
  `null`.
- `listHandbookDocs` ohne `inhalt`.
- `parseHandbookIndex`: Kapitel mit Seiten; Kapitel, das zugleich Seite ist;
  Reihenfolge wie in der Datei.

**Markdown, `packages/markdown/tests/help.test.ts`**: Bild wird umgeschrieben
und behalten; `img` mit `http`-Quelle wird gestrichen; `.md`-Link →
`/help/…`; `##` bekommt `id`; `script` bleibt gestrichen.

**App, `apps/kompass/tests/help.test.ts`**:

- `helpDocFor`: längster Treffer (`/dms/receive` → `post-ablegen`, `/dms/01J`
  → `dokumente-und-ordner`); Segmentgrenze; abgeschaltetes Modul trägt nichts
  bei; `/help/…` → `null`.
- **Handbuch-Vollständigkeit** gegen das echte `docs/handbuch/`: jeder `doc`
  aus `CORE_HELP` und allen Manifesten existiert als Datei; jede Datei außer
  `inhalt.md` steht genau einmal in `inhalt.md`; jede Datei erfüllt § 3 (1)
  und (2); der Titel in `inhalt.md` ist der Titel der Datei; jedes Bild, das
  eine Seite referenziert, existiert; jeder relative `.md`-Link zeigt auf eine
  existierende Datei.
- `buildCommandIndex` liefert die Gruppe `help` mit Kapitel als Hinweis.
- `crumbsFor` unter `/help/akte/post-ablegen` → `['Hilfe', 'Akte', 'Post ablegen']`.

**E2E, `apps/kompass/e2e/help.spec.ts`**:

1. Auf `/dms/receive` öffnet `?` das Panel mit Titel „Post ablegen" und dem
   Kurzabsatz; „Ganze Seite lesen" führt auf `/help/akte/post-ablegen` mit
   Inhaltsverzeichnis links, dort ist die Seite markiert; genau ein `<h1>`
   (die Brotkrume „Post ablegen"; der Titel im Text ist ein `<h2>`, § 6).
2. Ein Bild im Text lädt (`naturalWidth > 0`) — dafür liegt ein echtes
   Bild im Handbuch (das erste Screenshot-Bild von Joe, bis dahin ein
   1-px-PNG mit Alt-Text „Platzhalter").
3. Auf `/help` steht das Inhaltsverzeichnis; ⌘K „Post ablegen" zeigt die
   Gruppe „Hilfe" und führt zur Seite.
4. Auf einer Seite ohne Hilfe (`/help` selbst) zeigt das Panel den Hinweis
   und das Inhaltsverzeichnis.
5. Im Image-Ring (`pnpm e2e:image`) laufen dieselben Tests — das beweist,
   dass `docs/handbuch` im Image liegt.

## 11. Dateien

| Datei | Änderung |
|---|---|
| `docs/handbuch/**` | neu: `inhalt.md`, alle Seiten aus § 3, `bilder/` |
| `docs/betrieb.md`, `docs/briefe-formatieren.md` | `git mv` nach § 8 |
| `packages/core/src/modules/manifest.ts` | `HelpEntry`, `ModuleManifest.help?` |
| `packages/core/src/app.ts` | `RuntimeEnv.handbookDir`, `KOMPASS_HANDBOOK_DIR` |
| `packages/core/src/help/handbook.ts`, `index.ts`-Export | neu |
| `packages/core/tests/handbook.test.ts`, `tests/fixtures/handbuch/` | neu |
| `packages/markdown/src/help.ts`, `tests/help.test.ts` | neu |
| `packages/modules/{site,projects,animals,contacts,dms}/src/manifest.ts` | `help: […]` |
| `apps/kompass/src/lib/help.ts`, `tests/help.test.ts` | neu |
| `apps/kompass/src/lib/navigation.ts` | `matches` exportieren; `crumbsFor` Zweig für `/help` |
| `apps/kompass/src/lib/command-index.ts` | Gruppe `help` |
| `apps/kompass/src/components/shell/command-palette.tsx` | vierte Gruppe |
| `apps/kompass/src/components/shell/help-panel.tsx` | neu |
| `apps/kompass/src/components/shell/topbar.tsx` | Hilfe-Knopf |
| `apps/kompass/src/components/shell/shell-frame.tsx` | `?`-Kürzel, Panel einhängen |
| `apps/kompass/src/app/(shell)/help/[[...doc]]/page.tsx` | neu |
| `apps/kompass/src/app/help-bilder/[...path]/route.ts` | neu |
| `apps/kompass/src/app/api/help/route.ts` | neu |
| `apps/kompass/src/app/(shell)/layout.tsx` | `helpPages` für die Palette |
| `apps/kompass/messages/de.json` | § 9 |
| `apps/kompass/e2e/help.spec.ts` | neu |
| `apps/kompass/tests/german-quotes.test.ts` | `SCOPE` |
| `packages/documents/tests/markdown-render.test.ts` | Fixture-Pfad |
| `Dockerfile` | `COPY docs/handbuch`, `ENV KOMPASS_HANDBOOK_DIR` |
| `README.md`, `AGENTS.md`, `docs/nordstern.md` | Pfade nach § 8; AGENTS.md-Regel: „Jede neue Seite bringt ihre Handbuchseite und ihren `help`-Eintrag mit" |

## 12. Bewusst nicht

- **Übersetzung des Handbuchs.** Kommt mit einer zweiten Oberflächensprache,
  nicht vorher.
- **Editor in der App.** Das Handbuch ist Teil der Auslieferung, wie die
  Basis-Vorlagen; wer es ändern will, ändert das Repo.
- **Hilfe je Formularfeld** (Tooltips an Feldern). Der Kurzabsatz erklärt die
  Seite; Felder erklären sich über ihre Beschriftung und `hints` in `de.json`,
  die es schon gibt.
- **MCP-Werkzeug `help_read`.** Der Kern kann es (§ 5), das Werkzeug kommt,
  wenn ein Assistent danach fragt — dann ist es eine Zeile in `core-tools.ts`.
- **Suche im Handbuch** über die Palette hinaus (Volltext). Zwölf Kapitel
  brauchen keine.

## 13. Reihenfolge der Umsetzung

Zwei Pläne, weil Mechanik und Text verschiedene Arbeit sind:

1. **Mechanik** — Kern, Renderer, Routen, Panel, Palette, Umzüge, Tests; dazu
   `inhalt.md` und **drei** fertige Seiten als Beleg (`einstieg/oberflaeche`,
   `akte/post-ablegen`, `akte/brief-schreiben`), alle übrigen Seiten als
   Gerüst mit Titel und Kurzabsatz (der Vollständigkeitstest verlangt beides).
   Die Kurzabsätze stehen **wörtlich im Plan** — sie sind das Erste, was ein
   Vorstand liest, und werden nicht vom ausführenden Agenten formuliert.
2. **Text** — jede Gerüstseite bekommt ihren Inhalt aus den Specs und der
   Oberfläche; Joe fügt Screenshots ein. Ein Commit je Kapitel.

## 14. Abnahme

- [ ] `docs/handbuch/inhalt.md` und alle Seiten aus § 3 existieren; jede beginnt mit Titel und Kurzabsatz; der Vollständigkeitstest ist grün.
- [ ] Das „?" in der Kopfleiste (und `?` als Taste) öffnet rechts das Panel mit dem Kurzabsatz der Seite, auf der man steht; „Ganze Seite lesen" führt ins Handbuch.
- [ ] `/help` zeigt das Inhaltsverzeichnis, `/help/<doc>` die Seite mit Verzeichnis links und markierter Seite; Bilder laden; Links zwischen Seiten funktionieren.
- [ ] Genau ein `<h1>` je Seite, auch im Handbuch.
- [ ] Ein Modul meldet seine Hilfe im Manifest; ein abgeschaltetes Modul trägt nichts bei; ohne Treffer zeigt das Panel das Inhaltsverzeichnis.
- [ ] ⌘K findet Handbuchseiten in der Gruppe „Hilfe".
- [ ] Die E2E laufen auch gegen das Image (`docs/handbuch` liegt darin).
- [ ] `docs/betrieb.md` und `docs/briefe-formatieren.md` sind umgezogen; README, AGENTS.md, Nordstern und der Fixture-Test zeigen auf die neuen Pfade.
- [ ] Hilfetexte stehen nur in `docs/handbuch/`; kein Hilfetext in `de.json` außer den sieben Schlüsseln aus § 9.

## 15. Self-Review

- Platzhalter: keine. Das einzige `<h1>` ist in § 6 entschieden (Renderer
  stuft herunter); § 10 (1) prüft es nur.
- Konsistenz: `doc`-Pfade in § 3, § 4 und § 13 stimmen überein
  (`akte/post-ablegen`, `akte/brief-schreiben`, `einstieg/oberflaeche`).
  `helpDocFor` benutzt `matches` aus `navigation.ts` (§ 4, § 11). Der
  Bild-Pfad `/help-bilder/…` steht in § 6, § 7 und § 11 gleich.
- Umfang: zwei Pläne (§ 13); der erste ist für sich lauffähig und abnehmbar.
- Ambiguität: „Kurzabsatz" ist in § 3 (2) definiert (erster Absatz nach der
  Überschrift, bis zur ersten Leerzeile); „längster Treffer" verweist auf die
  Navigations-Spec.
