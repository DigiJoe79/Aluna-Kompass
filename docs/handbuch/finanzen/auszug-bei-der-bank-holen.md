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

## So heißt es bei der Sparkasse

Im Online-Banking der Sparkasse steht der Export unter „Postfach“ oder
„Umsätze“ → „Exportieren“, dort als „XML (CAMT)“. Es gibt zwei Fassungen:
**camt.053.001.08 (V8)** ist die aktuelle und wird bevorzugt, camt.053.001.02
(V2) geht ebenfalls. Wichtig ist, immer die **gebuchten Umsätze** zu
exportieren, nicht die vorgemerkten. MT940/MT942 und Excel-CSV-CAMT liest
Kompass nicht — nur die XML-Fassung von camt.053.

## Notiz Ihres Vereins

> **Notiz Ihres Vereins:** Hier trägt der Verein ein, wie der Weg bei der
> eigenen Bank konkret aussieht — Menüpunkt, Format-Name, Besonderheiten.
> Diese allgemeine Anleitung kennt die Bank des Vereins nicht.

## Datei speichern und laden

Die heruntergeladene Datei (Endung meist `.xml`) wird auf der Seite
[Kontoauszug laden](kontoauszug-laden.md) auf die Ablagefläche gezogen. Ein
Umbenennen ist nicht nötig; Kompass liest den Inhalt, nicht den Dateinamen.
