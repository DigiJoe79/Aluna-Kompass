# Template einlesen

Die Vereinsseite wird aus einem Template gebaut, das der Verein mitbringt.
Beim Einlesen prüft Kompass, welche Variablen und Sammlungen das Template
deklariert, zeigt Befunde an und übernimmt die Deklaration — erst danach
lassen sich Inhalte pflegen und publizieren.

## Woher das Template kommt

Das Template ist ein Verzeichnis auf dem NAS: `/data/site/template`. Beim
ersten Start legt Kompass dort das mitgelieferte Basis-Template ab; der Verein
ersetzt es durch sein eigenes, indem die Person, die das NAS betreut, das
Verzeichnis austauscht (siehe [Betrieb](../betrieb.md)). Kompass liest von
dort — es lädt kein Template hoch und speichert keins in der Datenbank.

Die Seite „Template“ zeigt den Namen des Templates, das zuletzt eingelesen
wurde, und wann. Steht dort „Noch kein Template eingelesen“, sind Variablen,
Sammlungen und Publizieren noch nicht verfügbar.

## Einlesen

„Template einlesen“ lädt die Deklaration aus dem Verzeichnis und vergleicht
sie mit dem Stand, den Kompass kennt. Das Ergebnis sind **Befunde**, in drei
Gruppen:

- **Blockiert — erst aufräumen.** Das neue Template erlaubt weniger, als
  vorhanden ist: eine Sammlung darf nur noch zehn Einträge haben, es gibt
  aber zwölf. Kompass entscheidet nicht, welche zwei verschwinden. Sie räumen
  erst auf, dann lesen Sie erneut ein.
- **Kostet Inhalt.** Ein Feld entfällt oder wechselt seinen Typ so, dass
  vorhandener Text nicht mitkommt. Kompass zeigt, wie viele Einträge davon
  tatsächlich betroffen sind — ein Feld, das nirgends gefüllt ist, kostet
  nichts.
- **Unkritisch.** Neue Felder, neue Sammlungen, Umbenennungen, die das
  Template als solche kennzeichnet, Typwechsel ohne Verlust.

Steht nichts an, sagt die Seite „Keine Änderungen gegenüber dem eingelesenen
Stand“. Fordert das Template eine Sprache, die unter Einstellungen → Sprachen
nicht eingerichtet ist, bricht das Einlesen ab, bevor etwas geändert wird.

Mit „Übernehmen“ wendet Kompass die Befunde in einem Schritt an und schreibt
den vollständigen Plan ins Änderungsprotokoll. „Abbrechen“ lässt alles, wie
es war.

## Startinhalte

Bringt ein Template Startinhalte mit — Werte für die Variablen, Einträge für
die Sammlungen, die zugehörigen Bilder —, erscheint nach dem Einlesen die
Karte „Startinhalte“. Sie zeigt in der Vorschau, was hereinkäme, und
übernimmt es mit einem Klick. Das geht **genau einmal** und nur, solange die
Webseite noch leer ist: Danach ist die Datenbank die einzige Quelle, und was
Sie ändern, ändert das Template nicht mehr.

## Was danach gilt

Kompass merkt sich eine Prüfsumme der eingelesenen Datei. Ändert jemand das
Template im Verzeichnis, ohne neu einzulesen, verweigert das Publizieren mit
dem Hinweis, erst einzulesen — sonst würde die Seite gegen Felder gebaut, die
Kompass nicht kennt.
