# Eine Vorlage (Template-Datei) schreiben

Ein Template ist eine Astro-Seite mit einer Datei `kompass.template.ts`, die
Kompass sagt, welche Variablen und Sammlungen es braucht und welche Sichten
der Module es zeigt. Diese Seite erklärt den Vertrag für die Person, die das
Template baut — Felder, Typen, Referenzen, Startinhalte.

## Die Arbeitsteilung

Kompass pflegt Inhalte. Das Template baut daraus die Seite. Was Kompass
kennt, ist genau das, was `kompass.template.ts` deklariert — und **nur** das.
Seitenstruktur, Routen, Layout, feste Texte, Sprachpfade: alles Sache des
Templates. Was nicht wechselt, gehört nicht in eine Variable.

Ein Template ist ein Astro-Projekt. Es hat eine Entwicklungsabhängigkeit auf
`@kompass/site-template`, aus der die Deklaration ihre Helfer und ihre Typen
bezieht. Ein Beispiel liegt im Repo unter `templates/verein-basis`; mit
`pnpm --filter verein-basis dev` läuft es lokal mit Beispielinhalten.

## Die Deklaration

```ts
// kompass.template.ts
import { asset, defineTemplate, markdown, number, reference, text } from '@kompass/site-template';

export default defineTemplate({
  name: 'Verein Basis',
  locales: ['de'],
  variables: {
    claim: text({ max: 120, localized: true, label: 'Claim' }),
    intro: markdown({ max: 2000, localized: true, label: 'Text auf der Startseite' }),
    heroImage: asset({ label: 'Bild auf der Startseite' }),
    memberFee: number({ min: 0, label: 'Mitgliedsbeitrag im Jahr', unit: '€' }),
    featuredProject: reference({ view: 'projects', label: 'Projekt auf der Startseite' }),
  },
  collections: {
    news: {
      label: 'Aktuelles', slug: true, publishable: true,
      fields: { title: text({ localized: true, label: 'Titel' }), body: markdown({ localized: true, label: 'Text' }), image: asset({ label: 'Foto' }) },
    },
    team: {
      label: 'Team', sortable: true, max: 60,
      fields: { name: text({ label: 'Name' }), role: text({ localized: true, label: 'Aufgabe' }), photo: asset({ label: 'Foto' }) },
    },
  },
  uses: ['projects'],
});
```

- **`name`** erscheint in Kompass auf der Seite „Vorlage der Webseite“.
- **`locales`** sind die Sprachen, die das Template ausliefert. Sie müssen in
  Kompass unter Einrichtung → Sprachen eingerichtet sein, sonst bricht das
  Einlesen ab. Pflegt der Verein mehr Sprachen, als das Template nennt,
  bleiben die übrigen unangetastet und werden nur nicht ausgeliefert.
- **`variables`** sind einzelne Felder, **`collections`** Listen von
  Einträgen mit eigenen Feldern.
- **`uses`** nennt die Module, deren veröffentlichte Sichten das Template
  liest. Ist ein genanntes Modul in Kompass ausgeschaltet, verweigert der
  Publish, statt eine leere Seite zu bauen.

## Feldtypen

| Helfer | In Kompass | Optionen |
|---|---|---|
| `text()` | eine Zeile | `max`, `localized`, `label` |
| `markdown()` | Text mit Formatierung | `max`, `localized`, `label` |
| `number()` | Zahl | `min`, `max`, `integer`, `unit` (Einheit rechts im Feld, etwa `'€'`), `label` |
| `select([...])` | Auswahl aus festen Werten | `label` |
| `asset()` | Bild oder Datei aus der Mediathek; gespeichert wird die Asset-ID | `accept` (MIME-Typ, etwa `application/pdf`), `ratio`, `width`, `label` |
| `date()` | Datum | `label` |
| `list(of)` | mehrere Werte eines Typs | `max`, `label` |
| `objectList({ fields })` | mehrere Einträge mit je denselben Feldern | `max`, `label` |
| `reference({ view })` | ein Datensatz aus einer Sicht | `view`, `key`, `labelField`, `where`, `label` |
| `references({ view, max })` | mehrere Datensätze | wie `reference`, plus `max` |

`localized: true` macht ein Feld mehrsprachig: Kompass speichert je Sprache
einen Wert und liefert ein Objekt `{ de: '…', en: '…' }` aus. `label` ist die
Beschriftung, die die pflegende Person sieht — schreiben Sie sie in ihrer
Sprache, nicht als Bezeichner.

**Verweise.** `reference({ view: 'projects' })` zeigt in Kompass die
veröffentlichten Projekte zur Auswahl und speichert deren `slug` (änderbar mit
`key`); angezeigt wird `name` (änderbar mit `labelField`). `where` schränkt
ein: `{ kind: 'dog' }` oder `{ image: { present: true } }`. Ein leerer Verweis
heißt „die Vorlage entscheidet“ — bauen Sie diesen Fall ein, meist als
„erster Datensatz nach Sortierung“. Ein Wert, der die Bedingung nicht mehr
erfüllt, kommt als `null` an.

**Format und Breite einer Bildstelle.** Zeigt Ihre Vorlage ein Bild in einem
festen Format, sagen Sie es Kompass: `asset({ label: 'Foto', ratio: '1:1',
width: 430 })`. `ratio` ist Breite zu Höhe in ganzen Zahlen (`'4:3'`), eine
Liste zur Auswahl (`['16:10', '16:9']`) oder `'original'`; `width` ist die
größte Anzeigebreite der Stelle in CSS-Pixeln. Kompass bietet beim Ausschnitt
dann nur dieses Format an und warnt, wenn ein Ausschnitt für die Stelle zu
schmal ist. Beides ist freiwillig; ohne Angabe ist jedes Format wählbar. Die
Bilder der Sichten (Tierfotos, Geschichte, Projektbild) sind keine Felder —
für sie gibt es in `defineTemplate` den Eintrag `images`, etwa
`images: { 'animals.primary': { ratio: '4:5', width: 600 }, 'projects.image':
{ ratio: ['16:10', '16:9'] } }`. Ein Schlüssel, den Kompass nicht kennt, ist
beim Einlesen ein Hinweis, kein Fehler. Gibt die Vorlage `animals.primary`
vor, gilt ihr Format auch in Kompass statt der Einstellung „Bildausschnitt“.

## Sammlungen

Je Sammlung neben `label` und `fields` vier Merkmale, alle standardmäßig aus:

- **`slug: true`** — jeder Eintrag bekommt einen eindeutigen URL-Teil. Für
  alles, was eine eigene Seite hat.
- **`sortable: true`** — der Verein bestimmt die Reihenfolge; das Template
  bekommt die Einträge so geliefert.
- **`publishable: true`** — Einträge haben einen Schalter „Veröffentlicht“;
  der Export enthält nur die veröffentlichten. Ohne das Merkmal ist jeder
  Eintrag sofort öffentlich.
- **`max`** — Höchstzahl der Einträge.

## Was das Template bekommt

Beim Build schreibt Kompass eine Datei `content.json` in das Verzeichnis, aus
dem Astro liest:

```json
{
  "variables": { "claim": { "de": "…" }, "heroImage": "01J…", "featuredProject": "sommerfest" },
  "collections": { "news": [ { "slug": "erste-notiz", "title": { "de": "…" }, "image": "01J…" } ] },
  "views": { "projects": [ { "slug": "sommerfest", "name": "Sommerfest", "…": "…" } ] },
  "assets": [ { "id": "01J…", "fileName": "…", "mimeType": "image/jpeg", "…": "…" } ]
}
```

Der Typ dieser Datei folgt aus der Deklaration: `InferContent<typeof
template>` liefert ihn, und das Beispiel-Template zeigt in
`src/lib/content.ts`, wie man ihn lädt. Ein Feld, das es im Template nicht
gibt, ist damit ein Tippfehler beim Build — nicht ein Loch auf der Seite.

**Bilder.** Kompass bereitet jedes verwendete Bild in mehreren Größen auf und
liefert je Asset-ID `src`, `srcset`, `width` und `height` (Beispiel:
`src/lib/images.ts`). Das Template setzt sie in `<img>` ein; es rechnet
keine Bilder selbst. Hat ein Bild einen Ausschnitt, steht im Wert eine
abgeleitete ID (`01J…~1000_0_8000_10000`), und die Bildgrößen unter dieser ID
sind schon zugeschnitten — das Template behandelt sie wie jede andere ID.

**Sichten.** Unter `views` stehen die Datensätze der Module aus `uses`, so wie
das Modul sie veröffentlicht — ein Tier mit Profil und Fotos, ein Projekt mit
Beschreibung und Verweis. Nicht mehr: Was ein Modul nicht freigibt, kommt
nicht an.

**Jahresrechnung.** Mit `uses: ['finance']` bekommt das Template die Sicht
`annualAccounts`: je auf der Webseite bereitgestellter Jahresrechnung eine
Zeile, neuestes Jahr zuerst.

| Feld | Inhalt |
|---|---|
| `year` | Bezeichnung des Geschäftsjahres, etwa `2026` |
| `title` | „Jahresrechnung {Jahr}“, wie auf dem PDF |
| `finalizedOn` | Tag der Festschreibung (`JJJJ-MM-TT`) |
| `pdfAssetId` | das PDF; unter `assets` mit `mimeType` `application/pdf` und Dateinamen, die Datei liegt neben den Bildern |
| `corrected` | `true` bei einer berichtigten Fassung |
| `replacesFinalizedOn` | bei einer berichtigten Fassung der Tag der ersetzten, sonst `null` |
| `webVersionOn` | Tag der Webfassung nach dem Widerruf einer Einwilligung, sonst `null` |

Das Template setzt den Link selbst, etwa „Jahresbericht 2026 (PDF)“ auf einer
Seite zur Transparenz. Namen oder Beträge stehen nicht in der Sicht, nur im PDF.

## Das Template ändern

Ein Template lebt. Wenn Sie Felder ändern, gleicht Kompass beim nächsten
[Einlesen](template-einlesen.md) die vorhandenen Inhalte ab:

- **Umbenennen** deklarieren Sie: `text({ renamedFrom: 'subtitle' })`. Ohne
  die Angabe ist eine Umbenennung ein Löschen plus ein Anlegen — der Inhalt
  wäre weg.
- **Neue Felder** sind unkritisch; sie sind leer, bis jemand sie füllt.
- **Entfallene Felder** kosten Inhalt, wenn dort etwas steht; Kompass zeigt
  es an und fragt.
- **Typwechsel** sind verlustfrei, wo es geht: Text wird zur einelementigen
  Liste, Zahl zur Zeichenkette, Auswahl zu Text. Alles andere gilt als
  Verlust.
- **Verschärfte Grenzen** — weniger Einträge erlaubt, als es gibt —
  blockieren das Einlesen, bis der Verein aufgeräumt hat.

## Startinhalte mitbringen

Ein Template kann ein Verzeichnis `seed/` enthalten: `seed/content.json` in
genau der Form, die Kompass exportiert, dazu `seed/assets/` mit den Dateien.
Kompass bietet die Übernahme einmalig an, solange die Webseite leer ist.
Danach ist die Datenbank die Quelle; das Template ist wieder nur Code und
Deklaration. Der einfachste Weg zu einer Seed-Datei: Inhalte einmal in einer
Entwicklungsinstanz pflegen und den Export übernehmen.

## Auf dem NAS

Das Template liegt unter `/data/site/template` im Container. Der Build führt
seinen Code mit den Rechten des Containers aus — das Verzeichnis gehört
deshalb dem Container-Nutzer und wird nicht über eine Freigabe geteilt. Nach
einer Änderung dort: in Kompass neu einlesen, sonst verweigert der Publish.
Einzelheiten in [Betrieb](../betrieb.md).
