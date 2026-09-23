# CSV-Format einrichten

Manche Banken und die meisten Zahlungsdienste liefern ihre Umsätze nicht als
CAMT.053, sondern als CSV-Datei — eine Tabelle, bei der jede Bank ihre
Spalten anders nennt und anders ordnet. Damit Kompass eine solche Datei
richtig liest, richtet man für das Konto **einmal** ein CSV-Format ein.

## Zuerst: Nehmen Sie CAMT, wenn es geht

Bietet Ihre Bank CAMT.053 an, nehmen Sie das. CAMT liest Kompass ohne
Einrichtung, und es erkennt schon geladene Zahlungen sicher wieder, weil
jede Zahlung eine Bankreferenz trägt. Eine CSV-Datei hat das meist nicht;
Kompass vergleicht dann Datum, Betrag, IBAN und Verwendungszweck und legt
Ihnen öfter einen Zweifelsfall vor. Wo die CAMT-Datei im Online-Banking
steht, beschreibt [Auszug bei der Bank holen](auszug-bei-der-bank-holen.md).

## Die fünf Schritte

Den Assistenten öffnen Sie unter „Hochgeladene Auszüge“: Laden Sie eine
CSV-Datei auf ein Konto ohne CSV-Format, bietet Kompass „CSV-Format
einrichten“ an. Auch die Checkliste unter „Finanzen einrichten“ führt dorthin.
Einrichten darf, wer „Finanzen einrichten“ darf.

1. **CAMT oder CSV** — der Assistent fragt noch einmal nach CAMT. Erst mit
   „Trotzdem CSV einrichten“ wählen Sie die Datei.
2. **Einstellungen** — Kompass schlägt Zeichensatz, Trennzeichen, die Zeile
   der Kopfzeile (manche Banken schreiben Kontodaten davor), Datumsformat
   und Dezimalzeichen vor. Meist stimmt der Vorschlag.
3. **Spalten** — über jeder Spalte der Vorschau steht, wofür Kompass sie
   nimmt: Buchungstag, Betrag (oder getrennte Spalten für Ausgang und
   Eingang), Name der Gegenseite, Verwendungszweck und, wenn vorhanden,
   IBAN, Referenz, Gebühr, Kontostand, Währung und Status. Was Sie nicht
   brauchen, bleibt auf „ignorieren“.
4. **Vorzeichen** — Kompass zeigt eine echte Zeile Ihrer Datei und fragt, ob
   das eine Ausgabe war. So weiß es, ob Ihre Bank Ausgänge mit Minus führt.
5. **Probe** — die erste Zeile, so wie Kompass sie liest. Stimmt sie, geben
   Sie dem Format einen Namen und wählen „Speichern und Auszug laden“.

Hat die Datei eine Spalte mit dem Kontostand, prüft Kompass, ob jede Zeile
zum Kontostand davor passt. Passt es nicht, stimmt meist das Vorzeichen oder
eine Spalte nicht — Kompass liest die Datei dann nicht, statt sie falsch zu
lesen.

Der Assistent merkt sich Ihren Stand in diesem Browser. Wählen Sie dieselbe
Datei noch einmal, geht es dort weiter, wo Sie aufgehört haben.

## Gebühren

Führt ein Zahlungsdienst die Gebühr in einer eigenen Spalte, wird daraus ein
**eigener Kontoumsatz** neben der Zahlung: 50,00 € Spende und −1,60 €
Gebühr sind zwei Umsätze, die Sie einzeln buchen. So stimmt die Summe mit
dem Guthaben beim Dienst überein.

Laden Sie beim Zahlungsdienst möglichst alle angebotenen Spalten herunter —
und jedes Mal dieselben. Eine andere Spaltenauswahl ist für Kompass eine
andere Datei.

## Kontostand laut Bank

Hat die Datei keine Spalte mit dem Kontostand, kann Kompass nicht prüfen, ob
ein Auszug lückenlos an den vorigen anschließt. Im letzten Schritt können
Sie deshalb den „Kontostand laut Bank“ am letzten Tag der Datei eintragen.
Das ist freiwillig; ohne ihn steht der Auszug in der Liste „ohne
Kontostand“.

## Formatwechsel

Ein Konto hat **ein** Auszugsformat. Passt eine Datei nicht mehr zum Format
— etwa weil die Bank ihre Spalten geändert hat —, lehnt Kompass sie ab und
bietet an, ein neues Format einzurichten. Das ist ein Formatwechsel und
verlangt eine Bestätigung: Nach dem Wechsel erkennt Kompass schon geladene
Zahlungen nicht mehr sicher wieder und legt Ihnen mehr Zweifelsfälle vor.
Korrigieren Sie nur die Zuordnung einer Spalte, bleibt die Kopfzeile gleich,
und es ist kein Wechsel.

Frühere Auszüge behalten ihr Format: In der Liste steht bei jedem Auszug,
mit welchem Format er gelesen wurde.
