# Tiere

Hier stellen Sie ein, was das Tiermodul über die Webseite wissen muss. Heute
ist das eine Angabe: in welchem Ausschnitt die Webseite das Hauptfoto eines
Tiers zeigt.

## Bildausschnitt des Hauptfotos

Die Webseite zeigt das Hauptfoto nicht als ganzes Bild, sondern in einem festen
Rahmen — etwa hochkant im Format 4:5 auf der Seite eines Hundes und auf den
Karten der Übersicht. Was außerhalb des Rahmens liegt, schneidet sie ab. Welches
Format gilt und wohin der Rahmen blickt, legt das Template der Webseite fest,
nicht Kompass.

Tragen Sie hier dasselbe ein, dann zeigt das [Tierprofil](../tiere.md) auf dem
Reiter „Texte und Fotos“ jedes Foto in diesem Rahmen. Beim Wählen des
Hauptfotos sehen Sie so, was die Seite zeigen wird: ob Kopf und Ohren im Bild
sind oder abgeschnitten werden.

- **Seitenverhältnis** — Breite zu Höhe, etwa 4:5 für Hochformat oder 4:3 für
  Querformat.
- **Blickpunkt waagerecht und senkrecht** — in Prozent, wie die Webseite den
  Rahmen über das Bild legt: 50 und 50 schneidet mittig, 50 und 25 behält eher
  den oberen Teil. Wer das Template der Webseite kennt, findet die Werte dort
  unter `object-position`.

Vorgabe ist 4:3, mittig. Die Einstellung verlangt das Recht, Einstellungen zu
ändern; ein Agent kann sie über MCP mit `settings_set` und dem Schlüssel
`animals.photoFrame` setzen.
