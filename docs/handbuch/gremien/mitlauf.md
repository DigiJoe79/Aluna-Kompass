# Mitlauf

Der Mitlauf ist die Arbeitsfläche für die laufende Sitzung: Anwesenheit, Ergebnisse und Notizen ohne Speichern-Knopf,
gebaut für die Protokollführung am Laptop.

## Aufbau

Oben steht die **Lageleiste**: wie viele Stimmberechtigte da sind (ein Klick öffnet die Anwesenheit), ob die Sitzung
beschlussfähig ist, der Speicherstand und **Mitlauf beenden …**. Links steht die Tagesordnung als **Sprungliste**, je
Punkt mit seinem Ergebnis; rechts der aktuelle Punkt mit Antrag, „Notiz fürs Protokoll“ und Ergebnis. **Weiter zu TOP
…** geht zum nächsten Punkt. Am ersten Punkt stehen die Anwesenheit und die Feststellungen zu Beginn — Leitung,
Protokollführung, ordnungsgemäße Einladung, Beschlussfähigkeit, Tagesordnung. Kompass schlägt vor; weicht die
Feststellung ab, fragt es nach einer Begründung.
Hinweise zur Sitzung — etwa ein Beginn an einem anderen Tag oder eine Protokollführung, die nicht als anwesend
erfasst ist — stehen darüber und auf der Seite der Sitzung; sie sperren nichts.

![Der Mitlauf einer Vorstandssitzung: oben die Lageleiste mit Anwesenheit und Beschlussfähigkeit, darunter ein Punkt mit gezählter Abstimmung, erforderlicher Mehrheit und Feststellung](../bilder/gremien/mitlauf.png)

## Anwesenheit

Suchen Sie den Namen und drücken Sie Enter: Die Person kommt bzw. geht mit der Uhrzeit von jetzt. **⋯ Mit Uhrzeit
eintragen …** nimmt eine andere Uhrzeit. Gäste tragen Sie mit **Gast eintragen** ein; sie stimmen nicht mit.

## Beschließen

- **Einstimmig angenommen** (Taste `E`) trägt das Ergebnis mit einem Tastendruck ein.
- **Auszählen** (Taste `Z`) fragt, wie im Saal gefragt wird: Nein, Enthaltung, ungültig. **Ja errechnet Kompass** aus
  den Stimmberechtigten minus Nein, Enthaltung und ungültig (Subtraktionsverfahren); das Protokoll nennt das Verfahren.
  **Selbst zählen** macht Ja zum Feld. Bei Satzungsänderung, Zweckänderung und Auflösung zählen Sie Ja immer selbst:
  Dort zählte sonst jede schweigende Person als Ja.
- Kompass zeigt die nötige Mehrheit mit ihrer Fundstelle, ob sie erreicht ist und wenn es knapp ist. Es schlägt vor,
  die Leitung stellt fest. Weicht die Feststellung von der Zählung ab, verlangt Kompass eine Begründung fürs
  Protokoll. Eine Feststellung gegen die Zählung macht den Beschluss nicht wirksam; sie steht mit ihrer Begründung im
  Protokoll. Fehlt die Begründung, trägt der Punkt „Begründung fehlt“, und festschreiben lässt sich die Sitzung erst
  mit ihr.
- Vertagt oder zurückgezogen steht unter **⋯** am Ergebnis.
- Bei einer **Abberufung** wählen Sie über der Ergebnis-Karte, wessen Amtszeit endet; beim **Ehrenmitglied** das
  Mitglied und seine künftige Mitgliedsart — wie beim Auftrag Empfänger und Frist. Beim Festschreiben endet die Amtszeit; für
  das Ehrenmitglied entsteht ein Hinweis, die Mitgliedsart unter Mitglieder zu ändern. Ohne Auswahl entsteht nichts,
  und ein Hinweis bleibt stehen.

Geht jemand, während gezählt wird, rechnet Kompass Ja neu und sagt es unter dem Feld.

## Wahl

Je Amt tragen Sie die Kandidaten aus der Anwesenheit ein oder wählen mit **Andere Person** jemanden, der nicht
da ist. Bei einer Person reicht **Einstimmig gewählt**, sonst zählen
Sie je Kandidat. Erreicht niemand die Mehrheit, legt **Stichwahl anlegen** einen weiteren Wahlgang an. Danach fragt
Kompass, ob die Person annimmt: **Nimmt an** (Taste `J`), **Lehnt ab** oder **Nicht anwesend, Erklärung folgt** — die
Annahme erfassen Sie dann später im Schritt Protokoll.

## Entlastung

Wählen Sie vor der ersten Abstimmung, ob gemeinsam oder einzeln abgestimmt wird; danach steht es fest. Wer entlastet
wird, stimmt nicht mit — bei gemeinsamer Abstimmung alle Betroffenen; sie bleiben für die Beschlussfähigkeit
anwesend. Die Lageleiste zählt für den Punkt ohne sie.

## Antrag aus der Versammlung

**Antrag aus der Versammlung …** fragt, wer ihn stellt, den Antrag und die Art. Er kommt hinter den aktuellen Punkt;
zuerst stimmt die Versammlung über die Aufnahme ab. Muss die Art in der Einladung angekündigt sein, warnt Kompass.

## Tastenkürzel

| Taste | Wirkung |
|---|---|
| `E` | einstimmig |
| `Z` | auszählen |
| `J` | nimmt die Wahl an |
| `A` | Anwesenheit öffnen |
| `Alt ↑` / `Alt ↓` | voriger / nächster Punkt |
| Enter | „Weiter“ nach einem Ergebnis |

Die Tasten wirken nur, wenn kein Textfeld den Fokus hat — in der Notiz tippen Sie ganz normal.

## Speichern ohne Knopf

Jede Eingabe geht sofort an den Server. Die Lageleiste zeigt „Zwischenstand gespeichert“ mit Uhrzeit. Fehlt die
Verbindung, bleiben die Eingaben im Browser und gehen der Reihe nach hinaus, sobald sie wieder da ist — auch nach einem
Neuladen der Seite. Lehnt Kompass dabei etwas ab, steht der Grund am Punkt.

## Ein Gerät schreibt

Es schreibt immer genau eine Person: wer die Sitzung begonnen hat. Andere sehen den Mitlauf lesend, er erneuert sich
alle 15 Sekunden. Mit **Protokollführung übernehmen** schreibt ab dann die neue Person.
