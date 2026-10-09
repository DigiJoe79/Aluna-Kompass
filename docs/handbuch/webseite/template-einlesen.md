# Vorlage einlesen

Die Vereinsseite wird aus einer Vorlage (Template-Datei) gebaut, die der Verein mitbringt.
Beim Einlesen prüft Kompass, welche Variablen und Sammlungen die Vorlage
deklariert, zeigt Befunde an und übernimmt die Deklaration — erst danach
lassen sich Inhalte pflegen und publizieren.

## Woher die Vorlage kommt

Die Vorlage ist ein Verzeichnis auf dem NAS: `/data/site/template`. Beim
ersten Start legt Kompass dort die mitgelieferte Basis-Vorlage ab; der Verein
ersetzt sie durch seine eigene, indem die Person, die das NAS betreut, das
Verzeichnis austauscht (siehe [Betrieb](../betrieb.md)). Kompass liest von
dort — es lädt keine Vorlage hoch und speichert keine in der Datenbank.

Sie lesen sie unter Einstellungen → Webseite → Vorlage ein (siehe
[Webseite einrichten](../einstellungen/webseite-einrichten.md)). Der Reiter
zeigt den Namen der Vorlage, die zuletzt eingelesen wurde, und wann. Steht dort „Noch keine Vorlage eingelesen“, sind Variablen,
Sammlungen und Publizieren noch nicht verfügbar.

## Einlesen

„Vorlage einlesen“ lädt die Deklaration aus dem Verzeichnis und vergleicht
sie mit dem Stand, den Kompass kennt. Das Ergebnis sind **Befunde**, in drei
Gruppen:

- **Blockiert — erst aufräumen.** Die neue Vorlage erlaubt weniger, als
  vorhanden ist: eine Sammlung darf nur noch zehn Einträge haben, es gibt
  aber zwölf. Kompass entscheidet nicht, welche zwei verschwinden. Sie räumen
  erst auf, dann lesen Sie erneut ein.
- **Kostet Inhalt.** Ein Feld entfällt oder wechselt seinen Typ so, dass
  vorhandener Text nicht mitkommt. Kompass zeigt, wie viele Einträge davon
  tatsächlich betroffen sind — ein Feld, das nirgends gefüllt ist, kostet
  nichts.
- **Unkritisch.** Neue Felder, neue Sammlungen, Umbenennungen, die die
  Vorlage als solche kennzeichnet, Typwechsel ohne Verlust.

Steht nichts an, sagt die Seite „Keine Änderungen gegenüber dem eingelesenen
Stand“. Fordert die Vorlage eine Sprache, die unter Einstellungen → Sprachen
nicht eingerichtet ist, bricht das Einlesen ab, bevor etwas geändert wird.

Mit „Übernehmen“ wendet Kompass die Befunde in einem Schritt an und schreibt
den vollständigen Plan ins Änderungsprotokoll. „Abbrechen“ lässt alles, wie
es war.

## Startinhalte

Bringt eine Vorlage Startinhalte mit — Werte für die Variablen, Einträge für
die Sammlungen, die zugehörigen Bilder —, erscheint nach dem Einlesen die
Karte „Startinhalte“. Sie zeigt in der Vorschau, was hereinkäme, und
übernimmt es mit einem Klick. Das geht **genau einmal** und nur, solange die
Webseite noch leer ist: Danach ist die Datenbank die einzige Quelle, und was
Sie ändern, ändert die Vorlage nicht mehr.

## Was danach gilt

Kompass merkt sich eine Prüfsumme der eingelesenen Datei. Ändert jemand die
Vorlage im Verzeichnis, ohne neu einzulesen, verweigert das Publizieren mit
dem Hinweis, erst einzulesen — sonst würde die Seite gegen Felder gebaut, die
Kompass nicht kennt.

## Nach einem eingespielten Backup

Eine Vorlage ist kein Text, sondern **ausführbarer Code**: Kompass führt sie
beim Einlesen aus, und beim Publizieren baut sie die ganze Webseite. Deshalb
gilt für Vorlagen dasselbe wie für jedes Programm — spielen Sie nur eine
ein, deren Herkunft Sie kennen.

Das Backup nimmt Ihre Vorlage mit, Sie verlieren sie also nicht. Nach dem
Einspielen prüft Kompass, ob die Vorlage aus dem Backup dieselbe ist, die
vorher lief:

- **Dieselbe Vorlage** — der Normalfall, wenn Sie Ihr eigenes Backup
  zurückspielen. Es geht ohne Zutun weiter, Sie merken nichts davon.
- **Eine andere Vorlage** — dann steht auf dieser Seite ein Hinweis, und
  Publizieren ist gesperrt, bis Sie sie einlesen. Tun Sie das erst, wenn Sie
  wissen, woher das Backup stammt.

Kommt das Backup in eine frische Installation, in der noch nie eine Vorlage
lief, gibt es nichts zu vergleichen — dann fragt Kompass immer.
