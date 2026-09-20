# Nordstern

Stand 2026-09-20. Das Gesamtbild von Aluna Kompass und die Reihenfolge, in der
es entsteht. Regeln stehen in `AGENTS.md`, das Was einzelner Vorhaben in
`docs/intern/specs/`, bewusst zurückgestellte Kleinigkeiten in
`docs/intern/backlog.md` (beides Arbeitsdokumente, nicht im öffentlichen
Repo). Dieses Dokument zeigt, wohin das alles führt.

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
Modul, das sich je Installation ein- und ausschalten lässt. Ein Modul ist heute
ein Baustein derselben Auslieferung: Es steckt im Image, seine Tabellen kommen
mit den Migrationen des Kerns, seine Seiten mit der Anwendung. Nachinstallieren
ohne neues Image gibt es nicht; das steht in Abschnitt 5. Eine Installation
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
  besser können, und verliert seinen Kern. Ein fester, im Code stehender
  Ablauf an einem Vorgang — der Jahresabschluss am Geschäftsjahr, die
  Amtsübergabe — ist keine Aufgabenliste: keine freien Aufgaben, keine
  Zuweisung, keine Termine.
- **Keine qualifizierte elektronische Signatur.** Sie ersetzt die
  eigenhändige Unterschrift nur, wo das Gesetz Schriftform verlangt, und das
  ist im Vereinsalltag fast nie der Fall: Zuwendungsbestätigungen über Geld
  dürfen maschinell mit eingeblendetem Faksimile erstellt werden, wenn das
  Verfahren dem Finanzamt angezeigt ist (R 10b.1 Abs. 4 EStR); Sach- und
  Aufwandsspenden brauchen die eigenhändige Unterschrift auf Papier, die als
  Eingang in die Akte kommt. Registeranmeldungen beglaubigt
  der Notar, Verträge und Mitgliedsanträge sind formfrei. Was der Verein
  braucht, ist der Nachweis, dass ein Dokument seit dem Festschreiben
  unverändert ist, und den liefern Prüfsumme und Änderungsprotokoll. Ein
  Vereinssiegel bei einem Vertrauensdiensteanbieter kostet laufend Geld für
  einen Vorgang, den es nicht gibt.
- **Keine Finanzbuchhaltung für Bilanzierer, keine Übermittlung.** Kompass
  führt eine Einnahmen-Überschuss-Rechnung nach deutschem
  Gemeinnützigkeitsrecht. Keine Bilanz, keine Lohnabrechnung, keine
  Umsatzsteuer-Voranmeldung, keine Übermittlung an ELSTER — Kompass liefert
  die Zahlen, ein Mensch reicht sie ein. Keine direkte Bankanbindung:
  Kontoumsätze kommen als Datei, weil eine Bankschnittstelle im eigenen Netz
  ein Betriebs- und Zulassungsrisiko wäre. Keine ausgehenden E-Rechnungen.
  Wer darüber hinauswächst, übergibt per Export an eine Finanzbuchhaltung.
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
Prüfringe, und die Startseite als Kachelfläche, die jeder Nutzer sich selbst
zusammenstellt. Alles, woran sich Fachmodule anhängen.

Spec: mehrere, siehe `docs/intern/specs/`.

Die Startseite war bis zum 2026-09-17 die Einrichtungs-Checkliste aus dem
Handoff („Checkliste, kein Dashboard — Stufe 1 hat keine Zahlen“). Das galt
für Stufe 1; mit Akte, Kontakten und Webseite ist sie zur Fläche geworden,
auf der jeder sieht, was für ihn ansteht. Jedes Modul steuert seine Kacheln
über das Manifest bei, der Kern speichert die Anordnung je Nutzer. Entschieden
am 2026-09-17, vor Finanzen, damit Finanzen seine Kacheln gleich mitbringt.

**Stand: steht.** Offen im Backlog: Backup-Upload über einen Route Handler.
Mit den Vorarbeiten für Fachmodule (0.2.0) liefert ein Modul seine
Grundausstattung bei jedem Start nach, ohne wiederherzustellen, was der Verein
geändert hat; neue Haken beschriften fremde Datensätze, räumen Anhängsel mit
und lassen ein Modul sein Ausschalten ablehnen; „nur ein Mensch über die
Oberfläche" ist ein Helfer des Kerns.

### Öffentlichkeit

Die Webseite des Vereins, gepflegt in Kompass, gebaut als statische Seite aus
einem Template, das der Verein selbst mitbringt, und aus Prod zum Hoster
publiziert. Im Internet gibt es weder Datenbank noch Login. Projekte gehören
mit ihrem öffentlichen Teil hierher; ihren Finanzteil bekommen sie in der
Säule Finanzen.

Spec: mehrere, siehe `docs/intern/specs/`.

Was der Verein anbietet, entscheidet das Template, nicht der Kern. Seit dem
2026-09-13 gilt das ausdrücklich: Ein Angebot wie die Patenschaft ist eine
deklarierte Variable mit Schalter, und die Rechtstexte (Impressum,
Datenschutzerklärung) entstehen im Template aus den Vereinsdaten in Kompass.
Der Grundsatz „eine Quelle" reicht damit bis in die Pflichtangaben: Anschrift,
Vorstand und Registereintrag stehen nirgends ein zweites Mal.

**Stand: steht.** Alunas Seite wird seit dem 2026-09-19 aus Prod publiziert
und steht unter der eigenen Domain; das frühere CMS ist abgeschaltet. Test
bleibt der Weg, auf dem Inhalte und Template vorher abgenommen werden.
Projekte sind seit dem 2026-09-12 ein eigenes Modul; der Kern kennt keine
Spendenplattform.

### Korrespondenz und Akte

Kontakte als Empfänger und Absender, mit Rollen über die Zeit und einer
berechneten Aufbewahrungsfrist. Die Akte für ausgehende und eingehende Post:
Entwurf, Festschreiben, Nummer, Storno statt Löschen, Ordnungsbaum und Bezüge,
Einsortierhilfe, Volltext mit Texterkennung lokal auf dem NAS. Der Ort, an dem
jeder Vorgang eine Spur hinterlässt.

Spec: mehrere, siehe `docs/intern/specs/`.

**Stand: steht.** Schritt 1 der Roadmap ist abgeschlossen. Mit den Vorarbeiten
für Fachmodule (Fassung 0.2.0) kommen Schutzbereiche an der Dokumentart — ein
Modul meldet einen Bereich mit seinem Recht an, und wer nur dieses Recht hat,
sieht in der Akte genau diese Dokumente —, das Ausstellen von Dokumenten aus
Modulen und der Aktenexport.

### Finanzen

Konten, Buchungen mit Zuordnung zu den vier Sphären, Belege aus der Akte,
Bankimport, Zweckbindung als eigene Dimension neben dem Projekt, Rücklagen
nach § 62 AO, Zuwendungsbestätigungen nach amtlichem Muster,
Kostenerstattungen mit Freigabe durch eine zweite Person, Mittelweitergabe an
Partner und Aufträge an Hilfspersonen mit Nachweisakte, Projekte mit
Finanzseite. Am Ende:
Einnahmen-Überschuss-Rechnung, Vermögensübersicht, Mittelverwendungsrechnung,
Kassenprüfungsunterlagen. Das Modell ist ein Einnahmen-Ausgaben-Journal mit
ausgeglichenen Zeilen, keine doppelte Buchführung; Vereine mit
Bilanzierungspflicht sind nicht die Zielgruppe.

Spec: `2026-09-20-finanzen-design.md` in `docs/intern/specs/`, eine für das
ganze Modul, umgesetzt in neunzehn Plänen; davor
`2026-09-20-vorarbeiten-fachmodule-design.md` mit dem, was Kern, Akte und
Kontakte dafür lernen müssen — und was Schritt 4 genauso braucht.
Festgeschriebenes wird nie gelöscht; nach Ablauf der Aufbewahrung verschwindet
der Personenbezug, nicht die Buchung.

**Stand: in Arbeit.** Schritt 3 der Roadmap, Fassung 0.2.0.

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

Spec: das Profil hat eine, siehe `docs/intern/specs/`; die Vollstufe hat noch
keine.

**Stand: Profil steht, Vollstufe offen.** Schritt 5 der Roadmap.

### Betrieb

Ein Image für Dev, Test und Prod, Container auf dem NAS des Vereins,
Migrationen beim Start, CI, die gegen die ausgelieferte Fassung prüft. Kein
Feature, aber die Bedingung für alle.

Das Backup vor einem Update ist ein **Schritt in der Anleitung**, kein
Mechanismus: `docs/handbuch/betrieb.md` stellt ihn an den Anfang des Updates,
und weil Migrationen nur vorwärts laufen, ist er der einzige Rückweg. Ihn zu
erzwingen würde bedeuten, dass der Container den Start verweigert, solange
kein frisches Archiv daliegt — das wäre eine Hürde an der falschen Stelle.
Wer ihn automatisieren will, tut das im Update-Ablauf, nicht in der
Anwendung.

Quellen: `docs/handbuch/betrieb.md`; Spec siehe `docs/intern/specs/`.

**Stand: steht.**

### Querschnitt: Rechenschaft

Keine eigene Säule, sondern das Ende jeder Säule. Jede Säule ist erst fertig,
wenn sie das erzeugt, was der Verein nach außen schuldet: Finanzen die EÜR und
die Kassenprüfungsunterlagen, Gremien das Protokoll und den Tätigkeitsbericht,
die Akte den Aktenexport für Prüfer, Kontakte das Verzeichnis der
Verarbeitungstätigkeiten und die Löschfälligkeit. Die Liste der Pflichten
steht als Raster in der Fundament-Spec, Abschnitt „Rechenschaftspflichten".
Der Nachweis ist die Spur, nicht der Datensatz, an dem sie hängt: Ein Projekt
ohne Buchung, ein Tier ohne Vorgang ist Webseiteninhalt und löschbar. Jede
Säule, die Vorgänge an fremden Datensätzen führt, meldet sie dem Kern als
Halter und als Verweis.

### Querschnitt: Fristen und Wiedervorlagen

Ebenfalls keine eigene Säule. Der Kern kennt Aufbewahrungsfristen und eine
Fälligkeitsliste; jede Säule bringt ihre Fristen und ihre Wiedervorlagen mit:
die Akte „Antwort erwartet bis", Finanzen die Abgabefristen, Gremien die
Einladungsfristen. Eine Frist hängt immer an einem Vorgang, nie in der Luft.
Was sich aus Daten berechnen lässt — der Ablauf eines Bescheids, ein fälliger
Nachweis —, ist eine berechnete Liste und keine gespeicherte Wiedervorlage:
Sie verschwindet erst, wenn der Grund verschwindet, nicht wenn jemand sie
abhakt.
Sichtbar wird das auf der Startseite: Jede Säule bringt dort ihre Kacheln
mit — die Akte den Eingangskorb, Finanzen später die Umsätze ohne Zuordnung,
Gremien die Einladungsfristen — und der Nutzer wählt, was er sehen will.

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
- Sortierbare Tabellen.

Diese Punkte berühren das Datenmodell; sie kommen jetzt, damit keine laufende
Akte migriert werden muss.

**Fertig, wenn:** ein Verein einen Schriftwechsel vollständig in der Akte
führen kann, vom Entwurf über den Versand bis zur Antwort, und die Oberfläche
dem Handoff entspricht.

**Abgeschlossen am 2026-09-12.** Woran erkannt: Die E2E-Liste aus § 8 der
zugehörigen Spec (`docs/intern/specs/`) läuft grün — Einsortieren aus dem
Eingangskorb, Antwort auf einen Eingang, Versandvermerk, Wiedervorlage bis zur
Startseite, Notiz, Baustein, Kontakt aus dem Overlay, Beziehungsakte am
Kontakt, Sortierung, Storno mit Ersatz. Der Handoff-Abgleich außerhalb der
Akte läuft weiter, gehört aber nicht mehr zu diesem Schritt.

### Schritt 2: Webseite fertig

- Cutover-Rest aus dem Cutover-Plan (`docs/intern/specs/`): Image auf den
  Testcontainer, Alunas Template einlesen, Startinhalte übernehmen, Publish
  aus Test abnehmen. Danach der erste Publish aus Prod.
- Erledigt am 2026-09-12: Projekte als eigenes Modul, mit Verweisen nach
  aussen statt einer Plattformspalte. Kam vor Finanzen, weil Finanzen die
  Projekte erweitert.
- Erledigt am 2026-09-13: Referenzfelder in der Deklaration; Startseitenplätze
  sind Template-Variablen mit Auswahl, nicht Kennzeichen am Tier.
- Browsertest bei Handybreite (Backlog 3): für Alunas Seite im Vereinsrepo
  (`mobile.e2e.ts`, 390 px); für das mitgelieferte Basis-Template offen.

**Fertig, wenn:** Alunas Seite aus Prod publiziert wird, WordPress abgeschaltet
ist und im Kern kein Feld mehr steht, bei dem ein anderer Verein stutzt.

**Abgeschlossen am 2026-09-19** mit Fassung 0.1.1. Woran erkannt: Alunas
Seite wird aus Prod publiziert und steht unter der eigenen Domain, das frühere
CMS ist abgeschaltet, und der Kern kennt weder Spendenplattform noch
Vereinsnamen (`no-association-content.test.ts`). Der Handybreite-Test des
Basis-Templates bleibt als Backlog-Punkt, nicht als Bedingung.

### Schritt 3: Finanzen

**Fassung 0.2.0, vollständig** — nicht auf Teilfassungen verteilt; was
dazwischen kommt, wird als 0.1.x eingeschoben. Eigene Spec, eigenes
Brainstorming. Was heute schon feststeht:

- **Zuerst die Vorarbeiten** (eigene Spec, Pläne VP1–VP5): Schutzbereiche und
  Ausstelldienst der Akte, `install` bei jedem Start, Nutzer-Kontakt-Verknüpfung,
  Kontaktrollen ohne eigenen Halter, „nur ein Mensch über die Oberfläche" als
  Kernhelfer. Sie gehören zu Fundament und Akte, nicht zu den Finanzen, und
  Schritt 4 braucht sie genauso.

- Konten, Buchungen nach Sphären, Belege als Bezug in die Akte, Storno statt
  Löschen. Projekte bekommen ihre Finanzfelder. Finanzen meldet sich als
  Halter und Verweis für jedes Projekt, an dem eine Buchung hängt; ein
  Projekt ohne Buchung bleibt löschbar.
- Bankimport aus Kontoumsätzen. Ohne ihn tippt jemand jede Buchung ab, und die
  Kassenprüfung vergleicht Abgetipptes mit dem Auszug.
- Beleg-Import aus E-Rechnungen: ZUGFeRD zuerst, weil es eine PDF mit
  eingebettetem XML ist und damit in die Akte passt; Kompass liest das XML und
  belegt die Buchung vor. XRechnung (reines XML) bleibt offen, bis ein
  Lieferant eine schickt.
- Rücklagen nach § 62 AO, Kostenerstattungen mit Freigabe durch eine zweite
  Person, Mittelweitergabe an Partner und Aufträge an Hilfspersonen mit
  Nachweisakte.
- Zweckbindung als eigene Dimension der Buchung, mit Umwidmung als
  dokumentiertem Vorgang. Der Spendenstand je Projekt als veröffentlichte
  Sicht für die Webseite.
- Zuwendungsbestätigungen nach amtlichem Muster, einzeln und als
  Serienerzeugung zum Jahresende.
- Aktenexport für Prüfer: ein Ordner oder Jahrgang als Bündel aus PDFs mit
  Inhaltsverzeichnis, Nummern, Daten und Prüfsummen. Kommt hier und nicht in
  Schritt 1, weil der Prüfer die Belege dazu will.
- Rechenschaft: EÜR, Vermögensübersicht, Mittelverwendungsrechnung,
  Kassenprüfungsunterlagen.
- Fristen: Steuererklärung, Freistellungsbescheid. Dazu Schwellenwächter
  (zeitnahe Mittelverwendung, Freigrenze, Kleinunternehmer), ein geführter
  Jahresabschluss, ein Lesezugang für Kassenprüfer und ein Datenexport.

**Fertig, wenn:** ein Geschäftsjahr vollständig in Kompass gebucht ist und
die Kassenprüfung ihre Unterlagen aus Kompass bekommt, ohne dass jemand etwas
nachträgt. Das liegt zwangsläufig nach dem Release: Die Fassung 0.2.0 ist
auslieferbar, wenn ihre Prüfsteine grün sind; der Schritt ist abgeschlossen
mit dem ersten echten Prüfpaket.

### Schritt 4: Mitglieder und Gremien

Eigene Spec, eigenes Brainstorming. Was heute feststeht:

- Mitglieder sind Kontakte mit einer Rolle und einem Beitrag; Beiträge sind
  Buchungen. Seit 0.2.0 ist der Beitrag eine Einnahmeart; hier kommen
  Beitragssoll, Mahnlauf und SEPA-Lastschrift dazu, die Forderung je Mitglied
  als offener Posten der Finanzen.
- Die Kontaktrollen für Organmitglieder und Nahestehende, die Finanzen für
  seine Prüfliste mitbringt, gehen an die Gremien über. Entlastung und
  Prüfbericht hängen am Geschäftsjahr.
- Das Gremien-Modul meldet den Schutzbereich für Vorstands- und
  Mitgliedersachen an (Protokolle, Aufnahmeanträge, Ausschlussverfahren); die
  Nutzer-Kontakt-Verknüpfung aus den Vorarbeiten trägt Mitglieder mit Zugang.
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
  Wiedervorlage. Entschieden am 2026-09-13: Bei Hunden eines Partnervereins
  läuft die Anfrage über den Partner, nicht über Kompass; der Link zum
  Partnerprofil ist das Kennzeichen. Der Vorgang in Kompass beginnt erst,
  wenn der Verein selbst vermittelt.
- **Patenschaft.** Pate als Kontakt, Beitrag als Buchung, Laufzeit.
  Entschieden am 2026-09-13: erst mit eigenen Hunden. Solange alle Hunde vom
  Partnerverein kommen, bietet Aluna keine Patenschaft an, das Angebot ist
  im Template abgeschaltet, und Dauerzahler laufen über Fördermitgliedschaft
  und Dauerspende. Der Teil wird nicht vor dem ersten eigenen Hund gebaut.
- **Verbleib.** Vermittelt, zurückgekommen, verstorben, an Partner
  weitergegeben; jeder Wechsel mit Datum und Dokument.
- **Rechenschaft.** Bestandsbuch und die Nachweise nach § 11
  Tierschutzgesetz kommen aus diesen Schritten, nicht aus einer eigenen
  Erfassung. Bestandsbuch und Verbleib melden sich als Halter und Verweis
  für jedes Tier, an dem ein Vorgang hängt; ein Tier, das nur auf der
  Webseite stand, bleibt löschbar.

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
  den Volltext, den es jetzt gibt. Für Finanzen mit 0.2.0 eingelöst: Der Agent
  sortiert Kontoumsätze vor, und was festschreibt, freigibt, abschließt oder
  ausstellt, ist über MCP gesperrt, bis ein Verein es bewusst freigibt. Offen
  bleibt die Akte.
- **Einsortierregeln auf dem Volltext** (Backlog 5), als Teil desselben
  Vorgangs.
- **Freigabe-Schritt vor dem Festschreiben** (Vier-Augen-Prinzip), als
  Rechte-Frage, nicht als Signatur. Für Finanzen mit 0.2.0 eingelöst
  (Erstattungen, Partnerzahlungen, Umwidmungen); offen bleibt die Akte.
- **Finanzen, Phase zwei:** der Dienst, der nach Fristablauf den Personenbezug
  aus den Finanzdaten entfernt (frühestens 2035 nötig; Regeln und Protokoll
  stehen seit 0.2.0), DATEV-Buchungsstapel, Anlagenverzeichnis, Haushaltsplan,
  Transparenzzahlen für die Webseite, Verwendungsnachweis nach Kostenplan,
  elektronische Zuwendungsmeldung, sobald das Verfahren steht.
- **Mobiler Beleg-Client.** Belege am Telefon scannen und offenen oder neuen
  Vorgängen zuordnen. Gescannt wird auf dem Gerät, Kompass bekommt ein PDF —
  die Grenze „kein Bildeingang" bleibt. Er verschiebt zwei andere Dinge und
  ist deshalb eine Entscheidung an diesem Dokument: einen schlanken
  HTTP-Zugang mit Token neben MCP (Prinzip 8 gilt weiter: dieselben Dienste),
  und die Frage, wie ein Telefon unterwegs eine Installation erreicht, die
  nur im eigenen Netz steht.
- **Editor für Basis-Vorlagen** in der Oberfläche (Pipeline-Spec,
  Entscheidung 7).
- **Spendenplattform-Abgleich** als vereinsspezifisches Modul.
- **XRechnung** in der Akte, samt Sichtfassung.
- **Module nachinstallierbar** (entschieden am 2026-09-13 als V2). Heute
  beschreibt sich ein Modul über sein Manifest, und die Anwendung setzt die
  Liste zusammen; das bleibt so, weil eine Registry, die sich beim Import
  selbst füllt, in Next je Route anders befüllt wäre. Was für ein
  nachinstallierbares Modul fehlt: Migrationen im eigenen Paket, die der Kern
  beim Einschalten in Abhängigkeitsreihenfolge ausführt; eine Oberfläche, die
  das Modul mitbringt, statt Routen in der Anwendung; und Tests, die ein
  Modul nur mit dem Kern und seinem `dependsOn` laufen, mit genau den
  Tabellen, die seine Registry kennt. Die Modul-Tests bauen ihre Registry
  schon so; die Tabellen kommen bis dahin für alle aus dem Kern.

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
