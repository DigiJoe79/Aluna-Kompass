# Nordstern

Stand 2026-09-12. Das Gesamtbild von Aluna Kompass und die Reihenfolge, in der
es entsteht. Regeln stehen in `AGENTS.md`, das Was einzelner Vorhaben in
`docs/superpowers/specs/`, bewusst zurückgestellte Kleinigkeiten in
`docs/backlog.md`. Dieses Dokument zeigt, wohin das alles führt.

Der Stufenplan aus der Fundament-Spec vom 2026-09-05 (1 Fundament, 2 Webseite,
3 Finanzen, 4 Tiere, 5 Mitglieder) ist damit abgelöst. Er hat eine Woche
gehalten: Stufe 3 wurde für die Webseiten-Templates ein zweites Mal vergeben,
und Kontakte, Akte und Volltext kamen ohne Nummer. Von hier an gibt es keine
Stufennummern mehr, sondern Säulen und eine Roadmap.

## 1. Was Kompass ist

Aluna Kompass ist die **eine Anwendung für alle Angelegenheiten eines
gemeinnützigen Vereins**: Webseite, Post, Geld, Mitglieder, Beschlüsse und das,
was der Verein sonst noch führt. Nicht ein Werkzeug unter mehreren, sondern der
Ort, an dem ein Vorgang entsteht und bleibt.

Der Grundsatz dahinter: **ein Vorgang, eine Quelle.** Jeder Brief, jede
Buchung, jeder Beschluss wird genau einmal erfasst, an der Stelle, an der er
anfällt, und von da an nie wieder abgetippt, kopiert oder nachträglich
einsortiert. Alles, was der Verein nach außen schuldet, wird daraus erzeugt:
Jahresfinanzbericht, Kassenprüfungsunterlagen, Zuwendungsbestätigungen,
Protokolle, Meldungen an Register und Finanzamt, die öffentliche Webseite.

Der Zweck ist **Rechenschaft**. Ein gemeinnütziger e.V. hat Pflichten gegenüber
Finanzamt, Registergericht, Transparenzregister, Mitgliedern und Spendern. Wer
diese Pflichten aus einer vollständigen, unveränderbaren Aufzeichnung erfüllt,
muss am Jahresende nichts rekonstruieren. Kompass ist so gebaut, dass diese
Aufzeichnung nebenbei entsteht, während der Vorstand seine Arbeit tut.

Der Kern ist generisch und für jeden Verein gleich; Vereinsspezifisches ist ein
Modul, das sich je Installation ein- und ausschalten lässt. Eine Installation
je Verein, auf eigener Hardware, nur im eigenen Netz. Aluna Tierhilfe e.V. ist
Erstnutzer und Taktgeber, nicht Grenze der Zielgruppe. Das Projekt ist Open
Source.

## 2. Was Kompass nicht ist

Diese Grenzen sind entschieden. Wer sie verschieben will, ändert dieses
Dokument, nicht die Spec eines Moduls.

- **Kein Newsletter.** Massenversand ist ein eigenes Handwerk mit eigenen
  Pflichten (Einwilligung, Abmeldung, Zustellbarkeit). Dafür gibt es Dienste.
- **Kein Mailprogramm.** Kompass verschickt und empfängt keine E-Mails. Ein
  Brief verlässt Kompass als PDF; eine Mail, die in die Akte gehört, wird als
  PDF gedruckt und abgelegt. Das hält die Akte bei einem Dateiformat und
  Kompass aus dem Postfach heraus.
- **Kein Kalender.** Termine ohne Bezug zu einem Vorgang gehören in den
  Kalender, den der Vorstand ohnehin hat. Kompass kennt Fristen und
  Wiedervorlagen, und beide hängen immer an etwas: an einem Dokument, einem
  Kontakt, einer Buchung, einer Versammlung.
- **Kein Aufgabenmanager.** Dieselbe Grenze: Wiedervorlage am Vorgang ja,
  freie Aufgabenlisten nein. Sonst konkurriert Kompass mit Werkzeugen, die das
  besser können, und verliert seinen Kern.
- **Keine qualifizierte elektronische Signatur.** Sie ersetzt die
  eigenhändige Unterschrift nur, wo das Gesetz Schriftform verlangt, und das
  ist im Vereinsalltag fast nie der Fall: Zuwendungsbestätigungen dürfen
  maschinell ohne Unterschrift erstellt werden, Registeranmeldungen beglaubigt
  der Notar, Verträge und Mitgliedsanträge sind formfrei. Was der Verein
  braucht, ist der Nachweis, dass ein Dokument seit dem Festschreiben
  unverändert ist, und den liefern Prüfsumme und Änderungsprotokoll. Ein
  Vereinssiegel bei einem Vertrauensdiensteanbieter kostet laufend Geld für
  einen Vorgang, den es nicht gibt.
- **Kein Multi-Tenant.** Eine Installation je Verein. Kein Mandantenfeld,
  keine geteilte Datenbank.
- **Kein Bildeingang, keine Handschrifterkennung.** Die Akte nimmt PDF. Die
  Scanfunktion jedes Telefons liefert genau das.
- **Kein Baukasten für Webseiten.** Der Verein ist Template-Autor. Kompass
  verwaltet Inhalte, die das Template deklariert, und kennt die Seite sonst
  nicht.

## 3. Säulen und Querschnitte

Sieben Säulen tragen das Bild, zwei Querschnitte laufen durch alle. Jede Säule
nennt, was sie leistet, welche Specs sie beschreiben und wo sie steht.

### Fundament

Nutzer, Rollen und Rechte, Einstellungen statt Konstanten, Themes,
Änderungsprotokoll, Backup und Import, Modul-System, MCP-Server, die
Dokument-Pipeline mit Basis-Vorlagen, die Mediathek mit Löschpolitik, drei
Prüfringe. Alles, woran sich Fachmodule anhängen.

Specs: `2026-09-05-fundament-design.md`, `2026-09-06-setup-import-design.md`,
`2026-09-08-pruefringe-design.md`,
`2026-09-09-dokument-pipeline-und-basisvorlagen-design.md`,
`2026-09-09-loeschbarkeit-und-mediathek-design.md`.
Design-Referenz: `docs/design/fundament/`.

**Stand: steht.** Offen im Backlog: Backup-Upload über einen Route Handler.

### Öffentlichkeit

Die Webseite des Vereins, gepflegt in Kompass, gebaut als statische Seite aus
einem Template, das der Verein selbst mitbringt, und aus Prod zum Hoster
publiziert. Im Internet gibt es weder Datenbank noch Login. Projekte gehören
mit ihrem öffentlichen Teil hierher; ihren Finanzteil bekommen sie in der
Säule Finanzen.

Specs: `2026-09-05-webseite-design.md` (abgelöst),
`2026-09-07-site-template-design.md`, `2026-09-08-site-seed-design.md`.

**Stand: steht, Cutover offen.** Alunas Template und seine Startinhalte liegen
im Vereinsrepo und laufen lokal durch die Pipeline (2026-09-12: 77 Dateien,
keine Lücken, keine Sperrworttreffer). Auf dem Testcontainer ist noch nichts
eingelesen, ein Publish aus Test nicht abgenommen. Betterplace steckt noch im
Kern.

### Korrespondenz und Akte

Kontakte als Empfänger und Absender, mit Rollen über die Zeit und einer
berechneten Aufbewahrungsfrist. Die Akte für ausgehende und eingehende Post:
Entwurf, Festschreiben, Nummer, Storno statt Löschen, Ordnungsbaum und Bezüge,
Einsortierhilfe, Volltext mit Texterkennung lokal auf dem NAS. Der Ort, an dem
jeder Vorgang eine Spur hinterlässt.

Specs: `2026-09-10-kontakte-design.md`,
`2026-09-10-dokumente-und-korrespondenz-design.md`,
`2026-09-11-volltext-und-texterkennung-design.md`.

**Stand: steht, Ausbau läuft.** Was zu „fertig" fehlt, steht in Schritt 1 der
Roadmap.

### Finanzen

Konten, Buchungen mit Zuordnung zu den vier Sphären, Belege aus der Akte,
Bankimport, Rücklagen nach § 62 AO, Zuwendungsbestätigungen nach amtlichem
Muster, Kostenerstattungen, Mittelweitergabe an Partner, Projekte mit
Finanzseite. Am Ende: Einnahmen-Überschuss-Rechnung, Vermögensübersicht,
Mittelverwendungsrechnung, Kassenprüfungsunterlagen.

Spec: noch keine.

**Stand: offen.** Schritt 3 der Roadmap.

### Mitglieder und Gremien

Mitgliederstamm auf den Kontakten, Beiträge als Buchungen, Beitragsordnung und
Satzung mit Ständen, Mitgliederversammlung mit Einladung, Anwesenheit und
Protokoll, Vorstandssitzungen und Beschlüsse, Ehrenamt als Rolle. Am Ende:
Tätigkeitsbericht und alles, was Registergericht und Transparenzregister
verlangen.

Spec: noch keine.

**Stand: offen.** Schritt 4 der Roadmap.

### Vereinsspezifische Module

Was ein Verein braucht und ein anderer nicht. Für Aluna: das Tiermodul in
seiner Vollstufe. Es bildet den ganzen Weg eines Tieres ab, von Anfang bis
Ende, und hängt jeden Schritt an die anderen Säulen: die Aufnahme im
Partner-Shelter, der Transport mit seinen Papieren, die medizinische Akte mit
Tierarztrechnungen als Belegen, die Vermittlung von der Anfrage über
Selbstauskunft und Vorkontrolle bis zum Adoptionsvertrag und zur Schutzgebühr
als Buchung, die Nachkontrolle, die Patenschaft, der Verbleib. Dazu
Bestandsbuch und die Nachweise nach § 11 Tierschutzgesetz, die sich aus genau
diesen Schritten ergeben. Ein Abgleich mit einer Spendenplattform wäre ein
weiteres solches Modul. Ein Modul erfüllt dieselben Regeln wie der Kern:
Rechte, Protokoll, MCP, Seed.

Spec: das Profil aus `2026-09-05-webseite-design.md`; die Vollstufe hat noch
keine.

**Stand: Profil steht, Vollstufe offen.** Schritt 5 der Roadmap.

### Betrieb

Ein Image für Dev, Test und Prod, Container auf dem NAS des Vereins, Backup
vor jedem Update, Migrationen beim Start, CI, die gegen die ausgelieferte
Fassung prüft. Kein Feature, aber die Bedingung für alle.

Quellen: `docs/betrieb.md`, `2026-09-08-pruefringe-design.md`.

**Stand: steht.**

### Querschnitt: Rechenschaft

Keine eigene Säule, sondern das Ende jeder Säule. Jede Säule ist erst fertig,
wenn sie das erzeugt, was der Verein nach außen schuldet: Finanzen die EÜR und
die Kassenprüfungsunterlagen, Gremien das Protokoll und den Tätigkeitsbericht,
die Akte den Aktenexport für Prüfer, Kontakte das Verzeichnis der
Verarbeitungstätigkeiten und die Löschfälligkeit. Die Liste der Pflichten
steht als Raster in der Fundament-Spec, Abschnitt „Rechenschaftspflichten".

### Querschnitt: Fristen und Wiedervorlagen

Ebenfalls keine eigene Säule. Der Kern kennt Aufbewahrungsfristen und eine
Fälligkeitsliste; jede Säule bringt ihre Fristen und ihre Wiedervorlagen mit:
die Akte „Antwort erwartet bis", Finanzen die Abgabefristen, Gremien die
Einladungsfristen. Eine Frist hängt immer an einem Vorgang, nie in der Luft.

## 4. Roadmap

Fünf Schritte in dieser Reihenfolge. Jeder Schritt hat ein Fertig-Kriterium,
damit er abgeschlossen werden kann, statt zu verlaufen. Die beiden
Querschnitte wachsen mit jedem Schritt, sie stehen nicht einzeln.

Was die Reihenfolge treibt: Aluna Tierhilfe e.V. wird gerade eingetragen. Ab
dem ersten Tag soll der Verein in Kompass arbeiten, nichts soll nachträglich
einsortiert werden. Deshalb erst die beiden Säulen fertig, die schon stehen,
dann das Geld, dann das, was die Gründung selbst an Vorgängen erzeugt.

### Schritt 1: Akte fertig

- Design-Handoff Runde 3 umsetzen: Drag-and-drop auf die Ordnerspalte, Dialog
  „Post ablegen", Entwurf als Splitscreen mit Vorschau. Das Handoff ist global
  und betrifft auch Seiten außerhalb der Akte; die Akte ist der Anfang.
- Bezüge zwischen Dokumenten: unterschriebene Fassung von, Antwort auf,
  ersetzt. Ein Vorgang liegt sonst in zwei Zeilen, die nichts voneinander
  wissen.
- Versandvermerk am festgeschriebenen Dokument: wann, auf welchem Weg.
- Wiedervorlage am Dokument, als erster Anwendungsfall des Querschnitts.
- Interne Notiz am Dokument, als Arbeitsmaterial, nicht Teil des Dokuments.
- Textbausteine für Briefe.
- Sortierbare Tabellen (Backlog 6).

Diese Punkte berühren das Datenmodell; sie kommen jetzt, damit keine laufende
Akte migriert werden muss.

**Fertig, wenn:** ein Verein einen Schriftwechsel vollständig in der Akte
führen kann, vom Entwurf über den Versand bis zur Antwort, und die Oberfläche
dem Handoff entspricht.

**Abgeschlossen am 2026-09-12.** Woran erkannt: Die E2E-Liste aus § 8 der Spec
`2026-09-12-akte-fertig-design.md` läuft grün — Einsortieren aus dem
Eingangskorb, Antwort auf einen Eingang, Versandvermerk, Wiedervorlage bis zur
Startseite, Notiz, Baustein, Kontakt aus dem Overlay, Beziehungsakte am
Kontakt, Sortierung, Storno mit Ersatz. Der Handoff-Abgleich außerhalb der
Akte läuft weiter, gehört aber nicht mehr zu diesem Schritt.

### Schritt 2: Webseite fertig

- Cutover-Rest aus `2026-09-07-site-5-cutover.md`: Image auf den
  Testcontainer, Alunas Template einlesen, Startinhalte übernehmen, Publish
  aus Test abnehmen. Danach der erste Publish aus Prod.
- Betterplace aus dem Kern, Projekte als eigenes Kernmodul (Backlog 4). Vor
  Finanzen, weil Finanzen die Projekte erweitert.
- Browsertest bei Handybreite (Backlog 3).

**Fertig, wenn:** Alunas Seite aus Prod publiziert wird, WordPress abgeschaltet
ist und im Kern kein Feld mehr steht, bei dem ein anderer Verein stutzt.

### Schritt 3: Finanzen

Eigene Spec, eigenes Brainstorming. Was heute schon feststeht:

- Konten, Buchungen nach Sphären, Belege als Bezug in die Akte, Storno statt
  Löschen. Projekte bekommen ihre Finanzfelder; damit werden sie
  rechenschaftsrelevant und die Löschfrage aus `AGENTS.md` entscheidet sich.
- Bankimport aus Kontoumsätzen. Ohne ihn tippt jemand jede Buchung ab, und die
  Kassenprüfung vergleicht Abgetipptes mit dem Auszug.
- Beleg-Import aus E-Rechnungen: ZUGFeRD zuerst, weil es eine PDF mit
  eingebettetem XML ist und damit in die Akte passt; Kompass liest das XML und
  belegt die Buchung vor. XRechnung (reines XML) bleibt offen, bis ein
  Lieferant eine schickt.
- Rücklagen nach § 62 AO, Kostenerstattungen, Mittelweitergabe an Partner.
- Zuwendungsbestätigungen nach amtlichem Muster, einzeln und als
  Serienerzeugung zum Jahresende.
- Aktenexport für Prüfer: ein Ordner oder Jahrgang als Bündel aus PDFs mit
  Inhaltsverzeichnis, Nummern, Daten und Prüfsummen. Kommt hier und nicht in
  Schritt 1, weil der Prüfer die Belege dazu will.
- Rechenschaft: EÜR, Vermögensübersicht, Mittelverwendungsrechnung,
  Kassenprüfungsunterlagen.
- Fristen: Steuererklärung, Freistellungsbescheid.

**Fertig, wenn:** ein Geschäftsjahr vollständig in Kompass gebucht ist und
die Kassenprüfung ihre Unterlagen aus Kompass bekommt, ohne dass jemand etwas
nachträgt.

### Schritt 4: Mitglieder und Gremien

Eigene Spec, eigenes Brainstorming. Was heute feststeht:

- Mitglieder sind Kontakte mit einer Rolle und einem Beitrag; Beiträge sind
  Buchungen.
- Satzung und Beitragsordnung mit Ständen, ab der Gründungsfassung.
- Mitgliederversammlung: Einladung mit Frist, Anwesenheit, Protokoll.
  Vorstandssitzungen und Beschlüsse.
- Ehrenamt als Kontaktrolle, dazu, was ein Helfer außer der Rolle braucht.
- Rechenschaft: Protokolle, Tätigkeitsbericht, Meldungen an Registergericht
  und Transparenzregister, Verzeichnis der Verarbeitungstätigkeiten.

Vor Tiere, weil die Gründung selbst diese Vorgänge erzeugt und sie sonst
nachträglich einsortiert werden.

**Fertig, wenn:** die erste ordentliche Mitgliederversammlung von der Einladung
bis zum Protokoll in Kompass geführt wurde.

### Schritt 5: Tiere Vollstufe

Eigene Spec, eigenes Brainstorming. Das Modul bildet den Prozess von Anfang
bis Ende ab, nicht nur das Profil und das Bestandsbuch. Was heute feststeht,
entlang des Weges eines Tieres:

- **Aufnahme.** Herkunft, Partner-Shelter als Kontakt, Datum, Zustand;
  Übernahmevereinbarung als Dokument der Akte.
- **Transport.** Fahrt, Fahrer, Fahrzeug, Tiere an Bord, Papiere (TRACES,
  Gesundheitszeugnis, EU-Heimtierausweis) als Dokumente; Kosten als Belege.
- **Medizinische Akte.** Impfungen, Kastration, Behandlungen, Chip; jede
  Tierarztrechnung als Beleg in Finanzen und als Dokument in der Akte, am
  Tier verlinkt.
- **Vermittlung.** Anfrage, Selbstauskunft und Vorkontrolle als Dokumente,
  Adoptionsvertrag als erzeugtes Dokument mit unterschriebener Fassung als
  Eingang, Schutzgebühr als Buchung, Übergabe, Nachkontrolle mit
  Wiedervorlage.
- **Patenschaft.** Pate als Kontakt, Beitrag als Buchung, Laufzeit.
- **Verbleib.** Vermittelt, zurückgekommen, verstorben, an Partner
  weitergegeben; jeder Wechsel mit Datum und Dokument.
- **Rechenschaft.** Bestandsbuch und die Nachweise nach § 11
  Tierschutzgesetz kommen aus diesen Schritten, nicht aus einer eigenen
  Erfassung. Danach sind Tierprofile rechenschaftsrelevant.

Jeder Schritt hängt an den anderen Säulen: Kontakte für Menschen und
Partner, Akte für Papiere, Finanzen für Geld, Wiedervorlagen für Fristen.
Das Modul erfindet nichts davon neu; es verbindet.

Nach Gremien, weil die Pflichten aus § 11 erst mit der Erlaubnis entstehen,
die nach der Eintragung beantragt wird. Bis dahin genügt das Profil für die
Webseite.

**Fertig, wenn:** ein Tier vom Eintreffen im Partner-Shelter bis zur
Nachkontrolle nach der Adoption lückenlos in Kompass steht, jede Rechnung,
jede Fahrt und jeder Vertrag daran hängt, und das Bestandsbuch aus Kompass
kommt.

## 5. Später

Entschieden als sinnvoll, bewusst nicht in den fünf Schritten. Kommt, wenn
die Säulen stehen.

- **Agent schlägt vor, der Mensch schreibt fest.** Post wird abgelegt, ein
  Agent schlägt Art, Betreff, Bezüge und Frist aus dem Volltext vor. Die
  Schnittstelle dafür steht (Services über MCP); die Treffsicherheit braucht
  den Volltext, den es jetzt gibt.
- **Einsortierregeln auf dem Volltext** (Backlog 5), als Teil desselben
  Vorgangs.
- **Freigabe-Schritt vor dem Festschreiben** (Vier-Augen-Prinzip), als
  Rechte-Frage, nicht als Signatur.
- **Editor für Basis-Vorlagen** in der Oberfläche (Pipeline-Spec,
  Entscheidung 7).
- **Spendenplattform-Abgleich** als vereinsspezifisches Modul.
- **XRechnung** in der Akte, samt Sichtfassung.

## 6. Pflege

Der Nordstern ist ein lebendes Dokument, kein Protokoll. Er beschreibt den
Zielzustand und den Weg dorthin, wie sie heute gelten.

- Jede neue Spec nennt in ihrem ersten Abschnitt die Säule, zu der sie gehört,
  und den Roadmap-Schritt, den sie erfüllt.
- Wer eine Säule verschiebt, eine Grenze aus Abschnitt 2 antastet oder die
  Reihenfolge der Roadmap ändert, zieht dieses Dokument im selben Commit nach.
  Die Begründung steht hier, nicht nur in der Spec.
- Ein abgeschlossener Schritt bleibt stehen, mit Datum und dem Satz, woran
  man den Abschluss erkannt hat. Erledigtes wird nicht gelöscht, anders als im
  Backlog, weil die Reihenfolge selbst eine Entscheidung war.
- Was klein und zurückgestellt ist, gehört ins Backlog. Was das Bild ändert,
  gehört hierher.
