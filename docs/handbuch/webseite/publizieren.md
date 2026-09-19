# Publizieren

Publizieren baut die Seite aus Template und Inhalten und lädt die fertigen
Dateien auf den Webspace des Vereins. Vorher laufen Prüfungen — fehlende
Pflichtangaben, gesperrte Begriffe, veraltete Verweise —, und Sie sehen, was
sich gegenüber dem letzten Stand ändert. Publiziert wird nur aus der
Prod-Instanz.

## Ziel und Stand

Oben steht, wohin diese Instanz publiziert: **Staging** aus der
Test-Instanz — eine Kopie der Seite unter einer Adresse, die nicht im
Suchindex steht —, die **Live-Webseite** aus Prod. Aus der
Entwicklungsumgebung wird nicht publiziert. Darunter der letzte Publish mit
Datum und Ergebnis.

## Sperrwörter

Die Karte „Sperrwörter“ auf dieser Seite hält die Begriffe, die nie auf der
Webseite erscheinen dürfen — etwa einen alten Vereinsnamen oder einen
Platzhalter aus der Einrichtung. Ein Begriff je Zeile, 2 bis 80 Zeichen,
höchstens 50. Groß- und Kleinschreibung zählt nicht, und Leerzeichen,
Bindestrich und Unterstrich gelten als gleich: „alter-name“ trifft auch
„Alter Name“. Leere Zeilen und doppelte Einträge fallen beim Speichern weg.

Pflegen darf die Liste, wer publizieren darf (`site.publish`); jede Änderung
steht im Änderungsprotokoll. Über MCP gehen dasselbe `site_blocked_terms_get`
und `site_blocked_terms_set`.

## Prüfen

„Prüfen“ geht über alle Inhalte, ändert nichts und meldet drei Dinge:

- **Sperrworttreffer** — Begriffe, die nie auf der Seite erscheinen dürfen,
  etwa ein alter Vereinsname oder ein Platzhalter aus der Einrichtung. Ein
  Treffer sperrt den Publish, bis der Text geändert ist.
- **Übersetzungslücken** — Felder, die in einer eingerichteten Sprache leer
  sind. Eine Warnung, keine Sperre: Die Seite erscheint, aber an dieser
  Stelle in der Leitsprache oder leer, je nach Template.
- **Veraltete Verweise** — eine Variable zeigt auf einen Datensatz, der nicht
  mehr veröffentlicht ist. Ebenfalls eine Warnung; das Feld wird leer
  ausgeliefert, das Template nimmt seinen Vorschlag.

Der **Inhalts-Hash** darunter ist die Prüfsumme des Stands, der gebaut
würde; er steht später in der Historie.

## Vorschau

„Vorschau bauen“ erzeugt die Seite so, wie sie publiziert würde, und
„Vorschau öffnen“ zeigt sie im Browser — im eigenen Netz, ohne dass etwas
den Webspace erreicht. Das ist der Weg, eine Änderung zu sehen, bevor sie
draußen ist.

## Änderungen gegenüber Live

Die Liste zeigt je Datei, ob sie gegenüber dem letzten Publish **geändert**,
**neu** oder **entfallen** ist. Bei einer neuen Meldung unter Aktuelles sind
das die Seite der Meldung, die Übersicht und die Bilder — mehr nicht. Steht
dort „Keine Änderungen“, würde ein Publish dasselbe noch einmal hochladen.

## Verbindung testen

Vor dem ersten Publish und nach jeder Änderung am Webspace: „Verbindung
testen“ meldet sich am Ziel an, überträgt nichts und listet, was dort liegt.
Steht die erwartete Seite in der Liste, stimmt der Pfad. Kommt sie leer
zurück, zeigt der Pfad ins Leere — ein Publish würde dann nichts entfernen,
aber auch nichts sichtbar machen.

## Publizieren

„Live publizieren“ (oder „Nach Staging publizieren“) fragt noch einmal nach
und lädt dann hoch. Die Übertragung legt alle Dateien erst in einem
Zwischenverzeichnis ab und tauscht sie am Ende auf einmal um — ein Abbruch
mittendrin lässt keine halb alte, halb neue Seite stehen. Der Publish steht
mit Datum, Prüfsumme und Ergebnis im Änderungsprotokoll.

Kompass verweigert den Publish, wenn ein Sperrwort getroffen wurde, wenn das
Template im Verzeichnis geändert, aber nicht neu [eingelesen](template-einlesen.md)
wurde, oder wenn das Template ein Modul braucht, das unter Einstellungen →
Module ausgeschaltet ist.
