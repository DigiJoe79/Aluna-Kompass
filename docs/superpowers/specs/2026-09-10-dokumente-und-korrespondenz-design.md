# Aluna Kompass — Dokumente und Korrespondenz (Design)

Stand 2026-09-10. Zweites Teilstück des Vorhabens „Kontakte, Korrespondenz und
Dokumentenmanagement". Die Kontakte stehen, die Dokument-Pipeline steht — was
fehlt, ist die Akte: der Ort, an dem ein Schreiben entsteht, festgeschrieben
wird und wiedergefunden werden kann, und an dem eingegangene Post liegt. Die
Rahmenentscheidungen dazu stehen in `2026-09-10-kontakte-design.md` § 10; diese
Spec übernimmt sie und führt sie aus.

## 1. Ausgangslage

Gebaut ist beides, was die Akte braucht, aber nicht die Akte selbst.

**Die Pipeline** (`2026-09-09-dokument-pipeline-und-basisvorlagen-design.md`):
`packages/documents` liefert drei Basis-Vorlagen, den Typst-Renderer und die
Auflösung über `/data/document-templates`. Der `DocumentTemplate`-Vertrag im
Manifest nimmt Zod-Schema, Slots und Markdown-Körper; `filed: false`
unterscheidet den Ad-hoc-Auszug vom Akteneintrag.

**Die Kontakte** (`2026-09-10-kontakte-design.md`): Empfänger, Anschriftsblock
über `formatPostalAddress`, die vier Fristklassen, die beiden Manifest-Haken
`retentionHolds` und `retentionDue`, der Fristenbildschirm.

**Die Akte fehlt.** Der Kern führt heute eine `documents`-Tabelle mit
lückenloser Nummer, Storno und einem einzelnen `entityType`/`entityId`-Paar.
Sie kennt keine Entwurfsphase, keine eingegangene Post, keine Klassifikation
und keinen Ordnungsbaum. Die einzige Briefvorlage `letterhead` ist ein
Beispiel: Sie füllt `title`, aber weder Empfänger noch Betreff, und ihr Text
kommt als Feld im Erzeugungsdialog. Ein Verein kann damit ein PDF ziehen, aber
keinen Schriftwechsel führen.

Der Anlass ist nicht ein bestimmtes Schreiben, das drückt, sondern die
Reihenfolge: Die Akte soll stehen, bevor der erste Vorgang anfällt, damit
nichts nachträglich einsortiert werden muss.

## 2. Ziel

Ein Modul `dms`, das die Akte führt — beidseitig. Ausgehende Post entsteht
darin als Entwurf, wird als gekennzeichnete Vorschau gelesen, festgeschrieben
und ist von da an unveränderlich. Eingehende Post wird abgelegt, klassifiziert
und verknüpft. Beides ist dasselbe Ding: Datei plus Metadaten, unterschieden
durch Herkunft und Entwurfsphase.

Gefunden wird ein Dokument auf zwei Wegen, die nebeneinander bestehen: über
seinen Platz in der **Sachakte** (Ordnungsbaum) und über seine Bezüge in der
**Beziehungsakte** (Kontakt, Tier, Projekt). Beim Einsortieren hilft Kompass,
soweit es das ohne Blick in die Datei kann: Vorschläge aus Dateiname, Absender
und Dokumentart, dazu einfache Regeln, die das Formular vorbelegen. Der Mensch
bestätigt; automatisch abgelegt wird nichts.

Dieselben Services stehen über MCP bereit. Der Zielzustand, auf den das
zuläuft: Post wird abgelegt, ein Agent schlägt Art, Betreff, Bezüge und Frist
vor, der Mensch schreibt fest. Die Treffsicherheit wächst mit der OCR aus
Phase 4, ohne dass sich die Schnittstelle ändert.

## 3. Entscheidungen aus dem Brainstorming (2026-09-10)

Die Nummern 1–12 sind die Rahmenentscheidungen aus `2026-09-10-kontakte-design.md`
§ 10, hier als gültig übernommen. 13–20 kommen aus diesem Brainstorming.

| # | Entscheidung | Verworfen |
|---|---|---|
| 13 | Die **ganze Akte ist das Modul** `dms`; im Kern bleibt nur die Pipeline ohne jede Ablage. Die vorhandene `documents`-Tabelle zieht per Migration um. | Akte im Kern, nur die Korrespondenz als Modul; Registratur im Kern und Fachakte im Modul |
| 14 | Modulschlüssel **`dms`**, Paket `@kompass/module-dms`, Rechte `dms.*`. | `records` (fremder Begriff), `documents` (kollidiert mit `@kompass/documents`) |
| 15 | **Sachakte und Beziehungsakte nebeneinander**: `documents.folder` für den Ordnungsbaum, `document_links` für die Bezüge. Keines setzt das andere voraus. | Nur Ordner; nur Bezüge; Ordner mit eigenen Rechten |
| 16 | **Ein Recht für die ganze Akte** (`dms.view`). Keine Vertraulichkeitsstufe, kein zweites Leserecht. | Schalter „vertraulich" am Dokument; Sichtbarkeit je Ordner |
| 17 | Kompass bringt einen **freien Brief** als Dokumentart mit: Empfänger aus den Kontakten, Betreff, Markdown-Textfeld. | Nur Fachvorlagen (kein eigener Brief möglich); Brief samt Textbausteinspeicher |
| 18 | Das **Nummernpräfix hängt an der Dokumentart**, nicht an der Vorlage; `DocumentTemplate.prefix` wird zu `type`. Ein Weg für erzeugte und eingegangene Post. | Vorlage behält `prefix`, Eingang bekommt ein zweites Verfahren |
| 19 | **Einsortierhilfe schlägt vor, legt nie ab.** Regeln belegen das Formular vor; bestätigt wird von Hand. | Regeln legen automatisch ab; gar keine Regeln |
| 20 | Der **Eingangskorb ist `folder IS NULL`**, kein eigener Zustand und keine eigene Tabelle. *Nachtrag 2026-09-12: und `direction = 'incoming'`. Ein Ausgang oder Entwurf ohne Ordner ist kein Eingang; die Ordnerspalte zählte sonst Briefe als Post, die einzusortieren wäre.* | Statusfeld `inbox`; eigene Tabelle für Unsortiertes |

**Nicht-Ziele** (Entscheidung 12, hier präzisiert): Formatierleiste und
Vorlagenspeicher für Brieftexte; OCR; Volltextsuche; Serienbriefe; E-Mail-Versand
und -Empfang; Vertraulichkeitsstufen; Wiedervorlage und Fristenüberwachung
jenseits der Aufbewahrung; Versionierung festgeschriebener Dokumente (dafür gibt
es Storno).

## 4. Der Schnitt zwischen Kern und Modul

**Im Kern bleibt die Pipeline, ohne Ablage.** Der `DocumentTemplate`-Vertrag,
die Basis-Vorlagen samt Auflösung über `/data/document-templates`, der
Markdown→Typst-Wandler, `prepare`/`buildContext`/`render`, `listDocumentBases`
und `exportDocument`. Der Auszugsweg benutzt die `documents`-Tabelle nicht — er
rendert, gibt zurück und schreibt einen Audit-Eintrag. Als Recht behält der Kern
`documents.export`; `documents.create` und `documents.view` entfallen dort.

**Die Mediathek wächst um die Prüfsumme** (Entscheidung 3):
`media_assets.checksum`, SHA-256 hexadezimal, beim Ablegen gefüllt — für jede
Datei, nicht nur für Dokumente. Sie ist der Grund, warum das PDF und nicht die
Datenbankzeile der rechenschaftsrelevante Datensatz sein kann.

**Ins Modul `dms` zieht die Akte**: die Tabelle `documents` in neuer Form,
`document_links`, `document_types`, `document_folders`, `document_rules`, die
Services, die Rechte, die MCP-Werkzeuge und die Oberfläche. Das Manifest
deklariert `dependsOn: ['contacts']` (Entscheidung 11).

**Umzug.** Migration `0013_dms.sql` übernimmt die Tabelle mitsamt Inhalt und
erweitert sie; `entityType`/`entityId` wandern in `document_links` mit der Rolle
`about`. Die Vorlage `letterhead` verschwindet aus `coreDocumentTemplates()` und
wird im Modul zum freien Brief; im Kern bleibt `audit-log-export` als Auszug.
Die Oberfläche unter `apps/kompass/src/app/(shell)/admin/documents` zieht nach
`/dms` und bekommt eine eigene Navigation statt eines Platzes in der Verwaltung
— die Akte ist Tagesgeschäft, keine Administration. Die Basis-Vorlagen-Übersicht
(`bases-panel.tsx`) bleibt in der Verwaltung, weil sie zur Pipeline gehört.

**Konsequenz, bewusst getragen.** Ohne installiertes `dms` kann eine
Installation keine Dokumente ablegen, nur Auszüge ziehen. Fachmodule, die später
Bescheinigungen erzeugen (Stufe 3), deklarieren `dependsOn: ['dms']`.

## 5. Datenmodell

Alle Tabellen im Modul (`packages/modules/dms/src/schema.ts`), Migration zentral.

### 5.1 `documents`

Ein Eintrag ist eine Datei plus Metadaten, gleich welcher Herkunft
(Entscheidung 5).

| Spalte | Typ | Bedeutung |
|---|---|---|
| `id` | ULID | |
| `phase` | `draft` \| `issued` | Entwurf oder festgeschrieben |
| `direction` | `outgoing` \| `incoming` | Herkunft |
| `sourceKind` | `generated` \| `uploaded` | erzeugt oder hochgeladen |
| `typeKey` | FK `document_types.key` | Dokumentart |
| `number` | Text, **nullable** | erst beim Festschreiben; unique |
| `subject` | Text | Betreff |
| `documentDate` | ISO-Datum | Datum **auf** dem Dokument; löst die Frist aus |
| `folder` | Text, nullable | Platz in der Sachakte; `null` = Eingangskorb |
| `draftBody` | Text, nullable | Markdown des Entwurfs; beim Festschreiben geleert |
| `templateKey` | Text, nullable | nur `generated` |
| `inputSnapshot` | JSON, nullable | nur `generated`: Daten, Slots, Basis, Basis-Prüfsumme |
| `assetId` | FK `media_assets.id`, nullable | die Datei; beim Entwurf leer |
| `status` | `issued` \| `voided` | Storno |
| `voidedAt`, `voidedByUserId`, `voidReason` | | wie bisher |
| `createdByUserId`, `createdAt`, `updatedAt` | | |

`number` ist nullable, weil ein Entwurf keine trägt (Entscheidung 1); der
Unique-Index bleibt und greift für alle nicht-leeren Werte. `documentDate` und
nicht `createdAt` trägt die Frist, weil eingegangene Post ein Datum hat, das vor
dem Empfang liegt.

`draftBody` ist die einzige Fundstelle des Entwurfstexts (Entscheidung 4): Er
lebt an der Entwurfszeile, geht mit ihr, und ist nach dem Festschreiben nur noch
im PDF. Ein Entwurf hat keine `assetId` — er ist noch keine Datei.

### 5.2 `document_links`

`documentId`, `entityType`, `entityId`, `role`, `createdAt`; unique über die
ersten vier (Entscheidung 6). `entityType` ist ein freier String wie bei
`mediaReferences`, damit das Modul keine fremden Entitäten kennen muss. Rollen
als Enum im Code: `sender`, `recipient`, `about`. Ein Brief an eine Behörde über
ein Tier ist ein Dokument mit zwei Zeilen.

### 5.3 `document_types`

Die Klassifikation als Stammdaten, nicht als Konstanten (Prinzip 2): `key`,
`label`, `prefix` (drei Großbuchstaben, Entscheidung 18), `defaultDirection`,
`retentionClass`, `defaultFolder`, `isActive`, `sortOrder`. Die Fristklasse
hängt an der Art — der Hebel, über den die Formularhilfe die Aufbewahrung
richtig setzt, ohne dass jemand sie eintippt.

### 5.4 `document_folders`

Pfadtabelle nach dem Muster von `media_folders`: `path` als Schlüssel,
`/`-getrennt, kanonisch, plus `createdAt`. Der Ordnungsbaum der Sachakte, frei
benennbar.

### 5.5 `document_rules`

`id`, `matchField` (`filename` \| `senderName`), `matchContains`, `thenTypeKey`,
`thenFolder`, `isActive`, `sortOrder`. Bewusst klein: keine Bedingungsketten,
keine Negation, kein automatisches Ablegen (Entscheidung 19).

## 6. Lebenszyklus und Services

Hausform `fn(deps, ctx, input) → Promise<Result<T>>`, Ablauf `requirePermission`
→ `validate` → `db.transaction` → `recordAudit` → `ok`.

### 6.1 Ausgang

- `createDraft` — Art, Bezüge, Betreff, Körper; Zeile ohne Nummer, `phase: draft`.
- `updateDraft` — beliebig oft; nur im Entwurf.
- `deleteDraft` — Arbeitsmaterial, mit Zeile im Änderungsprotokoll, ohne Storno.
- `previewDraft` — rendert durch dieselbe Pipeline und gibt die Bytes zurück,
  ohne abzulegen. `DocumentSlots` bekommt dafür `draft?: boolean`; die drei
  mitgelieferten Basen zeichnen dann ein Wasserzeichen, damit eine Vorschau nie
  mit dem Original verwechselt wird.
- `fileDocument` — der eine Übergang, der zählt (Entscheidung 2): Nummer ziehen,
  mit Nummer neu rendern, PDF in die Mediathek, Prüfsumme und `inputSnapshot`
  festhalten, `draftBody` leeren, `phase: issued`. Zweimal Festschreiben ist
  `conflict`.
- `voidDocument` — Storno wie bisher; ein festgeschriebenes Dokument ändert sich
  nie.

### 6.2 Eingang

`receiveDocument` — Datei, Art, `documentDate`, Bezüge, optional Ordner. Die
Datei geht in die Mediathek (mit Prüfsumme), die Zeile entsteht sofort als
`issued` mit Nummer aus dem Präfix der Art. Kein Entwurf, keine Vorschau, kein
Neu-Rendern: Die Datei ist, was sie ist.

Das steht nicht gegen Entscheidung 2. Die Nummer hängt am Übergang nach
`issued`, nicht am Rendern — beim Ausgang ist dieser Übergang das
Festschreiben, beim Eingang das Ablegen. Was es nicht gibt, ist ein Dokument in
`issued` ohne Nummer oder eines in `draft` mit.

### 6.3 Lesen und Ordnen

`listDocuments` (Filter: Richtung, Art, Ordner, Phase, Bezug, Freitext über
Betreff und Nummer), `getDocument`, `linkDocument`/`unlinkDocument`,
`moveDocument` (Ordner setzen — das Einsortieren aus dem Eingangskorb),
`suggestClassification` (Vorschläge aus Dateiname, Absender und Regeln; rein
lesend, ändert nichts), dazu die Stammdatenservices für Arten, Ordner und Regeln.

### 6.4 Nummernvergabe

`nextDocumentNumber` zieht mit ins Modul. Präfix kommt aus der Dokumentart
(Entscheidung 18), Format und Lückenlosigkeit je Präfix und Jahr bleiben, samt
Wiederholung bei Kollision am Unique-Index.

### 6.5 Löschen und Fristen

`DELETION_POLICY` bekommt zwei Einträge:

- `documentDraft` — `deletable: true`, ohne Frist. Arbeitsmaterial
  (Entscheidung 1).
- `document` — `deletable: true` mit `retentionClass` aus der Dokumentart und
  dem Hinweis, was eine Löschung verhindert. Kein Knopf, sondern ein fälliger
  Vorgang mit Datum (Entscheidung 10): Das Modul beantwortet `retentionDue` mit
  allem, dessen Frist ab `documentDate` abgelaufen ist. Aufbewahrungsfrist
  sticht Löschpflicht.

`retentionHolds` beantwortet das Modul aus `document_links`: „Dokument
BRF-2026-004 hält diesen Kontakt bis 31.12.2036." Damit wird die Verknüpfung zur
Halterauskunft, die der Kontaktbildschirm schon anzeigt — ohne neue Mechanik.

## 7. Rechte und MCP

`dms.view` (lesen und herunterladen), `dms.create` (Entwürfe und Eingang),
`dms.file` (festschreiben), `dms.void` (stornieren), `dms.deleteDraft`
(wegwerfen), `dms.manage` (Arten, Ordner, Regeln). Getrennt, weil Festschreiben
und Stornieren die Handlungen mit Folgen sind: Ein Schriftführer darf entwerfen,
der Vorstand schreibt fest. Ein Recht für die ganze Akte, keine
Vertraulichkeitsstufe (Entscheidung 16).

MCP-Werkzeuge mit echtem Zod-Schema, zu jedem Recht mindestens eines
(Prinzip 8): `dms_list`, `dms_get`, `dms_create_draft`, `dms_update_draft`,
`dms_delete_draft`, `dms_file`, `dms_void`, `dms_receive`, `dms_link`,
`dms_suggest_classification`, `dms_manage_types`. `dms_receive` nimmt die Datei
als Base64 oder als bereits abgelegte `assetId`.

## 8. Oberfläche

Unter `/dms`, eigene Navigation:

- **Liste** mit Filtern nach Richtung, Art, Ordner und Phase; der Eingangskorb
  als Filter `folder IS NULL` mit Zähler in der Navigation.
- **Detailseite** mit PDF-Vorschau, Metadaten, Bezügen und Aufbewahrungsblock,
  nach dem Muster der Kontakt-Detailseite.
- **Entwurfsbildschirm** mit Empfängerauswahl aus den Kontakten, Betreff,
  Markdown-Textfeld, Vorschau- und Festschreiben-Knopf. Kein Rich-Text-Editor
  (Entscheidung 12).
- **Ablegen-Dialog** für Eingangspost: Datei, vorbelegte Felder aus
  `suggestClassification`, Bezüge.
- **Ordnerverwaltung**; Arten und Regeln unter Verwaltung, weil Stammdaten.

Auf der Kontakt-Detailseite entsteht nichts Neues: Dokumente erscheinen dort als
Halter im Aufbewahrungsblock.

## 9. Tests

Pro Service Erfolg, `forbidden`, `validation`, Audit-Eintrag. Dazu:

- Entwurf hat keine Nummer; `previewDraft` legt nichts ab und trägt das
  Wasserzeichen.
- `fileDocument` vergibt lückenlos, leert `draftBody`, füllt `assetId` und
  Prüfsumme; zweimal ist `conflict`.
- Prüfsumme stimmt mit den Bytes der Datei überein.
- Ein festgeschriebenes Dokument lässt sich nicht ändern.
- Löschung erst nach Fristablauf; `retentionDue` rechnet ab `documentDate` und
  dem Ablauf des Kalenderjahres.
- `retentionHolds` nennt Nummer und Frist.
- Gleicher Entwurf, gleiche Basis, gleiches Branding ⇒ byte-identisches PDF.
- Migration: vorhandene Zeilen behalten Nummer und Datei, `entityType`/`entityId`
  landen als `about`-Link.
- E2E: Brief entwerfen, Vorschau, festschreiben, in der Akte wiederfinden; Datei
  in den Eingangskorb laden und einsortieren.

## 10. Seed

Über den `seed`-Haken des Moduls, frei erfunden und idempotent (AGENTS.md):
ein generischer Satz Dokumentarten (Brief, Behördenschreiben, Vertrag, Rechnung,
Protokoll), ein Ordnerbaum, ein Entwurf, ein festgeschriebener Brief an einen
Seed-Kontakt, ein Eingangsdokument im Korb, eine Regel. Mit `tests/seed.test.ts`.

## 11. Dateien

**Neu:** `packages/modules/dms/` (`schema.ts`, `manifest.ts`, `service.ts`,
`drafts.ts`, `classification.ts`, `retention.ts`, `templates.ts`, `mcp-tools.ts`,
`seed.ts`, `tests/`), Migration `packages/core/src/db/migrations/0013_dms.sql`,
Oberfläche `apps/kompass/src/app/(shell)/dms/`.

**Geändert:** `packages/core/src/db/schema.ts` (Prüfsumme an `media_assets`,
`documents` entfällt), `packages/core/src/documents/service.ts` (nur noch
Auszug), `packages/core/src/permissions/core.ts`, `packages/core/src/deletion-policy.ts`,
`packages/core/src/modules/manifest.ts` (`DocumentTemplate.prefix` → `type`,
`DocumentSlots.draft`), `packages/documents/src/templates.ts` (`letterhead`
entfällt), die drei Basen (Wasserzeichen), `apps/kompass/messages/de.json`.

**Entfällt:** `apps/kompass/src/app/(shell)/admin/documents/` bis auf
`bases-panel.tsx`.

## 12. Self-Review

**Platzhalter.** Keine offenen Punkte. Was nicht gebaut wird, steht als
Nicht-Ziel in Abschnitt 3.

**Konsistenz.** Die Dokumentart ist durchgängig der Träger von Präfix und
Fristklasse (§ 5.3, § 6.4, § 6.5) — daran hängt Entscheidung 18. Der Eingangskorb
ist überall `folder IS NULL` (§ 5.1, § 6.3, § 8), kein eigener Zustand. Der
Entwurfstext hat genau eine Fundstelle (`draftBody`, § 5.1) und verschwindet beim
Festschreiben (§ 6.1).

**Zuschnitt.** Vier Blöcke für den Plan: Umzug und Datenmodell samt Migration;
Entwurfsweg und Festschreiben; Eingang, Klassifikation und Einsortierhilfe;
Oberfläche, MCP und Seed.

**Ambiguität.** „Festschreiben" heißt: Nummer vergeben, PDF erzeugt, Zeile
unveränderlich. „Fällig" heißt wie bei den Kontakten: Frist abgelaufen, ein
Mensch bestätigt die Löschung. Ein Entwurf ist kein Dokument im Sinne der
Rechenschaft — er hat keine Nummer, keine Datei und keine Frist.

**Abgrenzung zur Pipeline.** Das Modul erzeugt keine PDF-Bytes selbst; es ruft
die Kern-Pipeline. `build(data)` bleibt rein, das Auflösen der Bezüge
(`resolve(refs)`) geschieht im Service vor dem Rendern (Entscheidung 7).
