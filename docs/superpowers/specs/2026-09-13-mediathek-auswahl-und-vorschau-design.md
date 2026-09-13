# Aluna Kompass — Mediathek: Auswahl, Vorschau, Suche (Design)

Stand 2026-09-13. Säule „Fundament". Baut auf
`2026-09-09-loeschbarkeit-und-mediathek-design.md` auf und schließt die
Lücken aus der Durchsicht vom 2026-09-13 vor dem ersten Release: Formulare
können aus der Mediathek **auswählen**, Bilder haben **Vorschaubilder**, die
Liste kennt **Suche, Sortierung und Typfilter**, und Fundstellen sind
**Links**.

## 1. Ausgangslage

Die Mediathek vom 09.09. ist eine Ablage mit Ordnern, Löschpolitik und
Referenzprüfung. Was fehlt, ist der Weg von der Ablage in die Formulare:

| Stelle | Heute |
|---|---|
| Projektbild, Vorher/Nachher-Bild (`MediaPicker`) | nur Upload vom Rechner, keine Auswahl aus dem Bestand |
| Tierfotos (`PhotosEditor`) | nur Upload, eine Datei je Vorgang |
| Asset-Felder der Website-Formulare (`schema-form/field.tsx`, `AssetField`) | ein Textfeld für die Asset-ID |
| Logo (`admin/settings/logo-upload.tsx`, `logo-actions.ts`) | eigener Upload-Weg, der zugleich die Einstellung setzt |
| Mediathek-Seite | keine Suche, keine Sortierung (älteste zuerst), kein Typfilter; Grid und Liste laden Originale bis 10 MB |
| Detail-Dialog | Fundstellen als Text, kein Öffnen-Link (ein PDF ist nie sichtbar) |

Ein Bild, das an zweiter Stelle gebraucht wird, muss erneut vom Rechner
kommen. Das Dedup fängt die Bytes, nicht den Arbeitsweg.

## 2. Entscheidungen (Brainstorming 2026-09-13)

| # | Entscheidung | Verworfen |
|---|---|---|
| 1 | **Ein Knopf, ein Dialog.** Formulare haben „Wählen" und „Entfernen"; Hochladen passiert im Dialog, nicht daneben. | Zwei Knöpfe „Hochladen" und „Aus der Mediathek" |
| 2 | Der Dialog zeigt nur, **was das Feld nehmen kann** (`image` oder `pdf`). Der Typfilter kommt vom Feld, nicht von der Person. | Freier Typfilter im Dialog |
| 3 | **Vorschaubild beim Upload**, 320 px breit, WebP, flach neben dem Original. Fehlt es (Bestand), baut der Abruf es nach. | Skalieren auf Anfrage mit Breitenparameter; eigene Spalte in der Datenbank |
| 4 | Suche, Sortierung, Typfilter im **Kern** (`listMediaAssets`), damit UI und MCP dasselbe können. | Filtern nur im Client |
| 5 | Fundstellen tragen ein optionales **`href`**, das das Modul liefert — Muster `FollowUpTarget`. | Routentabelle in der App je Entitätstyp |
| 6 | Der Dialog lädt über einen **Route Handler** `GET /media`. | Server Action (seriell, nicht für Nachladen gedacht) |
| 7 | Die Wurzel heißt am Asset **„Ohne Ordner"**; der oberste Eintrag „Alle Dateien" zeigt weiter alles. | Eigene Ansicht nur für Dateien ohne Ordner |
| 8 | Der Dialog erlaubt **Mehrfach-Upload** (mehrere Dateien je Vorgang), nacheinander über dieselbe Action. | Ein Upload je Vorgang |

**Nicht-Ziele.** Drag-and-drop von Dateien, Zuschnitt oder Bildbearbeitung,
Ersetzen einer Datei unter gleicher ID, Alt-Text (Backlog 21), Sammelabfrage
der Referenzen (Backlog 22), Änderungen am Template-Vertrag.

## 3. Kern: Vorschaubilder

**Ablage.** Zu jedem Rasterbild (`image/png`, `image/jpeg`, `image/webp`)
liegt neben dem Original eine Datei `<slug>-<hash12>.preview.webp` im selben
Verzeichnis. Sie ist 320 px breit, nach EXIF gedreht, `withoutEnlargement`,
`webp({ quality: 80 })`. Der Name ergibt sich aus dem Dateinamen des Originals:
`previewFilename(record.filename)` ersetzt die Endung durch `.preview.webp`.
Keine Spalte, keine Migration — die Vorschau ist ein **Cache** (Prinzip 5:
abgeleitet, jederzeit neu berechenbar). SVG und PDF haben keine Vorschau.

**Erzeugen.** `packages/core/src/media/preview.ts`:

```ts
export function previewFilename(filename: string): string;
export function hasPreview(mimeType: string): boolean;          // die drei Rasterformate
/** Vorschau-Bytes aus dem Original; wirft bei unlesbarem Bild. */
export async function renderPreview(bytes: Uint8Array): Promise<Uint8Array>;
/** Liest die Vorschau, baut sie nach, wenn sie fehlt. Für SVG das Original, für PDF null. */
export async function ensurePreview(deps: Deps, record: MediaAssetRecord): Promise<Uint8Array | null>;
```

- Beim Upload entsteht die Vorschau in `prepare`, dort wo heute die Maße
  gelesen werden: `sharp(bytes).metadata()` liefert Breite und Höhe, ein
  zweiter Aufruf die Vorschau-Bytes. `image-size` entfällt damit. Schlägt
  `sharp` fehl (kaputte Datei), wird der Upload als
  `validation('unsupportedMediaType')` abgelehnt, bevor irgendetwas auf der
  Platte liegt. Erst danach schreibt `storeMediaInternal` Original und
  Vorschau, dann die Transaktion. Das Dedup greift vorher wie heute: Ein
  Treffer schreibt nichts.
- `getMediaPreview(deps, ctx, id)` in `service.ts`: dieselben Rechteregeln wie
  `getMediaAsset` (angemeldet; Modul-Recht, wo eine Fundstelle eins nennt),
  dann `ensurePreview`. Der Nachbau beim Abruf ist kein Vereinsvorgang und
  erzeugt keinen Protokolleintrag.
- `deleteMediaAsset` löscht Original **und** Vorschau (`FileStore.delete` ist
  idempotent).
- `sharp` wird Abhängigkeit von `@kompass/core`; das Site-Modul behält seine
  eigene Pipeline (andere Breiten, anderes Verzeichnis).

**Route** `apps/kompass/src/app/media/[id]/preview/route.ts`: wie `/media/[id]`
(401 ohne Sitzung, 404 bei fehlendem Asset oder `null`, `content-type`
`image/webp` bzw. `image/svg+xml`, `cache-control: private, max-age=3600`,
`content-security-policy: sandbox`, `x-content-type-options: nosniff`).

**Backup und Betrieb.** Die `.preview.webp`-Dateien reisen im Medienordner
mit. Sie dürfen jederzeit gelöscht werden; der nächste Abruf baut sie neu.
`docs/betrieb.md` bekommt den Satz unter „Medien".

## 4. Kern: Liste mit Suche, Typ und Sortierung

`listMediaAssets(deps, ctx, filter?)` ersetzt den einzelnen `folder`-Parameter:

```ts
export interface MediaListFilter {
  /** weggelassen = alle; null = ohne Ordner; Pfad = genau dieser Ordner */
  folder?: string | null;
  /** Teilstring ohne Groß-/Kleinschreibung im Dateinamen oder in einem Verwendungs-Label */
  query?: string;
  /** image umfasst PNG, JPEG, WebP und SVG; pdf nur PDF */
  kind?: 'image' | 'pdf';
  /** Vorgabe newest */
  sort?: 'newest' | 'oldest' | 'name' | 'size';
}
```

Zod-Schema `mediaListFilterSchema` im Kern, exportiert, damit MCP und Route
Handler dasselbe Schema zeigen. `folder` und `kind` filtern in SQL,
`query` nach dem Laden (die Labels entstehen erst durch `findMediaReferences`).
`sort` in SQL; `name` nach `filename`, `size` absteigend nach `bytes`.

Aufrufer, die sich ändern: Mediathek-Seite, `media_list` (MCP), Tests. Das
MCP-Werkzeug `media_list` nimmt `mediaListFilterSchema` als `inputSchema`.

**`MediaReference.href`** (optional, `packages/core/src/modules/manifest.ts`):
der Weg zur Fundstelle in der Oberfläche, oder weggelassen, wenn es keine Seite
gibt. Die Module füllen es:

| Modul | Entität | href |
|---|---|---|
| Kern | Logo (`setting`) | `/admin/settings` |
| projects | `project` | `/projects/<id>` |
| animals | `animal` | `/animals/<id>` |
| site | `siteEntry` | `/site/c/<collection>/<id>` |
| site | `siteValue` | `/site/variables` |

Die Pfade stehen heute schon in den Navigations-Einträgen und Wiedervorlagen
der Module; das Muster ist dasselbe wie `FollowUpTarget.href`.

## 5. Route Handler `GET /media`

`apps/kompass/src/app/media/route.ts`. Query-Parameter `folder`, `query`,
`kind`, `sort` (Werte wie `MediaListFilter`; `folder=` leer heißt ohne Ordner,
weggelassen heißt alle). Antwort JSON:

```ts
{ items: { id, filename, mimeType, bytes, width, height, createdAt, folder, references: { label, href? }[] }[],
  folders: { path, assetCount }[] }
```

401 ohne Sitzung, 403 ohne `media.upload` (der Dialog braucht dasselbe Recht
wie die Mediathek — wer auswählen darf, darf hochladen). Kein Cache-Header:
Die Liste ändert sich mit jedem Upload.

## 6. Der Auswahl-Dialog

`apps/kompass/src/components/forms/media-chooser-dialog.tsx`:

```ts
interface MediaChooserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: 'image' | 'pdf';
  multiple: boolean;
  /** Bereits gewählte IDs; bei multiple vorab angehakt, bei single nur markiert. */
  selected: string[];
  onConfirm: (ids: string[]) => void;
}
```

**Aufbau** (Dialog `sm:max-w-4xl`):

- Kopf: Suchfeld (`media.search`), Sortierung (`media.sort.*`), rechts der
  Upload-Knopf, ein `<input type="file" multiple>` mit dem `accept` des Typs.
- Links: Ordnerliste aus `flattenFolderTree`, oberster Eintrag „Alle Dateien",
  ohne Anlegen, Umbenennen, Löschen. Der offene Ordner wird über
  `usePreference('mediaChooserFolder')` gemerkt.
- Rechts: Kacheln (`AssetGrid` aus der Mediathek, um eine Auswahl-Markierung
  erweitert), Vorschau über `/media/<id>/preview`, darunter Dateiname und
  Ordner. Bei `kind: 'pdf'` die Typ-Kachel wie heute.
- Fuß: bei `multiple` die Zählung (`media.selectedCount`), „Abbrechen",
  „Übernehmen". Bei Einzelauswahl schließt der Klick auf die Kachel den Dialog
  und ruft `onConfirm([id])`; der Fuß hat dann nur „Abbrechen".

**Laden.** Beim Öffnen und bei jeder Änderung von Ordner, Suche, Sortierung
ein `fetch('/media?…')`. Suche entprellt (300 ms). Leerzustand mit
`EmptyState` und dem Hinweis, dass Hochladen hier geht.

**Upload im Dialog.** `uploadMediaAction(fd)` aus `admin/media/actions.ts`,
je Datei ein Aufruf nacheinander, `folder` = offener Ordner (leer = ohne
Ordner). Während des Uploads ist das Feld gesperrt und der Hinweis
`media.uploading` sichtbar. Nach jedem Erfolg: Liste neu laden und die Datei
auswählen (bei `multiple` anhaken, bei single sofort `onConfirm` und
schließen — bei mehreren Dateien in single gewinnt die letzte). Ein
Dedup-Treffer zeigt die Meldung `media.alreadyStored` als Toast und wählt die
vorhandene Datei aus.

`uploadMediaAction` liefert dazu `data: { id, created }` — heute gibt sie nur
die Meldung zurück.

## 7. Die Formulare

**`MediaPicker`** (`components/forms/media-picker.tsx`) wird umgebaut: Props
`name`, `value`, `label`, `kind` (Vorgabe `image`). Anzeige: Vorschau
(`/media/<id>/preview`) oder Platzhalter, Knopf „Wählen" (`content.choose`),
bei Wert „Entfernen". Klick auf „Wählen" öffnet den `MediaChooserDialog` mit
`multiple: false`. Kein Dateifeld mehr. `apps/kompass/src/app/(shell)/media-actions.ts`
entfällt.

Stellen:

- Projektbild (`projects/project-form.tsx`) — unverändert außer dem Picker.
- Vorher/Nachher (`animals/story-form.tsx`) — ebenso.
- **Asset-Felder der Website-Formulare**: `AssetField` in
  `components/schema-form/field.tsx` rendert den `MediaPicker` statt des
  Textfelds; `kind` aus dem Feldschema: Der DSL-Helfer `asset()` in
  `@kompass/site-template` schreibt `accept` in die Feld-Metadaten, Vorgabe
  `image/*`, die Dokumente-Sammlung des Basis-Templates deklariert
  `application/pdf`. `accept === 'application/pdf'` ergibt `pdf`, alles andere
  `image`. Der Wert bleibt die Asset-ID.
- **Logo**: `LogoUpload` wird ein `MediaPicker` mit `name="branding.logoAssetId"`
  im Branding-Tab, gespeichert wie jede andere Einstellung über
  `settings-form`. `logo-actions.ts` und `logo-upload.tsx` entfallen; die
  Übersetzungen `settings.logo.*` werden bereinigt.

**`PhotosEditor`** (`animals/photos-editor.tsx`): Das Dateifeld wird zu
„Fotos wählen" (`animals.photos.choose`), öffnet den Dialog mit
`multiple: true` und `selected` = die aktuellen IDs. `onConfirm` setzt die
Liste: neue IDs hinten anhängen, abgewählte entfernen, Reihenfolge der
bleibenden behalten, Hauptfoto bleibt, wenn es noch dabei ist, sonst das
erste. Kacheln zeigen die Vorschau. `uploadAnimalPhotoAction` entfällt.

## 8. Die Mediathek-Seite

- **Werkzeugleiste**: Suchfeld, Sortierung, Typfilter „Alle / Bilder / PDF"
  als URL-Parameter `q`, `sort`, `kind` neben `folder`. Die Seite bleibt
  serverseitig; die Felder sind ein `<form method="get">`, das die Parameter
  setzt, plus Umschalter Liste/Grid wie heute.
- **Liste**: Spalten Datei, Ordner, Größe, Hochgeladen, Verwendung. Zeilen
  bekommen einen fokussierbaren Knopf im Dateinamen, damit die Tastatur den
  Dialog öffnet. Vorschau über `/media/<id>/preview`.
- **Grid**: Vorschau statt Original.
- **Detail-Dialog**: Link „Öffnen" (`media.open`) auf `/media/<id>`,
  `target="_blank" rel="noopener"`. Fundstellen mit `href` als Links, ohne als
  Text. Ordner ohne Wert heißt „Ohne Ordner" (`media.noFolder`); derselbe
  Schlüssel ersetzt `media.rootFolder` in der Dedup-Meldung. „Alle Dateien"
  bleibt der Text des obersten Eintrags links.

`page.tsx` reicht `references` als `{ label, href? }[]` weiter statt als
`string[]`; `Item.references` in `types.ts` folgt.

## 9. Seed

`packages/core/src/seed/media.ts`, aufgerufen aus `seedDevelopment`, nur wenn
`media_assets` leer ist:

- Ordner `Bilder`, `Bilder/2026`, `Dokumente`.
- Vier Rasterbilder in verschiedenen Maßen (quer, hoch, quadratisch, klein),
  mit `sharp` als einfarbige Flächen mit Rahmen erzeugt — keine Binärdateien
  im Repo; je Datei ein anderer Farbton, damit sie im Grid unterscheidbar
  sind. Zwei davon in `Bilder/2026`, eins in `Bilder`, eins ohne Ordner.
- Ein PDF in `Dokumente`: ein minimales, handgeschriebenes Ein-Seiten-PDF als
  Konstante im Seed. Kein Rendern über `@kompass/documents` — der Kern hängt
  nicht am Dokumentpaket.
- Ein SVG (einfaches Vereinssymbol) ohne Ordner.
- Nichts davon wird referenziert — die Module hängen ihre eigenen Seeds an
  eigene Uploads. So zeigt die Entwicklung „nicht verwendet", Löschen,
  Verschieben und die Vorschau.

Test `packages/core/tests/seed-media.test.ts`: legt an, zählt, läuft ein
zweites Mal ohne neue Zeilen, jede Rasterdatei hat eine Vorschau.

## 10. Tests

**Kern** (`packages/core/tests/`):

- `media-preview.test.ts`: Upload eines PNG legt `<name>.preview.webp` ab,
  320 px breit (oder Originalbreite bei kleineren), Hochkant bleibt hochkant;
  `getMediaPreview` baut eine gelöschte Vorschau nach; SVG liefert das
  Original; PDF `null`; `deleteMediaAsset` entfernt beide Dateien; Recht wie
  `getMediaAsset` (`forbidden` bei Modul-Recht).
- `media.test.ts`: `listMediaAssets` mit `query` (Dateiname, Label, Groß-/
  Kleinschreibung), `kind`, `sort` (alle vier), Kombination mit `folder`;
  `mediaListFilterSchema` lehnt unbekannte Werte ab.
- `media-references.test.ts`: Kern liefert `href` fürs Logo.

**Module**: je ein Fall, dass `href` gesetzt und korrekt ist (animals,
projects, site: Eintrag und Variable).

**MCP** (`packages/mcp/tests/media-tools.test.ts`): `media_list` mit `query`
und `kind`; Schema zeigt die vier Felder.

**App** (`apps/kompass/tests/`): Route Handler `GET /media` — 401, 403, Filter
werden durchgereicht (gegen `createTestDeps` mit gemockter Sitzung, wie der
bestehende Muster-Test für Route Handler, falls vorhanden; sonst E2E).
`flattenFolderTree` bleibt.

**E2E** (`apps/kompass/e2e/media.spec.ts` und `animals.spec.ts`,
`projects.spec.ts`):

- Projektbild über den Dialog wählen: Dialog öffnet, Kachel klicken, Vorschau
  im Formular, speichern, Bild am Projekt.
- Upload aus dem Dialog: Datei hochladen, wird ausgewählt, Dialog zu.
- Tierfotos: zwei Fotos anhaken, übernehmen, beide in der Liste, Hauptfoto
  das erste; eins abwählen.
- Mediathek: Suche nach einem Tiernamen findet dessen Foto; Filter PDF zeigt
  nur das PDF; Sortierung nach Name.
- Detail-Dialog: Fundstelle klicken führt zur Seite des Tiers; „Öffnen" hat
  `href=/media/<id>`.
- Vorschau-Route liefert `image/webp` mit beiden Sicherheits-Headern.

## 11. Dateien

**Kern**
- `packages/core/src/media/preview.ts` (neu) — `previewFilename`, `hasPreview`, `ensurePreview`
- `packages/core/src/media/service.ts` — Vorschau beim Upload, `getMediaPreview`, `MediaListFilter`, `mediaListFilterSchema`, Löschen beider Dateien
- `packages/core/src/media/references.ts` — `href` fürs Logo
- `packages/core/src/modules/manifest.ts` — `MediaReference.href?`
- `packages/core/src/seed/media.ts` (neu), `seed.ts` — Aufruf
- `packages/core/package.json` — `sharp` rein, `image-size` raus
- `packages/core/tests/media-preview.test.ts` (neu), `media.test.ts`, `media-references.test.ts`, `seed-media.test.ts` (neu)

**Module**
- `packages/modules/{animals,projects,site}/src/references.ts` + Tests — `href`

**MCP**
- `packages/mcp/src/core-tools.ts` — `media_list` mit `mediaListFilterSchema`; Test

**App**
- `apps/kompass/src/app/media/route.ts` (neu) — `GET /media`
- `apps/kompass/src/app/media/[id]/preview/route.ts` (neu)
- `apps/kompass/src/components/forms/media-chooser-dialog.tsx` (neu)
- `apps/kompass/src/components/forms/media-picker.tsx` — Umbau
- `apps/kompass/src/components/schema-form/field.tsx` — `AssetField` nutzt `MediaPicker`
- `apps/kompass/src/app/(shell)/media-actions.ts` — entfällt
- `apps/kompass/src/app/(shell)/animals/photos-editor.tsx`, `actions.ts` — Dialog, `uploadAnimalPhotoAction` entfällt
- `apps/kompass/src/app/(shell)/admin/settings/logo-upload.tsx`, `logo-actions.ts` — entfallen; `settings-form.tsx` — `MediaPicker`
- `apps/kompass/src/app/(shell)/admin/media/*` — Werkzeugleiste, Spalten, Vorschau, Links, „Öffnen", `Item.references`
- `apps/kompass/src/app/(shell)/admin/media/actions.ts` — `uploadMediaAction` liefert `{ id, created }`
- `apps/kompass/src/lib/preferences.ts` — `mediaChooserFolder`
- `apps/kompass/messages/de.json` — `media.search`, `media.sort.*`, `media.kind.*`, `media.open`, `media.noFolder`, `media.selectedCount`, `media.choose`, `media.confirmSelection`, `content.choose`, `animals.photos.choose`; `settings.logo.*` und `media.rootFolder` raus
- `apps/kompass/e2e/media.spec.ts`, `animals.spec.ts`, `projects.spec.ts`

**Doku**
- `docs/betrieb.md` — Vorschau-Dateien sind ein Cache
- `docs/superpowers/specs/2026-09-09-loeschbarkeit-und-mediathek-design.md` — Nachtrag mit Verweis hierher
- `AGENTS.md` — Quellenliste

## 12. Self-Review

**Platzhalter.** Keine offenen TBD. Die Frage, wie ein PDF-Feld im Template
aussieht, ist geklärt (`accept` in den Feld-Metadaten, Abschnitt 7).

**Konsistenz.** Vorschau-Name in 3, 8 und 11 gleich (`.preview.webp`).
`MediaListFilter` in 4, 5 und im MCP-Werkzeug dieselben vier Felder.
`uploadMediaAction` liefert `{ id, created }` (6) und wird vom Dialog (6) und
der Mediathek-Seite (8) benutzt. „Ohne Ordner" ersetzt „Wurzel" überall (7 in
Entscheidungen, 8).

**Zuschnitt.** Vier Blöcke, jeder für sich testbar: Kern (Vorschau, Liste,
`href`), Route Handler und Dialog, Formulare, Mediathek-Seite plus Seed. Der
Plan folgt dieser Reihenfolge.

**Mehrdeutigkeit.** „Auswählen" bei Einzelauswahl ist der Klick auf die
Kachel, kein Übernehmen-Knopf. „Nachbau beim Abruf" heißt: `ensurePreview`
prüft `exists`, baut bei `false` über `renderPreview`, und schreibt mit
`flag: 'wx'` — zwei gleichzeitige Abrufe stören sich nicht. Beim Upload
läuft `renderPreview` in `prepare`, vor jedem Schreiben (Abschnitt 3). `query` trifft auch Labels, damit ein
Tiername Fotos findet; die Sammelabfrage aus Backlog 22 ändert daran nichts.
