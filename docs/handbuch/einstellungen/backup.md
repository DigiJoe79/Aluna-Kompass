# Backup

Ein Backup ist eine Datei mit allem, was Kompass weiß: Datenbank, Dateien,
Einstellungen. Sie laden es hier herunter und spielen es auf einer anderen
Instanz ein — etwa um Test mit dem Stand von Prod zu füllen. Vor jedem
Update des Containers gehört ein Backup gezogen.

## Export

„Export erstellen“ packt den vollständigen Datenbestand — Datenbank,
Dokumente, Medien, Protokoll, Einstellungen — in ein Archiv und bietet es
zum Herunterladen an. Das dauert rund 40 Sekunden. Die Seite zeigt, wann der
letzte Export war; die Kachel „Backup“ auf der
[Startseite](../startseite.md) sagt es ebenfalls und warnt, sobald das letzte
Backup älter ist als die Frist unter „Frist“ — Vorgabe 30 Tage. Wer die
Einstellungen pflegen darf, ändert sie dort.

Legen Sie das Archiv außerhalb des NAS ab. Ein Backup auf demselben Gerät
schützt vor einem Fehler in Kompass, nicht vor einem Ausfall des Geräts.

## Import

Der Import **ersetzt den gesamten Bestand** dieser Instanz — Nutzer,
Protokoll, Dokumente, alles. Deshalb zeigt „Import vorbereiten“ zuerst, was
im Archiv steckt und was überschrieben würde, und verlangt dann, dass Sie
den Namen der Umgebung eintippen. Ab dann läuft es durch; alle Sitzungen
werden beendet, auch Ihre.

Der übliche Fall: Prod nach Test kopieren, um eine Änderung mit echten Daten
zu prüfen. Der umgekehrte Weg — Test nach Prod — ist die Ausnahme und
bedeutet, dass alles verloren geht, was in Prod seit dem Export geschehen
ist.

## Wer importieren darf

„Backup importieren“ ist das mächtigste Recht in Kompass. Ein Import ersetzt
auch das Änderungsprotokoll — wer ein Archiv vorher außerhalb von Kompass
bearbeitet, kann damit Einträge verschwinden lassen, ohne je Zugang zum Server
zu haben. Geben Sie das Recht deshalb nur Personen, denen Sie auch den Server
anvertrauen würden; in der Regel bleibt es bei der Rolle „Administration“.

Gegen jemanden, der den Server selbst verwaltet, schützt keine Software, die
darauf läuft. Dafür gibt es die Kontrolle im Verein: Kassenprüfung, zwei
Personen mit Zugang, Backups an mehr als einem Ort.

## Und das Geheimnis

Das Archiv enthält keine Zugangsdaten zum Webspace und keinen
Sitzungsschlüssel; die liegen neben den Daten, nicht darin. Ein Backup lässt
sich deshalb weitergeben, ohne den Zugang zum Webspace mitzugeben.
