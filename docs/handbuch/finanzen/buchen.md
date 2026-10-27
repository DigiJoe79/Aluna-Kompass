# Buchen von Hand

Eine Buchung hält fest, was mit dem Geld des Vereins geschehen ist: von
welchem Konto es kam oder wohin es ging, und wofür. Das Journal zeigt alle
Buchungen; „Neue Buchung“ öffnet die Maske dafür.

## Von welchem Konto? Und wofür?

Jede Buchung hat zwei Seiten. Die Kontoseite sagt, welches Bankkonto oder
welche Kasse betroffen ist und mit welchem Betrag. Die Seite „Wofür?“
ordnet diesen Betrag einer oder mehreren Kategorien zu — Spenden,
Büromaterial, Fahrtkosten und so weiter. Beide Seiten müssen sich zum
gleichen Betrag summieren; ein Ausgleichsanzeiger zeigt am Fuß der
Konto-Karte an, ob noch etwas fehlt oder zu viel verteilt ist.

Vier Vorlagen legen die Richtung vor: **Einnahme**, **Ausgabe**,
**Umbuchung zwischen Konten** und **Sachspende**. Eine Umbuchung — etwa
Bargeld von der Bank abgehoben — hat kein „Wofür?“: Sie ist weder Einnahme
noch Ausgabe, das Geld bleibt im Verein. Eine Sachspende hat kein Konto,
weil kein Geld fließt; stattdessen tragen zwei Zuordnungszeilen denselben
Betrag mit umgekehrtem Vorzeichen — die zweite folgt der ersten von
selbst. Wie eine solche Umbuchung im Journal und mit Kontofilter im
Kontoblatt erscheint, steht unter „Kontoblatt“ in
[Konten und offene Zahlungen](konten-und-offene-zahlungen.md).

## Entwurf, geprüft, festgeschrieben

Eine neue Buchung ist zunächst ein **Entwurf**: Sie darf unausgeglichen
sein und lässt sich jederzeit ändern oder löschen. Wer eine zweite Person
kurz gegenlesen lässt, markiert den Entwurf als **geprüft** — das ist eine
Vorstufe, noch keine endgültige Buchung. Erst **Festschreiben** vergibt
eine Nummer und macht die Buchung unveränderlich; danach gibt es kein
Eingabefeld mehr, nur noch „Korrigieren“ und — im Menü **Weitere Aktionen**
(⋯) — „Zurücknehmen …“.

Eine unausgeglichene Buchung lässt sich nicht festschreiben — die
Oberfläche nennt den Grund und bietet einen Ausweg an, etwa den Rest in
die letzte Zeile einzutragen.

Ein Entwurf mit einem Datum nach heute lässt sich speichern, warnt aber am
Datumsfeld — festschreiben lässt sich das erst, sobald der Tag erreicht
ist; heute selbst genügt bereits.

Zwei Fälle verlangen beim Festschreiben eine Bestätigung, weil sonst Geld doppelt
fließt: Die Zahlung gleicht eine offene Zahlung aus, die schon in einem bei der
Bank eingereichten Einzug steckt (die Bank zieht sie trotzdem ein), oder sie ist
höher als der offene Betrag und der Rest steht auf derselben Kategorie (etwa
„Mitgliedsbeiträge“). Der Dialog nennt den Grund; **Trotzdem festschreiben**
bestätigt ihn, und das Protokoll hält die Bestätigung fest. Legen Sie einen Rest
besser auf eine eigene Zeile, etwa als Spende. Nach einer Doppelzahlung zeigt der
Einzug den Posten als „schon bezahlt“, und die Startseite erinnert daran:
Veranlassen Sie eine Rückgabe bei der Bank oder erstatten Sie den Betrag. Diese
Erinnerung steht vor einem verfallenen Einzug, denn sie hat eine Frist; den
verfallenen nennt die Kachel dann im selben Satz mit.

Stünde ein Bank- oder Zahlungsdienstkonto nach dem Festschreiben im Minus,
weist die Vorschau des Sammel-Festschreibens darauf hin — das sperrt nicht,
meist fehlt nur noch ein Auszug; eine Barkasse lässt sich dagegen nie ins
Minus bringen.

## Eine Zahlung auf mehrere Zwecke aufteilen

Zahlt eine Spendenplattform gesammelt aus, betrifft eine einzige
Kontobewegung oft mehrere Spender oder Zwecke. Die Seite „Wofür?“ nimmt
dafür mehrere Zeilen auf: eine je Spender oder Zweck, dazu bei Bedarf eine
für die Gebühr des Zahlungsdiensts. Das Zeilenmenü teilt einen Betrag
gleichmäßig auf oder trägt den verbleibenden Rest in eine gewählte Zeile
ein — solange oben „Noch … zu verteilen“ steht, ist die Buchung noch nicht
ausgeglichen.

Für die Anlage Gem trägt eine Zeile zwei Merkmale. Bei einer Zuwendung einer
anderen Organisation steht das Kästchen **Vermögensausstattung (§ 58 Nr. 3
AO)**: Ist es gesetzt, fragt Kompass nach dem Geber mit Finanzamt und
Steuernummer. Eine Erbschaft und eine erhaltene Vermögensausstattung gehen
dem Vermögen zu. Hat der Erblasser laufenden Aufwand bestimmt oder erlaubt der
Geber die laufende Verwendung, setzen Sie **Nicht dem Vermögen zuführen** —
der Grund steht damit fest.

Was ein Zweck bekommen und verwendet hat, zeigt Finanzen → Zwecke; soll
Geld später den Zweck wechseln, geht das nicht über eine neue Buchung,
sondern über eine Umwidmung (siehe [Zwecke und zurückgelegtes
Geld](zwecke-und-ruecklagen.md)).

## Eine offene Zahlung begleichen

Zahlt der Verein eine offene Rechnung oder geht eine erwartete Zahlung
ein, lässt sich das direkt an der Geldzeile vermerken: „begleicht offene
Zahlung“ öffnet eine Suche über die offenen Posten, die zur Richtung der
Zeile passen — eine Ausgabe zeigt, was der Verein noch schuldet, eine
Einnahme, was er noch erwartet. Zur Auswahl stehen Zahlungsreferenz oder
Kontakt und der jeweilige Restbetrag; mehrere Posten lassen sich in einer
Buchung begleichen, je mit einem eigenen Teilbetrag. Ein zu hoher
Teilbetrag wird am Feld abgewiesen. Bleibt nach dem Festschreiben ein Rest
offen, steht er an der Buchung unter „Hängt zusammen mit“ — dort auch die
übrigen Bezüge, etwa eine Gegenbuchung oder eine vorangegangene Buchung.

## Beleg anhängen

Ein Beleg lässt sich auf die Buchung ziehen oder aus der Akte auswählen.
Kompass nimmt dafür nur **PDF** — kein Foto. Wer nur eine Kamera zur Hand
hat: Die Scan- oder Kamera-App der meisten Telefone kennt eine Funktion
„Als PDF speichern“; das Ergebnis lässt sich wie gewohnt ablegen. Ein
Beleg lässt sich jederzeit nachreichen, auch an einer bereits
festgeschriebenen Buchung.

Eine reine Umbuchung zwischen zwei eigenen Konten braucht keinen eigenen
Beleg mehr, sobald die Bankseite einen Kontoumsatz aus einem Auszug trägt
— der Auszug selbst belegt sie, auch wenn die andere Seite eine Kasse ist.
Eine Bareinnahme oder Barausgabe mit eigener Zuordnung (etwa eine
Spende oder eine Ausgabe) braucht dagegen weiterhin einen Beleg.

## Umsatzsteuer nach § 13b

Bezieht der Verein eine Leistung von einem Anbieter im Ausland — Werbung,
Software, Plattformen —, schuldet er die deutsche Umsatzsteuer selbst, auch als
Kleinunternehmer (§ 13b UStG). In der Auswahl „Umsatzsteuer“ stehen dafür unter
„Steuer schuldet der Verein“ drei Kennzeichen: „§ 13b, Leistung aus der EU“
(Kennzahlen 46/47), „§ 13b, übrige“ (84/85), etwa aus dem Vereinigten Königreich
oder der Schweiz, und „Erwerb“ (innergemeinschaftlicher Erwerb). Zahlungsdienste
wie PayPal, inländische Anbieter, Flüge und Messe-Eintritte sind keine
§ 13b-Fälle.

- Mit einem dieser Kennzeichen erscheint in der zweiten Reihe der Zeile das Feld
  **Leistungsdatum**, bei „§ 13b, übrige“ heißt es **Rechnungsdatum**. Es
  bestimmt den Zeitraum der Voranmeldung; ohne gilt der Buchungstag, bei Zahlung
  vor der Leistung die Zahlung. Ein anderes Kennzeichen leert das Feld.
- Unter der Zeile steht, was der Verein schuldet: Betrag, Satz,
  Bemessungsgrundlage und das Quartal (bzw. der Monat), in dem die Steuer zählt.
  Liegen Leistung und Buchung in verschiedenen Zeiträumen, nennt der Satz beide
  Monate; ein Kleinunternehmer liest dazu „Kein Vorsteuerabzug“. Gerechnet wird
  mit den Sätzen von heute.
- Trägt ein Kontakt das Merkmal „Rechnungen mit Umkehr der Steuerschuld
  (§ 13b)“ (am Kontakt im Abschnitt **Umsatzsteuer**), setzt die Maske das
  Kennzeichen, sobald der Kontakt an einer Ausgabezeile ohne Kennzeichen gewählt
  wird; darunter steht „Vorgabe vom Kontakt“. Ein von Hand gewähltes Kennzeichen
  gilt immer. Die Arbeitsliste verhält sich genauso.

### Prüffrage § 13b

Ist der Verein umsatzsteuerlich Unternehmer, fragt Kompass bei einer Ausgabe
ohne Kennzeichen über den Aufteilungszeilen **Ist das eine Leistung nach
§ 13b?**, wenn etwas darauf deutet: Der Beleg trägt den Hinweis
„Steuerschuldnerschaft des Leistungsempfängers“ oder „Reverse charge“, der
Anbieter oder die IBAN der Zahlung sitzt im Ausland und es ist keine Steuer
gesetzt, oder die Rechnung weist ausländische Umsatzsteuer aus bzw. deutsche
Umsatzsteuer, obwohl der Anbieter im Ausland sitzt. Ein fehlender Hinweis auf der
Rechnung ändert an der Pflicht nichts. Dieselbe Frage steht in der Arbeitsliste
über der schmalen Zeile und beim Rechnungsleser unter den erkannten Werten. Sie
sperrt nichts; „Festschreiben“ bleibt bedienbar.

- **Ja, § 13b** setzt das Kennzeichen an den Ausgabezeilen ohne Kennzeichen — „aus
  der EU“ oder „übrige“ nach dem Land des Anbieters —, darunter steht „aus der
  Prüffrage“. Mit dem vorangekreuzten Kästchen **Bei … künftig immer so** setzt
  Kompass zugleich das Merkmal am Kontakt; jede weitere Ausgabe an ihn bekommt das
  Kennzeichen dann als Vorgabe.
- **Nein, weil …** klappt vier Gründe auf: steuerfreie Zahlungsabwicklung, der
  Anbieter ist inländisch, Ausnahme von § 13b oder Sonstiges (mit Text).
  „Speichern“ merkt sich das Nein am Kontakt; Kompass fragt dort nicht wieder.
  Ohne Kontakt schließt die Frage nur für diese Buchung.

Wie es danach weitergeht — Voranmeldung, Jahreserklärung, Berichtigung —, steht
unter [Fristen und Schwellen](fristen-und-schwellen.md) und
[Umsatzsteuer-Voranmeldung](umsatzsteuer.md).

## Bargeld

Bei einer Kasse gibt es keinen Entwurf: Die Buchung wird sofort
festgeschrieben, weil sich eine offene Kasse sonst nicht mehr nachvollziehen
ließe. Deshalb braucht Bargeld immer das Recht zum Festschreiben — wer es
nicht hat, sieht statt der Maske einen Hinweis, wer stattdessen bucht.

## Korrigieren

Eine festgeschriebene Buchung lässt sich nicht mehr bearbeiten, aber
korrigieren. Es gibt zwei Wege:

- Betrifft es nur die **Zuordnung** — Spender, Projekt, Zweck oder ob das
  Geld im Ausland verwendet wird —, führt **Korrigieren** oben rechts dorthin.
  Die Änderung wirkt im laufenden Geschäftsjahr sofort; in einem bereits
  abgeschlossenen Jahr wartet sie auf die Freigabe einer zweiten Person.
  Ebenso lassen sich an einer Ausgabe das Kennzeichen zwischen „keine
  Umsatzsteuer“, den beiden § 13b-Kennzeichen und dem innergemeinschaftlichen
  Erwerb und das Leistungsdatum ändern („Umsatzsteuer und Leistungsdatum“) —
  das Netto bleibt dabei gleich. Ist der alte oder neue Zeitraum schon
  abgegeben, sagt der Dialog vor dem Knopf, dass danach unter Fristen eine
  berichtigte Voranmeldung steht; gesperrt wird nichts.
- Betrifft es die **Zahlen** — Betrag, Datum, Konto, Kategorie oder
  Umsatzsteuer —, nehmen Sie die Buchung zurück: **Weitere Aktionen** (⋯) →
  **Zurücknehmen …**. Der Dialog nennt das Datum der Gegenbuchung; sie
  entsteht mit den negierten Beträgen und wird sofort festgeschrieben, ihre
  Nummer nennt der Hinweis danach. Ein vorbelegter Entwurf mit den bisherigen
  Werten öffnet sich, wenn gewünscht, für die richtige Fassung.

Sind beide Arten von Änderungen nötig, gilt immer der zweite Weg — er
kann alles.

Trägt eine Buchung mehr als eine Aufteilungszeile, fragt der Dialog
zuerst, welche davon gemeint ist — Kategorie, Betrag, Spender oder
Empfänger und Zweck stehen zur Wahl. Eine Zeile, deren Änderung schon auf
Freigabe wartet, lässt sich nicht ein zweites Mal auswählen.

### Wann ein Dokument nötig ist, wann eine zweite Person

Ändert sich bei einer Spende der **Zweck**, verlangt Kompass ein
Dokument, das belegt, was die Spenderin ursprünglich bestimmt hat — ein
PDF lässt sich dafür ablegen oder aus der Akte wählen. Ohne ein solches
Dokument ist es keine Korrektur mehr, sondern eine Umwidmung; die
entsprechende Seite kommt mit einer späteren Fassung.

Ist für das betroffene Geschäftsjahr die Steuererklärung bereits
abgegeben, verlangt eine Änderung an Spender, Auslandsbezug oder Zweck
zusätzlich eine ausdrückliche Kenntnisnahme: Eine solche Korrektur kann
eine Berichtigung nach § 153 AO nötig machen. Erst mit dem angehakten
Kästchen lässt sich die Änderung erneut absenden.

In einem bereits abgeschlossenen Geschäftsjahr wirkt eine Zuordnungsänderung
nie sofort — sie wartet auf die Freigabe einer zweiten Person mit dem
Recht „Freigeben“. Der Dialog nennt dabei, wer das erledigen kann.

Ein Geschäftsjahr lässt sich erst abschließen, wenn jede Zeile der
Kontoauszüge des Jahres festgeschrieben gebucht ist und für jedes
Bankkonto mindestens ein Auszug des Jahres vorliegt; die Vorschau des
Abschlusses nennt offene Zeilen mit Konto, Datum und Betrag und die Konten
ohne Auszug. Kassen und Zahlungsdienste ohne Auszugsformat brauchen keinen.

## Was ein Agent darf

Ein Agent über die Schnittstelle darf Buchungen anlegen und vorbereiten,
aber nicht festschreiben — das bleibt einem Menschen am Bildschirm
vorbehalten. Eine vom Agenten vorbereitete Buchung trägt im Journal ein
eigenes Kennzeichen, damit erkennbar bleibt, wer sie angelegt hat.
