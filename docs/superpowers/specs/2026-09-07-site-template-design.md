# Aluna Kompass — Stufe 3 „Webseiten-Templates" (Design)

Stand 2026-09-07. Löst das Webseiten-Modul aus Stufe 2 ab. Grundlage sind zwei
Feldstudien vom selben Tag, deren Ergebnisse in Abschnitt 4 und 5 stehen.

## 1. Ziel, Zuschnitt, Nicht-Ziele

**Ziel.** Kompass verwaltet Webseiten-Inhalte, ohne die Webseite zu kennen. Ein
Verein bringt sein eigenes Astro-Template mit und entscheidet darin, was fest
verdrahtet ist und was Kompass verwalten soll. Was er verwalten lassen will,
deklariert er; daraus erzeugt Kompass Masken, Validierung, veröffentlichte
Sichten und MCP-Werkzeuge. Mit dem Image kommt ein allgemeines Vereins-Template,
das sofort läuft und als Vorlage dient. Alunas Seite wird eines von vielen
möglichen Templates und verlässt dieses Repo.

**Warum jetzt.** Das Modul `website` aus Stufe 2 ist ein 1:1-Abbild von Alunas
Seite: `shelterDogCount`, `section11Status`, `forwardingPercent` mit dem Default
97.2, zwölf feste Seitenschlüssel samt `sponsor` und `adoption-process`, vier
feste Download-Plätze. Ein Verein ohne Tierschutz bekommt heute „Hunde im
Shelter" und „§ 11 TSchG" in seiner Konfigurationsmaske. Die Spec zu Stufe 2 hat
genau das ausgeschlossen (Entscheidung 2 vom 2026-09-05: „Das Webseiten-Modul
selbst bleibt generisch"); beim Bauen ist die Grenze gerissen. Nach dem Go-live
wäre die Korrektur eine Migration produktiver Inhalte, deshalb vorher.

**Entscheidungen aus dem Brainstorming (2026-09-07):**

| # | Entscheidung | Verworfen |
|---|---|---|
| 1 | Das Template deklariert, was Kompass verwaltet. Struktur, Routen, Layout und alles Feste bleiben Astro-Code im Template. | Generischer Seitenbaukasten; freie Variablen als `(id, name, value)` in der Datenbank |
| 2 | Zweiteilung: **Variablen** (einmalige Werte, eine Konfigurationsmaske) und **Sammlungen** (n Datensätze, eigene Listenpflege). Fachmodule steuern Sammlungen über `publishedViews` bei. | Nur Variablen; nur Sammlungen |
| 3 | Templates liegen unter `/data/site-template`, wie `site.pw`. Kein Upload über die Oberfläche. | Upload eines Archivs; Git-Klon; eigenes Image je Verein |
| 4 | Sprachen sind verwaltete Stammdaten des Vereins; das Template **fordert** nur, was es rendert. `localizedText` im Kern wird zu einer Menge. | `{de, en}` bleibt fest; Template legt Sprachen an |
| 5 | Der Cutover wartet auf diese Stufe; Aluna geht direkt auf `site` live. | Cutover mit `website`, Migration danach |
| 6 | `site` löst `website` ab und ersetzt es; kein Nebeneinander. | Parallelbetrieb beider Module |
| 7 | Der Verein ist Template-Autor. Wer die Struktur ändern will, schreibt Astro. | Kompass als Website-Baukasten für Laien |

**Nicht-Ziele.** Upload von Templates über die Oberfläche; Seiten- oder
Baustein-Baukasten für Laien; Theme- oder Designsystem für Templates;
maschinelle Übersetzung; Parallelbetrieb von `website` und `site`; Sandbox für
den Template-Build.

**Zerlegung.** Die Stufe ist zu gross für einen Plan. Vorschlag für fünf:
(1) Sprachen im Kern, (2) Template-Vertrag mit Datenmodell und Einlesen samt
Resync, (3) Oberfläche, MCP und Export, (4) Basis-Template und Erstinbetriebnahme, (5) Cutover: Publish-Kette, Alunas
Migration und die Ablösung von `website`.
Nur (1) berührt den Kern und lässt sich unabhängig abschliessen; nur (5) wartet
auf Voraussetzungen ausserhalb dieses Repos.

## 2. Der Template-Vertrag

Ein Template ist ein Astro-Projekt mit einer zusätzlichen Datei:

```ts
// kompass.template.ts
import { defineTemplate, text, markdown, number, asset, select } from '@kompass/site-template';

export default defineTemplate({
  name: 'Aluna Tierhilfe',
  locales: ['de', 'en'],

  variables: {
    claim: text({ max: 120, localized: true, label: 'Claim' }),
    forwardingPercent: number({ min: 0, max: 100, label: 'Weiterleitungsquote (%)' }),
  },

  collections: {
    articles: {
      label: 'Artikel', slug: true,
      fields: { title: text({ localized: true }), body: markdown({ localized: true }) },
    },
    team: {
      label: 'Team', sortable: true,
      fields: { name: text(), position: text({ localized: true }), photo: asset() },
    },
  },

  uses: ['animals'],
});
```

Die Helfer (`text`, `markdown`, `number`, `asset`, `select`, `list`) erzeugen
Zod-Schemata mit `.meta({ widget, label, … })`. Zod ist damit die einzige
Sprache für Validierung, Maskenerzeugung, veröffentlichte Sichten und
MCP-Schemata — dieselbe, die der Kern schon benutzt.

`uses` zieht veröffentlichte Sichten aktivierter Fachmodule dazu. Ist ein dort
genanntes Modul abgeschaltet, meldet das der Publish, statt stumm eine leere
Seite zu bauen.

**Merkmale einer Sammlung** neben ihren Feldern, alle mit Vorgabe `false`:
`slug` gibt jedem Eintrag einen eindeutigen URL-Teil, `sortable` eine vom
Verein bestimmte Reihenfolge, `publishable` den Schalter „veröffentlicht", mit
dem ein Eintrag gepflegt, aber noch nicht ausgeliefert wird. Ohne `publishable`
ist jeder Eintrag sofort öffentlich; die veröffentlichte Sicht filtert dann
nicht. `max` begrenzt die Zahl der Einträge.

Was **nicht** im Vertrag steht, ist Absicht: Seitenstruktur, Routen, Layout,
URL-Pfade je Sprache und alle festen Texte. Aluna verdrahtet den grössten Teil
seiner heutigen Site-Fakten fest; nur was wirklich wechselt, wird Variable.

## 3. Datenmodell

| Tabelle | Inhalt |
|---|---|
| `siteValues` | `key`, `value` (JSON) — die Variablen |
| `siteEntries` | `collection`, `id` (ULID), `slug`, `sortOrder`, `data` (JSON), `isPublished` |
| `siteTemplate` | zuletzt eingelesenes Schema als JSON, Prüfsumme, Zeitpunkt, einlesender Nutzer |

Werte liegen als JSON in einer Spalte, nicht als Key-Value-Zeilen: Ein Datensatz
bleibt ein Datensatz, und die Prüfung läuft beim Schreiben gegen das
Template-Schema — dieselbe Zod-Prüfung, aus der die Maske entstanden ist.

`siteTemplate` ist die Vergleichsgrundlage des Resync und zugleich die
Sicherung beim Publish (Abschnitt 5).

## 4. Masken aus dem Schema

Belegt durch die erste Feldstudie (2026-09-07): Ein Renderer von 195 Zeilen
erzeugt aus `z.toJSONSchema(schema, { io: 'input' })` vollständige Masken —
mehrsprachige Textfelder mit Fehlt-Markierung, Markdown mit Vorschau und
Sprachumschalter, Bildauswahl, Datum, Aufzählung, Stringliste sowie
verschachtelte Objektlisten mit Hinzufügen, Sortieren, Löschen und sichtbarer
Obergrenze aus `.max()`.

Tragend ist, dass `.meta()` bis ins JSON-Schema durchschlägt: Grenzen,
Aufzählungen und Formate kommen aus Zod, die Widget-Wahl aus der Annotation. Der
Renderer errät nichts.

Offen aus der Studie und in dieser Stufe zu bauen: Validierungsfehler aus
`safeParse` an die richtigen Felder zurückspielen; ab vier Sprachen Reiter statt
Spalten; das Schema serverseitig zu reinem JSON machen, bevor es an die
Client-Komponente geht.

## 5. Resync

Belegt durch die zweite Feldstudie: 129 Zeilen erzeugen aus altem Schema, neuem
Schema und den vorhandenen Daten eine Liste von Befunden — neu, entfällt,
umbenannt, Typwechsel, Grenze überschritten, Aufzählungswert entfallen. Jeder
Befund trägt, wie oft er tatsächlich gefüllte Daten trifft; Befunde ohne Inhalt
laufen ohne Rückfrage durch.

**Sprachen sind hier kein Befund.** Die Studie kannte noch einen Fall „Sprache
weg"; seit Sprachen Stammdaten sind (Abschnitt 6), kann ein Template-Wechsel
keine entfernen. Fordert ein Template eine Sprache, die es nicht gibt, bricht das
Einlesen ab; fordert es weniger, als der Verein pflegt, bleibt der Rest
unangetastet und wird nur nicht ausgeliefert. Text aus einer Sprache verschwindet
ausschliesslich über `removeLocale` im Kern, mit eigener Vorschau.

Die Befunde reichen in Sammlungen hinein: Entfällt `metrics[].suffix` oder
wechselt seinen Typ, zählt der Plan, in wie vielen der vorhandenen Einträge dort
tatsächlich etwas steht — nicht, wie viele Einträge es gibt.

**Ablauf.** Knopf „Template einlesen" → Datei laden → Deklaration prüfen →
Befunde gegen die vorhandenen Daten erzeugen → Anzeige, verlustbehaftete Befunde
hervorgehoben → Bestätigung → Anwendung in einer Transaktion → Eintrag im
Änderungsprotokoll mit dem vollständigen Plan.

**Entscheidungen je Fall:**

- **Umbenennung** deklariert das Template (`renamedFrom: 'subtitle'`). Ohne die
  Angabe ist eine Umbenennung ein Löschen plus ein Anlegen — das muss in der
  Template-Dokumentation deutlich stehen.
- **Verschärfte Grenze** blockiert das Anwenden. Kompass entscheidet nicht,
  welcher von drei Einträgen verschwindet; der Verein räumt erst auf.
- **Typwechsel** haben eine Tabelle verlustfreier Umformungen: Text → Liste wird
  einelementig, Zahl → Text wird zur Zeichenkette, Aufzählung → Text behält den
  Wert. Alles andere gilt als Verlust und wird als solcher angezeigt.
- **Entfallener Aufzählungswert** nennt den Ersatz vorab: den ersten Wert der
  neuen Aufzählung.

**Zwei Sicherungen.** Ein Template, das sich nicht laden lässt oder dessen
Deklaration ungültig ist, ändert nichts — der Abbruch kommt vor dem ersten
Schreibvorgang. Und der Publish vergleicht die Prüfsumme der Datei im Volume mit
dem eingelesenen Stand; weichen sie ab, verweigert er mit dem Hinweis, erst neu
einzulesen. Sonst baut Astro gegen Felder, die Kompass nicht kennt.

## 6. Sprachen

Sprachen sind **Stammdaten des Vereins**, verwaltet in Kompass wie Rollen:
anlegen, umsortieren, entfernen. Die erste ist Leitsprache — Pflichtfeld,
Rückfallebene und Bezugspunkt des Übersetzungsabgleichs. Vorgabe einer neuen
Installation ist eine Sprache, gewählt bei der Einrichtung.

Das Template **fordert** Sprachen, es legt keine an: `locales: ['de','en']`
heisst „ich rendere diese". Das Einlesen prüft, ob sie existieren, und bricht
sonst mit einer Meldung ab. Pflegt der Verein mehr Sprachen, als das Template
fordert, ist das kein Fehler — die überzähligen werden nicht ausgeliefert.

Der Grund für diese Richtung: Andernfalls wäre ein Template-Update mit
`locales: ['de']` ein globaler Löschbefehl, der die englischen Texte aller
Module verwirft — auch die der Tierprofile — als Nebenwirkung einer Änderung,
die jemand zum Aufräumen gemacht hat. Eine Sprache zu entfernen ist deshalb eine
eigene Handlung mit eigener Vorschau: Sie zeigt modulübergreifend, wie viele
Felder Inhalt in dieser Sprache tragen, und verlangt eine Bestätigung.

**Wie die Schemata an die Sprachen kommen.** Service-Schemata sind
Modulkonstanten, die beim Import entstehen; die Sprachen stehen in der
Datenbank. `localizedText()` erzeugt deshalb ein Record-Schema, das beliebige
Sprachschlüssel annimmt, trimmt und auf Länge prüft, und markiert sich mit
`.meta({ localized: true })`. Die Prüfung „Leitsprache gefüllt, keine fremden
Schlüssel" läuft zentral in `validate(deps, schema, input)`, das die Liste aus
`deps.locales` nimmt — dieselbe Stelle, an der heute schon jede Eingabe geprüft
wird, und dasselbe Muster wie `deps.registry`.

Verworfen: Schemata als Fabriken (`animalCreateSchema(locales)`) — fasst jeden
Service und jede Aufrufstelle an. Prozessweite Sprachliste — globaler Zustand,
Sprachwechsel bräuchte einen Neustart. Filtern im Drizzle-Spaltentyp — der kennt
`deps` nicht.

Bestandsdaten bleiben unangetastet: Ein gespeichertes `{"de":"…","en":"…"}` ist
gültig, sobald die Liste `['de','en']` lautet. Es wird Code generisch, keine
Daten umgeschrieben.

Betroffen sind `localizedText`, `resolveText`, `translationGaps`, `validate` und
seine rund vierzig Aufrufstellen, jede Maske mit `LocalizedField`, die
Lückenzähler und die Formularhelfer — auch die des Tiermoduls.

## 7. Oberfläche und MCP

Aus jeder Sammlung entsteht ein Navigationseintrag mit Liste und Bearbeitungs-
maske, aus den Variablen eine Konfigurationsseite. Beides erzeugt, nicht
geschrieben.

Dasselbe gilt für die MCP-Werkzeuge, sonst wäre Prinzip 8 für alles, was ein
Template mitbringt, nur auf dem Papier erfüllt. Je Sammlung entstehen
`site_<name>_list`, `_get`, `_create`, `_update`, `_delete` und, wo
`publishable` gesetzt ist, `_set_published`; dazu `site_variables_get` und
`site_variables_set` sowie `site_template_read`, das die aktive Deklaration
ausgibt, damit ein Client die Feldstruktur kennt, ohne das Volume zu lesen. Die
`inputSchema` sind die Schemata des Templates — genau die, aus denen auch die
Masken entstehen.

Die Sprachverwaltung gehört zum Kern und bekommt dort ihre Werkzeuge —
`locales_list`, `locales_add`, `locales_remove`, `locales_reorder` unter
`settings.manage`.

Die Permission-Keys des Moduls bleiben statisch: `site.view`, `site.manage`,
`site.publish`.
Damit greift die Prüfung aus `apps/kompass/tests/mcp-tools.test.ts` unverändert.
Sie braucht allerdings eine Ergänzung, weil die Werkzeugliste dieses Moduls erst
zur Laufzeit aus dem eingelesenen Template entsteht: Ohne Template ist sie leer,
und die Prüfung muss das als gültigen Zustand kennen, statt es als Lücke zu
melden.

## 8. Export, Build, Publish

Der Export erzeugt `content.json` nach der Form des Templates:

```json
{ "variables": { … }, "collections": { "articles": [ … ] },
  "views": { "animals": [ … ] }, "assets": [ … ] }
```

Das Template liest es und leitet seine Typen aus der eigenen Deklaration ab
(`loadContent<typeof template>()`). Ein Tippfehler bricht damit den Build des
Templates, bevor etwas publiziert wird — die Kopplung bleibt sichtbar und lokal.

Pipeline und Oberfläche darüber bleiben, wie sie sind: Bildvarianten,
Astro-Build, Prüfsummen, Diff gegen den letzten Publish, rsync, Historie,
Vorschau, Verbindungstest. Sie kennen keine Feldnamen. `SITE_DIR` zeigt künftig
auf `/data/site-template`. Sperrwortprüfung und Übersetzungsabgleich laufen
generisch über alle Textfelder aller deklarierten Sprachen.

**Modulauflösung.** Das Template im Volume braucht `astro` für den Build und
`@kompass/site-template` schon beim Lesen seiner Deklaration; beide liegen im
Image unter `/app/node_modules`. Node löst Bare-Specifier vom Speicherort der
Datei aus auf und findet dort nichts — am 2026-09-07 beim Umsetzen verifiziert:
`Cannot find package '@kompass/site-template' imported from …`.

Ein Symlink `<template>/node_modules` → `/app/node_modules` löst beides. Er wird
**beim Einrichten angelegt, nicht beim Lesen**: Der Start stellt ihn her, und in
Tests tut es der Testaufbau. `loadTemplate` bleibt lesend — es wird auch von der
Publish-Sicherung aufgerufen, die nur eine Prüfsumme vergleicht, und ein
Lesevorgang, der die Platte verändert, wäre eine Falle. Fehlt die Auflösung,
meldet der Loader das als eigenen Fehler statt als unverständlichen Importfehler.

Damit hat ein Template zunächst keine eigenen Abhängigkeiten. Wer sein Template
lokal entwickelt, installiert `@kompass/site-template` als Entwicklungsabhängigkeit
und bekommt so Typprüfung und Vervollständigung.

Verworfen: die Deklaration als reine Daten statt als Modul zu lesen, was den
Import erübrigt hätte. Der Astro-Build braucht die Auflösung ohnehin, also
verschöbe es das Problem nur — und kostete die Typhilfe beim Schreiben eines
Templates.

## 9. Auslieferung und Betrieb

`templates/verein-basis/` liegt im Repo und im Image unter
`/app/templates/verein-basis`. Findet der Container beim Start ein leeres
`/data/site-template`, kopiert er es dorthin: Ein neuer Verein hat sofort eine
laufende Seite und zugleich die Referenz, wie ein Template aussieht.

Das Basis-Template deckt die üblichen Vereinsseiten ab — Start, Über uns, Team,
Aktuelles, FAQ, Spenden, Mitglied werden, Kontakt, Impressum, Datenschutz,
Satzung — und ist ausdrücklich kein blasses Aluna.

`apps/site` verlässt dieses Repo und wird Alunas Template im Vereins-Repo. Damit
kann Alunas Seite nicht mehr versehentlich im Image landen — heute kopiert das
Dockerfile sie vollständig hinein.

Die Betriebsdoku hält fest, dass `/data/site-template` eine Vertrauensgrenze
ist: Was dort liegt, läuft beim Build als Code im Container, mit Zugriff auf
`/data`. Wer dort schreiben darf, darf alles.

## 10. Migration und Ablösung

Ein einmaliges Skript überführt Alunas Bestand — zwölf Seiten, Artikel, Team,
FAQ, Downloads, Projekte — in `siteValues` und `siteEntries`. Es läuft vor dem
Go-live gegen Testdaten und ist danach löschbar. Die Seitentexte, die heute in
der Datenbank liegen, wandern grösstenteils fest ins Template; nur was wechselt,
wird Variable.

Danach entfällt `packages/modules/website` samt seinen Migrationen, Masken und
MCP-Werkzeugen. Die Tabellen bleiben bis zum erfolgreichen Umzug bestehen und
werden in einer eigenen Migration entfernt.

## 11. Offene Punkte für spätere Stufen

- Upload von Templates über die Oberfläche, mit der Frage, wer das darf und was
  ein übernommenes Konto damit anrichten kann.
- Eigene Abhängigkeiten je Template, falls der Symlink-Weg aus Abschnitt 8 nicht
  trägt.
- Mehrere Templates nebeneinander (Vorschau eines neuen, bevor es aktiv wird).
- Maschinelle Übersetzungsvorschläge, unverändert aus Stufe 2 zurückgestellt.
