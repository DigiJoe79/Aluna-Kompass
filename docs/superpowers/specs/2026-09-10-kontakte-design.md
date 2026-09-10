# Aluna Kompass — Kontakte (Design)

Stand 2026-09-10. Erstes Teilstück des Vorhabens „Kontakte, Korrespondenz und
Dokumentenmanagement". Es bringt die Entität, an die Briefe, Verträge und
Bescheinigungen adressiert werden, und mit ihr das Fristenmodell, das die
DSGVO-Seite des gesamten Vorhabens trägt. Das Dokumentenmanagement selbst
bekommt eine eigene Spec; die dafür bereits getroffenen Rahmenentscheidungen
stehen in Abschnitt 10, damit sie nicht verloren gehen.

## 1. Ausgangslage

Kontakte gibt es im Code nicht. Die Fundament-Spec führt sie unter
„Nicht-Ziele: Fachmodule (Projekte, Tiere, Buchungen, Kontakte, Mitglieder)"
und der Stufenplan parkt sie bei Stufe 3 (Finanzen).

Das trägt nicht mehr. Drei Vorhaben hängen daran:

- **Korrespondenz.** `DocumentSlots` kennt `recipient`, `subject` und `place`,
  aber die einzige Briefvorlage füllt nur `title`
  (`packages/documents/src/templates.ts`). Das Anschriftenfeld der Basis bleibt
  leer; das Fensterkuvert ist heute Dekoration.
- **Finanzen (Stufe 3).** Eine Zuwendungsbestätigung nach amtlichem Muster
  braucht einen strukturierten Empfänger, keinen Freitext.
- **Tiere (Stufe 4).** Ein Adoptionsvertrag verbindet ein Tier mit einer Person.

Dazu kommt ein Befund, der beim Durchsehen der Dokumentenpipeline auffiel und
den das Folgevorhaben aufräumt: `renderDocument` behandelt jede Vorlage gleich
und vergibt auch für den Änderungsprotokoll-Export eine lückenlose
Dokumentnummer. Ein Ad-hoc-Auszug, den man dreimal am Tag mit anderem Filter
zieht, verbrennt damit drei Nummern und läge nach neuer Fristenlogik zehn Jahre
im Bestand.

## 2. Ziel

Ein **Modul** `contacts`, das natürliche Personen und Organisationen führt,
ihre Rollen über die Zeit kennt und für jeden Kontakt beantwortet, wie lange er
aufzubewahren und wann er zu löschen ist. Es funktioniert eigenständig und
vollständig, bevor das Dokumentenmanagement existiert, und wird von diesem
später nur ergänzt.

## 3. Entscheidungen aus dem Brainstorming (2026-09-10)

| # | Entscheidung | Verworfen |
|---|---|---|
| 1 | **Modul**, nicht Kern: `packages/modules/contacts`, `dependsOn: []`. Abhängige Module (DMS, Finanzen, Mitglieder) tragen `dependsOn: ['contacts']`. | Kontakte im Kern wie Nutzer, Medien, Dokumente |
| 2 | **Eine Tabelle `contacts` mit `kind: 'person' \| 'organization'`**; Zugehörigkeit als Selbstverweis `belongsToId`. | Getrennte Tabellen `persons` / `organizations` mit polymorphen Verknüpfungen; flacher Anschriftsblock als Freitext |
| 3 | **Genau eine Anschrift je Kontakt, ohne Historie.** Das ausgegebene PDF trägt die gedruckte Adresse. | Anschriftenhistorie; mehrere Anschriften je Kontakt |
| 4 | **Anrede ist Freitext mit Vorschlagsliste**, kein Enum. | `'herr' \| 'frau'` als Enum |
| 5 | **Rollen enden, sie verschwinden nicht** (`until` statt Löschen), und sie kommen aus einer Registry, die Module über `ModuleManifest.contactRoles` füllen. | Ein `type`-Feld am Kontakt, das umgeschaltet wird; frei getippte Tags |
| 6 | **Die Aufbewahrungsfrist eines Kontakts wird berechnet, nicht gespeichert** (Prinzip 5) — als Maximum über alle Halter. | Ein gepflegtes Feld `deleteAfter` am Kontakt |
| 7 | **Halter werden über einen Manifest-Haken `retentionHolds` erfragt**, gespiegelt auf `mediaReferences`. Ein Modul mit diesem Haken muss in `dependsOn` von `contacts` stehen. | Zentrale Tabelle mit Haltevermerken; der Kern kennt die Modultabellen |
| 8 | **Fristklassen sind Einstellungen, keine Konstanten** (Prinzip 2); Fristbeginn ist das Ende des Kalenderjahres (§ 147 Abs. 4 AO). | Feste Zahlen im Code |
| 9 | **Fällig heißt nicht gelöscht.** Ein Mensch bestätigt jede Löschung; nichts läuft automatisch ab. | Ein Hintergrundlauf, der fällige Daten selbsttätig entfernt |
| 10 | **Der Fälligkeitsbildschirm liegt im Kern** (Verwaltung → Aufbewahrung), gefüllt über einen zweiten Haken `retentionDue`. Gelöscht wird im Modul. | Je Modul eine eigene Fälligkeitsliste |
| 11 | **Zwei Rechte**, `contacts.view` und `contacts.manage`; Löschen bekommt kein eigenes. | Ein drittes Recht `contacts.delete` |
| 12 | **Kein `contacts_delete` über MCP**, begründet in `mcp-tools.test.ts`. | Vollständige MCP-Parität auch beim Löschen |

**Nicht-Ziele.** Import bestehender Kontaktlisten (es gibt keine);
Dublettenerkennung; mehrere Anschriften je Kontakt; Beziehungen zwischen
Personen („Ehepartner von"); Einwilligungsverwaltung mit Nachweis
(Newsletter-Opt-in) — die Fristklasse `consent` berührt das Thema, verwaltet
aber keine Einwilligungen; Serienbriefe.

**Ausdrücklich getrennt:** Die Team-Einträge der Webseite bleiben
Webseiteninhalt. Sie sehen aus wie Kontakte, folgen aber anderen Regeln —
löschbar, veröffentlicht, ohne Frist. Sie zusammenzulegen wäre der naheliegende
und falsche Schritt.

## 4. Datenmodell

Deklaration in `packages/modules/contacts/src/schema.ts`, Migration im zentralen
Strom unter `packages/core/src/db/migrations/` (Muster: `0004_animals.sql`).

```
contacts
  id             ULID
  kind           'person' | 'organization'
  -- nur Person
  salutation     text?     Freitext mit Vorschlagsliste („Frau", „Familie", „Dr.")
  firstName      text?
  lastName       text?
  -- nur Organisation
  name           text?
  legalForm      text?     e. V., GmbH, Behörde, Kanzlei
  -- beide
  belongsToId    → contacts.id?   Person bei Organisation
  addressExtra   text?     „z. Hd.", „c/o"
  street, postalCode, city, country
  notes          text?
  status         'active' | 'archived'
  createdAt, updatedAt

contact_channels                     contact_roles
  id, contactId                        id, contactId
  kind  'email'|'phone'|'mobile'       role   Schlüssel aus der Registry
        |'fax'|'web'                   since  Datum
  value, label?, isPrimary             until  Datum? — Ende, nicht Löschung
```

`kind` bestimmt, welche Felder Pflicht sind: Zod prüft Person und Organisation
mit zwei Varianten desselben Schemas. Die drei Sorten aus dem Alltag — Person,
Organisation, Person bei einer Organisation — bildet der Selbstverweis ab. Der
Notar löst sich damit in beide Richtungen: entweder eine Organisation
„Notariat Schmidt" oder eine Person mit `belongsTo` darauf; das Modell zwingt
nichts.

`formatPostalAddress(contact)` ist eine **reine Funktion ohne `ctx`** und
liefert den mehrzeiligen Anschriftsblock, der später in `DocumentSlots.recipient`
geht. Bei einer Person mit Zugehörigkeit erzeugt sie beide Zeilen
(Organisation, darunter „z. Hd. …"). Sie kennt keine Rechte, weil die
Dokumentenpipeline sie später ohne Aufrufkontext braucht.

## 5. Rollen und Fristen

### 5.1 Rollen aus einer Registry

`ModuleManifest` bekommt `contactRoles?: readonly ContactRoleDefinition[]`. Das
Kontaktmodul bringt die allgemeinen mit (`interested`, `partner`, `authority`,
`service`), Tiere melden `adopter` und `sponsor`, Finanzen später `donor`,
Mitglieder `member`. Jede Definition nennt ihre **Fristklasse**.

Freie Tags wären bequemer, tragen aber keine Frist: An der Rolle hängt die
Aufbewahrung, und eine Frist, die an einem selbstgetippten Wort hängt, ist
keine. Ein unbekannter Rollenschlüssel ist `validation`.

### 5.2 Fristklassen als Einstellung

| Klasse | Vorgabe | Wofür |
|---|---|---|
| `permanent` | nie fällig | Satzung, Vorstandsbeschlüsse, MV-Protokolle |
| `statutory10Y` | 10 Jahre | Belege, Zuwendungsbestätigungen, Jahresabschluss (§ 147 AO) |
| `statutory6Y` | 6 Jahre | empfangene und abgesandte Geschäftsbriefe (§ 147 Abs. 3 AO) |
| `consent` | 24 Monate | ohne gesetzliche Grundlage — der Interessent, aus dem nichts wurde |

Die Zahlen stehen als Einstellung `retention.<klasse>` in Monaten (Prinzip 2 —
ein Verein außerhalb Deutschlands rechnet anders); die Klassen selbst sind
Code, weil Services sie benennen.

**Der Fristbeginn ist das Ende des Kalenderjahres**, nicht das Datum selbst
(§ 147 Abs. 4 AO). `retentionEnd(from: string, months: number): string` ist eine
reine Funktion und unit-getestet, weil es die Sorte Detail ist, die man sonst um
zwölf Monate verfehlt.

### 5.3 Halter

```ts
export interface RetentionHold {
  /** Menschlich lesbar, für die Anzeige und die Fehlermeldung:
   *  'Zuwendungsbestätigung BST-2026-0042', 'Adoptionsvertrag für „Rocky"'. */
  label: string;
  /** ISO-Datum, bis zu dem gehalten wird; null = dauerhaft. */
  until: string | null;
  entity: string;
  id: string;
}

// in ModuleManifest, neben mediaReferences:
/** Was dieses Modul festhält — synchron, nur lesend, ohne Rechteprüfung.
 *  Befragt vor dem Löschen und für den Fristenbildschirm. */
retentionHolds?: (deps: Deps, entityType: string, id: string) => readonly RetentionHold[];

/** Was bei diesem Modul zur Löschung fällig ist. */
retentionDue?: (deps: Deps) => readonly DueItem[];   // { entity, id, label, dueSince }
```

`entityType` ist generisch, nicht `'contact'` — derselbe Haken trägt später
Dokumente und Belege.

Die Fälligkeit eines Kontakts ist das **Maximum** über alle Antworten plus die
Fristen seiner Rollen. Wer Spender *und* Interessent ist, bleibt zehn Jahre.
Nichts davon wird gespeichert (Prinzip 5).

Deaktivierte Module werden nicht befragt (Entscheidung 7 der Mediathek-Spec).
Das wiegt hier schwerer als bei Medien: Ein ausgeschaltetes Finanzmodul dürfte
keinen Spender freigeben. Deshalb gilt — **ein Modul mit `retentionHolds` muss
in `dependsOn` von `contacts` stehen**; `setModuleEnabled` verhindert dann
bereits, dass es abgeschaltet wird, während Kontakte laufen
(`packages/core/src/modules/service.ts`).

### 5.4 Löschen

Fällig heißt nicht gelöscht. `deleteContact` lehnt ab, solange irgendein Halter
läuft — `conflict('retentionHoldActive', …)`, und nennt die Halter. Ist nichts
mehr offen, löscht es den Kontakt samt Rollen und Kommunikationswegen und
schreibt ins Änderungsprotokoll: Was verschwindet, ist der Inhalt, nicht die
Tatsache, dass jemand ihn entfernt hat (Prinzip 3).

Kein Hintergrundlauf entfernt etwas selbsttätig. Bei einem Verein, in dem
womöglich wochenlang niemand einloggt, wäre ein Fehler in der Fristenrechnung
unbemerkt und unumkehrbar.

`DeletionRule` in `packages/core/src/deletion-policy.ts` braucht dafür **keine
neue Kategorie** — das vorhandene `guard` („was eine einzelne Löschung trotzdem
verhindert") deckt den Fall. Es kommt nur ein optionales `retentionClass` dazu,
damit die Frist maschinenlesbar ist statt als Prosa dazustehen.

## 6. Services, Rechte und MCP

Zwei Rechte: `contacts.view`, `contacts.manage`. Löschen bekommt kein eigenes —
dieselbe Entscheidung wie bei der Mediathek (dort schützt Löschen
`media.upload`). Das echte Tor ist hier der Fristablauf, nicht das Recht.

Alle Services in der Signatur aus `AGENTS.md`
(`fn(deps, ctx, input) → Promise<Result<T>>`), mit `recordAudit` in derselben
Transaktion:

| Funktion | Recht | Anmerkung |
|---|---|---|
| `createContact` / `updateContact` | `contacts.manage` | Zod prüft je nach `kind` |
| `setContactChannels` | `contacts.manage` | ersetzt die Menge (Muster `setAnimalPhotos`) |
| `addContactRole` / `endContactRole` | `contacts.manage` | Ende setzt `until`, löscht nichts |
| `setContactStatus` | `contacts.manage` | aktiv / archiviert |
| `listContacts` | `contacts.view` | Filter `kind`, Rolle, Freitext; seitenweise |
| `getContact` | `contacts.view` | mit Rollen, Wegen, Zugehörigkeit |
| `contactRetention` | `contacts.view` | bis wann gehalten und **von wem** |
| `listDueContacts` | `contacts.manage` | fällige, mit „fällig seit" |
| `deleteContact` | `contacts.manage` | `conflict('retentionHoldActive')` mit Haltern |

**MCP.** `contacts_list`, `contacts_get`, `contacts_retention` auf
`contacts.view`; `contacts_create`, `contacts_update`, `contacts_set_channels`,
`contacts_add_role`, `contacts_end_role`, `contacts_set_status`, `contacts_due`
auf `contacts.manage`. Beide Rechte sind damit in Werkzeugbeschreibungen
genannt (Prinzip 8). Jedes Werkzeug zeigt sein echtes Zod-Schema.

**`contacts_delete` fehlt bewusst**, begründet in
`apps/kompass/tests/mcp-tools.test.ts`: Das unwiederbringliche Löschen
personenbezogener Daten soll einen Menschen vor einem Bildschirm haben, der
zeigt, was gleich verschwindet. Ein Agent, der eine Fälligkeitsliste falsch
liest, löscht sonst dreißig Spender.

## 7. Oberfläche

Muster wie beim Tiermodul: `page.tsx` als Liste, `[id]` als Detailseite,
`actions.ts` für Server Actions, Formulare als eigene Komponenten. Keine neuen
Farben — Theme-Tokens und die vorhandenen shadcn-Muster; für Kontakte gibt es
keine Design-Referenz im Handoff.

**`/contacts` — Liste.** Spalten: Name (Symbol für Person/Organisation),
Zugehörigkeit, Rollen als Marken, Ort, primärer Kontaktweg. Filter über Art,
Rolle und Freitext; die Suche greift auf Name, Ort und Kanalwerte, damit „die
mit der Nummer 0157…" auffindbar ist. Archivierte ausgeblendet, per Schalter
sichtbar.

**`/contacts/[id]` — Detail.** Vier Blöcke: Stammdaten und Anschrift,
Kommunikationswege, Rollen mit Zeitraum, Aufbewahrung.

- **Der Anschriftsblock wird live gezeigt**, nicht nur die Felder: neben dem
  Formular das Ergebnis von `formatPostalAddress`, so wie es ins Fensterkuvert
  fällt. Dieselbe Idee wie die Markdown-Vorschau im Dokumentdialog.
- **Der Aufbewahrungsblock nennt die Halter beim Namen** — nicht „gehalten bis
  31.12.2036", sondern die Liste mit Grund und Datum. Solange ein Halter läuft,
  ist der Löschknopf aus und sagt, warum.

**Verwaltung → Aufbewahrung und Löschfristen** (Kern). Sammelt über
`retentionDue` aller aktiven Module, gruppiert nach Art, mit Zähler in der
Navigation. Der Kern zeigt nur; **gelöscht wird im Modul** — ein Klick führt auf
die Kontaktseite, wo steht, was gleich verschwindet. Der Kern löscht nie fremde
Entitäten.

Alle Texte in `apps/kompass/messages/de.json`, Sie-Form, kein hartcodierter
String.

## 8. Tests

Über die Pflicht je Service (Erfolg, `forbidden`, `validation`, Audit-Eintrag)
hinaus:

**Fristen (rein, `packages/modules/contacts/tests/retention.test.ts`)**
- `15.03.2026 + statutory10Y → 31.12.2036`; Grenzfall `31.12.2026 → 31.12.2036`.
- Maximum über Halter: Rolle `interested` (kurz) plus Zuwendungsbestätigung
  (lang) ⇒ die lange Frist gewinnt.
- `permanent` wird nie fällig.

**Anschrift**
- `formatPostalAddress` für Person, Organisation, Person mit Zugehörigkeit und
  mit fehlendem Ort — kein einsames Komma, keine Leerzeile.

**Services**
- `endContactRole` setzt `until` und löscht keine Zeile.
- Unbekannter Rollenschlüssel ⇒ `validation`.
- `deleteContact` mit laufendem Halter ⇒ `conflict('retentionHoldActive')`, die
  Halter stehen in der Meldung; ohne Halter ⇒ gelöscht, mit Audit-Eintrag.
- `listDueContacts` führt genau die fälligen.

**Module und Politik**
- Ein deaktiviertes Modul wird nicht nach `retentionHolds` befragt.
- `contacts` lässt sich nicht deaktivieren, solange ein haltendes Modul aktiv
  ist (`moduleRequiredByOthers`).
- `DELETION_POLICY` führt `contact` mit `guard` und `retentionClass`; der
  bestehende Konsistenztest bleibt grün.

**App**
- `mcp-tools.test.ts`: beide Rechte in Werkzeugbeschreibungen genannt;
  Abwesenheit von `contacts_delete` begründet.
- e2e `contacts.spec.ts`: Kontakt anlegen, Rolle geben, Anschriftsblock sehen,
  gesperrter Löschknopf mit Begründung.
- `no-color-literals.test.ts` und `no-association-content.test.ts` bleiben grün.

**Seed.** Ein paar Beispielkontakte, nur in `development`, frei erfunden. Das
Repo ist öffentlich; personenbezogene Daten haben darin nichts verloren, auch
keine harmlos wirkenden.

## 9. Dateien

**Neues Modul**
- `packages/modules/contacts/` — `schema.ts`, `service.ts`, `retention.ts`,
  `address.ts`, `roles.ts`, `references.ts`, `mcp-tools.ts`, `manifest.ts`,
  `index.ts`, `tests/`

**Kern**
- `packages/core/src/modules/manifest.ts` — `contactRoles`, `retentionHolds`,
  `retentionDue`, `RetentionHold`, `DueItem`, `ContactRoleDefinition`
- `packages/core/src/modules/registry.ts` — Aggregation der neuen Haken
- `packages/core/src/settings/core.ts` — `retention.<klasse>`
- `packages/core/src/deletion-policy.ts` — `retentionClass`, Regel für `contact`
- `packages/core/src/db/migrations/` — eine Migration für die drei Tabellen
- `packages/core/src/retention/` (neu) — Sammeln über `retentionDue`
- `packages/core/tests/` — Politik, Registry, Fälligkeitssammlung

**App**
- `apps/kompass/src/app/(shell)/contacts/` — Liste, Detail, Formulare, Actions
- `apps/kompass/src/app/(shell)/admin/retention/` — Fristenbildschirm
- `apps/kompass/messages/de.json`
- `apps/kompass/e2e/contacts.spec.ts`
- `apps/kompass/tests/mcp-tools.test.ts`

**Dokumentation**
- `docs/superpowers/specs/2026-09-05-fundament-design.md` — Nachtrag: Kontakte
  wandern aus Stufe 3 vor, als eigenes Modul
- `AGENTS.md` — Quellenliste; Hinweis auf `retentionClass` bei Prinzip 3

## 10. Anhang: Rahmenentscheidungen für Korrespondenz und DMS

Im selben Brainstorming entschieden, gültig für die noch zu schreibende Spec
„Dokumente und Korrespondenz". Hier festgehalten, damit sie nicht verloren
gehen; jene Spec übernimmt sie.

| # | Entscheidung |
|---|---|
| 1 | Entwurf ist Arbeitsmaterial: änderbar, löschbar, beliebig oft als gekennzeichnetes PDF exportierbar, ohne Nummer |
| 2 | Erst das Festschreiben vergibt die Nummer, friert ein und stellt unter die Storno-Regel |
| 3 | Das PDF ist der rechenschaftsrelevante Datensatz, nicht die Datenbankzeile — `media_assets` braucht dafür eine Prüfsumme |
| 4 | So wenige Fundstellen personenbezogener Daten wie möglich; der Entwurfsinhalt geht mit dem Entwurf |
| 5 | Ein- und Ausgang sind dasselbe Ding: Datei plus Metadaten, unterschieden durch Herkunft und Entwurfsphase |
| 6 | Mehrere Bezüge je Dokument über `document_links` mit Rolle, statt eines `entity_type`/`entity_id`-Paars |
| 7 | `resolve(refs)` unrein / `build(data)` rein — Module dürfen ihre Daten lesen, Determinismus bleibt bei `build` |
| 8 | Die Akte ist die einzige Ablage; Fachmodule sind Auslöser, keine Ablage |
| 9 | Akteneintrag gegen Ad-hoc-Auszug ist eine Eigenschaft der Vorlage — ein Auszug bekommt keine Nummer und keine Zeile |
| 10 | Aufbewahrungsfrist sticht Löschpflicht; Löschen wird ein fälliger Vorgang mit Datum, kein Knopf |
| 11 | Das DMS wird ein Modul mit `dependsOn: ['contacts']`; die Pipeline bleibt im Kern |
| 12 | Nicht in dieser Reihe: Texteditor mit Vorlagenspeicher (rudimentär, später), OCR, Volltextsuche |

## 11. Self-Review

**Platzhalter.** Keine „TBD". Der Texteditor mit Vorlagenspeicher, OCR und
Volltextsuche stehen als Nicht-Ziele des Folgevorhabens in Abschnitt 10, nicht
als offene Punkte.

**Konsistenz.** Die Fristklasse ist durchgängig derselbe Begriff: an der
Rollendefinition (§ 5.1), als Einstellung (§ 5.2), in `RetentionHold.until`
(§ 5.3) und als `retentionClass` in der Löschpolitik (§ 5.4). Die beiden Haken
sind gegeneinander abgegrenzt: `retentionHolds` beantwortet „wer hält *dieses*
Objekt", `retentionDue` „was ist bei *diesem Modul* fällig".

**Zuschnitt.** Vier Blöcke für den Plan: Datenmodell und Migration;
Fristenrechnung samt beider Manifest-Haken; Services, Rechte und MCP;
Oberfläche einschließlich Fristenbildschirm.

**Abgrenzung zur Mediathek.** Bewusst dasselbe Muster wie `mediaReferences` —
befragt statt zentral gescannt, deaktivierte Module schweigen. Ein Unterschied:
Schweigen ist hier gefährlich, deshalb die zusätzliche `dependsOn`-Pflicht für
haltende Module. Das steht in § 5.3 und wird getestet.

**Mehrdeutigkeit.** „Fällig" heißt: alle Halter sind abgelaufen und die
Rollenfristen sind vorbei. „Gelöscht" heißt: ein Mensch hat bestätigt. Zwischen
beidem liegt immer eine Handlung; nichts läuft automatisch durch. „Archiviert"
ist davon unabhängig und bedeutet nur, dass der Kontakt nicht mehr in der
Standardliste erscheint — er wird dadurch weder fällig noch geschützt.
