# Aluna Kompass — Akte fertig (Design)

Stand 2026-09-12. Säule „Korrespondenz und Akte", Roadmap-Schritt 1 aus
`docs/nordstern.md`. Viertes Teilstück nach Kontakten, Dokumenten und
Volltext. Die Akte steht; dieses Vorhaben macht sie fertig im Sinne des
Nordsterns: Ein Verein kann einen Schriftwechsel vollständig darin führen, vom
Entwurf über den Versand bis zur Antwort, und die Oberfläche entspricht dem
Handoff.

## 1. Ausgangslage

Eine Durchsicht des ganzen Moduls am 2026-09-12 (Services, Oberfläche, Routen,
MCP, Tests) ergab: Die Substanz trägt. Services nach Muster, Protokoll in der
Transaktion, ein Worker, der Abstürze überlebt, ein Index, der das Original
nie anfasst. Was fehlt, sind Wege, die die Spec versprochen hat und die nie
gebaut wurden, und ein paar Stellen, an denen der Code weniger streng ist als
seine Kommentare.

**Versprochen und nicht gebaut:**

1. **Der Eingangskorb hat keinen Ausgang.** `moveDocument` existiert, keine
   Oberfläche ruft es. Ein Dokument im Eingangskorb kommt dort nur über MCP
   heraus.
2. **Bezüge sind in der Oberfläche unantastbar.** `linkDocument` und
   `unlinkDocument` gibt es nur über MCP. Der Entwurf kennt den Empfänger, das
   festgeschriebene Dokument kennt gar nichts.
3. **Die Beziehungsakte ist einseitig.** Das Dokument zeigt seine Bezüge;
   Kontakt, Tier und Projekt zeigen nicht ihre Dokumente. `linkedTo` in
   `listDocuments` hat keinen Aufrufer in der Oberfläche.

**Weniger streng als gedacht:**

4. `voidDocument` prüft `phase` nicht: Ein Entwurf lässt sich stornieren
   („Dokument null storniert") und bleibt danach bearbeitbar und
   festschreibbar.
5. `receiveDocument`, `createDraft` und `updateDraft` prüfen `folder` nicht
   gegen `document_folders`; `moveDocument` tut es. Über MCP landet ein
   Dokument in einem Ordner, den die Ordnerspalte nie zeigt.
6. `dms_receive` nimmt laut Schema ein `assetId`, das der Service nie
   auflöst; `dms_get` liefert die PDF-Bytes als JSON-Objekt mit Zehntausenden
   Zahlenschlüsseln.
7. Parität mit Löchern: kein Werkzeug entfernt einen Bezug, keines verwaltet
   Ordner oder Regeln, `dms_manage_types` sagt „create or change" und kann nur
   anlegen. Der Paritätstest bleibt grün, weil jedes Recht irgendwo genannt
   wird.
8. `nextDocumentNumber` beginnt bei 001, wenn das letzte Dokument eines
   Präfixes und Jahres gelöscht wurde. Eine Nummer kann damit zwei Dokumente
   bezeichnen, das gelöschte im Protokoll und ein neues in der Akte.
9. `deleteDocument` (Fristlöschung, `dms.manage`) prüft `phase` nicht und
   löscht auch Entwürfe, sobald deren Datum alt genug ist — am Recht
   `dms.deleteDraft` vorbei.
10. Der Empfänger ist ein `<select>` über die ersten 200 Kontakte. Vor
    Finanzen kommen Spender, dann trägt das nicht mehr.

Dazu die fünf Punkte, die der Nordstern für „Akte fertig" nennt: Bezüge
zwischen Dokumenten, Versandvermerk, Wiedervorlage, Notiz, Textbausteine. Und
Backlog 6, sortierbare Tabellen, weil die Dokumentliste ohnehin angefasst wird.

Bewusst nicht in diesem Vorhaben: Agent-Vorschläge beim Ablegen und
Einsortierregeln auf dem Volltext (Nordstern „Später"), der Aktenexport für
Prüfer (Finanzen, Schritt 3), Serienerzeugung (Finanzen).

## 2. Ziel

Ein Schriftwechsel lässt sich vollständig in der Akte führen. Ein Eingang wird
abgelegt und als Antwort auf ein früheres Schreiben markiert; eine Antwort
darauf entsteht als Entwurf mit Textbausteinen, wird festgeschrieben,
versandt, und die Akte weiß, wann und wie. Wer eine Antwort erwartet, setzt
eine Wiedervorlage, die auf der Startseite erscheint, bis jemand sie abhakt.
Was einer der drei Vorstände sich zum Dokument merken will, steht als Notiz
mit Namen und Zeit daneben. Und jede dieser Verbindungen ist von beiden Seiten
sichtbar: vom Dokument aus und vom Kontakt, Tier oder Projekt aus.

Alles, was hier neu ist, hat dieselbe Form wie das Vorhandene: ein Service
nach Muster, ein Recht, ein Werkzeug, ein Test, ein Seed.

## 3. Entscheidungen aus dem Brainstorming (2026-09-12)

Die Zählung führt die Kette fort (1–12 Kontakte, 13–20 Dokumente, 21–31
Volltext).

| # | Entscheidung | Verworfen |
|---|---|---|
| 32 | **Wiedervorlagen liegen im Kern**, mit generischem Bezug auf Entitätstyp und ID, und einer Liste auf der Startseite. Die Akte ist der erste Anwender, Finanzen und Gremien folgen ohne zweites Bauen. | Felder am Dokument im Modul; Liste unter Verwaltung |
| 33 | **Bezüge zwischen Dokumenten sind eine eigene Tabelle** mit Richtung und fester Art: Antwort auf, unterschriebene Fassung von, ersetzt, Anlage zu. Beide Enden zeigen den Bezug mit gedrehtem Text. | `document_links` mit `entityType: 'document'`; freie Art |
| 34 | **Ein Versandvermerk je Dokument**: Datum, Weg, Bemerkung. Nur an ausgehenden, festgeschriebenen Dokumenten, freiwillig, nachträglich mit Protokoll änderbar. Die Wege sind eine Einstellung mit Vorgabeliste (Prinzip 2). | Liste von Versänden; Weg als Konstante im Code; Versand als Pflicht |
| 35 | **Notizen sind ein Journal**: mehrere je Dokument, mit Person und Zeit, nur anhängen, nie ändern; löschen darf, wer geschrieben hat, oder wer verwaltet. Nie Teil des Dokuments. | Ein frei änderbares Feld |
| 36 | **Textbausteine ohne Platzhalter**: Name, wahlweise Betreff, Markdown. Eingefügt an der Schreibmarke; in einem leeren Entwurf setzt ein Baustein mit Betreff auch den Betreff. | Platzhalter für Empfänger und Datum (Vorstufe zum Serienbrief, der bei Finanzen kommt) |
| 37 | **Die Beziehungsakte an Kontakt, Tier und Projekt baut die App-Schicht**, die alle Module kennt, wie sie heute Bezüge zu Namen auflöst. | Manifest-Haken für Kästen an fremden Entitäten (kommt, wenn ein zweites Modul ihn braucht) |
| 38 | **Nummern werden nie wiedervergeben.** Ein Zähler je Präfix und Jahr, in derselben Transaktion hochgezählt wie das Dokument. | Höchste vorhandene Nummer plus eins (heute); Zähler aus dem Protokoll ableiten |
| 39 | **Ein Agent bekommt Metadaten und Volltext, nie Bytes.** `dms_get` ohne Datei, neues `dms_text` mit den Seiten aus dem Index. | Bytes als Base64; Datei-Werkzeug |
| 40 | **Ablegen verliert die Asset-Option.** Ein Medium aus der Mediathek ist kein Schriftverkehr, und der Weg hat nie funktioniert. | `assetId` auflösen und behalten |
| 41 | **Kontakt anlegen aus dem Editor heraus**, als Overlay am Suchfeld für Empfänger und Absender. | Wechsel zur Kontaktseite und zurück |
| 42 | **Ein Entwurf hinterlässt keine Feldspuren im Protokoll.** Was am Entwurf geändert wird, ist Arbeitsmaterial; gezählt wird das Festschreiben. Bleibt wie heute. | Empfängerwechsel und Datum am Entwurf protokollieren |

**Nicht-Ziele.** Agent-Vorschläge beim Ablegen; Einsortierregeln auf dem
Volltext; Aktenexport; Serienbriefe und Platzhalter; Benachrichtigungen per
E-Mail für Wiedervorlagen; Notizen bearbeiten; mehrere Versände je Dokument;
ein Manifest-Haken für fremde Kästen; Bezüge zwischen Dokumenten verschiedener
Installationen.

## 4. Datenmodell

### 4.1 Kern: Wiedervorlagen

`packages/core/src/db/schema.ts`, neue Tabelle `follow_ups`:

| Spalte | Typ | Bedeutung |
|---|---|---|
| `id` | text PK | ULID |
| `entityType`, `entityId` | text | Woran sie hängt, generisch wie `document_links` |
| `dueAt` | text (Datum) | Fällig am |
| `title` | text | Anlass, 1–200 Zeichen |
| `assigneeUserId` | text, nullable | Zuständig; leer heißt alle |
| `createdByUserId`, `createdAt` | text | |
| `doneAt`, `doneByUserId` | text, nullable | Abgehakt; die Zeile bleibt |
| `updatedAt` | text | |

Indizes: `(entity_type, entity_id)`, `(done_at, due_at)`.

Löschpolitik: `followUp` ist `deletable: true` als Arbeitsmaterial, mit
`auditAction: 'followUps.delete'`. Gelöscht wird selten; der Normalweg ist
Abhaken.

### 4.2 Akte: Dokumentbezüge

`packages/modules/dms/src/schema.ts`, neue Tabelle `document_relations`:

| Spalte | Typ | Bedeutung |
|---|---|---|
| `id` | text PK | |
| `documentId` | text FK → documents | Das Dokument, an dem der Bezug angelegt wurde |
| `relatedDocumentId` | text FK → documents | Das andere Ende |
| `kind` | enum `repliesTo` \| `signedCopyOf` \| `replaces` \| `attachmentOf` | Gelesen von `documentId` aus: „BEH-004 ist Antwort auf BRF-002" |
| `createdByUserId`, `createdAt` | text | |

Unique `(document_id, related_document_id, kind)`; Index auf
`related_document_id`. Ein Dokument darf sich nicht auf sich selbst beziehen.
Beide Enden dürfen Entwürfe sein: Der Entwurf einer Antwort bezieht sich auf
den Eingang, bevor er festgeschrieben ist.

**Was ein Dokument beim Verschwinden mitnimmt** (`deleteDraft` und
`deleteDocument`, in derselben Transaktion, vor der Zeile selbst): seine
Bezüge zu Entitäten, seine Dokumentbezüge in beiden Richtungen, seine
Notizen, seinen Volltext, und seine Wiedervorlagen im Kern über
`deleteFollowUpsFor(tx, 'document', id)` — auch die erledigten, weil der Kern
sonst Zeilen auf ein Ziel hält, das es nicht mehr gibt. Das Protokoll trägt
die Nummer des Dokuments und die Zahl der mitgelöschten Anhängsel im
`before`. Eine offene Wiedervorlage hindert das Löschen nicht: Die Frist ist
abgelaufen, und ein Anlass ohne Dokument wäre ein Anlass ins Leere.

Die gedrehte Lesart je Art:

| `kind` | am `documentId` | am `relatedDocumentId` |
|---|---|---|
| `repliesTo` | Antwort auf … | beantwortet durch … |
| `signedCopyOf` | unterschriebene Fassung von … | unterschrieben zurück als … |
| `replaces` | ersetzt … | ersetzt durch … |
| `attachmentOf` | Anlage zu … | Anlage: … |

Löschpolitik: `documentRelation` ist `deletable: true` (Arbeitsmaterial wie
`documentLink`), `auditAction: 'dms.unrelate'`.

### 4.3 Akte: Versandvermerk

Drei Spalten an `documents`:

| Spalte | Typ | |
|---|---|---|
| `sentAt` | text (Datum), nullable | |
| `sentVia` | text, nullable | Schlüssel eines Versandwegs aus der Einstellung |
| `sentNote` | text, nullable | max. 300 Zeichen |

Alle drei sind zusammen gesetzt oder zusammen leer. Nur `direction:
'outgoing'` und `phase: 'issued'`; ein Entwurf oder ein Eingang weist den
Vermerk mit `conflict` ab.

Die Versandwege sind eine Einstellung `dms.dispatchChannels` (Prinzip 2):
eine Liste aus `{ key, label }`, registriert in `install.ts` mit der
Vorgabe Post, Einschreiben, E-Mail, persönlich übergeben, Portal, sonstiges
(Schlüssel `post`, `registeredMail`, `email`, `inPerson`, `portal`,
`other`; Beschriftungen in der führenden Sprache der Installation, wie die
Startarten). Schlüssel sind `^[a-z][a-zA-Z0-9]*$`, eindeutig, mindestens
einer. `recordDispatch` nimmt nur Schlüssel an, die in der Einstellung
stehen. Wird ein Weg später aus der Einstellung genommen, behalten
vorhandene Vermerke ihren Schlüssel; die Oberfläche zeigt dann den
Schlüssel statt der Beschriftung, und das Protokoll trägt den Wert ohnehin.

### 4.4 Akte: Notizen

Neue Tabelle `document_notes`:

| Spalte | Typ | |
|---|---|---|
| `id` | text PK | |
| `documentId` | text FK → documents | |
| `body` | text | 1–4000 Zeichen, reiner Text |
| `createdByUserId`, `createdAt` | text | |

Index auf `document_id`. Keine `updatedAt`: Notizen werden nicht geändert.
Löschpolitik: `documentNote` ist `deletable: true`, `auditAction:
'dms.note.delete'`. Notizen stehen nie im PDF, nie im Index, nie in einem
Export.

### 4.5 Akte: Textbausteine

Neue Tabelle `document_snippets`:

| Spalte | Typ | |
|---|---|---|
| `id` | text PK | |
| `name` | text | 1–120 Zeichen, eindeutig |
| `subject` | text, nullable | max. 300 |
| `body` | text | Markdown, max. 20 000 |
| `sortOrder` | integer | |
| `isActive` | boolean | Inaktive erscheinen nicht im Editor |

Löschpolitik: `documentSnippet` ist `deletable: true`, `auditAction:
'dms.snippet.delete'`.

### 4.6 Akte: Nummernzähler

Neue Tabelle `document_counters`:

| Spalte | Typ | |
|---|---|---|
| `prefix` | text | drei Großbuchstaben |
| `year` | integer | Ablagejahr |
| `last` | integer | zuletzt vergebene Nummer |

Primärschlüssel `(prefix, year)`. Der Zähler ist Zustand, kein abgeleiteter
Wert: Er erinnert sich an Nummern, deren Dokument nicht mehr da ist, und genau
das ist sein Zweck. Prinzip 5 verbietet gespeicherte Ableitungen, nicht
gespeicherte Vergaben.

Die Migration füllt die Zähler aus dem Bestand: je `(prefix, year)` das
Maximum der vorhandenen Nummern. Für gelöschte Dokumente kann sie nichts
nachholen; ab der Migration gilt die neue Regel.

## 5. Services

Alle nach Muster: `requirePermission` → `validate` → Transaktion →
`recordAudit` → `ok`.

### 5.1 Kern: Wiedervorlagen (`packages/core/src/follow-ups/service.ts`)

| Service | Recht | |
|---|---|---|
| `createFollowUp({ entityType, entityId, dueAt, title, assigneeUserId? })` | `followUps.manage` | Audit `followUps.create` |
| `completeFollowUp({ id })` | `followUps.manage` | setzt `doneAt`/`doneByUserId`; `conflict`, wenn schon erledigt |
| `reopenFollowUp({ id })` | `followUps.manage` | leert beides |
| `deleteFollowUp({ id })` | `followUps.manage` | Arbeitsmaterial |
| `listFollowUps({ entityType, entityId, includeDone? })` | `followUps.view` | am Vorgang |
| `listDueFollowUps({ until, assigneeUserId? })` | `followUps.view` | offen und `dueAt <= until`, älteste zuerst; für die Startseite |
| `deleteFollowUpsFor(tx, entityType, entityId)` | intern, kein `ctx` | für Module, die ihre Entität löschen; läuft in deren Transaktion, schreibt keinen eigenen Protokolleintrag — der des Moduls nennt die Zahl |

Der Kern prüft nicht, ob die Entität existiert oder ob der Aufrufer sie sehen
darf — er kennt sie nicht. Das prüft, wer die Wiedervorlage anlegt: In der
Akte läuft das Anlegen durch einen dünnen Wrapper `createDocumentFollowUp`,
der `dms.create` und die Existenz des Dokuments prüft und dann den Kern ruft.
Die Startseite zeigt Titel, Datum und einen Link; der Link selbst ist durch
das Recht der Zielseite geschützt. Wer `followUps.view` hat, sieht also
Anlässe, aber keine Inhalte.

Zwei neue Kernrechte in `packages/core/src/permissions/core.ts`:
`followUps.view`, `followUps.manage`. Die Rolle „Administration" hat sie
automatisch; die Migration gibt sie jeder Rolle, die heute `dms.create` trägt,
damit niemand nach dem Update vor einem leeren Kasten steht.

Ein Manifest-Haken `followUpTargets` sagt dem Kern, wie ein Bezug zu
beschriften und zu verlinken ist: `(deps, entityType, id) => { label, href }
| null`. Die Akte antwortet für `document` mit Nummer und Betreff. Ohne
Antwort zeigt die Startseite den Anlass ohne Link.

Das ist kein Widerspruch zu Entscheidung 37, die einen Haken für Kästen
ablehnt. Dort ginge es darum, dass ein Modul Oberfläche in die Seite eines
anderen Moduls einhängt — ein neuer Mechanismus mit offenem Zuschnitt. Hier
fragt der Kern ein Modul nach einem Namen für etwas, das das Modul besitzt,
genau wie bei `mediaReferences` und `retentionHolds`: ein eingeführtes
Muster, dritte Anwendung. Der Haken ist die Richtung Kern → Modul, der
abgelehnte wäre Modul → fremdes Modul.

### 5.2 Akte: Bestand korrigieren

- `voidDocument`: `conflict('documentIsDraft')`, wenn `phase !== 'issued'`.
- `deleteDocument`: dasselbe. Entwürfe gehen nur über `deleteDraft`.
- `receiveDocument`, `createDraft`, `updateDraft`: `folder` wird wie in
  `moveDocument` normalisiert und gegen `document_folders` geprüft;
  `notFound('documentFolder')`, wenn es ihn nicht gibt. Dieselbe Hilfsfunktion
  `resolveFolder(db, folder)` für alle vier.
- `nextDocumentNumber(tx, prefix, year)` wird `allocateDocumentNumber`: liest
  den Zähler in der Transaktion, erhöht ihn, gibt die Nummer zurück. Die
  Schleife mit drei Versuchen in `fileDocument` und `receiveDocument` entfällt;
  die Unique-Verletzung wird zum technischen Fehler, weil sie nicht mehr
  vorkommen darf. `previewNextNumber` liest `last + 1` ohne zu erhöhen.
- `fileDocument`/`receiveDocument`: Die Datei wird weiter vor der Transaktion
  geschrieben, weil das Schreiben scheitern kann und die Zeile dann nicht da
  sein darf. Ohne Kollisionsschleife entsteht keine verwaiste Datei mehr;
  scheitert die Transaktion doch, wird die Datei im `catch` entfernt.

### 5.3 Akte: Dokumentbezüge (`relations.ts`)

| Service | Recht | |
|---|---|---|
| `relateDocuments({ documentId, relatedDocumentId, kind })` | `dms.create` | beide müssen existieren, dürfen nicht gleich sein; `conflict('relationExists')` |
| `unrelateDocuments({ id })` | `dms.create` | |
| `listRelations(documentId)` | intern | beide Richtungen, für `toRecord` |

`DocumentRecord` bekommt `relations: { id, kind, direction: 'out' | 'in',
otherId, otherNumber, otherSubject, otherPhase }[]`, damit die Oberfläche
nichts nachlädt.

Beim Storno bietet die Oberfläche „Ersatz anlegen" an. Das ist ein Service
`createReplacementDraft({ voidedId })` (`dms.create`): neuer Entwurf mit Art,
Betreff und Ordner des stornierten Dokuments, Text aus
`inputSnapshot.input.body` (nur bei `sourceKind: 'generated'`), Empfänger
übernommen, und ein Bezug `replaces` vom neuen auf das alte Dokument.
Voraussetzung: das alte ist `voided`.

### 5.4 Akte: Versand (`dispatch.ts`)

| Service | Recht | |
|---|---|---|
| `recordDispatch({ id, sentAt, sentVia, note? })` | `dms.create` | setzt oder ersetzt; Audit `dms.dispatch` mit Vorher/Nachher |
| `clearDispatch({ id })` | `dms.create` | leert; Audit `dms.dispatch.clear` |

`sentAt` darf nicht vor `documentDate` liegen und nicht in der Zukunft
(`deps.clock`); `sentVia` muss ein Schlüssel aus `dms.dispatchChannels`
sein (`validation`).

### 5.5 Akte: Notizen (`notes.ts`)

| Service | Recht | |
|---|---|---|
| `addNote({ documentId, body })` | `dms.create` | |
| `deleteNote({ id })` | `dms.create` **und** eigene Notiz, oder `dms.manage` | `forbidden` sonst |
| `listNotes(documentId)` | intern | chronologisch, für `toRecord` |

### 5.6 Akte: Textbausteine (`snippets.ts`)

`createSnippet`, `updateSnippet`, `deleteSnippet` (`dms.manage`),
`listSnippets({ includeInactive })` (`dms.view`). Name eindeutig
(`conflict('snippetExists')`).

### 5.7 Akte: Volltext lesen (`text.ts`)

`getDocumentText({ documentId })` (`dms.view`): liefert `{ textStatus,
textError, pages: { page, text }[] }` aus `document_text`. Bei `pending`,
`running`, `failed`, `unavailable` sind `pages` leer und der Zustand sagt
warum.

### 5.8 Sortierung (Backlog 6)

`listDocuments` und `listContacts` bekommen `orderBy: { field, direction }`.
Dokumente: `number`, `subject`, `documentDate`, `typeKey`, `folder`,
`createdAt`; Kontakte: `name`, `kind`, `city`, `createdAt`. Ohne Parameter
bleibt die heutige Reihenfolge (Entscheidung 31). Neue Filter an
`listDocuments`: `unsent: true` (ausgehend, festgeschrieben, ohne Vermerk),
`withOpenFollowUp: true`, `relatedTo: documentId`.

## 6. Rechte und MCP

Keine neuen Rechte in der Akte. Zwei im Kern (§ 5.1).

**Werkzeuge, geändert:**

- `dms_get`: Metadaten, Bezüge, Dokumentbezüge, Versand, Notizen,
  Wiedervorlagen. Keine Bytes.
- `dms_receive`: ohne `assetId`; nur `contentBase64`.
- `dms_manage_types` wird `dms_create_type` und `dms_update_type`, jedes mit
  seinem Schema.
- `dms_list`: die neuen Filter und `orderBy`.

**Werkzeuge, neu:**

| Werkzeug | Service | Recht |
|---|---|---|
| `dms_text` | `getDocumentText` | `dms.view` |
| `dms_unlink` | `unlinkDocument` | `dms.create` |
| `dms_relate`, `dms_unrelate` | § 5.3 | `dms.create` |
| `dms_dispatch`, `dms_dispatch_clear` | § 5.4 | `dms.create` |
| `dms_add_note`, `dms_delete_note` | § 5.5 | `dms.create` |
| `dms_snippets`, `dms_create_snippet`, `dms_update_snippet`, `dms_delete_snippet` | § 5.6 | `dms.view` / `dms.manage` |
| `dms_folders`, `dms_create_folder`, `dms_delete_folder` | `catalog.ts` | `dms.view` / `dms.manage` |
| `dms_rules`, `dms_create_rule`, `dms_update_rule`, `dms_delete_rule` | `catalog.ts` | `dms.view` / `dms.manage` |
| `dms_create_replacement` | § 5.3 | `dms.create` |
| `followups_list_due`, `followups_list`, `followups_create`, `followups_complete`, `followups_reopen`, `followups_delete` | § 5.1 (Kern, `@kompass/mcp`) | `followUps.*` |

`dms_create_follow_up` in der Akte ruft den Wrapper mit Dokumentprüfung.
Weiter kein `dms_delete_document` (Entscheidung 10), begründet in
`mcp-tools.test.ts`.

Der Paritätstest wird strenger, und zwar mechanisch, nicht über eine
handgepflegte Liste: Er lädt das Paket jedes eingeschalteten Moduls und den
Kern, nimmt jeden Export, der eine Funktion mit der Service-Signatur ist
(drei Parameter, der erste heißt `deps`, der zweite `ctx`; geprüft über
`fn.length` und die Parameternamen aus `fn.toString()`), und verlangt, dass
mindestens ein registriertes Werkzeug diesen Service in seinem `handler`
aufruft. Damit das prüfbar ist, trägt jede `McpToolDefinition` ein neues
Feld `service: Function` neben `handler`; der Test vergleicht Referenzen. Ein
Service ohne Werkzeug ist rot, es sei denn, er steht in der Ausnahmeliste des
Tests mit Begründung: `deleteDocument` (Entscheidung 10), `previewDraft`
(liefert Bytes), `extractDocumentText` (Innenleben des Workers, von
`dms_reindex` angestoßen), `previewNextNumber` (nur ein Hinweis in der
Oberfläche), `getDocument` (liefert Bytes; `dms_get` ruft
`getDocumentRecord`). Der bisherige Rechte-Test bleibt daneben bestehen.

## 7. Oberfläche

### 7.1 Detailseite `/dms/[id]`

Die rechte Spalte wächst. Reihenfolge von oben: Details (mit **Ordner als
Auswahlfeld** und Speichern → `moveDocument`), **Versand** (nur ausgehend und
festgeschrieben: Datum, Weg, Bemerkung; Knopf „Als versandt vermerken", danach
„Ändern" und „Vermerk entfernen"), **Wiedervorlagen** (offene mit Häkchen,
erledigte eingeklappt, „Neue Wiedervorlage" mit Datum, Anlass, zuständig),
Aufbewahrung, Volltext, **Bezüge** (wie heute, dazu „Bezug hinzufügen":
Entitätstyp, Suchfeld, Rolle; „Entfernen" je Zeile), **Dokumentbezüge**
(beide Richtungen mit gedrehtem Text, „Bezug hinzufügen": Art und ein
Suchfeld nach Nummer oder Betreff über `listDocuments`), und unter der Vorschau
das **Notizjournal** (Liste mit Name und Zeit, Textfeld „Notiz anfügen",
„Löschen" nur an eigenen oder mit `dms.manage`).

Der Storno-Dialog bekommt ein Häkchen „Ersatz als Entwurf anlegen"; ist es
gesetzt, landet man nach dem Storno im Editor des Ersatzes.

### 7.2 Liste `/dms`

- **Zeile auf Ordner ziehen.** Die Ordnerspalte ist schon Drop-Ziel für
  Dateien; eine Zeile der Liste wird ziehbar (`draggable`, `dataTransfer` mit
  der Dokument-ID), und die Spalte unterscheidet am Typ, ob Datei oder Zeile
  ankommt. Zeile auf Ordner heißt `moveDocument`, ohne Dialog, mit Toast.
- **Markierungen** hinter dem Betreff, wie der Punkt für den Volltext: „nicht
  versandt" (ausgehend, festgeschrieben, ohne Vermerk, dezent) und
  „Wiedervorlage" (offen, mit Datum; überfällig in Warnfarbe).
- **Filter**: „nicht versandt", „mit offener Wiedervorlage".
- **Spaltenköpfe klickbar**, Richtung als Pfeil, Zustand in der URL
  (`sort=documentDate&dir=desc`). Gemeinsame Komponente
  `components/sortable-head.tsx`, die auch die Kontaktliste nutzt.

### 7.3 Suchfeld für Kontakte (`components/contact-picker.tsx`)

Ersetzt das `<select>` im Entwurf (Empfänger) und im Ablegen-Dialog
(Absender). Aufgebaut auf `command.tsx` (cmdk): tippen, Treffer über
`listContacts({ text, limit: 20 })` per Server-Action, auswählen. Letzter
Eintrag immer „Neu anlegen …": öffnet ein Overlay mit dem vorhandenen
`contact-form.tsx` in einem Dialog; nach dem Speichern ist der neue Kontakt
gewählt, die Liste des Editors ist nicht verlassen worden. Das Feld gibt die
ID über ein verstecktes Input mit, damit die Formulare wie heute laufen.

### 7.4 Ablegen-Dialog

Ein Feld **„Antwort auf"** unter Ordner und Absender: Suchfeld nach Nummer
oder Betreff (dasselbe Muster wie 7.3, gegen `listDocuments`). Gesetzt, legt
`receiveDocument` den Bezug `repliesTo` gleich mit an (`relations: [...]` im
Schema, parallel zu `links`). Ist ein Absender gewählt, schlägt das Feld das
jüngste ausgehende Dokument an diesen Kontakt vor, mit Herkunftsfähnchen.

### 7.5 Editor

Über dem Textfeld ein Auswahlfeld **„Baustein einfügen"** (nur aktive
Bausteine). Einfügen an der Schreibmarke; bei leerem Betreff und Baustein mit
Betreff wird auch der Betreff gesetzt. Der Editor bleibt ein Textfeld, kein
Rich-Text.

### 7.6 Kontakt, Tier, Projekt

Ein Kasten **„Dokumente"** auf `/contacts/[id]`, `/animals/[id]`,
`/projects/[id]`, gerendert von `components/related-documents.tsx` in der
App-Schicht: prüft `isModuleEnabled('dms')` und `dms.view`, ruft
`listDocuments({ linkedTo })`, zeigt Nummer, Betreff, Datum, Rolle, verlinkt
auf das Dokument. Knöpfe: beim Kontakt „Brief schreiben" (`/dms/new?recipient=
<id>`) und „Post ablegen" (`/dms/receive?sender=<id>`); bei Tier und Projekt
nur „Post ablegen" (`/dms/receive?about=<type>:<id>`). Die Zielseiten lesen
die Parameter und belegen vor, mit Herkunftsfähnchen „von der Kontaktseite".

### 7.7 Startseite

Ein Kasten **„Fällig"** oben, sichtbar mit `followUps.view`: überfällige
Wiedervorlagen und die der nächsten sieben Tage, älteste zuerst, je Zeile
Datum, Anlass, Bezug (Beschriftung aus `followUpTargets`), zuständig, und ein
Häkchen zum Erledigen. Leer heißt: ein Satz, kein leerer Rahmen. Wer nur seine
eigenen sehen will, schaltet um; die Wahl merkt sich der Browser.

### 7.8 Verwaltung → Akte

Ein Panel **„Textbausteine"** neben Dokumentarten, Regeln und Ordnern: Liste,
Anlegen, Bearbeiten, Deaktivieren, Löschen. Und ein Panel **„Versandwege"**:
die Liste aus der Einstellung, Schlüssel und Beschriftung, Anlegen, Umbenennen,
Entfernen; gespeichert über `setSetting` mit `settings.manage`, wie die
Erkennungssprachen im Volltext-Panel.

### 7.9 Handoff

Alle neuen Felder und Knöpfe halten die Maße des Fundament-Handoffs: 38 px
Feldhöhe, `--row-h` für Zeilen, Pflichtsternchen, Herkunftsfähnchen für
Vorbelegungen. Neue Bildschirmzustände (Dokumentbezug hinzufügen,
Kontakt-Overlay, Fällig-Kasten) bekommen keine eigene Design-Runde; sie
setzen sich aus vorhandenen Bausteinen zusammen.

## 8. Tests

**Service-Tests** je neuem Service: Erfolg, `forbidden`, `validation`,
Protokoll. Dazu gezielt:

- Nummern: Ein Dokument ablegen, löschen (Frist abgelaufen), erneut ablegen —
  die Nummer ist eine höhere, nie dieselbe. Zwei parallele Ablagen in einer
  Testdatei bekommen zwei verschiedene Nummern ohne Wiederholung.
- Storno und Fristlöschung an einem Entwurf: `conflict`.
- Ordner: Ablegen in einen unbekannten Ordner: `notFound`.
- Bezüge: Selbstbezug abgelehnt; Doppel abgelehnt.
- Löschen: Verwerfen eines Entwurfs und Fristlöschung nehmen Bezüge in beiden
  Richtungen, Notizen, Volltext und Wiedervorlagen (auch erledigte) mit; die
  Startseite zeigt danach nichts ins Leere.
- Versand: an Eingang und Entwurf abgelehnt; Datum vor Dokumentdatum
  abgelehnt; unbekannter Weg abgelehnt; Änderung mit Vorher/Nachher im
  Protokoll; ein aus der Einstellung entfernter Weg bleibt am Dokument lesbar.
- Notiz: Fremde Notiz ohne `dms.manage` nicht löschbar.
- Wiedervorlage im Kern: Fälligkeitsliste sortiert; Abhaken zweimal ist
  `conflict`; Wrapper in der Akte weist ein unbekanntes Dokument ab.
- Ersatz: Text und Empfänger übernommen, Bezug `replaces` gesetzt; an einem
  nicht stornierten Dokument abgelehnt.
- `getDocumentText`: leere Seiten mit Zustand, wenn nicht gelesen.
- Löschpolitik-Test kennt die vier neuen Einträge.

**MCP:** Paritätstest in der strengeren Form (§ 6), dazu sein Gegenbeweis:
ein erfundener Service ohne Werkzeug muss auffallen; `dms_get` enthält keine
Bytes; `dms_receive` weist `assetId` als unbekanntes Feld ab.

**E2E** (`apps/kompass/e2e/dms.spec.ts`, `follow-ups.spec.ts`):

- Ein Dokument aus dem Eingangskorb in einen Ordner ziehen; die Zählerspalte
  ändert sich.
- Post ablegen als Antwort auf ein vorhandenes Schreiben; beide Seiten zeigen
  den Bezug.
- Einen Brief festschreiben, als versandt vermerken, Markierung verschwindet.
- Wiedervorlage am Dokument anlegen, auf der Startseite sehen, dort abhaken.
- Notiz anfügen, mit Namen und Zeit sehen, löschen.
- Baustein einfügen; ein leerer Entwurf übernimmt den Betreff.
- Kontakt aus dem Overlay anlegen, er ist als Empfänger gewählt.
- Auf der Kontaktseite die Dokumente sehen und von dort einen Brief beginnen.
- Spaltenkopf klicken, Reihenfolge dreht, URL trägt den Zustand.
- Storno mit Ersatz: Editor des Ersatzes mit übernommenem Text.

**Migration** (`packages/modules/dms/tests/migration.test.ts`): Zähler nach
der Migration gleich dem Maximum je Präfix und Jahr; Rollen mit `dms.create`
tragen `followUps.manage`.

## 9. Seed

`seedDms` ergänzt: einen Eingang als Antwort auf den festgeschriebenen Brief,
den Brief mit Versandvermerk (Post, drei Tage nach Dokumentdatum), eine
Notiz, zwei Bausteine („Grußformel", „Bitte um Rückmeldung" mit Betreff), eine
offene Wiedervorlage „Antwort abwarten" in fünf Tagen und eine erledigte.
`packages/core/src/seed/follow-ups.ts` läuft nur, wenn die Akte einen Bezug
liefern kann; ohne Akte legt der Kern keine Wiedervorlage ins Leere. Alles
erfunden, idempotent, mit `seed.test.ts`.

## 10. Migration und Betrieb

Eine Migration im Kern (`follow_ups`, zwei Rechte für bestehende Rollen) und
eine in der Akte (`document_relations`, `document_notes`,
`document_snippets`, `document_counters` mit Erstbefüllung, drei
Versandspalten). Erzeugt mit `db:generate`, die Erstbefüllung der Zähler als
Datenmigration in derselben Datei. Kein Eingriff in Dateien, kein neues
Werkzeug im Container.

## 11. Dateien

```
packages/core/src/db/schema.ts                     follow_ups
packages/core/src/follow-ups/service.ts            § 5.1
packages/core/src/permissions/core.ts              followUps.view, followUps.manage
packages/core/src/modules/manifest.ts              followUpTargets, McpToolDefinition.service
packages/core/src/deletion-policy.ts               followUp, documentRelation, documentNote, documentSnippet
packages/core/src/seed/follow-ups.ts
packages/mcp/src/core-tools.ts                     followups_*
packages/modules/dms/src/schema.ts                 vier Tabellen, drei Spalten
packages/modules/dms/src/service.ts                allocateDocumentNumber, resolveFolder, Filter, orderBy, phase-Prüfungen
packages/modules/dms/src/install.ts                dms.dispatchChannels
packages/modules/dms/src/relations.ts  dispatch.ts  notes.ts  snippets.ts
packages/modules/dms/src/text.ts                   getDocumentText
packages/modules/dms/src/follow-ups.ts             Wrapper + followUpTargets
packages/modules/dms/src/mcp-tools.ts              § 6
packages/modules/contacts/src/service.ts           orderBy
apps/kompass/src/components/contact-picker.tsx  sortable-head.tsx  related-documents.tsx
apps/kompass/src/app/(shell)/dms/…                 Detail, Liste, Dialog, Editor
apps/kompass/src/app/(shell)/page.tsx              Fällig-Kasten
apps/kompass/src/app/(shell)/contacts/[id]/page.tsx  animals/[id]  projects/[id]
apps/kompass/src/app/(shell)/admin/dms/snippets-panel.tsx  dispatch-channels-panel.tsx
apps/kompass/messages/de.json                      dms.*, followUps.*
apps/kompass/tests/mcp-tools.test.ts               strengere Parität
apps/kompass/e2e/dms.spec.ts  follow-ups.spec.ts
docs/backlog.md                                    Punkt 6 entfällt nach Umsetzung
```

**Zerlegung** in vier Pläne: (1) Kern — Wiedervorlagen, Rechte, Haken,
Löschpolitik, MCP im Kern; (2) Akte-Modell — Zähler, Bezüge, Versand, Notizen,
Bausteine, Korrekturen am Bestand, Volltext-Werkzeug, MCP-Parität; (3)
Oberfläche der Akte — Detail, Liste, Dialog, Editor, Kontakt-Suchfeld,
Verwaltung; (4) Querverbindungen — Beziehungsakte an Kontakt, Tier, Projekt;
Startseite; Sortierung; Seed und E2E über alles. (1) und (2) sind unabhängig
voneinander; (3) braucht (2), (4) braucht beide.

## 12. Self-Review

**Platzhalter.** Keine. Die Vorgabeliste der Versandwege ist vollständig
aufgezählt, die vier Bezugsarten samt gedrehter Lesart stehen in § 4.2.

**Konsistenz.** Entscheidung 42 (Entwurf ohne Feldspuren) und § 5.4
(Versand mit Vorher/Nachher) widersprechen sich nicht: Der Versandvermerk
hängt an einem festgeschriebenen Dokument, der Entwurf ist Arbeitsmaterial.
Die Zählertabelle (§ 4.6) und Prinzip 5 sind in § 4.6 gegeneinander
abgegrenzt. `followUps.view` ohne `dms.view` zeigt Anlässe ohne Inhalte, das
ist in § 5.1 benannt und gewollt.

**Zuschnitt.** Zu groß für einen Plan, deshalb vier; die Abhängigkeiten stehen
in § 11.

**Mehrdeutigkeit.** „Fertig" für den Roadmap-Schritt heißt: die E2E-Liste in
§ 8 läuft grün, und der Nordstern trägt am Schritt 1 Datum und diesen Satz.
„Versandt" heißt: ein Vermerk steht, nicht: Kompass hat etwas verschickt.
„Erledigt" bei Wiedervorlagen heißt abgehakt, nicht gelöscht.
