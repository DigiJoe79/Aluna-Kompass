# Webseite einrichten

Unter Einstellungen → Webseite richten Sie ein, woraus und wohin die
Vereinsseite gebaut wird: das Template, die Verbindung zum Webspace, den
Cache der Bildvarianten und die Liste gesperrter Begriffe. Die Inhalte
selbst pflegen Sie unter „Webseite“ in der Leiste; dort steht auch
„Publizieren“, das ohne Template zuerst in diese Einstellungen führt.

Die Seite hat vier Reiter. Sie brauchen dafür das Recht „Webseite pflegen“.

## Template

Hier lesen Sie das Template des Vereins ein und übernehmen, falls es welche
mitbringt, die Startinhalte. Wie das geht und was die Befunde bedeuten,
steht unter [Template einlesen](../webseite/template-einlesen.md). Die alte
Adresse „Webseite → Template“ leitet auf diesen Reiter weiter.

## Verbindung

Der Reiter zeigt, wohin Kompass publiziert: die öffentliche Adresse, das Ziel
(Benutzer, Server und Pfad, bei Tests ein lokales Verzeichnis), die Art der
Anmeldung und ob die Schlüssel- oder Passwortdatei gesetzt und lesbar ist,
dazu, ob die Instanz auf Staging publiziert. Das Geheimnis selbst erscheint
nie, nur „gesetzt“, „fehlt“ oder „nicht lesbar“.

Diese Werte stehen in der Umgebung des Containers und lassen sich nur dort
ändern; danach muss der Container neu erstellt werden (siehe
[Betrieb](../betrieb.md)). Ist das Ziel nicht vollständig eingerichtet oder
die Datei nicht lesbar, bleibt der Testknopf aus und der Reiter sagt es.

„Verbindung testen“ prüft in Sekunden vier Punkte und baut nichts: ob die
Anmeldung gelingt, ob es das Zielverzeichnis gibt, ob dort geschrieben werden
darf — Kompass legt dafür eine Probedatei an und löscht sie wieder — und wie
viele Dateien am Ziel liegen. Bei einem lokalen Ziel entfällt die Anmeldung.
Jeder Punkt steht mit Haken oder mit einer Meldung da, die sagt, was zu
prüfen ist; scheitert ein Punkt, bleiben die folgenden ungeprüft. Der Test
lässt sich abbrechen, das letzte Ergebnis bleibt stehen. Er verlangt
zusätzlich das Recht „Publizieren“; wer es nicht hat, sieht den Reiter nur
lesend und mit einem Hinweis. Ein Assistent startet ihn mit
`site_deploy_check` und liest das Ergebnis mit `site_job_result`.

## Cache

Der Cache enthält die Bildvarianten, die der Seitenbau erzeugt, und die
zuletzt gebaute Vorschau. Der Reiter zeigt, wie viele Bildvarianten es sind,
wie groß sie sind, wie alt die älteste und die neueste ist und wann die
Vorschau gebaut wurde. Beides lässt sich jederzeit neu erzeugen; Leeren ist
sinnvoll, wenn Bilder oder Vorschau erkennbar nicht mehr stimmen.

„Cache leeren“ fragt nach. Danach erzeugt der nächste Bau alles neu und
dauert bei vielen Fotos deutlich länger. Solange eine Vorschau, ein
Verbindungstest oder ein Publish läuft, ist der Knopf gesperrt. Ein
Assistent liest den Stand mit `site_cache_status` und leert mit
`site_cache_clear`; das Leeren steht im Änderungsprotokoll.

## Gesperrte Begriffe

Die Liste hält die Begriffe, die nie auf der Webseite erscheinen dürfen —
etwa einen alten Vereinsnamen oder einen Platzhalter aus der Einrichtung. Ein
Begriff je Zeile, 2 bis 80 Zeichen, höchstens 50. Groß- und Kleinschreibung
zählt nicht, und Leerzeichen, Bindestrich und Unterstrich gelten als gleich:
„alter-name“ trifft auch „Alter Name“. Leere Zeilen und doppelte Einträge
fallen beim Speichern weg.

Jeder Treffer beim [Prüfen](../webseite/publizieren.md) sperrt den Publish,
bis der Text geändert ist; im Prüfergebnis führt „Liste bearbeiten“ hierher.
Speichern darf, wer das Recht „Publizieren“ hat; ohne dieses Recht ist die
Liste nur zu lesen. Jede Änderung steht im Änderungsprotokoll. Über MCP gehen
`site_blocked_terms_get` und `site_blocked_terms_set`.

## Rechte

Die Seite verlangt „Webseite pflegen“. Wer nur „Webseite veröffentlichen“
hat, sieht unter Einstellungen keinen Eintrag „Webseite“.
