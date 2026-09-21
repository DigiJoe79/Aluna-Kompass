# Auszug bei der Bank holen

Bevor ein Kontoauszug in Kompass geladen werden kann, muss er im
Online-Banking der Bank heruntergeladen werden — im Format CAMT.053.

## Wonach suchen

Die Bezeichnung ist von Bank zu Bank verschieden. Gesucht wird meist unter
„Kontoauszüge“, „Umsätze exportieren“ oder „Postausgang“, dort nach einem
Format namens „CAMT.053“, „camt.053“, „Kontoauszug (XML)“ oder schlicht
„XML“. Manche Banken zeigen mehrere CAMT-Varianten (camt.052, camt.053,
camt.054) — für Kompass zählt **camt.053**, der tagesaktuelle Kontoauszug,
nicht die laufende Vormerkung (camt.052).

Der Zeitraum lässt sich meist frei wählen; ein Auszug pro Kalendertag oder
ein zusammenhängender Zeitraum sind beide möglich — Kompass legt für jeden
im Auszug enthaltenen Tag einen eigenen Lauf an.

## Notiz Ihres Vereins

> **Notiz Ihres Vereins:** Hier trägt der Verein ein, wie der Weg bei der
> eigenen Bank konkret aussieht — Menüpunkt, Format-Name, Besonderheiten.
> Diese allgemeine Anleitung kennt die Bank des Vereins nicht.

## Datei speichern und laden

Die heruntergeladene Datei (Endung meist `.xml`) wird auf der Seite
[Kontoauszug laden](kontoauszug-laden.md) auf die Ablagefläche gezogen. Ein
Umbenennen ist nicht nötig; Kompass liest den Inhalt, nicht den Dateinamen.
