# Aluna Kompass — Übersetzungen über MCP (Design)

Stand 2026-09-13. Säule „Öffentlichkeit", Roadmap-Schritt 2 aus
`docs/nordstern.md`. Ein MCP-Client soll alle fehlenden Übersetzungen der
Webseiteninhalte in einem Aufruf abholen und die abgestimmten Texte in einem
zweiten zurückschreiben, ohne andere Sprachen anzufassen.

Der Nutzen landet in der Öffentlichkeit, weil heute nur Webseiteninhalte
mehrsprachig sind. Der Mechanismus — Kernservice, Manifest-Haken,
MCP-Werkzeuge — gehört zum Fundament, wie Wiedervorlagen oder Aufbewahrung,
und steht jedem künftigen Modul mit mehrsprachigen Feldern offen.

## 1. Ausgangslage

Mehrsprachige Felder liegen als Map je Sprachschlüssel vor
(`{ "de": "…", "en": "" }`), die eingerichteten Sprachen stehen in der
Einstellung `i18n.locales`, die erste ist Leitsprache. Die Kernfunktion
`translationGaps` in `packages/core/src/i18n/localized.ts` erkennt eine Lücke:
Leitsprache gefüllt, eine weitere Sprache leer. Sie speist bisher nur den
Lückenzähler in den Masken.

Über MCP gibt es heute zwei Wege zu den Lücken, beide mit Haken:

- `site_export_check` meldet Lücken als Pfad plus Sprache, etwa
  `views.animals[3].summary`. Sammlungseinträge tragen im Export keine ID,
  Unveröffentlichtes fehlt (Prinzip 4), und das Werkzeug verlangt
  `site.publish`, obwohl es nur liest.
- Ein Client kann alle Listen-Werkzeuge abfragen und die Lücken selbst suchen.
  Das sind viele Aufrufe und Rechenarbeit auf Client-Seite.

Beim Schreiben ersetzen alle Update-Services ein mehrsprachiges Feld als
Ganzes. Wer nur `{ "en": "…" }` schickt, löscht damit den deutschen Text. Ein
Client muss erst lesen, dann die vollständige Map zurückschreiben.

Der gewünschte Ablauf: Der Client holt die Liste mit den deutschen
Ausgangstexten, die Vorschläge werden im Chat besprochen, der Client schreibt
die abgestimmten Texte zurück — einzeln oder als Auftrag „übersetze alles
Fehlende ins Englische, behalte Ton und Professionalität der deutschen Texte".

## 2. Entscheidungen

1. **Modul-Haken statt Datenbank-Scan oder Export.** Jedes Modul mit
   mehrsprachigen Inhalten meldet dem Kern seine übersetzbaren Datensätze und
   nimmt Übersetzungen über seinen eigenen Update-Service entgegen. Das ist
   das Muster von `followUpTargets` und `retentionDue`: Der Kern fragt, das
   Modul antwortet, Rechteprüfung und Änderungsprotokoll bleiben im Service.
   Verworfen: ein generischer Tabellen-Scan wie `scanLocale` (keine
   Beschriftung, kein zuordenbares Recht, Schreiben an den Services vorbei)
   und eine Erweiterung des Export-Prüflaufs (der Export darf nach Prinzip 4
   nur Freigegebenes enthalten und soll keine Verwaltungs-IDs nach außen
   tragen).
2. **Entwürfe zählen mit.** Ein Entwurf wird vor dem Veröffentlichen
   übersetzt. Der Export-Prüflauf bleibt auf Veröffentlichtes beschränkt,
   weil er eine andere Frage beantwortet: ob der Export vollständig ist.
3. **Bestehende Rechte der Inhalte.** Kein neuer Permission-Key. Die Liste
   zeigt, was der Aufrufer lesen darf (`animals.view`, `projects.view`,
   `site.view`), Schreiben braucht das jeweilige `…manage`. Eine Übersetzung
   ist eine Inhaltsänderung. Ein Übersetzer-Recht, das nur Fremdsprachen
   füllen darf, kommt erst, wenn es jemanden gibt, der es braucht.
4. **Eigenes Schreibwerkzeug, alte Semantik bleibt.** Die bestehenden
   Update-Werkzeuge ersetzen Maps weiterhin ganz; das ist für Masken und
   vollständige Datensätze richtig. Für einzelne Sprachen gibt es
   `translations_set`, das nur den einen Schlüssel ersetzt.

## 3. Kernservice und Datenform

Neu: `packages/core/src/i18n/translations.ts` mit zwei Services.

### listTranslationGaps

`listTranslationGaps(deps, ctx, { locale?, entityType? })` →
`Result<{ gaps: TranslationGap[]; omitted: string[] }>`

```ts
interface TranslationGap {
  entityType: string;        // 'animal', 'project', 'site.variables', 'site.entry'
  id: string;
  label: string;             // Tiername, Projektname, Slug …
  href: string;              // Link in die Maske
  field: string;             // 'summary', 'story.quote', 'faq[2].answer'
  locale: string;            // die fehlende Sprache
  source: { locale: string; text: string | string[] };  // Leitsprache
}
```

Ablauf: Sprachen lesen (`readLocales`), Filter validieren (`locale` muss
eingerichtet sein, sonst `validation` mit `unknownLocale`), dann jedes Modul
mit `translatables`-Haken befragen. Antwortet ein Modul `forbidden`, kommt
sein Schlüssel nach `omitted` und die Liste bleibt für die übrigen Module
vollständig. Andere Fehler eines Moduls sind technisch und werfen. Lücken
rechnet der Kern selbst aus den gelieferten Feldwerten, mit derselben Regel
wie `translationGaps`: Leitsprache gefüllt, Zielsprache leer. Bei
Listenfeldern heißt gefüllt: mindestens ein Eintrag. Der Ausgangstext ist
der vollständige Wert der Leitsprache, auch bei langen Fließtexten — er ist,
was der Client übersetzt.

`omitted` steht im Ergebnis, damit „keine Lücken" für einen Aufrufer ohne
Rechte nicht wie „alles übersetzt" aussieht.

### setTranslations

`setTranslations(deps, ctx, { items: TranslationInput[] })` →
`Result<{ applied: number; failed: { index: number; error: Failure }[] }>`

```ts
interface TranslationInput {
  entityType: string;
  id: string;
  field: string;
  locale: string;
  text: string | string[];
}
```

Ablauf: Eingabe mit Zod validieren (mindestens eine Position, `locale`
eingerichtet — sonst `validation` für den ganzen Aufruf, bevor etwas
geschrieben wird). Dann die Positionen nach `entityType` und `id` gruppieren
und jede Gruppe an das Modul geben, dessen `setTranslations`-Haken den
`entityType` kennt. Kennt ihn keines, sind alle Positionen der Gruppe
`notFound`. Das Modul liest den Datensatz einmal, ersetzt in jedem genannten
Feld genau den einen Sprachschlüssel und ruft seinen Update-Service einmal —
mit dessen Rechteprüfung, Validierung und einem Audit-Eintrag je Datensatz.
Fünf englische Felder für denselben Hund sind eine Transaktion und ein
Eintrag im Änderungsprotokoll. Alle übrigen Sprachen der Felder bleiben, wie
sie sind.

Kein Alles-oder-nichts über Datensätze hinweg: Jeder Modul-Service öffnet
seine eigene Transaktion, eine gemeinsame über Module gibt es nicht. Scheitert
eine Gruppe (`notFound`, `forbidden`, `validation`), scheitern alle ihre
Positionen zusammen und stehen mit ihren Indizes in `failed`; die übrigen
Gruppen werden geschrieben. Der Aufruf selbst ist `ok`, solange die Eingabe
gültig war.

Leerer Text (`""` oder `[]`) ist erlaubt und leert die Übersetzung wieder;
die Lücke erscheint dann erneut in der Liste. Die Leitsprache ist nicht
geschützt: Wer `manage` hat, darf sie in der Maske ohnehin ändern.

## 4. Modul-Haken

Zwei neue optionale Haken im `ModuleManifest`
(`packages/core/src/modules/manifest.ts`), Richtung Kern → Modul:

```ts
interface Translatable {
  entityType: string;
  id: string;
  label: string;
  href: string;
  fields: Record<string, LocalizedText | Record<string, string[]>>;
}

translatables?: (deps: Deps, ctx: CallContext) => Result<Translatable[]>;
setTranslations?: (
  deps: Deps,
  ctx: CallContext,
  input: { entityType: string; id: string; items: { field: string; locale: string; text: string | string[] }[] },
) => Promise<Result<void>> | null;
```

`translatables` prüft das Ansichtsrecht des Moduls und gibt `forbidden`
zurück, wenn es fehlt. Es liefert alle Datensätze, auch unveröffentlichte.
`setTranslations` bekommt alle Positionen eines Datensatzes auf einmal, gibt
`null` für einen fremden `entityType` zurück und sonst das Ergebnis des einen
Update-Aufrufs.

Was die drei Module melden:

| Modul | entityType | Felder | Schreibt über |
|---|---|---|---|
| Tiere | `animal` | `birthText`, `sizeText`, `traits` (Liste), `summary`, `body`; mit Geschichte zusätzlich `story.quote`, `story.beforeCaption`, `story.afterCaption` | `updateAnimal`; die `story.*`-Felder über `setAnimalStory` (eine Gruppe mit beidem ergibt zwei Aufrufe, weil es zwei Services sind) |
| Projekte | `project` | `name`, `summary`, `body` | `updateProject` |
| Site | `site.variables` (eine Zeile, `id: 'variables'`) | alle `localized`-Variablen des Templates, auch in `objectList` | `setValues` |
| Site | `site.entry` | alle `localized`-Felder der Sammlung, auch in `objectList` | `updateEntry` |

Links: `/animals/<id>`, `/projects/<id>`, `/site/variables`,
`/site/c/<collection>/<id>` — dieselben Ziele wie in der Navigation.

Beschriftungen: Tiere und Projekte ihren Namen (bei Projekten die Leitsprache
von `name`). Variablen den Namen des Templates. Sammlungseinträge so, wie die
Listenseite sie heute beschriftet: der Leitsprachen-Text des ersten Felds vom
Typ `text`, `localized` oder `markdown`, sonst der Slug, sonst die ID. Diese
Logik steht bisher in der App-Route
`apps/kompass/src/app/(shell)/site/c/[collection]/page.tsx`; sie zieht als
Helfer `entryLabel` ins Site-Modul, den Listenseite und Haken gemeinsam
nutzen.

Feldpfade: eine Punktnotation mit Index in eckigen Klammern, wie sie der
Export-Prüflauf schon verwendet (`faq[2].answer`). Das Site-Modul löst sie
beim Lesen und Schreiben selbst auf; der Kern behandelt den Pfad als
undurchsichtigen Schlüssel. Ein Pfad, den das Modul nicht kennt, ist
`notFound`.

## 5. MCP-Werkzeuge

Zwei Werkzeuge im Kern (`packages/mcp/src/core-tools.ts`):

- `translations_list_gaps` — Argumente `locale?`, `entityType?`. Beschreibung:
  „List missing translations across all modules with the source text in the
  leading locale. Requires the view right of each module (`animals.view`,
  `projects.view`, `site.view`); modules you may not read are named under
  `omitted`."
- `translations_set` — Argument `items`. Beschreibung: „Write translations for
  single locales without touching the other locales. Items for the same
  record are written together through the module's update service and need
  its manage right (`animals.manage`, `projects.manage`, `site.manage`).
  Audited once per record."

Die bestehenden Update-Werkzeuge (`animals_update`, `animals_set_story`,
`project_update`, `site_variables_set`, `site_<sammlung>_update`) bekommen
einen Satz in der Beschreibung: „Localized fields are replaced as a whole
map; to change one locale use `translations_set`." Kein Verhaltenswechsel.

Die Regeln aus `apps/kompass/tests/mcp-tools.test.ts` gelten unverändert:
Beide Werkzeuge zeigen ihr Zod-Schema, nennen die Rechte, tragen ihren
Service.

## 6. Tests

Kern (`packages/core/tests/translations.test.ts`) gegen `createTestDeps()`
mit einem Fake-Modul, das beide Haken trägt:

- Lücken werden richtig gerechnet, auch für Listenfelder; Felder ohne
  Leitsprachen-Text sind keine Lücke.
- Filter nach `locale` und `entityType` greifen; eine nicht eingerichtete
  Sprache ist `validation`.
- Antwortet ein Modul `forbidden`, steht sein Schlüssel in `omitted` und die
  Lücken der anderen Module bleiben.
- `setTranslations` ersetzt genau eine Sprache; Positionen desselben
  Datensatzes ergeben einen Haken-Aufruf; eine gescheiterte Gruppe stoppt die
  übrigen nicht und steht mit allen ihren Indizes in `failed`; unbekannter
  `entityType` ist `notFound`; ungültige Sprache lehnt den ganzen Aufruf ab,
  bevor etwas geschrieben wird.
- Ein Aufrufer ohne jedes Recht bekommt eine leere Liste mit allen Modulen
  unter `omitted`.

Je Modul (Tiere, Projekte, Site):

- `translatables` listet Entwürfe mit und gibt `forbidden` ohne Ansichtsrecht.
- `setTranslations` ändert nur die genannten Sprachen, erzeugt für mehrere
  Felder eines Datensatzes genau einen Audit-Eintrag des bestehenden Services,
  ist `forbidden` ohne Manage-Recht, `notFound` für eine fremde ID oder einen
  unbekannten Pfad.
- Tiere: `story.quote` läuft über `setAnimalStory`, `traits` als Liste.
- Site: Variablen und ein verschachteltes Feld in einer `objectList`; ein
  Template ohne `localized`-Felder liefert eine leere Liste; `entryLabel`
  liefert dieselbe Beschriftung wie die Listenseite.

`apps/kompass/tests/mcp-tools.test.ts`: die beiden Werkzeuge fallen unter die
vorhandenen Regeln. Neu ein Test: Er geht die Eingabeschemata der
MCP-Werkzeuge jedes Moduls durch — sie tragen die echten Zod-Schemata der
Services — und sucht nach Feldern mit `localized: true` in den Metadaten, auch
in verschachtelten Objekten und Listen. Jedes Modul mit einem Treffer muss
die Haken `translatables` und `setTranslations` haben. So kann ein künftiges
Modul die Übersetzungsliste nicht still auslassen.

## 7. Seed

`seedDevelopment` führt bereits `['de', 'en']`. Die Seeds der Module Tiere,
Projekte und Site legen mindestens je einen Datensatz mit gefüllter deutscher
und leerer englischer Fassung an, damit `translations_list_gaps` in der
Entwicklung etwas zeigt. Die vorhandenen `seed.test.ts` prüfen das je Modul.

## 8. Abhängigkeiten und Reihenfolge

Diese Spec kommt nach den vier Plänen der Startseiten-Spec
(`2026-09-13-startseiten-referenzen-und-nacharbeiten-design.md`):

- Deren § 8 macht die Bildunterschriften der Vermittlungsgeschichte
  mehrsprachig; die Feldtabelle in § 4 setzt das voraus.
- Beide Vorhaben fassen `packages/mcp/src/core-tools.ts`,
  `apps/kompass/tests/mcp-tools.test.ts` und den Seed des Tiermoduls an. Keine
  Widersprüche, nur Merge-Nähe; nacheinander ist einfacher als parallel.
- Deren § 4.4 lässt `setValues` jeden Referenzwert prüfen, auch unveränderte.
  Der Site-Haken schreibt Variablen über `setValues`; eine veraltete Referenz
  ließe damit jede Variablen-Übersetzung scheitern. Backlog-Punkt 19 (nur
  geänderte Referenzwerte prüfen) kommt vor oder mit dieser Spec.

## 9. Nicht-Ziele

- **Keine eigene Oberfläche „Übersetzungen".** Die Masken zeigen Lückenzähler,
  der Export-Prüflauf prüft Veröffentlichtes. Eine spätere Seite wäre eine
  dünne Sicht auf `listTranslationGaps`. Prinzip 8 ist gewahrt: Der Schreibweg
  läuft über dieselben Update-Services wie die Masken.
- **Keine Erkennung veralteter Übersetzungen** (Deutsch geändert, Englisch
  nicht). Das bräuchte einen Stand je Sprache und ist ein eigener Schnitt.
- **Kein Übersetzer-Recht.** Siehe Entscheidung 3.
- **Der Export-Prüflauf bleibt, wie er ist.** Er beantwortet die Frage nach
  dem veröffentlichten Stand.
- **Keine Übersetzung der Oberfläche selbst.** `messages/de.json` ist
  Anwendungstext, kein Inhalt.
