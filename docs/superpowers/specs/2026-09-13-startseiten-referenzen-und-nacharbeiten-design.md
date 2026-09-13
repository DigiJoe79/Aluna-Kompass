# Aluna Kompass — Startseiten-Referenzen und Nacharbeiten des Cutovers (Design)

Stand 2026-09-13. Säule „Öffentlichkeit", Roadmap-Schritt 2 aus
`docs/nordstern.md`. Der Webseiten-Tag am 2026-09-13 hat neun Backlog-Punkte
hinterlassen; diese Spec nimmt die fünf, die Kompass-Code betreffen, und
entscheidet dabei die eine offene Architekturfrage: wo das Wissen liegt,
welcher Datensatz auf der Startseite steht.

Backlog-Punkte, die hier aufgehen: 10 (Medien-Upload über MCP), 14
(Hilfetext am Profil-Link), 15 (Sichten nie strenger als ihre Dienste), 16
(Bildunterschriften der Vermittlungsgeschichte), 17 (Startseiten-Hund am Tier
markieren). Punkt 11 (Sammlungseinträge über MCP) ist gestrichen: Die
Werkzeuge `site_<sammlung>_*` gibt es seit dem 2026-09-12 (`6952331`); der
Befund vom 13.09. galt einem älteren Image auf der Test-Instanz.

## 1. Ausgangslage

Alunas Template deklariert zwei Textvariablen, `featuredAnimalSlug` und
`featuredStorySlug`, mit dem Slug eines Hundes oder dem Wort `auto`. Das
Template (`src/lib/featured.ts` im Vereinsrepo) filtert selbst: die erste nur
unter Hunden, die noch ein Zuhause suchen, die zweite nur unter vermittelten
mit Geschichte; findet es den Slug nicht, greift die Automatik. Projekte
zeigt die Startseite als die ersten zwei nach Sortierung.

Drei Schwächen: Ein Tippfehler im Slug oder ein inzwischen vermittelter Hund
lässt den Abschnitt still in die Automatik fallen. Wer ein Projekt teasern
will, muss die Reihenfolge der ganzen Liste umbauen. Und die Maske zeigt ein
Textfeld, obwohl die Menge der gültigen Werte bekannt ist.

Der Backlog-Punkt 17 schlug ein Kennzeichen am Tier vor, „auf der Startseite
zeigen", gesetzt wie „Hauptfoto". Die Durchsicht am 2026-09-13 ergab: Die
Regel „genau einer je Gruppe, zwei bei Projekten" ist Layoutwissen von
Alunas Startseite. Im Kern hieße das, das Tiermodul kennt Gruppen und das
Projektmodul die Zahl zwei. Ein anderer Verein mit drei Projekten auf der
Startseite müsste den Kern ändern (Prinzip 1).

## 2. Entscheidungen

1. **Die Wahl hängt am Template, nicht am Tier.** Ein Startseitenplatz ist
   eine Template-Variable, die auf einen Datensatz einer veröffentlichten
   Sicht verweist. Gepflegt unter Webseite → Variablen, mit einer Auswahl
   statt eines Textfelds. Tiere und Projekte bekommen kein neues Feld.
2. **Leer heißt Automatik.** Ohne Wahl verhält sich das Template wie heute:
   Notfall-Hund oder zuletzt aufgenommener, jüngste Geschichte, erste zwei
   Projekte nach Sortierung. Der Block fällt nur weg, wenn auch die Automatik
   nichts findet. Das ist Verhalten des Templates; Kompass liefert `null`.
3. **Die Deklaration nennt eine einfache Bedingung** mit genau zwei
   Operatoren, Gleichheit und Vorhandensein. Sie schränkt die Auswahl in der
   Maske ein und ist zugleich die Prüfung beim Speichern und beim Export.
   Alles Weitere bleibt im Template.
4. **Ein Verweis, der nicht mehr trägt, blockiert keinen Publish.** Der
   Export schreibt `null`, vermerkt es als Befund, und die Maske zeigt es.
   Ein vermittelter Hund darf die Webseite nicht anhalten, aber er darf auch
   nicht still verschwinden.

## 3. Referenzfelder in der Deklaration

Zwei neue Helfer in `@kompass/site-template`, neben `asset` und `list`:

```ts
reference({ view, label?, where?, key?, labelField?, renamedFrom? })   // string | null
references({ view, max, label?, where?, key?, labelField?, renamedFrom? }) // string[]
```

- `view`: Name einer veröffentlichten Sicht (`animals`, `projects`,
  `organization`). Sie muss zum Kern oder zu einem Modul aus `uses` gehören.
- `key`: das Feld der Sicht, dessen Wert gespeichert und exportiert wird.
  Vorgabe `slug`. Die Sichten liefern keine `id`; das bleibt so, weil das
  Template ohnehin über den Slug navigiert.
- `labelField`: das Feld für die Anzeige in der Maske. Vorgabe `name`. Ein
  mehrsprachiger Wert wird in der Oberflächensprache gezeigt, sonst in der
  ersten gepflegten Sprache mit Inhalt.
- `where`: ein Objekt über Felder der Sicht. Ein Skalar bedeutet Gleichheit,
  `{ present: true }` bedeutet „nicht `null`". Mehrere Einträge sind ein
  Und. Beispiel: `{ status: 'adopted', story: { present: true } }`.
- `max` bei `references`: Zahl der Plätze, Pflicht. Die Liste ist geordnet;
  die Reihenfolge ist die der Plätze.

Metadaten im Template-Schema, wie bei `asset`:

```json
{ "widget": "reference", "view": "animals", "key": "slug", "labelField": "name",
  "where": { "status": "adopted", "story": { "present": true } }, "label": "…" }
```

`references` trägt `"widget": "references"` und `"maxItems"`.

`defineTemplate` prüft, was es ohne Kompass prüfen kann: `view` nicht leer,
`max` bei `references` eine positive ganze Zahl, `where` nur Skalare oder
`{ present: true }`. Ob die Sicht existiert und ob die Felder in `where`,
`key` und `labelField` in ihrem Schema stehen, prüft Kompass beim Einlesen
des Templates (§ 4.5), weil erst dort die Registry bekannt ist.

Für Aluna:

```ts
featuredAnimal: reference({ view: 'animals', where: { status: 'lookingForHome' },
  label: 'Hund auf der Startseite', renamedFrom: 'featuredAnimalSlug' }),
featuredStory: reference({ view: 'animals', where: { status: 'adopted', story: { present: true } },
  label: 'Geschichte auf der Startseite', renamedFrom: 'featuredStorySlug' }),
featuredProjects: references({ view: 'projects', max: 2, label: 'Projekte auf der Startseite' }),
```

## 4. Kompass: Schema, Maske, Dienst, Export, Resync, MCP

### 4.1 Schema-Ableitung

`schemaFor` in `packages/modules/site/src/field-schema.ts` kennt zwei neue
Widgets: `reference` ergibt `z.string().nullable().default(null)`,
`references` ergibt `z.array(z.string()).max(maxItems)`. `widgetOf` liest
das gesetzte `widget`, wie bisher. `blankValue` liefert `null` bzw. `[]`.

### 4.2 Auflösung der Sicht

Eine Funktion `resolveReferenceOptions(deps, field, uiLocale)` in einer
neuen Datei `packages/modules/site/src/reference-fields.ts` (die bestehende
`references.ts` des Site-Moduls betrifft Medienverweise und bleibt unberührt):

- findet die Sicht über `deps.registry` (Kern oder Modul aus `uses`), lädt
  sie, wendet `where` an und liefert `{ value: row[key], label }[]` in der
  Reihenfolge der Sicht.
- `checkReferenceValues(deps, template, values)` prüft jeden Referenzwert
  gegen diese Optionen und liefert `{ path, value }[]` der Werte, die nicht
  (mehr) darin stehen. Bei `references` zusätzlich: keine Doppelten.

Beide Funktionen nutzen Dienst, Export und Maske. Es gibt keine zweite
Auflösung.

### 4.3 Maske

Die Variablenseite (Server) berechnet je Referenzfeld die Optionen und
reicht sie als `options: Record<pfad, Option[]>` an `SchemaForm`. Das
Feld `reference` ist ein `<select>` mit einer leeren Option „keine Auswahl,
das Template entscheidet" und den Optionen mit Beschriftung. `references`
zeigt `maxItems` solcher Auswahlen untereinander, nummeriert als Plätze.

Steht der gespeicherte Wert nicht in den Optionen, zeigt das Feld ihn als
Warnung („`chiara` erfüllt die Bedingung nicht mehr") mit einem Knopf
„leeren". Die Auswahl selbst bietet ihn nicht an.

### 4.4 Dienst

`setValues` prüft nach `validate` zusätzlich `checkReferenceValues` und gibt
`validation` mit `referenceNotFound` je Pfad zurück. Damit gilt die Prüfung
für Maske und `site_variables_set` gleichermaßen (Prinzip 8). Ein Wert, der
beim Speichern nicht trägt, wird nicht gespeichert; einer, der später nicht
mehr trägt (Hund vermittelt), bleibt stehen und wird zum Befund.

### 4.5 Einlesen des Templates

`readActiveTemplate` / der Template-Sync prüft je Referenzfeld gegen die
Registry: Die Sicht muss existieren und zum Kern oder einem Modul aus `uses`
gehören (`conflict('unknownView')`); `key`, `labelField` und jedes Feld in
`where` müssen im Zod-Schema der Sicht stehen (`conflict('unknownViewField')`).
Ob das Modul aktiv ist, prüft weiter der Export, wie bei `uses` heute.

### 4.6 Export

`exportSiteContent` ruft `checkReferenceValues` und schreibt für jeden
Treffer `null` (bei `references`: lässt den Wert weg und rückt auf).
`ExportChecks` bekommt neben `gaps` und `violations` ein drittes Feld
`stale: { path, value }[]`. Die Befundkarte unter Webseite → Publish zeigt
es als Warnung, nicht als Sperre. Der Job-Lauf protokolliert es.

### 4.7 Resync

Der Typwechsel `text → reference` gilt in der `LOSSLESS`-Matrix als
verlustfrei: Ein Slug ist ein gültiger Referenzwert. `auto` oder ein Slug,
der die Bedingung nicht erfüllt, bleibt nach dem Resync stehen und
erscheint als Befund in Maske und Export, bis jemand ihn leert. Der Resync
selbst rechnet nichts um.

### 4.8 MCP

Kein neues Werkzeug: `site_variables_get` liefert die Werte, `site_variables_set`
prüft sie über denselben Dienst. Damit ein Agent wählen kann, ohne die
Sichten selbst zu filtern, liefert `site_variables_get` je Referenzfeld
zusätzlich die aktuellen Optionen unter `references: Record<pfad, Option[]>`.
Das ist derselbe `resolveReferenceOptions`-Aufruf wie in der Maske.

## 5. Aluna-Template (Vereinsrepo)

Eigener Schritt, nach dem Kompass-Teil:

- Deklaration wie in § 3; `featuredAnimalSlug` und `featuredStorySlug` per
  `renamedFrom` übernommen.
- `featured.ts`: `featuredAnimal` und `featuredStory` lesen den Referenzwert
  statt des Slugs; `auto` entfällt, `null` heißt Automatik. Neu
  `featuredProjects`: die gewählten Slugs in Reihenfolge, aufgefüllt aus der
  Sortierung bis zwei.
- Tests des Templates ziehen nach; das Fixture bekommt die drei Variablen
  belegt und einmal leer.
- Der Resync auf der Test-Instanz zeigt zwei Umbenennungen und den
  Typwechsel; `auto` erscheint danach als Befund und wird geleert.

Das Basis-Template `templates/verein-basis` nutzt keine Sichten und bekommt
kein Beispiel; die Site-Template-Spec (§ 2, Feldhelfer) nennt die beiden
Helfer.

## 6. Sichten nie strenger als ihre Dienste (Punkt 15)

Am 2026-09-13 verlangte die Tiersicht `traits` in `de` und `en`, während der
Dienst ein Teil-Record annahm; eine MCP-Anlage brach damit jeden Export
(`686c843`). Die Regel: Was ein Dienst annimmt, muss jede Sicht ohne
Exception liefern.

- Helfer `loadAllViews(deps, manifest)` in `@kompass/core/testing`: lädt jede
  Sicht des Manifests; bei einer Zod-Exception wirft er mit Sichtname und
  Pfad des Feldes, damit der Test den Fehler benennt.
- Je Modul mit Sicht ein Test `tests/views-hold.test.ts`: einen Datensatz
  mit nur den Pflichtfeldern über den Dienst anlegen, veröffentlichen, dann
  `loadAllViews`. Tiere zusätzlich mit einer Geschichte, deren optionale
  Felder leer sind. Projekte mit leeren Verweisen und ohne Bild.
- Der Kern prüft `organization` gegen frische Einstellungen ohne einen
  einzigen gesetzten Wert.
- AGENTS.md, Testregeln: „Ein Modul mit veröffentlichter Sicht hat einen
  Test, der einen minimalen Datensatz anlegt und alle Sichten lädt."

Kein Meta-Test, der die Existenz dieser Tests erzwingt; die Regel steht in
AGENTS.md, die Review liest sie.

## 7. Medien-Upload über MCP (Punkt 10)

Zwei Werkzeuge in `packages/mcp/src/core-tools.ts`:

- `media_upload`: `{ filename, contentBase64, folder? }`. Dekodiert, ruft
  `storeMediaAsset`; die Grenze bleibt `MEDIA_MAX_BYTES` des Dienstes (zehn
  Megabyte, dekodiert). Beschreibung nennt `media.upload`. Antwort ist der
  Datensatz. Bei einem Dedup-Treffer ist es der vorhandene, mit dessen
  Dateiname und Ordner; die Werkzeugbeschreibung sagt das, damit ein Agent
  nicht rätselt, warum die Antwort nicht seine Angaben trägt. Der Dienst
  bleibt, wie er ist, und bekommt kein Kennzeichen.
- `media_list`: `{ folder? }`, ruft `listMediaAssets`, das ebenfalls
  `media.upload` verlangt. Damit findet ein Agent, was schon da ist, bevor er
  es ein zweites Mal hochlädt.

Base64 bläht zehn Megabyte auf gut dreizehn; das ist für ein Foto im
JSON-RPC vertretbar und die Grenze des Dienstes gilt weiter. Größere Dateien
gehen über die Oberfläche. Ungültiges Base64 ist `validation`
(`invalidBase64`). Tests in `packages/mcp/tests`: Upload eines PNG, Dedup,
Größengrenze, Base64-Fehler, `forbidden`, Audit über den Dienst. Kein Seed:
Fotos seedet das Tiermodul.

## 8. Bildunterschriften und Hilfetext (Punkte 16 und 14)

**Bildunterschriften.** `animal_stories` bekommt `before_caption` und
`after_caption` als `localizedColumn`, Vorgabe leer. Migration unter
`packages/core/src/db/migrations` per `db:generate`. `animalStorySchema`
nimmt beide als `localizedText({ max: 200 })`, optional mit Vorgabe leer,
damit `animals_set_story` ohne sie weiter funktioniert. Die Geschichte-Maske
zeigt zwei `LocalizedField` unter den beiden Bildern. Die Sicht liefert sie
in `story`. Seed: eine Geschichte mit Unterschriften, eine ohne. Das
Aluna-Template zeigt den Text unter dem jeweiligen Bild und lässt bei leerem
Wert die Ortsangabe ganz weg, keine festen Texte mehr (Vereinsrepo, im
Schritt aus § 5).

**Hilfetext.** Unter dem Feld „Externes Profil (URL)" in `animal-form.tsx`
ein Beschreibungstext aus `messages/de.json`: Trägt ein Hund den Link,
laufen Anfragen auf der Webseite über den Partner statt per E-Mail an den
Verein. Kein Code sonst.

## 9. Tests

- `packages/site-template/tests/define.test.ts`: Helfer erzeugen die
  Metadaten aus § 3; ungültiges `where`, fehlendes `max`, leeres `view`
  werfen.
- `packages/modules/site/tests`: `schemaFor` für beide Widgets;
  `resolveReferenceOptions` mit `where`-Gleichheit, Vorhandensein,
  mehrsprachiger Beschriftung; `checkReferenceValues` mit gültigem, fremdem
  und doppeltem Wert; `setValues` lehnt fremde Werte ab und protokolliert;
  Einlesen lehnt unbekannte Sicht und unbekanntes Feld ab; Export schreibt
  `null` und meldet `stale`; Resync stuft `text → reference` als verlustfrei
  ein; `site_variables_get` liefert `references`.
- Oberfläche: Playwright, Variablenseite mit einem Referenzfeld, Auswahl
  speichern, veralteten Wert sehen und leeren. Fixture-Template der E2E
  erhält ein Referenzfeld auf `animals`.
- § 6 bis § 8 wie dort beschrieben; jeder Dienst mit Erfolg, `forbidden`,
  `validation`, Audit.

## 10. Reihenfolge der Pläne

1. **Leitplanke**: § 6, Sichten nie strenger als Dienste. Klein, zuerst,
   weil alles Folgende Sichten anfasst.
2. **Tiermaske**: § 8, Bildunterschriften und Hilfetext. Schema, Dienst,
   Maske, Sicht, Seed.
3. **MCP-Medien**: § 7.
4. **Referenzfelder**: § 3 und § 4, der größte Block.
5. **Vereinsrepo**: § 5 und der Template-Teil von § 8. Danach Resync und
   Prüfung auf der Test-Instanz.

Nach 1 bis 4 verschwinden die Backlog-Punkte 10, 14, 15, 16 und 17; 11 sofort.
Der Nordstern nennt unter Schritt 2 die Referenzfelder als erledigt, wenn 5
durch ist.

## 11. Nicht-Ziele

- Keine Bedingungen jenseits von Gleichheit und Vorhandensein, kein
  Oder, keine Vergleiche. Was das Template darüber hinaus filtert, filtert
  es selbst.
- Kein Kennzeichen an Tieren oder Projekten. Wer später „auf der Startseite"
  in der Tiermaske sehen will, liest die Referenzwerte des Site-Moduls dort
  aus; er speichert sie nicht doppelt (Prinzip 5).
- Keine Referenzen in Sammlungsfeldern. Erst wenn ein Template das braucht,
  mit derselben Auflösung.
- Kein `media_delete` über MCP: Löschen bestätigt ein Mensch, wie bei den
  anderen Löschfunktionen.
