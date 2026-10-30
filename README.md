# Aluna Kompass

Vereinsverwaltung für gemeinnützige Vereine — eine Anwendung für Webseite, Schriftverkehr, Kontakte, Finanzen und alles, was der Verein sonst führt. Läuft auf eigener Hardware im eigenen Netz, eine Installation je Verein.

![Die Startseite: Eingangskorb, fällige Wiedervorlagen, offene Prüfungen und die Arbeitsliste der Finanzen auf einen Blick](docs/screenshots/desktop/start.png)

## Worum es geht

Ein gemeinnütziger Verein schuldet Rechenschaft: dem Finanzamt, dem Registergericht, dem Transparenzregister, den Mitgliedern und Spendern. Kompass ist der Ort, an dem jeder Vorgang genau einmal entsteht und bleibt — und aus dem alles erzeugt wird, was der Verein nach außen geben muss: Briefe, Protokolle, Zuwendungsbestätigungen, die öffentliche Webseite, Jahresabschluss, Kassenprüfungsunterlagen und die Werte für die Steuererklärung.

Der Grundsatz dahinter: **ein Vorgang, eine Quelle.** Nichts wird abgetippt, kopiert oder nachträglich einsortiert. Jede Änderung steht im Änderungsprotokoll; Rechenschaftsrelevantes wird storniert, nie gelöscht.

Der Kern ist generisch und für jeden Verein gleich. Was ein Verein braucht und ein anderer nicht, ist ein Modul, das sich je Installation ein- und ausschalten lässt. Kompass entsteht für die [Aluna Tierhilfe e.V.](https://aluna-tierhilfe.org) und läuft dort im Alltag — gebaut ist es für jeden Verein.

Alle Bilder auf dieser Seite zeigen den „Musterverein e.V.“ mit erfundenen Beispieldaten.

## Ein Rundgang

### Startseite

Wer sich anmeldet, sieht, was ansteht: fällige Wiedervorlagen, neue Post im Eingangskorb, Entwürfe und Unversandtes, Tierprofile, die auf Prüfung warten, Löschfristen, das letzte Backup und die Arbeitsliste der Finanzen. Jede Person stellt sich ihre Kacheln selbst zusammen; Kacheln zu Modulen, für die sie kein Recht hat, erscheinen nicht.

### Akte — Schriftverkehr mit Nummer und Ordner

Die Akte nimmt eingehende Post auf und erzeugt ausgehende. Eingescannte Briefe landen im Eingangskorb, werden per Texterkennung durchsuchbar und von Regeln einsortiert. Ordner pflegt man direkt im Baum — anlegen, umbenennen, per Ziehen oder Tastatur verschieben, jede Änderung zehn Sekunden lang rückgängig.

![Die Akte mit Ordnerbaum, Filtern und Dokumentliste](docs/screenshots/desktop/akte.png)

Ein Brief entsteht als Entwurf in Markdown, mit Textbausteinen und einer Vorschau, die beim Tippen mitläuft. Beim Festschreiben bekommt er eine Nummer aus dem Nummernkreis seiner Dokumentart und ist ab dann unveränderlich — korrigiert wird durch Storno und Ersatz, nie durch Überschreiben. „Antworten“ und „Folgeschreiben“ übernehmen Empfänger, Ordner und Bezug.

<table>
  <tr>
    <td><img src="docs/screenshots/desktop/brief.png" width="420" alt="Der Entwurf „Winterhilfe: Bitte um Unterstützung“ mit Text und Live-Vorschau" /></td>
    <td><img src="docs/screenshots/desktop/dokument.png" width="420" alt="Ein festgeschriebenes, versandtes Dokument mit Anlage, Antwort und Bezügen zu Kontakten" /></td>
  </tr>
  <tr>
    <td>Entwurf mit Vorschau</td>
    <td>Festgeschrieben: Nummer, Versand, Wiedervorlage, Storno</td>
  </tr>
</table>

### Kontakte, Tiere, Projekte

Kontakte tragen ihre Rollen über die Zeit: wer wann Interessent war, wann Vorstandsmitglied wurde, wann Partner. Das Tiermodul pflegt Profile mit Fotos und eigener Prüfung vor der Veröffentlichung, Projekte bekommen einen Finanzabschnitt mit Ziel, Einnahmen und Ausgaben. Tiere und Projekte liefern ihren öffentlichen Teil für die Webseite.

<table>
  <tr>
    <td><img src="docs/screenshots/desktop/kontakt.png" width="280" alt="Ein Kontakt mit Rollen über die Zeit: erst interessiert, dann Vorstandsmitglied" /></td>
    <td><img src="docs/screenshots/desktop/tier.png" width="280" alt="Ein Tierprofil mit Fotos, Steckbrief und Geschichte" /></td>
    <td><img src="docs/screenshots/desktop/projekt.png" width="280" alt="Das Projekt „Winterhilfe für Streuner“ mit Bild, Ziel, Einnahmen und Ausgaben" /></td>
  </tr>
  <tr>
    <td>Kontakt mit Rollen</td>
    <td>Tierprofil</td>
    <td>Projekt mit Finanzabschnitt</td>
  </tr>
</table>

### Finanzen — für Vereine mit Einnahmen-Überschuss-Rechnung

Kontoauszüge kommen als CAMT oder CSV herein, Belege aus der Akte, Rechnungen mit eingebettetem ZUGFeRD werden gelesen. Gebucht und festgeschrieben wird nach festen Regeln, Zuwendungsbestätigungen entstehen nach amtlichem Muster — einzeln oder im Serienlauf, auf Wunsch maschinell mit hinterlegter Unterschrift. Auslagen reicht eine Person ein, eine zweite gibt sie frei; die eigenen stehen nie in der eigenen Liste.

<table>
  <tr>
    <td><img src="docs/screenshots/desktop/fin-arbeitsliste.png" width="420" alt="Die Arbeitsliste der Finanzen mit offenen Aufgaben" /></td>
    <td><img src="docs/screenshots/desktop/fin-auszuege.png" width="420" alt="Hochgeladene Kontoauszüge je Konto mit Prüfung der Salden" /></td>
  </tr>
  <tr>
    <td>Arbeitsliste</td>
    <td>Kontoauszüge mit Saldenprüfung</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/desktop/fin-buchung.png" width="420" alt="Eine Buchung zum Projekt „Winterhilfe“ mit Beleg" /></td>
    <td><img src="docs/screenshots/desktop/fin-bestaetigungen.png" width="420" alt="Ausgestellte Zuwendungsbestätigungen mit Zustand und Versand" /></td>
  </tr>
  <tr>
    <td>Buchung mit Beleg</td>
    <td>Zuwendungsbestätigungen</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/desktop/fin-freigabe.png" width="420" alt="Freigabe einer Auslage mit Kassenbon, Kategorie-Vorschlag und Positionen" /></td>
    <td><img src="docs/screenshots/desktop/fin-bescheide.png" width="420" alt="Freistellungsbescheide mit den Zwecken des Vereins" /></td>
  </tr>
  <tr>
    <td>Auslagen: Freigabe durch eine zweite Person</td>
    <td>Bescheide des Finanzamts</td>
  </tr>
</table>

Am Ende des Jahres führt der **Jahresabschluss** in zwölf Schritten von den Kontoauszügen über die Kassenprüfung und die Mitgliederversammlung bis zur Steuererklärung; liegen die Einnahmen über der Grenze für die zeitnahe Mittelverwendung, kommt als dreizehnter Schritt die Mittelverwendung dazu. Die Kassenprüfer arbeiten in Kompass mit eigenem Zugang: Prüfpaket mit Stichproben, Vermerke mit Antwort, Kassenzählung, Prüfbericht. Die Berichte — Einnahmen-Überschuss-Rechnung, Vermögensübersicht, Kassenbericht, Zweckmittel, Rücklagenspiegel, Spendenbuch und weitere — sind vorläufig, solange das Jahr offen ist, und werden danach als Dokument festgeschrieben. Für die Steuererklärung stehen die Werte der Anlage Gem bereit, für die Umsatzsteuer die Voranmeldung — auch für Vereine, die kein Unternehmer sind und nur nach § 13b Steuer schulden.

Für Mitglieder, Spender und Öffentlichkeit gibt es die **Jahresrechnung**: Mittelherkunft, Mittelverwendung mit Vermögen und die großen Zuwender, festgeschrieben, von einem vertretungsberechtigten Vorstandsmitglied abgezeichnet und auf Wunsch auf der Webseite bereitgestellt. Die **Mittelverwendungsrechnung** zeigt je Zuflussjahr, ob die Mittel binnen zwei Jahren für die Satzungszwecke verwendet sind, mit Vortrag, Vermögensabgleich und Rücklagen — Nachweis, wo die zeitnahe Verwendung geboten ist, sonst freiwillig.

<table>
  <tr>
    <td><img src="docs/screenshots/desktop/fin-jahresabschluss.png" width="420" alt="Der Jahresabschluss 2025: elf von zwölf Schritten erledigt, als Nächstes die Umsatzsteuer-Jahreserklärung" /></td>
    <td><img src="docs/screenshots/desktop/fin-kassenpruefung.png" width="420" alt="Die Kassenprüfung eines Jahres: Prüfer in Kompass und auf Papier, die Abschnitte des Prüfpakets mit Fortschritt" /></td>
  </tr>
  <tr>
    <td>Jahresabschluss</td>
    <td>Kassenprüfung</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/desktop/fin-berichte.png" width="420" alt="Die Berichte eines Jahres mit festgeschriebenen Fassungen" /></td>
    <td><img src="docs/screenshots/desktop/fin-umsatzsteuer.png" width="420" alt="Eine abgegebene Umsatzsteuer-Voranmeldung mit Kennzahlen und Übertragungsprotokoll" /></td>
  </tr>
  <tr>
    <td>Berichte zum Festschreiben</td>
    <td>Umsatzsteuer-Voranmeldung</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/desktop/fin-jahresrechnung.png" width="420" alt="Die Jahresrechnung eines abgeschlossenen Jahres: festgeschrieben, abgezeichnet und auf der Webseite bereitgestellt, daneben die Seiten des Berichts" /></td>
    <td><img src="docs/screenshots/desktop/fin-mittelverwendung.png" width="420" alt="Die Mittelverwendung eines Jahres unter der Grenze: Kopfsatz zur Grenze und Teil A des Berichts" /></td>
  </tr>
  <tr>
    <td>Jahresrechnung für die Öffentlichkeit</td>
    <td>Mittelverwendung</td>
  </tr>
</table>

Nicht vorgesehen sind Bilanzierung und die Übermittlung ans Finanzamt: Die Werte überträgt der Verein selbst in Mein ELSTER.

### Mitglieder und Lastschrift

Mitglieder beginnen mit einem Antrag; erst die Aufnahme vergibt die Mitgliedsnummer und stellt auf Wunsch die Bestätigung aus. Was ein Mitglied zahlt, sagt die Beitragsordnung des Vereins — mit Ständen, die ab einem Tag gelten, und Mitgliedsarten mit oder ohne Stimmrecht. Der Beitragslauf legt die Beiträge eines Jahres als offene Zahlungen der Finanzen an, der Mahnlauf mahnt in Stufen und lässt aus, wessen Zahlung schon eingegangen sein könnte. Beide Läufe enden mit dem Versand: Briefe per E-Mail, wo eine Adresse da ist, der Rest als ein PDF zum Drucken.

Wer per Lastschrift zahlt, bekommt ein SEPA-Mandat mit vorausgefülltem Formular; gültig wird es erst mit der unterschriebenen Rücksendung in der Akte. Ein Einzug zeigt vorab, was eingezogen wird und was nicht, mit Grund und Ausweg je Zeile, und erzeugt die Datei für die Bank (pain.008). Gutschrift und Rücklastschriften erkennt die Arbeitsliste im Kontoauszug; eine Rückgabe klärt man am Einzug.

<table>
  <tr>
    <td><img src="docs/screenshots/desktop/mitglieder.png" width="280" alt="Die Mitgliederliste mit Reitern für Mitglieder, Anträge und Ausgetretene, Art, Zahlweg und Beitrag je Jahr" /></td>
    <td><img src="docs/screenshots/desktop/mitglied.png" width="280" alt="Ein Mitglied mit Angaben zur Mitgliedschaft, Rückstand, Beiträgen und Briefen" /></td>
    <td><img src="docs/screenshots/desktop/fin-lastschrift.png" width="280" alt="Ein gebuchter Einzug: Datei für die Bank, Einreichung und Gutschrift erledigt, ein Posten mit Rückgabe zu klären" /></td>
  </tr>
  <tr>
    <td>Mitgliederliste</td>
    <td>Ein Mitglied mit Beiträgen und Briefen</td>
    <td>Einzug per SEPA-Lastschrift</td>
  </tr>
</table>

### Gremien — Sitzungen, Beschlüsse, Satzung

Gremien führt die Organe des Vereins mit ihren Ämtern und Amtszeiten, die Sitzungen von Mitgliederversammlung, Vorstand und weiteren Organen, die Beschlüsse und die Satzung. Eine Sitzung läuft in fünf Schritten: Tagesordnung vorbereiten, einladen — die Mitgliederversammlung im Serienlauf mit einem Brief je Mitglied, per E-Mail oder als PDF zum Drucken —, die Sitzung, Protokoll und Festschreiben. In der Sitzung schreibt die Protokollführung im **Mitlauf** mit: Anwesenheit, Beschlussfähigkeit, Abstimmungen mit der nötigen Mehrheit und ihrer Fundstelle, Wahlen mit Stichwahl und Annahme — ohne Speichern-Knopf, auch bei wackliger Verbindung. Daraus entsteht der Entwurf des Protokolls; ist die unterschriebene Fassung abgelegt und die Sitzung festgeschrieben, tragen die Beschlüsse ihre Nummer und die Gewählten ihre Amtszeit. Beschlüsse ohne Sitzung laufen als Umlauf: Kompass verschickt nichts, hält aber fest, wer wie geantwortet hat, und rechnet, ob der Beschluss zustande kam.

Die Satzung besteht aus Ständen mit Wortlaut und einem Regelwerk, aus dem Kompass Fristen, Beschlussfähigkeit und Mehrheiten rechnet; wo die Satzung schweigt, gilt das Gesetz. Ändert eine Sitzung den Vorstand oder die Satzung, stellt Kompass die Anmeldung zum Vereinsregister mit ihren Unterlagen zusammen, verfolgt sie über Notar, Einreichung und Eintragung und fragt nach, ob eine Meldung zum Transparenzregister nötig ist. Eingereicht wird beim Notar, nicht aus Kompass.

Mit den Finanzen ist Gremien verbunden: Die festgeschriebene Mitgliederversammlung liefert Entlastung und Genehmigung der Jahresrechnung an den Jahresabschluss, die vertretenden Ämter bestimmen, wer die Jahresrechnung abzeichnet, die gewählten Kassenprüfer stehen beim Eintragen der Prüfer zur Auswahl, und die Kassenprüfung bekommt die Beschlüsse mit Wirkung auf die Kasse als eigenen Abschnitt. Die Rollen Vorstandsmitglied, Schatzmeister und Kassenprüfung am Kontakt folgen aus den Ämtern.

<table>
  <tr>
    <td><img src="docs/screenshots/desktop/gremien-uebersicht.png" width="420" alt="Die Übersicht der Gremien: je Organ die Ämter mit ihren Plätzen, rechts die nächste Sitzung und die Fristen" /></td>
    <td><img src="docs/screenshots/desktop/gremien-mitlauf.png" width="420" alt="Der Mitlauf einer Vorstandssitzung mit Lageleiste, Tagesordnung und einer gezählten Abstimmung" /></td>
  </tr>
  <tr>
    <td>Organe, Ämter und Fristen</td>
    <td>Mitlauf in der Sitzung</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/desktop/gremien-beschluesse.png" width="420" alt="Die Beschlussliste aller Organe mit Nummer, Tag und Gegenstand" /></td>
    <td><img src="docs/screenshots/desktop/gremien-satzung.png" width="420" alt="Das Regelwerk eines Satzungsstands je Organ mit Fundstellen, grau, was laut Gesetz gilt" /></td>
  </tr>
  <tr>
    <td>Beschlüsse mit Nummer</td>
    <td>Satzung mit Regelwerk</td>
  </tr>
</table>

### Webseite — kein CMS im Internet

Die meisten Vereinsseiten laufen auf einem CMS wie WordPress: ein Programm mit Datenbank, Anmeldung und Plugins, das rund um die Uhr im Internet steht. Jede Lücke darin ist für jeden erreichbar, und Angreifer suchen sie automatisch — sie fragen nicht, wie klein der Verein ist. Wer eine solche Seite sicher halten will, muss ständig Updates einspielen, Plugins prüfen und Warnungen lesen. Das schafft ein ehrenamtlicher Vorstand kaum.

![Pflege in Kompass: ein Aktuelles-Eintrag in der Maske](docs/screenshots/desktop/web-pflege.png)

Kompass macht es anders: Die Seite wird **in Kompass gepflegt** und als **fertige Dateien** veröffentlicht — HTML, Bilder, CSS. Auf dem Webspace liegt nur das. Daraus folgt:

- **Kein Login im Netz.** Es gibt keine Anmeldeseite, an der jemand Passwörter durchprobieren könnte.
- **Kein Programm, das man angreifen kann.** Auf dem Webspace läuft nichts, also gibt es keine Lücke, die man ausnutzen könnte, und kein Plugin, das veraltet.
- **Nichts zu aktualisieren.** Fertige Dateien werden nicht alt und brauchen keine Sicherheitsupdates.
- **Ein Angriff auf den Webspace trifft nur die Webseite.** Wer dort einbricht, findet die öffentlichen Seiten — sonst nichts. Kompass selbst steht im eigenen Netz und ist von außen nicht erreichbar.
- **Wiederherstellen ist einfach.** Ein neuer Publish schreibt die Seite komplett neu.

Vor dem Hochladen prüft Kompass auf Sperrwörter und Übersetzungslücken, baut eine Vorschau und zeigt, was sich gegenüber der Live-Seite ändert. Veröffentlicht wird erst, wenn man es bestätigt; jeder Publish steht im Änderungsprotokoll.

![Publizieren: prüfen, Vorschau bauen, Änderungen gegenüber Live sehen, hochladen](docs/screenshots/desktop/web-publizieren.png)

![Die gebaute Vorschau der Webseite mit Team, Aktuellem und Fotos](docs/screenshots/desktop/web-vorschau.png)

**So sieht das Ergebnis aus:** [aluna-tierhilfe.org](https://aluna-tierhilfe.org) ist die Seite der Aluna Tierhilfe, vollständig aus Kompass gebaut — mit eigenem Template, Hundeprofilen aus dem Tiermodul und Projekten.

Gebaut wird die Seite mit [Astro](https://astro.build), einem Werkzeug, das aus Vorlagen und Inhalten fertige HTML-Dateien erzeugt. Das **Template** ist ein gewöhnliches Astro-Projekt, das der Verein selbst mitbringt — Layout, Farben, Seitenaufbau gehören ihm. Eine Datei `kompass.template.ts` darin sagt Kompass, welche Inhalte das Template braucht: Variablen wie ein Claim oder ein Titelbild, Sammlungen wie „Aktuelles“ oder „Team“ mit ihren Feldern. Kompass erzeugt daraus die Pflegemasken, der Verein füllt sie, Astro baut die Seite. Wer kein eigenes Template hat, startet mit dem mitgelieferten [`templates/verein-basis`](templates/verein-basis). Wie man ein Template schreibt: [`docs/handbuch/webseite/template-schreiben.md`](docs/handbuch/webseite/template-schreiben.md).

### Dokumente — Briefbogen und Formulare aus Vorlagen

Briefe, Zuwendungsbestätigungen, Verzichtserklärungen, Kassenzählungen und Auszüge des Änderungsprotokolls entstehen als PDF. Der Text kommt aus der Akte oder aus der Vorlage des Moduls, das Aussehen aus einer **Basis-Vorlage**: Briefbogen mit Logo und Absender, Ränder, Schrift, Fußzeile, bei Formularen das Anschriftfeld für den Fensterumschlag nach DIN 5008. Gesetzt wird mit [Typst](https://typst.app), einem Satzsystem, das reproduzierbar und schnell PDFs erzeugt — dasselbe Dokument ergibt heute und in zehn Jahren dieselbe Datei.

Kompass bringt generische Basen mit (`a4-mit-briefkopf`, `a4-formular`, `a4-plain` und weitere). Ein Verein legt eigene `.typ`-Dateien daneben und ersetzt damit Kopf und Fuß, nie den Wortlaut eines Formulars — der steht in der Vorlage des Moduls und folgt dem amtlichen Muster. Welche Basis für welche Dokumentart gilt, stellt man unter Einrichtung → Dokumentvorlagen ein. Mehr: [`docs/handbuch/einstellungen/dokumente.md`](docs/handbuch/einstellungen/dokumente.md) und der Abschnitt „Dokument-Basisvorlagen“ in [`betrieb.md`](docs/handbuch/betrieb.md).

### Backup — jede Nacht, geprüft, mit einem Klick zurück

Ein Verein merkt erst, dass sein Backup nichts taugt, wenn er es braucht. Kompass sichert sich deshalb auf Wunsch jede Nacht selbst in ein eigenes Verzeichnis, hält Tages-, Wochen- und Monatsstände vor und liest jedes Backup nach dem Schreiben vollständig gegen, bevor es als gut gilt. Oben auf der Seite steht in einem Satz, wann das letzte geprüfte Backup lief; fehlt eines oder wird der Platz knapp, meldet es die Startseite und, ist der Mailversand eingerichtet, eine Mail. Zurück geht es direkt aus der Liste: Der Dialog nennt, was seit dem Backup verloren geht, Kompass sichert vorher den jetzigen Stand, und während des Einspielens sehen alle eine Wartungsseite. Eine Kopie außer Haus bleibt Sache des Vereins — das Verzeichnis ist dafür gemacht ([`betrieb.md`](docs/handbuch/betrieb.md), „Backups“).

<table>
  <tr>
    <td><img src="docs/screenshots/desktop/backup-liste.png" width="420" alt="Die Backup-Seite: oben der Satz zum letzten geprüften Backup, darunter die Liste mit Art, Größe, Version und wie lange jedes Backup bleibt" /></td>
    <td><img src="docs/screenshots/desktop/backup-einstellungen.png" width="420" alt="Die Backup-Einstellungen: nächtliches Backup mit Uhrzeit, wie viele tägliche, wöchentliche und monatliche Backups bleiben, und die Frist für die Warnung" /></td>
  </tr>
  <tr>
    <td>Backups mit Prüfung und „Bleibt“</td>
    <td>Zeitplan und Aufheben</td>
  </tr>
</table>

### Rechenschaft und Verwaltung

Rechte vergibt man je Rolle, Rollennamen sind frei — „Schatzmeisterin“, „Kassenprüfer“, „Finanz-Agent“. Jede Änderung, ob in der Oberfläche, über MCP oder vom System, steht im Änderungsprotokoll und lässt sich als PDF ausziehen. Löschfristen nach Abgabenordnung und DSGVO rechnet Kompass je Datensatz aus und meldet, was fällig ist.

<table>
  <tr>
    <td><img src="docs/screenshots/desktop/rollen.png" width="420" alt="Rollen und ihre Rechte" /></td>
    <td><img src="docs/screenshots/desktop/protokoll.png" width="420" alt="Änderungsprotokoll mit Filtern und PDF-Export" /></td>
  </tr>
  <tr>
    <td>Rollen und Rechte</td>
    <td>Änderungsprotokoll</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/desktop/aufbewahrung.png" width="420" alt="Aufbewahrung und Löschfristen" /></td>
    <td><img src="docs/screenshots/desktop/tokens.png" width="420" alt="Das Profil mit dem Beispiel-Zugang unter den API-Tokens für den MCP-Zugang" /></td>
  </tr>
  <tr>
    <td>Aufbewahrung und Löschfristen</td>
    <td>API-Tokens für KI-Assistenten (MCP)</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/desktop/erscheinungsbild.png" width="420" alt="Erscheinungsbild: Farben für hell und dunkel mit Live-Vorschau" /></td>
    <td><img src="docs/screenshots/desktop/dunkel.png" width="420" alt="Die Akte im dunklen Modus" /></td>
  </tr>
  <tr>
    <td>Erscheinungsbild in den Farben des Vereins</td>
    <td>Dunkler Modus</td>
  </tr>
</table>

### KI-Assistenten über MCP

Was die Oberfläche kann, kann auch ein KI-Assistent über das [Model Context Protocol](https://modelcontextprotocol.io) — dieselben Dienste, dieselben Rechte, dasselbe Protokoll. Ein Token wirkt mit den Rechten der Person, die es erstellt hat; jeder Vorgang steht mit dem Kanal „MCP“ und dem Namen des Tokens im Änderungsprotokoll. Drei Dinge bewusst nicht: Dateien abrufen (auch keine Backups herunterladen), API-Token verwalten, das eigene Passwort ändern. Das Einspielen eines Backups, in den Finanzen Festschreiben, Freigeben und Ausstellen, in den Gremien Einladen und Festschreiben bleiben Menschen vorbehalten, solange der Verein es nicht unter Verwaltung → Agenten ausdrücklich erlaubt. Ein Test hält die Liste vollständig.

### Unterwegs

Kompass läuft auch auf dem Telefon: die Startseite, ein Kontakt, ein Tierprofil — und eine Auslage mit Beleg ist schnell eingereicht.

<table>
  <tr>
    <td><img src="docs/screenshots/mobil/start.png" width="200" alt="Die Startseite auf dem Telefon" /></td>
    <td><img src="docs/screenshots/mobil/kontakt.png" width="200" alt="Ein Kontakt mit seinen Rollen auf dem Telefon" /></td>
    <td><img src="docs/screenshots/mobil/tier.png" width="200" alt="Ein Tierprofil auf dem Telefon" /></td>
    <td><img src="docs/screenshots/mobil/auslage.png" width="200" alt="Eine Auslage mit PDF-Beleg und Kassenbon-Positionen auf dem Telefon" /></td>
  </tr>
</table>

## Was heute da ist

| Bereich | Inhalt |
|---|---|
| **Fundament** | Nutzer, Rollen und Rechte, Einstellungen statt Konstanten, Themes mit hellem und dunklem Modus, Änderungsprotokoll, Aufbewahrung und Löschfristen, nächtliches und geprüftes Backup mit Einspielen aus der Liste, Modul-System, Dokument-Pipeline mit Basis-Vorlagen, Mediathek mit Ordnern |
| **Webseite** | Pflege in Kompass, Bau mit Astro aus dem Template des Vereins, Prüfung auf Sperrwörter und Übersetzungslücken, Vorschau mit Vergleich zur Live-Seite, Publish per rsync auf einen gewöhnlichen Webspace |
| **Kontakte und Akte** | Kontakte mit Rollen über die Zeit und berechneter Aufbewahrungsfrist. Die Akte für ein- und ausgehende Post: Entwurf, Festschreiben, Nummer, Storno statt Löschen, Ordnerbaum, Bezüge, Antworten und Folgeschreiben, Wiedervorlage, Volltext mit Texterkennung, Versand per E-Mail mit Ausgang |
| **Finanzen** | Bankkonten und Kassen, Kontoauszüge (CAMT, CSV), Belege mit ZUGFeRD, Buchen und Festschreiben, Zuwendungsbestätigungen nach amtlichem Muster mit Serienlauf und Spendenbuch, maschinelle Bestätigungen, Auslagen mit Freigabe durch eine zweite Person, Aufwandsspenden, Zahlungen an Partner mit Nachweisen, Zwecke und Rücklagen, Pauschalen je Person. Jahresabschluss, Kassenprüfung mit Prüferzugang, festschreibbare Berichte, Jahresrechnung für die Öffentlichkeit, Mittelverwendungsrechnung, Fristen und Schwellen, Werte für Steuererklärung und Anlage Gem, Umsatzsteuer-Voranmeldung, Amtsübergabe, Datenexport für die Außenprüfung. Für Vereine mit Einnahmen-Überschuss-Rechnung |
| **Mitglieder und Lastschrift** | Anträge, Aufnahme mit Nummer, Austritt mit Kündigungsfrist, Mitgliedsarten, Beitragsordnung mit Ständen, Beitrags- und Mahnlauf mit Versand per E-Mail oder Post, Stundung und Erlass, CSV-Liste und Bescheinigung über die Mitgliederzahl. SEPA-Lastschrift für Beiträge und Dauerspenden: Mandate mit Formular und Unterschrift, Einzug mit Vorschau und Datei für die Bank, Gutschrift und Rückgaben über die Arbeitsliste |
| **Gremien** | Organe und Ämter mit Amtszeiten, Sitzungen mit Tagesordnung, Anträgen und Einladung im Serienlauf, Mitlauf mit Anwesenheit, Beschlussfähigkeit, Abstimmungen und Wahlen, Protokoll und Festschreiben, Beschlüsse mit Nummer, Umlaufbeschlüsse, Satzung in Ständen mit Regelwerk, Anmeldung zum Vereinsregister und Transparenzregister. Liefert Entlastung, Vertretung und Kassenprüfer an die Finanzen |
| **Projekte, Tiere** | Vereinsspezifische Module mit ihrem öffentlichen Teil für die Webseite; Projekte haben dazu ihren Finanzabschnitt, Tierprofile eine Prüfung vor der Veröffentlichung |
| **MCP** | Alle Dienste der Oberfläche für KI-Assistenten, mit denselben Rechten und demselben Protokoll |

Was als Nächstes kommt — nach den Gremien das Tiermodul in seiner Vollstufe, mit dem ganzen Weg eines Tieres von der Aufnahme über Transport und medizinische Akte bis zur Vermittlung — und warum in dieser Reihenfolge, steht in [`docs/nordstern.md`](docs/nordstern.md). Dort steht auch, was Kompass **nicht** ist: kein Newsletter, kein Mailprogramm, kein Kalender, kein Aufgabenmanager, keine Finanzbuchhaltung für Bilanzierer und keine Übermittlung ans Finanzamt, kein Webseiten-Baukasten, kein Multi-Tenant.

## Betrieb

Kompass läuft als ein Docker-Image auf dem NAS oder Server des Vereins, mit Dev, Test und Prod strikt getrennt. Voraussetzungen, Installation, Update, Backup und Webseiten-Publish: [`docs/handbuch/betrieb.md`](docs/handbuch/betrieb.md). Das vollständige Handbuch liegt unter [`docs/handbuch/`](docs/handbuch/inhalt.md) und ist in der App über das „?“ in der Kopfleiste erreichbar.

## Entwicklung

Voraussetzungen: Node 24 oder neuer, pnpm 11, Docker für die vollständige Prüfung. Für die Texterkennung und das Lesen eingebetteter Rechnungen lokal `tesseract`, `tesseract-lang` und `poppler`.

```bash
pnpm install
cp apps/kompass/.env.example apps/kompass/.env   # SESSION_SECRET setzen
pnpm dev                                          # http://localhost:3000, Einrichtung beim ersten Aufruf
pnpm seed                                         # erfundene Beispieldaten für Kern und alle Module
```

Prüfen, bevor etwas gepusht wird:

```bash
pnpm typecheck
pnpm test
pnpm verify        # Typecheck, alle Tests, E2E kalt, Image-Build, E2E gegen das Image (~15 min, braucht Docker)
```

Aufbau des Repos:

```
apps/kompass/          Next.js-Anwendung: Oberfläche, MCP-Endpunkt, E2E-Tests
packages/core/         Kern: Dienste, Datenbank, Rechte, Änderungsprotokoll, Modul-System
packages/modules/      Fachmodule: animals, contacts, dms, finance, members, projects, site
packages/documents/    Dokument-Pipeline (Markdown → Typst → PDF)
packages/markdown/     Markdown für Dokumente, Webseite und Handbuch (Rendern, Bereinigen, Typst)
packages/text-extraction/ Texterkennung und eingebettete Dateien aus PDFs (OCR, ZUGFeRD)
packages/mcp/          MCP-Server über den Kerndiensten
packages/site-template/ Vertrag zwischen Kompass und einem Webseiten-Template
templates/verein-basis/ Mitgeliefertes Basis-Template für die Vereinsseite
docs/                  Nordstern, Betrieb, Backlog, Hilfeseiten
```

Regeln, Prinzipien und alle Befehle: [`AGENTS.md`](AGENTS.md). Die neun Prinzipien dort — generischer Kern, Konfiguration statt Konstanten, nichts Rechenschaftsrelevantes wird gelöscht, ein Weg zu den Daten, TDD ab der ersten Zeile — gelten für jeden Beitrag.

## Fragen, Fehler und Sicherheit

- **Fragen und Fehler** gehören in ein [Issue](https://github.com/DigiJoe79/Aluna-Kompass/issues).
  Hilfreich: welche Fassung (Fuß der Seitenleiste oder `/api/health`) und was du erwartet hast.
- **Sicherheitslücken** bitte **nicht** als Issue, sondern über den privaten
  Meldekanal — der Weg steht in [`SECURITY.md`](SECURITY.md).
- **Quellcode der mitgelieferten Fremdsoftware** (GPL/LGPL): ein Issue genügt.
  Die Aufstellung steht in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
- **Mitarbeiten**: [`CONTRIBUTING.md`](CONTRIBUTING.md) — was man zuerst wissen
  muss; die Regeln selbst stehen in [`AGENTS.md`](AGENTS.md).

## Lizenz

Apache-2.0 — siehe [`LICENSE`](LICENSE) und [`NOTICE`](NOTICE).

Die Lizenz erlaubt Nutzung, Änderung und Weitergabe, auch kommerziell.
Sie gewährt ausdrücklich Patentrechte (§ 3), verlangt einen Hinweis auf
geänderte Dateien (§ 4b) und räumt keine Rechte am Namen „Aluna Kompass“
ein (§ 6).
