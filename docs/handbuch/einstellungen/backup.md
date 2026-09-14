# Backup

Ein Backup ist eine Datei mit allem, was Kompass weiß: Datenbank, Dateien,
Einstellungen. Sie laden es hier herunter und spielen es auf einer anderen
Instanz ein — etwa um Test mit dem Stand von Prod zu füllen. Vor jedem
Update des Containers gehört ein Backup gezogen.

## Export

„Export erstellen“ packt den vollständigen Datenbestand — Datenbank,
Dokumente, Medien, Protokoll, Einstellungen — in ein Archiv und bietet es
zum Herunterladen an. Das dauert rund 40 Sekunden. Die Seite zeigt, wann der
letzte Export war; die [Startseite](../startseite.md) erinnert, solange
keiner existiert.

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

## Und das Geheimnis

Das Archiv enthält keine Zugangsdaten zum Webspace und keinen
Sitzungsschlüssel; die liegen neben den Daten, nicht darin. Ein Backup lässt
sich deshalb weitergeben, ohne den Zugang zum Webspace mitzugeben.
