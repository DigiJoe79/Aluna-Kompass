# Aluna Kompass — Löschbarkeit und Mediathek (Design)

Stand 2026-09-09. Schließt Backlog-Punkt 2 („Löschen für redaktionelle
Inhalte") und professionalisiert die Medienverwaltung. Zwei Teile, die
zusammengehören: eine **kanonische Löschpolitik im Kern** und eine
**Mediathek-Oberfläche mit virtuellen Ordnern**, in der das Löschen von
Medien überhaupt erst stattfinden kann.

## 1. Ausgangslage

Backlog-Punkt 2 (2026-09-07) beschreibt die Lage so: „Es gibt heute im ganzen
Repo genau eine Löschfunktion, `deleteTheme`." Das stimmt nicht mehr — der
`site`-Umbau hat `deleteEntry` für Sammlungseinträge gebracht, mit Oberfläche,
MCP und Änderungsprotokoll. Der eigentliche Rückstand ist heute:

| Datenart | Löschbar heute? |
|---|---|
| Sammlungseinträge (Artikel, Team, FAQ, Downloads) | ja — `deleteEntry` |
| Template-Variablen | auf Leerwert zurücksetzen (kein Löschvorgang) |
| Themes | ja — `deleteTheme` (außer aktiv/Default) |
| Sitzungen | ja |
| API-Tokens | widerrufen (Zustandswechsel, kein Löschen) |
| **Medien** | **nein** — keine `deleteMediaAsset`, und keine Oberfläche, die Medien überhaupt auflistet |

Zwei Probleme also:

1. **Die Regel, was löschbar ist, steht nur als Prosa in `AGENTS.md`.** Genau
   daraus ist der Backlog-Eintrag veraltet: Die Regel zählt Webseiteninhalte gar
   nicht auf, sie standen nur unter derselben Überschrift, und niemand hat den
   Eintrag nachgezogen, als `deleteEntry` kam.
2. **Medien wachsen monoton.** Ein ausgeschiedenes Teammitglied, ein
   versehentlich hochgeladenes Bild, ein PDF zu einem alten Thema: alles bleibt.
   Es gibt keinen Bildschirm, auf dem man den Bestand sieht, und keine
   Löschfunktion. Ohne Struktur wird die Mediathek mit jedem Jahr
   unübersichtlicher.

## 2. Entscheidungen aus dem Brainstorming (2026-09-09)

| # | Entscheidung | Verworfen |
|---|---|---|
| 1 | **Dokumentierte Politik plus konkrete Lücke.** Die Löschregeln als eine typisierte Konstante im Kern; `deleteMediaAsset` mit Referenzprüfung. Bestehende Löschfunktionen bleiben, wie sie sind. | Ein erzwungener zentraler Lösch-Mechanismus, durch den jede `delete*`-Funktion läuft |
| 2 | Die Politik ist eine **typisierte Konstante** `DELETION_POLICY`, gegen die ein Test läuft. | Reines Prosa-Dokument; Konstante plus generiertes Dokument |
| 3 | `deleteMediaAsset` **lehnt ab und nennt die Fundstellen**, solange irgendein Datensatz auf das Asset zeigt. | Redaktionelle Verweise beim Löschen auf `null` setzen; nach Referenzart unterscheiden |
| 4 | Referenzen werden über einen **Manifest-Haken** `mediaReferences` gefunden — jedes Modul (der Kern eingeschlossen) antwortet für sich. | Zentraler Scanner im Kern, der Modultabellen kennt; nur DB-Fremdschlüssel |
| 5 | Löschen von Medien schützt das **bestehende Recht `media.upload`**. | Neues Kernrecht `media.manage` mit Datenmigration |
| 6 | **Virtuelle Ordner** über eine eigene Tabelle `media_folders`; die Dateien bleiben flach im Verzeichnis. | Ordner als bloßes Pfad-Feld am Asset (keine leeren Ordner, Umbenennen unsauber); echte Unterverzeichnisse auf der Platte |
| 7 | Ein **deaktiviertes Modul wird nicht nach Referenzen befragt.** | Alle je installierten Module befragen |

**Nicht-Ziele.** Ein erzwungener Lösch-Mechanismus; Löschbarkeit von Projekten
oder Tierprofilen (entscheidet sich in Stufe 3 bzw. 4, siehe `AGENTS.md`);
Mehrfachauswahl zum Verschieben in der Mediathek; strukturierte Fehler-Nutzlast
im `Result`-Typ.

**Nachtrag 2026-09-09.** Die Mediathek-Seite bekommt doch ein Upload-Feld — in
den gerade offenen Ordner. Der ursprüngliche Zuschnitt („Uploads laufen weiter
dort, wo das Bild gebraucht wird") liess sich in der Praxis nicht halten: Ohne
Upload kann man in der Mediathek nichts anlegen, um Löschen und Ordnen zu
erproben, und ein eigenständiger Medienbestand ohne eigenen Upload-Weg ist
unvollständig.

Dazu: ein Umschalter **Liste / Grid** (Wahl pro Browser gemerkt über
`usePreference`, Default Liste), und ein **Detail-Dialog** je Datei (Klick auf
Zeile bzw. Kachel) mit grosser Vorschau, Metadaten (Typ, Grösse, Maße, Ordner,
hochgeladen am/von), Verwendungs-Liste und den Aktionen Verschieben und Löschen.
Die Zeilen-/Kachel-Ansicht selbst trägt keine Aktionen mehr — sie sind im Dialog.

## 3. Die Löschpolitik als Konstante

Neue Datei `packages/core/src/deletion-policy.ts`, exportiert über den Paket-Index.

```ts
export interface DeletionRule {
  /** Entitätstyp, wie in recordAudit als entityType verwendet. */
  entity: string;
  deletable: boolean;
  /** Ein Satz: warum (nicht). Deutsch, weil Rechenschaftsbezug. */
  reason: string;
  /** Nur bei deletable: was eine einzelne Löschung trotzdem verhindert. */
  guard?: string;
  /** Nur bei deletable: die Aktion, die ins Änderungsprotokoll geht. */
  auditAction?: string;
}

export const DELETION_POLICY: readonly DeletionRule[] = [
  // Rechenschaft — nie löschbar
  { entity: 'user',        deletable: false, reason: 'Der Verlauf von Nutzern, Rollen und Rechten ist rechenschaftsrelevant (Prinzip 3). Deaktivieren statt löschen.' },
  { entity: 'role',        deletable: false, reason: 'Teil des Rechte-Verlaufs. Rollen werden geleert, nicht gelöscht.' },
  { entity: 'setting',     deletable: false, reason: 'Vereinsstamm, Steuerdaten und Regeln sind nachweispflichtig; Werte ändern sich, Schlüssel bleiben.' },
  { entity: 'auditEntry',  deletable: false, reason: 'Das Änderungsprotokoll ist der Nachweis selbst.' },
  { entity: 'document',    deletable: false, reason: 'Belege und erzeugte Dokumente sind gegenüber Finanzamt und Transparenzregister nachweispflichtig; Storno statt Löschen.' },
  { entity: 'module',      deletable: false, reason: 'Module werden deaktiviert; ihre Datenspuren bleiben.' },
  { entity: 'project',     deletable: false, reason: 'Trägt ab Stufe 3 Finanzfelder; Löschbarkeit entscheidet sich dort (AGENTS.md).' },
  { entity: 'animal',      deletable: false, reason: 'Trägt ab Stufe 4 Bestandsbuch und § 11-Nachweise; Löschbarkeit entscheidet sich dort (AGENTS.md).' },
  { entity: 'sitePublish', deletable: false, reason: 'Die Publish-Historie ist ein Betriebsprotokoll über Jahre.' },

  // Arbeitsmaterial — löschbar, mit Protokolleintrag
  { entity: 'siteEntry',   deletable: true, reason: 'Redaktioneller Inhalt der Webseite (Prinzip 3).', guard: 'keiner', auditAction: 'site.entry.delete' },
  { entity: 'mediaAsset',  deletable: true, reason: 'Arbeitsmaterial der Redaktion.', guard: 'nur wenn kein Datensatz mehr darauf verweist', auditAction: 'media.delete' },
  { entity: 'mediaFolder', deletable: true, reason: 'Nur Ordnung, kein Nachweis.', guard: 'nur wenn leer (keine Assets, keine Unterordner)', auditAction: 'media.folder.delete' },
  { entity: 'theme',       deletable: true, reason: 'Gestaltung, kein Nachweis.', guard: 'nicht das aktive und nicht das Default-Theme', auditAction: 'themes.delete' },
];
```

**Umfang.** Die Politik führt die **dauerhaften Datensätze des Vereins** — was
Inhalt, Vorgang oder Nachweis abbildet. Nicht darin:

- **Flüchtige Infrastruktur** — Sitzungen. Werden bei Ablauf und beim
  Passwortwechsel gelöscht, ohne Protokoll, weil sie keinen Vereinsvorgang
  abbilden (Fundament §5).
- `apiToken` — wird widerrufen (`revokedAt` gesetzt), nicht gelöscht.
- `siteValue` — eine Variable wird auf ihren Leerwert zurückgesetzt (die Zeile in
  `site_values` verschwindet dabei); kein Löschvorgang im Sinn der Politik.
- Join-Zeilen wie die Foto-Zuordnung eines Tiers (`animal_photos`) — keine
  eigenständige Entität; sie werden über `setAnimalPhotos` neu gesetzt.

`entity` ist ein logischer Name, kein Tabellenname: `theme` etwa liegt als Wert
in der Einstellung `themes`, nicht in einer eigenen Tabelle. Wo eine Entität eine
eigene Tabelle hat, deckt sich `entity` mit dem `entityType` ihrer
`recordAudit`-Aufrufe (`siteEntry`, `mediaAsset`, `mediaFolder`).

**Der Test** `packages/core/src/deletion-policy.test.ts`:

1. Keine doppelten `entity`-Werte.
2. Jede Regel mit `deletable: true` hat `guard` **und** `auditAction`
   (Form `bereich.verb`); jede mit `deletable: false` hat beides **nicht**.
3. Ein festgezurrter Kern ist als `deletable: false` vorhanden: `user`, `role`,
   `setting`, `auditEntry`, `document`, `module`, `project`. Wer das ändert, muss
   diesen Test bewusst anfassen.

**`AGENTS.md`** verweist künftig auf `DELETION_POLICY` als kanonische Liste,
statt die Aufzählung in Prinzip 3 und in der Coding-Regel selbst zu führen.

## 4. Der Manifest-Haken `mediaReferences`

**Typ und Feld** in `packages/core/src/modules/manifest.ts`:

```ts
export interface MediaReference {
  /** Menschlich lesbar, für die Fehlermeldung und die Verwendungs-Spalte:
   *  z. B. 'Hund „Rocky"', 'Artikel „Sommerfest"', 'Logo des Vereins'. */
  label: string;
  /** Entitätstyp und ID, falls die Oberfläche später verlinken will. */
  entity: string;
  id: string;
}

export interface ModuleManifest {
  // … bestehende Felder
  /** Wo dieses Modul ein Medium verwendet — synchron, nur lesend, ohne
   *  Rechteprüfung. Befragt vor dem Löschen eines Assets. */
  mediaReferences?: (deps: Deps, assetId: string) => readonly MediaReference[];
}
```

**Der Kern ist selbst ein Manifest** (`coreModule` in
`packages/core/src/core-module.ts`) und bekommt sein eigenes `mediaReferences`:

- `branding.logoAssetId` (Einstellung) → Label „Logo des Vereins"
- `projects.imageAssetId` → Label „Projekt „&lt;Name&gt;""
- `documents.assetId` → Label „Dokument &lt;Nummer&gt;" — die harte Grenze:
  gerenderte PDFs sind Belege

**Die Aggregation** — neue Datei `packages/core/src/media/references.ts`:

```ts
export function findMediaReferences(deps: Deps, assetId: string): MediaReference[] {
  const manifests = [coreModule, ...enabledManifests(deps)];
  return manifests.flatMap((m) => m.mediaReferences?.(deps, assetId) ?? []);
}
```

`enabledManifests(deps)` gibt es bereits. Ein deaktiviertes Modul steht nicht in
der Liste und wird nicht befragt (Entscheidung 7) — dessen Inhalte sind ohnehin
nicht veröffentlicht, und das Asset kann jederzeit wieder auftauchen, wenn das
Modul zurückkommt. Der Preis: In dem seltenen Fenster „Modul aus, Asset gelöscht,
Modul wieder an" zeigt ein Feld ins Leere. Die Oberfläche des Moduls behandelt
ein fehlendes Asset schon heute als „missing" (siehe `animals`).

**Die Module liefern ihren Haken:**

- `packages/modules/animals` — prüft `animalPhotos.assetId`,
  `animalStories.beforeAssetId`, `animalStories.afterAssetId`; Label mit dem
  Tiernamen.
- `packages/modules/site` — geht Sammlungseinträge und Variablenwerte durch und
  sammelt jeden Wert in einem Feld mit `widget === 'asset'` (dieselbe
  Feld-Erkennung wie Seed und Export, `field-schema.ts`); Label „Eintrag
  „&lt;slug/Titel&gt;" in „&lt;Sammlung&gt;"" bzw. „Variable „&lt;key&gt;"".

## 5. `deleteMediaAsset` und der Medienspeicher

**`MediaStore` bekommt `delete`** (`packages/core/src/media/store.ts`), in beiden
Implementierungen:

```ts
export interface MediaStore {
  // …
  /** Idempotent: fehlt die Datei, kein Fehler. */
  delete(filename: string): Promise<void>;
}
```

Datei-Store: `unlink`, `ENOENT` schlucken. Memory-Store: `files.delete`.

**Der Dienst** in `packages/core/src/media/service.ts`:

```ts
export async function deleteMediaAsset(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<null>>
```

Ablauf:

1. `requirePermission(ctx, 'media.upload')`.
2. `validate` gegen `z.object({ id: z.string().min(1) })`.
3. Datensatz laden — fehlt er: `notFound('mediaAsset', id)`.
4. `findMediaReferences(deps, id)` — nicht leer:
   `conflict('mediaAssetInUse', 'Wird verwendet bei: ' + refs.map(r => r.label).join(', ') + '. Entferne die Datei dort zuerst.')`.
5. Transaktion: `tx.delete(mediaAssets).where(eq(id))` **plus**
   `recordAudit(tx, deps, ctx, { action: 'media.delete', entityType: 'mediaAsset', entityId: id, before: record, summary: 'Datei „<filename>" gelöscht' })`.
6. **Nach** erfolgreichem Commit: `await deps.media.delete(record.filename)`.

**Reihenfolge und Teil-Fehlschlag.** Der Datensatz ist die Wahrheit; die Datei
wird erst nach dem Commit entfernt. Bricht der Prozess dazwischen ab, bleibt eine
verwaiste Datei liegen — harmlos, und ein späterer Upload mit gleichem Hash
findet sie über `flag: 'wx'` (schluckt `EEXIST`) wieder. Dasselbe Muster wie bei
`applySeed`.

**Recht.** `media.upload` (Entscheidung 5). Wer Medien hochlädt, darf sie auch
entfernen. Der Schlüsselname bleibt schief; die Alternative — ein neues Recht mit
Datenmigration für bestehende Rollen — steht in keinem Verhältnis zu einer
Mediathek, die ein einziger flacher Bereich ist.

**Fehlermeldung.** Die Fundstellen stehen als lesbarer Text in `message`.
`ServiceError` um ein strukturiertes Feld zu erweitern würde den `Result`-Typ
berühren, den das ganze Repo benutzt — der Nutzen hier ist zu klein, zumal die
Mediathek-Seite die Verwendung ohnehin neben jedem Asset zeigt.

## 6. Virtuelle Ordner

**Die Dateien bleiben flach** im Medienverzeichnis. Der Ordner ist Metadate.

**Datenmodell** — eine neue Tabelle und eine Spalte in `packages/core/src/db/schema.ts`:

```ts
export const mediaFolders = sqliteTable('media_folders', {
  path: text('path').primaryKey(),   // 'tiere', 'tiere/2024' — kanonisch, '/'-getrennt
  createdAt: text('created_at').notNull(),
});

// mediaAssets zusätzlich:
folder: text('folder'),              // null = Wurzel; sonst ein Pfad aus media_folders
```

Kein Fremdschlüssel: Die Wurzel (`null`) hat keine Zeile in `media_folders`. Die
Bindung „`folder` verweist auf einen existierenden Ordner" prüft die
Service-Schicht.

Pfad-Regeln: je Segment `^[a-z0-9][a-z0-9-]{0,60}$`, höchstens 8 Segmente tief,
Gesamtlänge ≤ 200. Kanonische Form ohne führenden/schließenden Schrägstrich.

**Neue Kern-Dienste** in `packages/core/src/media/folders.ts` (alle
`requirePermission(ctx, 'media.upload')`, alle auditiert):

| Funktion | Verhalten |
|---|---|
| `listMediaFolders(deps, ctx)` | alle Ordner mit Asset-Zähler (direkte Kinder), sortiert nach Pfad |
| `createMediaFolder(deps, ctx, { path })` | Segmente geprüft; Elternpfad muss existieren (oder Wurzel); Dublette → `conflict('folderExists')`; Audit `media.folder.create` |
| `renameMediaFolder(deps, ctx, { from, to })` | `from` muss existieren, `to` frei; benennt die Zeile, alle Unterordner-Zeilen (`path` beginnt mit `from + '/'`) und hängt alle betroffenen Assets um — in einer Transaktion; Audit `media.folder.rename` |
| `deleteMediaFolder(deps, ctx, { path })` | nur wenn kein Asset `folder = path` hat **und** kein Ordner darunter liegt; sonst `conflict('folderNotEmpty')`; Audit `media.folder.delete` |
| `moveMediaAsset(deps, ctx, { id, folder })` | `folder` null oder existierender Pfad (`conflict('folderNotFound')`); Audit `media.move` mit before/after |

**`storeMediaAsset` / `storeMediaInternal`** bekommen ein optionales `folder`.
Ist es gesetzt, muss der Ordner existieren. Bei einem **Dedup-Treffer** (gleicher
Inhalts-Hash schon abgelegt) wird der vorhandene Datensatz unverändert
zurückgegeben — sein Ordner gewinnt, ein mitgegebenes `folder` wird ignoriert.
Dokumentiert im Funktionskommentar.

**Backup.** Tabelle und Spalte reisen im `kompass.db` mit; kein gesonderter
Schritt in Export/Import.

## 7. `listMediaAssets` mit Referenzen

Die Rückgabe ändert sich von `MediaAssetRecord[]` auf:

```ts
{ record: MediaAssetRecord; references: MediaReference[] }[]
```

Optionaler Parameter `folder?: string | null` filtert auf einen Ordner (kein
Filter = alle). Der einzige heutige Aufrufer ist die noch nicht existierende
Oberfläche — kein Bruch. `getMediaAsset` bleibt unverändert.

## 8. MCP

`media.upload` steht heute in `WITHOUT_MCP` (`apps/kompass/tests/mcp-tools.test.ts`)
— ein Recht ohne Werkzeug, geduldet. Das entfällt. Neue Werkzeuge in
`packages/mcp/src/core-tools.ts`, alle nennen `media.upload`:

| Werkzeug | Beschreibung |
|---|---|
| `media_list` | Assets mit Größe, Typ, Ordner und Verwendung; optionaler `folder`-Filter |
| `media_delete` | Asset löschen; abgelehnt, solange ein Datensatz darauf verweist; auditiert |
| `media_move` | Asset in einen Ordner verschieben |
| `media_folder_create` | Ordner anlegen |
| `media_folder_rename` | Ordner (und Unterordner, und Assets) umbenennen |
| `media_folder_delete` | leeren Ordner löschen |

`media.upload` fliegt aus `WITHOUT_MCP`; die begründete Ausnahme im Testkommentar
wird gestrichen.

## 9. Oberfläche

Neu: `apps/kompass/src/app/(shell)/admin/media/page.tsx`, Navigationseintrag
„Mediathek" in der Admin-Gruppe, sichtbar mit `media.upload`.

**Layout zweispaltig:**

- **Links: Ordnerbaum** aus `listMediaFolders` — aus den Pfaden aufgebaut,
  Wurzel oben. „Neuer Ordner" (Dialog mit Namensfeld, legt unter dem gewählten
  Ordner an). Je Ordner: Umbenennen (Dialog), Löschen (aus/deaktiviert, solange
  nicht leer).
- **Rechts: die Assets des gewählten Ordners** (`listMediaAssets(deps, ctx, folder)`)
  — Vorschaubild bei Bildern, Dateiname, Größe, Typ, Hochladedatum, hochgeladen
  von. Spalte **„Verwendung"**: die `references` als Liste von Labels; leer →
  Badge „nicht verwendet". Je Asset: „Verschieben nach…" (Auswahl aus den
  Ordnern) und „Löschen".
- **Löschen** öffnet einen Bestätigungsdialog. Ist das Asset verwendet, ist der
  Knopf aus und der Dialog nennt die Fundstellen; fällt zwischen Anzeige und
  Klick eine Referenz weg oder kommt eine hinzu, greift zusätzlich das `conflict`
  aus dem Dienst.

**Server-Actions** in `apps/kompass/src/app/(shell)/admin/media/actions.ts`:
`uploadMediaAction`, `deleteMediaAction`, `moveMediaAction`, `createFolderAction`,
`renameFolderAction`, `deleteFolderAction` — jede ruft die entsprechende
Kern-Funktion und `revalidatePath`. Übersetzungen unter `media.*` in
`apps/kompass/messages/de.json`.

Oben in der rechten Spalte ein **Upload-Feld** (`uploadMediaAction` →
`storeMediaAsset` mit dem gerade offenen Ordner). Der `MediaPicker` in Formularen
bleibt unverändert — sein „Entfernen" löst nur die Feld-Referenz und macht das
Asset damit gegebenenfalls löschbar.

## 10. Tests

**Kern:**

- `deletion-policy.test.ts` — keine doppelten Entitäten; `deletable` ⇔ `guard` +
  `auditAction`; der festgezurrte `false`-Kern ist vorhanden.
- `media/delete.test.ts` — Erfolg (unreferenziert → Zeile weg, Datei weg, Audit
  `media.delete`); `forbidden`; `validation` (fehlende ID); `notFound`;
  `conflict('mediaAssetInUse')` je Referenzart (Logo, Projektbild, Dokument) mit
  Label in der Meldung.
- `media/references.test.ts` — `findMediaReferences` bündelt Kern + aktive
  Module; ein deaktiviertes Modul wird nicht befragt.
- `media/folders.test.ts` — anlegen (Erfolg; fehlender Elternordner; ungültige
  Segmente; Dublette); umbenennen (Unterordner und Assets ziehen mit; Audit);
  löschen (leer → ok; Asset drin → `conflict`; Unterordner drin → `conflict`);
  `moveMediaAsset` (Ziel existiert / existiert nicht); Upload mit `folder`; Dedup
  behält den Ordner. Je Fall `forbidden` + Audit-Eintrag.
- Bestehende Media-Tests: `listMediaAssets` liefert jetzt `{ record, references }`;
  `folder`-Filter.

**Module:**

- `packages/modules/animals/tests/` — `mediaReferences` liefert Fundstellen für
  Foto und Vorher/Nachher-Bild mit Tiername; leer bei fremdem Asset.
- `packages/modules/site/tests/` — `mediaReferences` findet Asset-Felder in
  Einträgen und Variablen mit lesbarem Label; leer sonst.

**App:**

- `apps/kompass/tests/mcp-tools.test.ts` — `media.upload` ist raus aus
  `WITHOUT_MCP`; die sechs neuen Werkzeuge existieren und nennen das Recht in
  ihrer Beschreibung.
- Ein Integrationstest mit vollständiger Registry (`coreModule`, `animalsModule`,
  `siteModule`): `deleteMediaAsset` scheitert an einem Tierfoto — modulübergreifend.

**e2e** `apps/kompass/e2e/media.spec.ts` (neu): Bild über eine Entität hochladen
→ in der Mediathek sichtbar; Ordner anlegen, Asset verschieben; Löschen bei
Verwendung blockiert und zeigt die Fundstelle; Referenz entfernen → Löschen geht;
leeren Ordner löschen. `SITE_TEMPLATE_DIR` ist in der Playwright-Konfiguration
bereits gesetzt.

## 11. Migration

Eine Migration über `pnpm --filter @kompass/core db:generate`:

- `CREATE TABLE media_folders (path text primary key, created_at text not null)`
- `ALTER TABLE media_assets ADD COLUMN folder text`

Kein Backfill: Bestandsassets haben `folder = null` (Wurzel), es gibt anfangs
keine Ordner. Erzeugte SQL-Datei wird committet und nicht editiert.

## 12. Dateien

**Kern:**
- `packages/core/src/deletion-policy.ts` (neu) + `deletion-policy.test.ts` (neu)
- `packages/core/src/modules/manifest.ts` — `MediaReference`, `mediaReferences`
- `packages/core/src/core-module.ts` — `mediaReferences` für Logo/Projekt/Dokument
- `packages/core/src/media/references.ts` (neu) + Test
- `packages/core/src/media/folders.ts` (neu) + Test
- `packages/core/src/media/service.ts` — `deleteMediaAsset`, `listMediaAssets`-Rückgabe, `folder` bei `storeMedia*`
- `packages/core/src/media/store.ts` — `MediaStore.delete`
- `packages/core/src/db/schema.ts` — `mediaFolders`, `mediaAssets.folder`
- `packages/core/src/db/migrations/` — generierte Migration
- `packages/core/src/index.ts` — Exporte
- `packages/core/src/media/*.test.ts` — Anpassungen an der Rückgabe

**Module:**
- `packages/modules/animals/src/manifest.ts` + `references.ts` (o. ä.) + Test
- `packages/modules/site/src/manifest.ts` + `references.ts` + Test

**MCP:**
- `packages/mcp/src/core-tools.ts` — sechs Werkzeuge

**App:**
- `apps/kompass/src/app/(shell)/admin/media/page.tsx` (neu)
- `apps/kompass/src/app/(shell)/admin/media/actions.ts` (neu)
- `apps/kompass/src/app/(shell)/admin/media/*` — Komponenten (Baum, Liste, Dialoge)
- App-Navigation — Eintrag „Mediathek"
- `apps/kompass/messages/de.json` — `media.*`
- `apps/kompass/tests/mcp-tools.test.ts` — `WITHOUT_MCP`
- `apps/kompass/tests/` — Integrationstest
- `apps/kompass/e2e/media.spec.ts` (neu)

**Doku:**
- `AGENTS.md` — Prinzip 3 und Coding-Regel verweisen auf `DELETION_POLICY`;
  Quellenliste um diese Spec
- `docs/backlog.md` — Punkt 2 entfernen
- `docs/betrieb.md` — Hinweis, dass Ordner virtuell sind

## 13. Self-Review

**Platzhalter.** Keine offenen TBD.

**Konsistenz.** `media.upload` als Recht durchgehend (Abschnitt 5, 6, 8).
`DELETION_POLICY` nennt `media.delete`, `media.folder.delete` als `auditAction`;
`deleteMediaAsset` (Abschnitt 5) und `deleteMediaFolder` (Abschnitt 6) erzeugen
genau diese. Die `listMediaAssets`-Rückgabe ist in Abschnitt 7 einmal definiert
und in 9 (Oberfläche) und 10 (Tests) so verwendet.

**Zuschnitt.** Ein Plan, aber groß — er zerfällt natürlich in vier Blöcke:
Politik-Konstante; Referenz-Haken plus `deleteMediaAsset`; virtuelle Ordner;
Oberfläche. Der Implementierungsplan schneidet die Tasks entlang dieser Blöcke,
in dieser Reihenfolge (jeder für sich testbar, die Oberfläche zuletzt).

**Mehrdeutigkeit.** „Ordner existiert" heißt: eine Zeile in `media_folders` mit
diesem `path`, oder der Wert ist `null` (Wurzel). „Leerer Ordner" heißt: kein
Asset mit `folder = path` **und** kein Ordner mit `path` als Präfix + `/`.
„Referenziert" heißt: `findMediaReferences` liefert mindestens einen Eintrag —
Kern plus aktive Module, deaktivierte Module zählen nicht.

**Grenze bewusst.** Deaktiviertes Modul → seine Referenzen unsichtbar → ein Asset
kann gelöscht werden, das ein abgeschaltetes Modul noch führt. Vertretbar
(Abschnitt 4); die Modul-Oberflächen behandeln ein fehlendes Asset bereits als
„missing".
