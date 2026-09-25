# Arbeitsliste

In der Arbeitsliste wird aus jedem geladenen Kontoumsatz eine Buchung.
Kompass schlägt zu jedem Umsatz vor, wie er zu buchen ist, und sagt, warum;
ein Mensch prüft den Vorschlag und übernimmt ihn mit einem Tastendruck.

## Aufbau der Seite

Oben liegt die Ablagefläche für Kontoauszüge: Wer das Recht hat, Buchungen
vorzubereiten, zieht hier dieselben Dateien hinein wie unter [Kontoauszug
laden](kontoauszug-laden.md) beschrieben. Daneben wählt „Liste für Konto“,
ob die Liste alle Konten zeigt oder nur eines.

Darunter stehen fünf Reiter, jeder mit der Zahl seiner Einträge:

- **Zuzuordnen** — Kontoumsätze mit einem sicheren Vorschlag.
- **Unsicher** — Kontoumsätze, bei denen sich Kompass nicht sicher ist oder
  keinen Vorschlag hat. Hier ordnet man selbst zu.
- **Vom Agenten vorbereitet** — Entwürfe, die ein KI-Agent zu einem
  Kontoumsatz angelegt hat (siehe unten).
- **Geprüft, nicht festgeschrieben** — geprüfte Entwürfe, die noch keine
  Nummer tragen.
- **Fällig** — offene Zahlungen, deren Fälligkeit verstrichen ist.

Der gewählte Reiter steht in der Adresse; ein Neuladen bleibt dort. Hält
Kompass beim Laden Zeilen zurück, weil sie vielleicht schon bekannt sind,
nennt eine Zeile über der Liste ihre Zahl und führt zu „Hochgeladene
Auszüge“ — dort entscheidet ein Mensch über sie.

Links steht die Liste der Kontoumsätze: Datum, Gegenpartei, Zustand
(offen, vorgeschlagen, gebucht), Verwendungszweck und Betrag. Rechts steht
der gewählte Umsatz mit allen Angaben der Bank — Buchungstag,
Wertstellung, Betrag, Gegenpartei, IBAN, Verwendungszweck, Bankreferenz
und, falls vorhanden, der Rückgabe-Code — und darunter der Vorschlag.

## Mit der Tastatur arbeiten

Die Arbeitsliste lässt sich ganz mit der Tastatur bedienen; die Kürzel
stehen am Fuß der Liste:

| Taste | Wirkung |
|---|---|
| Pfeil nach oben / unten | anderen Kontoumsatz wählen |
| Enter | Vorschlag übernehmen und als geprüft markieren |
| E | ändern: die volle Buchungsmaske öffnen |
| Pfeil nach rechts | überspringen |

Nach **Enter** springt die Auswahl zum nächsten Umsatz. Ein
Bildschirmleser hört dabei, wie viele Umsätze noch auf Zuordnung warten.
Solange ein Eingabefeld den Fokus hat, gelten die Kürzel nicht — dort
schreibt man wie gewohnt. Wer Buchungen nur lesen darf, sieht Liste und
Vorschlag, aber weder Kürzel noch Knöpfe.

## „Vorschlag, weil:“

Jeder Vorschlag nennt seinen Grund. Kompass prüft der Reihe nach und nimmt
den ersten, der passt:

1. **Passt zu einer vorhandenen Buchung.** Sie haben die Zahlung schon von
   Hand gebucht, bevor der Auszug kam — gleiches Konto, gleicher Betrag,
   wenige Tage auseinander. Statt einer neuen Buchung bietet Kompass
   **Verknüpfen** an; der Umsatz hängt danach an Ihrer Buchung, auch wenn
   sie schon festgeschrieben ist.
2. **Umbuchung zwischen eigenen Konten.** Auf einem anderen Konto des
   Vereins liegt der Gegenumsatz, etwa eine Auszahlung des Zahlungsdiensts
   auf das Bankkonto. Fehlt unterwegs ein kleiner Betrag, bucht Kompass ihn
   als Gebühr. Steht im Verwendungszweck ein Wort für Bargeld —
   „Bareinzahlung“, „Barauszahlung“, „Geldautomat“ und ähnliche —, schlägt
   Kompass eine Umbuchung mit der Barkasse vor.
3. **Zurückgegebene Zahlung.** Die Bank meldet mit einem Rückgabe-Code,
   dass eine Zahlung zurückgekommen ist. Kompass sucht die ursprüngliche
   Buchung und schlägt vor, sie mit umgekehrtem Betrag auszugleichen.
4. **Offene Zahlung.** Der Verwendungszweck nennt die Zahlungsreferenz einer
   offenen Zahlung — dann ist der Vorschlag sicher. Passen nur Betrag und
   Kontakt, steht er unter „Unsicher“.
5. **Regel.** Eine Regel des Vereins trifft den Umsatz (siehe unten).
6. **Kontakt über die IBAN.** Die IBAN gehört zu einem bekannten Kontakt.
   Dieser Vorschlag ist immer unsicher: Er nennt, wer gezahlt hat, aber
   nicht, wofür.

Findet Kompass nichts davon, steht der Umsatz ohne Vorschlag unter
„Unsicher“. Hat ein Vorschlag ein Problem — etwa eine inzwischen
stillgelegte Kategorie —, sagt die Karte das deutlich und verweist auf die
Einrichtung; übernehmen lässt er sich erst, wenn das Problem behoben ist.
Bei einer ausländischen IBAN steht ein Hinweis, dass Zahlungen an Partner
erst mit Partnern und Zweckmitteln eigens erfasst werden.

## Übernehmen, ändern, überspringen

Unter dem Vorschlag steht eine kleine Buchungsmaske: Datum, Text und je
Zeile Kategorie, Betrag, Umsatzsteuer, Empfänger, Projekt und Zweck. Was
Sie hier ändern, gilt beim Übernehmen. **Übernehmen und geprüft** macht aus
dem Umsatz einen geprüften Entwurf; festgeschrieben ist er damit noch nicht.

**Ändern** öffnet die volle Buchungsmaske mit Konto, Betrag und
Kontoumsatz vorbelegt — für alles, was die kleine Maske nicht kann. Nach
dem Speichern führt sie zurück in die Arbeitsliste. **Überspringen** lässt
den Umsatz liegen und wählt den nächsten.

Hat inzwischen jemand anderes den Umsatz gebucht, lehnt Kompass das
Übernehmen ab und bietet an, die Liste neu zu laden.

## Regeln: „Künftig immer so?“

Wiederholt sich eine Zahlung — dieselbe Miete, derselbe Lieferant —, macht
„Künftig immer so?“ aus der aktuellen Zuordnung eine Regel. Der Dialog hat
zwei Teile:

- **Wenn der Umsatz …** — Konto, Richtung, die IBAN des Umsatzes, ein
  Textteil aus Gegenpartei oder Verwendungszweck, ein Betragsbereich.
  Mindestens eine Bedingung ist Pflicht.
- **… dann so buchen** — Kategorie, Projekt, Zweck, Kontakt, Umsatzsteuer
  und Buchungstext.

Während Sie die Regel einstellen, zählt Kompass mit: „trifft 12 frühere
Umsätze, davon 2 anders gebucht“. Ein Link führt zu den anders gebuchten,
damit Sie sehen, ob die Regel zu weit greift.

Eine Regel wirkt **nur nach vorn**: Sie schlägt für künftige Umsätze vor,
was schon gebucht ist, bleibt, wie es ist. Greifen mehrere Regeln, gewinnt
die erste in der Reihenfolge. Unter „Regeln“ stehen alle Regeln mit ihren
Treffern; dort lassen sie sich bearbeiten und löschen. Eine Regel, deren
Kategorie inzwischen stillgelegt ist, ist dort als „Kategorie stillgelegt“
markiert.

## Gehört nicht dem Verein

Manchmal läuft Geld nur durch den Verein: eine Sammelbestellung für eine
andere Gruppe, ein Betrag, der weitergegeben werden muss. „Gehört nicht dem
Verein“ bucht einen solchen Umsatz eigens, damit er weder als Einnahme noch
als Ausgabe zählt. Pflicht ist die Angabe „Für wen ist das Geld?“; sie
steht im Buchungstext.

Solches Geld steht unter **„Fremdes Geld, noch nicht weitergegeben“**, bis
es den Verein wieder verlassen hat. Kommt der Ausgang mit dem nächsten
Auszug, wählen Sie ihn in der Arbeitsliste, dann „Gehört nicht dem Verein“
und unter „Rückzahlung von“ den ursprünglichen Eingang — danach
verschwindet er aus der Liste.

## Beleg von beiden Seiten

Ein Beleg findet seine Buchung auf zwei Wegen:

- **Vom Umsatz aus.** Ziehen Sie das PDF auf den gewählten Umsatz. Kompass
  schlägt Art und Datum vor und legt den Beleg im Namen der Buchung in der
  Akte ab — im Betreff steht nie ein Personenname. Hat der Umsatz noch
  keinen Entwurf, entsteht einer aus dem Vorschlag. **Beleg suchen** sucht
  in der Akte nach einem Beleg über denselben Betrag oder dieselbe
  Gegenpartei; „Verknüpfen“ hängt einen Treffer an. „In der Akte suchen“
  öffnet die volle Suche der Akte.
- **Vom Beleg aus.** Ein Finanzbeleg in der Akte, der noch an keiner
  Buchung hängt, zeigt in seiner Ansicht den Knopf **Zu Buchung machen**.
  Er öffnet die Buchungsmaske; der Beleg wird beim Speichern verknüpft.
  Alle solchen Belege stehen gesammelt unter „Belege ohne Buchung“.

## Rechnungen mit ZUGFeRD

Viele Lieferanten schicken Rechnungen als PDF mit einer eingebetteten
elektronischen Rechnung (ZUGFeRD oder Factur-X, auch XRechnung im selben
Format). Kompass liest daraus Lieferant, Rechnungsnummer, Rechnungsdatum,
Betrag, Umsatzsteuer je Satz, Fälligkeit und die IBAN, an die gezahlt
werden soll. Das PDF muss dafür nichts Besonderes können; ob es eine
solche Rechnung trägt, sieht man ihm von außen nicht an.

Die Karte **Aus der Rechnung** zeigt diese Angaben an drei Stellen:

- unter **Belege ohne Buchung** — je Beleg aufklappbar mit „Aus der
  Rechnung“;
- in der Ansicht eines Finanzbelegs in der Akte, unter den Bezügen (nur,
  wer Finanzen lesen darf);
- in der Arbeitsliste, nachdem Sie ein PDF auf einen Umsatz gezogen haben:
  **Angaben aus der Rechnung übernehmen** trägt Lieferant und Nummer als
  Buchungstext ein, dazu Kontakt und Umsatzsteuer, und hängt das PDF an.

Darunter sagt die Karte, was mit der Rechnung zu tun ist:

- **Bezahlt** — auf einem Bank- oder Zahlungsdienstkonto ging genau der
  Rechnungsbetrag ab, frühestens zehn Tage vor und spätestens 90 Tage nach
  dem Rechnungsdatum, und die IBAN oder die Rechnungsnummer im
  Verwendungszweck passt. **Zum Kontoumsatz buchen** öffnet diesen Umsatz
  in der Arbeitsliste; nach dem Übernehmen trägt Kompass die Angaben der
  Rechnung ein und hängt das PDF als Beleg an.
- **Möglicherweise bezahlt** — nur der Betrag passt, oder mehrere Umsätze
  passen gleich gut. Kompass wählt dann nicht selbst, sondern listet die
  Umsätze; Sie entscheiden, welcher es war.
- **Nicht bezahlt** — **Offene Zahlung anlegen** macht aus der Rechnung
  eine offene Zahlung mit Betrag, Fälligkeit und der Rechnungsnummer als
  Zahlungsreferenz. Kommt die Zahlung später mit dem Auszug, schlägt die
  Arbeitsliste sie über diese Referenz vor. Je Rechnung gibt es höchstens
  eine offene Zahlung; danach führt die Karte zu ihr.
- **Gebucht als …** — die Rechnung hängt schon als Beleg an einer Buchung;
  die Karte führt nur noch dorthin.

Den Kontakt findet Kompass nur über die IBAN der Rechnung, nie über den
Namen des Lieferanten. Eine Kategorie schlägt die Rechnung nicht vor — sie
kennt die Kategorien des Vereins nicht; die wählen Sie beim Buchen, oder
eine Regel tut es.

**Was nie gespeichert wird:** Die Angaben werden bei jedem Öffnen der Karte
neu aus dem PDF gelesen. Die Umsatzsteuer der Rechnung übernimmt Kompass
nicht, sondern rechnet sie selbst aus dem Betrag; weicht der Betrag der
Rechnung um einige Cent ab, nennt die Karte die Abweichung nur. Gelesen
werden nur Rechnungen in Euro und nur die Summen, nicht die einzelnen
Positionen. Lassen sich die Anhänge nicht lesen, weil die Werkzeuge der
Texterkennung fehlen, sagt die Karte das und verweist auf die
[Betriebsanleitung](../betrieb.md).

## Festschreiben gegen den Auszug

Die Zeile „… geprüft, noch nicht festgeschrieben“ über der Liste hat den
Knopf **Festschreiben**. Er schreibt alle geprüften Entwürfe auf einmal
fest — alle oder keiner. Vorher zeigt Kompass je Konto die Summe, den
Buchbestand danach und den Endsaldo laut jüngstem Auszug. Stimmen beide
überein, ist das Konto abgestimmt; weichen sie ab, nennt Kompass die
Differenz. Das kann richtig sein, solange noch Umsätze offen sind. Eine
Kasse hat keinen Auszug; ihren Bestand prüft die Kassenzählung.

Steht einem Entwurf etwas im Weg — ein stillgelegtes Konto, eine
stillgelegte Kategorie, ein abgeschlossenes Geschäftsjahr —, nennt der
Dialog ihn mit einem Link, und nichts wird festgeschrieben. Danach nennt
Kompass die vergebenen Nummern.

## Wenn ein KI-Agent vorbereitet

Ein KI-Agent kann die Arbeitsliste über die Schnittstelle lesen und zu
Kontoumsätzen Entwürfe anlegen — mit denselben Vorschlägen, die auch am
Bildschirm erscheinen. Er legt diese Entwürfe **ungeprüft** vor; sie
stehen im Reiter „Vom Agenten vorbereitet“. Dort sieht ein Mensch sie an,
markiert sie als geprüft oder löscht sie.

Prüfen und Festschreiben bleiben einem Menschen am Bildschirm vorbehalten:
Nur ein Mensch drückt Enter. Das ist die Voreinstellung; ändern lässt sie
sich nur mit dem Schalter „Darf ein Agent festschreiben?“ unter [Finanzen
einrichten](einrichten.md), und der Schalter selbst lässt sich nur am
Bildschirm umlegen, nie über einen Agenten. Was es für den Datenschutz bedeutet, wenn ein Agent
Bankdaten liest, steht unter [Kontoauszug laden](kontoauszug-laden.md).
