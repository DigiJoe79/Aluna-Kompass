# Aluna Kompass — Volltext und Texterkennung (Design)

Stand 2026-09-11. Drittes Teilstück nach `2026-09-10-kontakte-design.md` und
`2026-09-10-dokumente-und-korrespondenz-design.md`. Die Akte steht: Post geht
hinein, bekommt eine Nummer und einen Platz. Was fehlt, ist der Weg zurück —
ein Dokument wiederfinden, wenn man weder Nummer noch Betreff im Kopf hat,
sondern nur ein Wort, das darin vorkommt.

## 1. Ausgangslage

Gefunden wird heute über drei Wege: den Ordnungsbaum, die Bezüge zu Kontakt,
Tier und Projekt, und ein Filterfeld, das über Betreff und Nummer läuft
(`LIKE` in `listDocuments`). Alle drei setzen voraus, dass jemand beim Ablegen
das Richtige eingetragen hat. Der Betreff eines eingescannten Schreibens ist
das, was der Mensch im Ablegen-Dialog getippt hat — nicht das, was auf dem
Papier steht.

Der Inhalt der Dokumente ist damit unerreichbar. Ein Verein, der wissen will,
welches Schreiben die Rechnungsnummer 2026-4711 nennt oder in welchem Brief
die Praxis Sommer vorkommt, muss die PDFs einzeln öffnen.

Zwei Bausteine liegen bereit. Das Modul führt seit `77a3f3a` seinen **eigenen
Dateispeicher** (`packages/modules/dms/src/storage.ts`): ausschließlich PDF,
inhaltlich geprüft, höchstens 10 MB, benannt nach der Dokument-ID. Und der
`Deps`-Vertrag kennt mit `deps.sqlite` den rohen Treiber sowie mit
`deps.documents` das Muster eines Ports, hinter dem ein externes Werkzeug
steckt.

## 2. Ziel

Jedes abgelegte Dokument wird lesbar für die Suche. Der Text kommt aus der
Datei — aus ihrer Textebene, wenn sie eine hat, sonst über Texterkennung. Er
landet seitenweise in einem Volltextindex, und das vorhandene Filterfeld der
Akte liest ihn mit. Wer sucht, sieht nicht nur, *dass* ein Dokument passt,
sondern **wo**: die Textstelle mit hervorgehobenem Wort und die Seitenzahl als
Sprung in die Vorschau.

Das rechenschaftsrelevante Objekt bleibt unberührt. Die abgelegte PDF-Datei
wird nie verändert, ihre Prüfsumme behält ihre Bedeutung. Der Index ist ein
abgeleiteter Wert im Sinne von Prinzip 5 — jederzeit aus den Dateien neu
baubar, nie Quelle von irgendetwas.

Erkennung geschieht **lokal auf dem NAS**. Posteingang enthält Spendernamen,
Bankverbindungen, tierärztliche Befunde und Verträge; nichts davon verlässt
die Installation, weder an eine Cloud-API noch an ein Modell irgendwo anders.

## 3. Entscheidungen aus dem Brainstorming (2026-09-11)

Die Zählung führt die Kette der beiden Vorgänger-Specs fort (1–12 Kontakte,
13–20 Dokumente), damit „Entscheidung 19“ über die ganze Akte hinweg eindeutig
bleibt.

| # | Entscheidung | Verworfen |
|---|---|---|
| 21 | **Das Original bleibt bitgenau.** Erkannter Text lebt ausschließlich im Index, nie in der Datei. | „Sandwich-PDF“ über OCRmyPDF (schreibt das PDF neu, also neue Bytes und neue Prüfsumme an einem festgeschriebenen Dokument); abgeleitete Zweitdatei neben dem Original |
| 22 | **Tesseract 5 und Poppler im Container**, lokal statt Cloud. | Cloud-OCR (Datenschutz); `tesseract.js`/WASM (RAM-Spitzen im Node-Prozess); Vision-Modelle (GPU, Gigabytes) |
| 23 | **Ein Weg zum Text: durch die abgelegte Datei.** Auch selbst erzeugte Briefe werden extrahiert, nicht aus `draftBody` abgekürzt. | Zweiter Pfad für erzeugte Dokumente — zwei Testmengen, und der Index enthielte etwas anderes als das PDF |
| 24 | **Die Warteschlange ist eine Spalte**, kein eigenes Gebilde: `textStatus = 'pending'`. Wie der Eingangskorb `folder IS NULL` ist. | Tabelle `document_text_jobs`; externer Broker |
| 25 | **Worker im selben Prozess und im selben Container**, angestoßen aus `instrumentation.ts` plus Antippen nach dem Ablegen. | Sidecar-Container (bricht Ein-Container-Betrieb, Backup und `pnpm e2e:image`); Verarbeitung im Request |
| 26 | **Entscheidung je Seite, nicht je Dokument**: Unter dem Schwellenwert gilt eine Seite als Bild und geht durch OCR. | Ganzes Dokument durch OCR; ganzes Dokument als „hat Text“ abhaken |
| 27 | **Trigramm-Tokenizer** mit Diakritika-Faltung, weil deutsche Komposita sonst unauffindbar bleiben. Preis: Suchbegriffe unter drei Zeichen finden nichts. | `unicode61` (findet „Tierarztrechnung“ nicht bei Eingabe „rechnung“); beide Tabellen nebeneinander |
| 28 | **Die vorhandene Liste wird die Suche.** Das Filterfeld liest den Volltext mit; Treffer aus dem Volltext zeigen Passage und Seite. | Eigener Suchbildschirm |
| 29 | **Die Erkennung ist ein `deps`-Port** mit Attrappe in den Service-Tests. | Binaries direkt im Fachcode aufrufen — Tests, die auf dem Entwicklungsrechner nicht laufen |
| 30 | **Der Zustand ist sichtbar** (`pending`, `running`, `done`, `failed`, `unavailable`), samt Grund und Knopf „Neu lesen“. | Stiller Ausfall; Dokumente, die für immer auf `pending` stehen; ein Zustand weniger, der „wartet“ zeigt, während gelesen wird |
| 31 | **Die Liste bleibt chronologisch.** Der Volltext erweitert die Treffermenge, nicht die Reihenfolge. | Relevanzsortierung: `LIKE`- und `MATCH`-Treffer müssten vereinigt, gemeinsam gezählt und nach einem Rang sortiert werden, den nur eine Hälfte besitzt |

**Nicht-Ziele.** Durchsuchbare PDFs für die Welt außerhalb von Kompass
(Entscheidung 21); Bildeingang — die Akte nimmt weiter nur PDF, die
Scanfunktion von iOS und macOS liefert genau das; Handschrifterkennung;
Einsortierregeln auf dem Volltext (siehe § 12); Suche über Kontakte, Tiere,
Projekte oder die Mediathek; Relevanzsortierung (Entscheidung 31); Synonyme,
Stammformen, Rechtschreibtoleranz.

## 4. Der Weg des Textes

```
Ablegen (receiveDocument | fileDocument)
  └─ Datei im Modulspeicher, textStatus = 'pending', Worker antippen
       └─ Worker nimmt das älteste 'pending' und setzt 'running'
            ├─ pdftotext je Seite  ──────────────┐
            │    Seite über Schwellenwert?  ja ──┤ Text der Seite
            │                              nein ─┤
            │                                    │
            ├─ pdftoppm → PNG → tesseract ───────┘  (nur diese Seiten)
            │
            └─ Zeilen in document_text (documentId, page, text)
                 textStatus = 'done', textExtractedAt gesetzt
```

Fehlt ein Binary, meldet der Port das beim Start; Dokumente gehen dann nach
`unavailable` statt sich auf `pending` zu stapeln. Ein Fehler während der
Verarbeitung zählt `textAttempts` hoch; beim dritten Versuch bleibt es bei
`failed` mit lesbarem Grund in `textError`.

## 5. Datenmodell

### 5.1 Vier Spalten an `documents`

| Spalte | Typ | Bedeutung |
|---|---|---|
| `textStatus` | `pending` \| `running` \| `done` \| `failed` \| `unavailable` | zugleich die Warteschlange (Entscheidung 24) |
| `textAttempts` | Integer, Vorgabe 0 | Versuche; ab 3 keine Wiederholung |
| `textError` | Text, nullable | Grund im Klartext, für die Detailseite |
| `textExtractedAt` | ISO-8601 UTC, nullable | wann gelesen wurde |

Entwürfe haben keine Datei und bekommen `textStatus` nicht gesetzt — für sie
bleibt es beim Filter über den Betreff. Ein Entwurf ist kein Dokument im Sinne
der Rechenschaft; er hat auch keinen Volltext.

`running` ist kein Schmuck: Ein 200-Seiten-Scan liegt Minuten unter dem
Werkzeug, und „wartet“ wäre dann schlicht falsch. Den Zustand aufzuräumen kostet
eine Regel, die in § 7 steht — wer ihn nach einem Neustart vorfindet, hat einen
Absturz vor sich, keinen laufenden Lauf.

Erzeugt über `pnpm --filter @kompass/core db:generate`.

### 5.2 `document_text` als FTS5-Virtualtabelle

```sql
CREATE VIRTUAL TABLE document_text USING fts5(
  document_id UNINDEXED,
  page UNINDEXED,
  text,
  tokenize = 'trigram remove_diacritics 1'
);
```

Der Text liegt **in** der Tabelle, nicht bloß sein Index: `snippet()` braucht
ihn, um die Passage zu bauen. Eine Zeile je Seite — daher die Seitenzahl im
Treffer, ohne zusätzliche Buchhaltung.

Drizzle kennt keine virtuellen Tabellen. Die Migration entsteht deshalb über
`drizzle-kit generate --custom --name=dms_text` und wird von Hand gefüllt: eine
vom Werkzeug angelegte und im Journal registrierte Datei, kein nachträglich
editiertes Erzeugnis (AGENTS.md).

### 5.3 Lebensdauer der Zeilen

Gelesen wird neu, nicht ergänzt: Jeder Lauf löscht die Zeilen des Dokuments und
schreibt sie frisch — zweimal „Neu lesen“ ergibt denselben Bestand. Mit dem
Dokument verschwinden sie; ein **storniertes** Dokument behält seine Zeilen und
bleibt auffindbar, gekennzeichnet wie in der Liste. Rechenschaft heißt, dass
man auch das Zurückgenommene wiederfindet.

## 6. Die Erkennung als Port

```ts
export interface PageText {
  page: number;
  text: string;
  /** Woher der Text stammt — für Protokoll und Fehlersuche. */
  source: 'layer' | 'ocr';
}

export interface TextExtraction {
  /** Meldet, was der Container kann: Binaries da, welche Sprachen. */
  probe(): Promise<{ ok: true; languages: string[] } | { ok: false; error: string }>;
  extract(opts: { bytes: Uint8Array; languages: string[] }): Promise<PageText[]>;
}
```

**Warum der Port in den Kern gehört, obwohl ihn ein Modul braucht.** Die
Dokument-Spec zieht den Schnitt so: Fachlichkeit ins Modul, Infrastruktur in den
Kern. Was außerhalb des Prozesses liegt — Dateispeicher (`deps.files`),
Typst (`deps.documents`), die Datenbank — besitzt der Kern und reicht es als
Vertrag durch; sonst müsste jedes Modul seine eigenen Binaries finden, prüfen
und in Tests ersetzen. `deps.textExtraction` ist von derselben Art: kein
Vereinsvorgang, sondern ein Werkzeug im Container. **Der Kern ruft ihn selbst
nie** — wie er auch `deps.files('dms')` nie benutzt. Wenn später die Mediathek
Text aus einem hochgeladenen PDF braucht, liegt der Vertrag schon da.

Die Umsetzung liegt in einem eigenen Paket und ruft `pdftotext`, `pdftoppm` und
`tesseract` über `execFile`; der Kern kennt nur die Schnittstelle, wie bei
`deps.documents`. In `createTestDeps()` steht eine Attrappe davor, die feste
Seiten liefert — damit laufen die Service-Tests auf jeder Maschine, mit oder
ohne Binaries.

**Schwellenwert.** Eine Seite mit weniger als 100 Zeichen aus der Textebene
gilt als Bild. Der Wert steht als begründete Konstante im Code, nicht als
Einstellung: Er beschreibt eine Eigenschaft von PDFs, kein Vereinsspezifikum,
und ein Drehknopf dafür lädt nur zum Verstellen ein.

**Grenzen, mit Zahlen.** 30 Sekunden je Seite, 10 Minuten je Dokument. Wird
eines gerissen, endet der Lauf als `failed` mit der Seitenzahl im Grund. Beides
sind Konstanten wie der Schwellenwert: Sie beschreiben, wie lange ein Werkzeug
auf dieser Maschinenklasse brauchen darf, nicht wie ein Verein arbeitet. Ein
zerschossenes PDF darf den Worker nicht festfahren.

## 7. Der Worker

Ein Dienst im selben Prozess, gestartet aus `instrumentation.ts` beim
Serverstart. **Diesen Haken gibt es in dieser Anwendung noch nicht**, und was
er zusichert, ist hier nicht erprobt: dass er genau einmal läuft, dass ein
Intervall im Standalone-Server überlebt, dass `next dev` ihn nicht doppelt
startet. Deshalb steht er als **erste Aufgabe** in Block 2 des Plans — mit
`process.env.NEXT_RUNTIME === 'nodejs'` als Wächter und einem Beweis in Form
eines Tests, bevor irgendetwas darauf aufbaut. Trägt der Haken nicht, ist es
eine Aufgabe, die kippt, und nicht der Bildschirm aus Block 4. Er arbeitet **ein** Dokument zur Zeit — die NAS-CPU rendert
nebenher Typst, und zwei parallele Tesseract-Läufe nehmen sich gegenseitig die
Luft. Angestoßen wird zweifach: ein Intervall, das nach einem Neustart
Liegengebliebenes aufsammelt, und ein Antippen direkt nach dem Ablegen, damit
ein frisch hochgeladener Scan nicht bis zum nächsten Takt wartet.

**Aufräumen beim Start.** Was auf `running` steht, wenn der Prozess hochkommt,
kann kein laufender Lauf sein — es war ein Absturz oder ein Neustart mitten in
der Arbeit. Der Dienst setzt solche Zeilen auf `pending` zurück, bevor er die
erste nimmt. Das ist gefahrlos, weil ein Lauf die Zeilen seines Dokuments
ohnehin löscht und neu schreibt (§ 5.3).

Der Lauf selbst ist ein gewöhnlicher Service in der Hausform — `extractText(deps, ctx, { documentId })`
mit `systemContext()` im Kanal `system`. Damit ist er einzeln testbar, über MCP
anstoßbar und erzeugt einen Eintrag im Änderungsprotokoll: **einen je Dokument**,
nicht je Seite.

## 8. Suche

`listDocuments` bekommt eine Bedingung dazu, keinen zweiten Bauplan. Betreff und
Nummer laufen weiter über `LIKE`; der Volltext kommt als
`documents.id IN (SELECT document_id FROM document_text WHERE document_text MATCH ?)`
in dieselbe `OR`-Gruppe. Damit bleiben `limit`, `offset` und `total` unangetastet,
und die Liste bleibt chronologisch sortiert (Entscheidung 31).

**Warum keine Relevanzsortierung.** Sie klingt billiger, als sie ist: `LIKE`- und
`MATCH`-Treffer wären zu einer Menge zu vereinigen, gemeinsam zu zählen und nach
einem Rang zu ordnen, den nur die eine Hälfte besitzt — und das bei
seitenweisem Abruf. In einer Akte trägt die Datumsordnung ohnehin eine Aussage;
wer im Herbst gesucht hat, findet den Herbst. Zeigt sich das im Gebrauch als
Mangel, ist Relevanz ein eigener kleiner Vorgang und kein Fundament, das hier
fehlt.

**Die Passagen werden nachgeladen**, nur für die sichtbare Seite: ein zweiter,
kleiner Zugriff über `deps.sqlite` mit `snippet()` — `MATCH` und `snippet()`
bildet Drizzle nicht ab —, der je Dokument die beste Seite nimmt. Gekapselt im
Service; die Oberfläche bekommt Passage und Seitenzahl fertig.

**Fenstergröße.** `snippet()` zählt Token, und Token sind hier Trigramme: Mit
einem kleinen Fenster liefert es „…t[rechnung] …“ statt eines Satzes. Der Wert
steht auf 64 — gemessen ergibt das eine Zeile Kontext um den Treffer.

**Warum Trigramme.** Gemessen gegen SQLite 3.53.4 aus `better-sqlite3@13`, am
Beispielsatz „Tierarztrechnung vom 14. Oktober 2026 für die Kätzin Bärbel“:

| Eingabe | `unicode61 remove_diacritics 2` | `trigram remove_diacritics 1` |
|---|---|---|
| `rechnung` → *Tierarzt**rechnung*** | findet nichts | findet |
| `katzin` → *Kätzin* | findet | findet |
| Passage mit Hervorhebung | sauber | sauber, mit größerem Fenster |

Deutsche Komposita sind in einer Vereinsakte der Normalfall —
Spendenbescheinigung, Mitgliedsbeitrag, Impfnachweis, Vorstandssitzungsprotokoll.
Wer nur den zweiten Teil im Kopf hat, fände mit `unicode61` nichts.

**Der Preis, gemessen.** 1000 dicht beschriebene Seiten ergeben eine Datenbank
von 11,3 MB statt 4,8 MB (Text: 4,0 MB) — Faktor 2,8 gegenüber 1,2. Bei ein
paar hundert Schreiben im Jahr ist das Rauschen im Backup-Volume. Der zweite
Preis gehört in die Oberfläche: **Suchbegriffe unter drei Zeichen finden im
Volltext nichts.** Dann greift weiterhin der Filter über Betreff und Nummer,
und das Feld sagt es, statt leer zu bleiben.

**Welche Seite gezeigt wird.** Bei mehreren Treffern im selben Dokument
entscheidet `bm25()`, welche Passage in der Zeile steht. Bei Trigrammen zählt
das Trigramm-Übereinstimmungen — „die Seite, auf der am meisten passt“, kein
feinjustiertes Relevanzmaß. Für die Auswahl einer Passage reicht das; für die
Reihenfolge der Liste wird es gar nicht erst herangezogen (Entscheidung 31).

## 9. Rechte, Einstellungen, MCP

**Rechte bleiben unverändert.** Ein Recht für die ganze Akte (Entscheidung 16):
Wer `dms.view` hat, sucht im Volltext; wer sie nicht hat, sieht die Akte
ohnehin nicht. Kein neues Recht, keine Filterung je Treffer. Neu lesen — einzeln
wie gesammelt — liegt unter `dms.manage`, weil es Stammdatenpflege ist und kein
Tagesgeschäft.

**Eine Einstellung.** Das Manifest deklariert `dms.ocrLanguages`, Vorgabe
`deu+eng`. Welche Sprachen ein Verein führt, ist seine Sache (Prinzip 2);
welche Pakete vorliegen, ist eine Betriebstatsache, und die unterscheidet sich
je Umgebung: Der Container meldet `deu`, `eng`, `osd`, ein Entwicklungsrechner
mit `tesseract-lang` meldet 162 Sprachen. Die Einstellung prüft ihre Werte
deshalb gegen `probe()`, nicht gegen eine Liste im Code.

**Eine Änderung wirkt nach vorn, nicht rückwirkend.** Wer eine Sprache
hinzunimmt, löst damit kein Neu-Lesen von tausend Dokumenten aus — das ist eine
Entscheidung mit Laufzeit, und die trifft ein Mensch über „Alles neu lesen“.

**Ein MCP-Werkzeug.** `dms_search` über denselben Service, mit Dokument, Seite
und Passage im Ergebnis, unter `dms.view` (Prinzip 8).

## 10. Oberfläche

**Die Liste wird die Suche** (Entscheidung 28). Das Feld steht, wo es steht;
Treffer aus dem Volltext wachsen um eine zweite Zeile mit der Passage und
„Seite 3“ als Link auf `/dms/[id]/preview#page=3` — die Sprungmarke versteht
jeder Browser-PDF-Betrachter.

**Die Hervorhebung wird gebaut, nicht eingesetzt.** `snippet()` liefert die
Passage mit Markierungszeichen; ein Helfer zerlegt sie und rendert `<mark>`.
Kein `dangerouslySetInnerHTML`: Dieser Text stammt aus einem PDF, das jemand von
außen geschickt hat, und ist fremde Eingabe wie jede andere. Der Helfer bekommt
einen eigenen Test.

**Der Zustand steht auf der Detailseite**, und er sagt die Wahrheit über die
fünf Fälle: „Volltext gelesen am 11.09.2026“, „wartet auf Erkennung“, „wird
gelesen“, „fehlgeschlagen: Seite 4 überschritt das Zeitlimit“, „Texterkennung
nicht verfügbar“ — dazu der Knopf „Neu lesen“. Der Unterschied zwischen den
ersten beiden ist kein Wortklauben: Bei einem 200-Seiten-Scan steht „wird
gelesen“ minutenlang, und wer dort „wartet“ läse, hielte den Worker für tot. In
der Liste reicht ein unauffälliges Zeichen an allem, was noch nicht `done` ist.
In der Verwaltung steht „Alles neu lesen“ mit Zähler.

Alle Texte über `messages/de.json`, Sie-Form (Prinzip 7).

## 11. Betrieb

**Im Image** (gemessen in `node:26-bookworm-slim`): `tesseract-ocr` 5.3.0,
`tesseract-ocr-deu`, `tesseract-ocr-eng`, `poppler-utils` 22.12.0 — **117 MB
zusätzlicher Platz**, 36,6 MB Download, keine Fremdquelle nötig. Debian liefert
die Sprachdateien in der Ausgabe 4.1.0; sie tragen die LSTM-Modelle und taugen
für die moderne Erkennung. Enttäuscht die Qualität bei echten Scans, ist der
Hebel, neuere `traineddata` ins Image zu legen — ein Austausch, kein Umbau.

**Alle drei Prüfringe sehen echte Binaries.** Auf dem Entwicklungsrechner
`brew install tesseract tesseract-lang poppler` (dokumentiert in der
Einrichtung), in der CI eine `apt-get`-Zeile vor dem E2E-Lauf, im Container die
Zeile im Dockerfile. Sonst gäbe es einen Pfad, den nur der dritte Ring je
ausführt — und das wäre Raten über die CI.

**Was nicht reproduzierbar ist.** Tesseract 5.3.0 im Container und 5.5.3 auf
dem Mac liefern nicht denselben Text. Das ist hinnehmbar, weil der Index
abgeleitet und nie rechenschaftsrelevant ist — aber es heißt: **kein Test
vergleicht erkannten Text auf Gleichheit.** Geprüft wird, dass ein erwartetes
Wort vorkommt, nie der Wortlaut. Die Zusicherung „gleicher Entwurf ⇒
byte-identisches PDF“ aus der Dokument-Spec bleibt davon unberührt; sie gilt für
die Erzeugung, nicht für die Erkennung.

## 12. Tests

Die Attrappe am Port trägt die Masse (Vitest, `createTestDeps()`):

- Pro Service Erfolg, `forbidden`, `validation`, Eintrag im Änderungsprotokoll.
- Nach `receiveDocument` und `fileDocument` steht `textStatus = 'pending'`.
- Schwellenwert je Seite: Seite 1 digital, Seite 2 leer ⇒ OCR läuft genau einmal.
- Drei Versuche, dann `failed` mit lesbarem Grund in `textError`.
- Port meldet fehlendes Binary ⇒ `unavailable`, keine Wiederholungsschleife.
- Was beim Start auf `running` steht, ist danach `pending` und wird gelesen.
- Zweimal „Neu lesen“ ergibt denselben Bestand, keine doppelten Zeilen.
- Suche: Kompositum gefunden (`rechnung` → *Tierarztrechnung*), Seitenzahl
  stimmt, Passage trägt die Markierung; unter drei Zeichen kommt der Hinweis
  statt einer leeren Liste.
- Die Liste bleibt chronologisch, auch wenn der Volltext trifft; `total`,
  `limit` und `offset` zählen Volltexttreffer mit.
- Storniertes bleibt auffindbar; mit dem Dokument verschwinden seine Zeilen.
- Escaping: Ein PDF, in dem `<script>` steht, erscheint als Text, nicht als
  Markup.
- Ein Eintrag im Änderungsprotokoll je Dokument, Kanal `system`, nicht je Seite.

**Echtes Tesseract** prüft genau ein Integrationstest im dritten Ring, gegen eine
mitgelieferte Beispiel-PDF mit erfundenem Inhalt
(`no-association-content.test.ts` gilt auch für Testdaten).

**Der Haken selbst** bekommt einen eigenen Test, bevor der Worker darauf
aufsetzt: `instrumentation.ts` läuft genau einmal, nur im Node-Laufzeitzweig,
und der Dienst steht danach.

**E2E:** Ein Dokument ablegen, warten, bis der Zustand „gelesen“ steht, im
Suchfeld ein Wort aus dem Inhalt eingeben, Treffer mit Passage und Seite sehen,
dem Seitenlink folgen.

## 13. Seed

Die Seed-Dokumente kommen als `pending` in die Welt und werden vom Worker
gelesen wie alles andere — kein zweiter Weg in den Index, auch nicht für
Beispieldaten. `tests/seed.test.ts` prüft genau das.

## 14. Dateien

**Neu:** Port und Umsetzung (`packages/text-extraction/`), der
Instrumentierungshaken `apps/kompass/instrumentation.ts` (bisher nicht
vorhanden), Worker und
Suchservice im Modul (`packages/modules/dms/src/text.ts`, `search.ts`,
`worker.ts`), Migration für die vier Spalten plus handgefüllte
`--custom`-Migration für `document_text`, Beispiel-PDF als Testdatei,
Passagen-Helfer in der Oberfläche.

**Geändert:** `packages/core/src/deps.ts` (`textExtraction`),
`packages/core/src/testing/` (Attrappe), `packages/modules/dms/src/schema.ts`,
`service.ts` (Antippen nach dem Ablegen, Suche), `manifest.ts` (Einstellung),
`mcp-tools.ts` (`dms_search`),
`document-list.tsx`, `document-detail.tsx`, Verwaltung, `messages/de.json`,
`Dockerfile`, CI-Workflow, `docs/betrieb.md`, Einrichtungsdoku.

## 15. Self-Review

**Platzhalter.** Keine offenen Punkte. Was nicht gebaut wird, steht als
Nicht-Ziel in § 3.

**Konsistenz.** Der Text kommt durchgängig aus der Datei (§ 2, § 4,
Entscheidung 23) — auch bei selbst erzeugten Briefen; die Abkürzung über
`draftBody` kommt nirgends vor. Die Warteschlange ist überall die Spalte
`textStatus` (§ 4, § 5.1, § 7), nie eine Tabelle. Das Original bleibt in jedem
Abschnitt unverändert (§ 2, § 5.3, Entscheidung 21).

**Zuschnitt.** Vier Blöcke für den Plan: (1) Port, Binaries, Erkennung je Seite
samt Image und Einrichtung; (2) der Instrumentierungshaken — zuerst, weil
unerprobt — dann Zustand und Worker; (3) Index, Migration, Suchservice, MCP;
(4) Oberfläche, i18n, E2E.

**Was hier behauptet und nicht geprüft ist.** Genau eines: dass Next' Haken
trägt (§ 7). Alles andere steht auf gemessenen Werten — Tokenizer, Indexgröße,
Paketgröße, Tesseract-Ausgaben. Deshalb die Reihenfolge in Block 2.

**Ambiguität.** „Gelesen“ heißt: Alle Seiten haben eine Zeile im Index,
`textStatus = 'done'`. „Wartet“ (`pending`) und „wird gelesen“ (`running`) sind
zwei Zustände, nicht einer mit zwei Namen; nach einem Neustart gibt es kein
`running` (§ 7). „Nicht verfügbar“ heißt: Die Binaries fehlen, nicht dass
das Dokument keinen Text hätte — es kommt wieder in die Schlange, sobald sie da
sind. Ein Dokument ohne jeden erkennbaren Text (leeres Blatt) ist `done` mit
leeren Zeilen, nicht `failed`.

**Was später kommen kann, aber nicht hier.** Einsortierregeln auf dem Volltext
(`document_rules.matchField = 'fulltext'`) wären billig zu bauen und nützen
trotzdem noch nichts: Die Regeln belegen das Ablegen-Formular vor, und zu dem
Zeitpunkt ist die Erkennung noch nicht durch. Das trägt erst, wenn ein Agent
nachträglich vorschlägt — der Zielzustand aus § 2 der Dokument-Spec, und ein
eigener Vorgang mit eigener Spec.
