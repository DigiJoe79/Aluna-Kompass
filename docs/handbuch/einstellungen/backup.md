# Backup

Ein Backup ist eine Datei mit allem, was Kompass weiß: Datenbank, Dateien,
Einstellungen. Kompass legt Backups im Hintergrund in einem eigenen
Verzeichnis ab, prüft jedes einzelne und spielt sie auf Wunsch wieder ein —
auch auf einer anderen Instanz, etwa um Test mit dem Stand von Prod zu füllen.

## Die Seite

Oben unter dem Titel steht in einem Satz, wann das letzte geprüfte Backup lief
und wann das nächste läuft — mit einem Haken, wenn alles gut ist. Ist etwas
schiefgegangen, nennt der Satz den letzten geprüften Stand, und darunter steht
eine Warnung mit Grund und Ausweg: ein gescheitertes Backup, ein nächtliches
Backup, das fehlt, ein nicht eingehängtes Backup-Verzeichnis oder knapper
Platz. Die Seite hat zwei Reiter, „Backups“ und „Einstellungen“.

## Backups erstellen

„Backup erstellen“ startet ein Backup von Hand. Es läuft im Hintergrund; die
Seite zeigt die Schritte mit Fortschritt, und Sie können sie währenddessen
verlassen. Solange ein Backup läuft, ruht der Knopf. Mit „Abbrechen“ endet ein
Lauf, ohne eine Zeile zu hinterlassen; im letzten Schritt geht das nicht mehr.
Scheitert ein Backup, das Sie gestartet haben, steht der Grund über der Liste
mit „Erneut starten“.

Ist der Zeitplan eingeschaltet, sichert sich Kompass jede Nacht selbst und hält
Tages-, Wochen- und Monatsstände vor; ältere räumt es nach festen Regeln auf.
Vor jedem Update mit Datenbankänderung entsteht beim Start ein Backup „vor
Update“. Ein Backup von Hand belegt einen eigenen Platz: Das nächste ersetzt
das vorige, sobald es geprüft ist. Jedes Backup wird nach dem Schreiben
vollständig geprüft.

## Die Liste

Die Liste zeigt je Backup Zeitpunkt, Art, Größe, Kompass-Version, wie lange es
bleibt („Bleibt“) und die Prüfung. Eine bestandene Prüfung ist der Normalfall
und bleibt leer; „Prüfung gescheitert“ steht mit Grund. „Bleibt“ sagt, wann das
Aufräumen die Zeile nimmt, etwa „als Wochenstand bis …“ oder „bis zum nächsten
von Hand“.

Gezeigt werden die Backups der letzten 7 Tage, alle von Hand und alle
festgehaltenen. Ältere fasst der Fuß der Liste zusammen; „Alle … anzeigen“
zeigt sie. Daneben steht, wie viel Platz die Backups belegen und wie viel frei
ist; wird es knapp, steht die Zeile in Warnfarbe.

Alle Aktionen an einem Backup stehen im Menü ⋯ der Zeile: „Einspielen …“,
„Herunterladen“, „Festhalten …“, „Erneut prüfen“, „Protokoll“ und „Löschen …“.
Was gerade nicht geht, bleibt sichtbar und nennt den Grund — etwa „Einspielen“
bei einem Backup, dessen Prüfung gescheitert ist, oder „Löschen“ beim neuesten
geprüften Backup, das als sicherer Stand bleibt.

## Festhalten

Ein Backup, das Sie behalten wollen, halten Sie fest: „Festhalten …“ fragt nach
einem kurzen Namen (optional, höchstens 60 Zeichen), etwa „Jahresabschluss
2025“. Der Name steht in der Liste unter dem Zeitpunkt. Ein festgehaltenes
Backup fällt aus jedem Aufräumen, bis Sie es mit „Freigeben“ wieder abgeben;
festgehalten sind höchstens drei. „Name ändern …“ ändert den Namen. Fiele ein
Backup beim Freigeben sofort aus dem Ring, fragt Kompass vorher nach.

## Herunterladen

„Herunterladen“ startet den Download im Browser; den Fortschritt zeigt der
Browser, und Sie können weiterarbeiten. Ein abgebrochener Download lässt sich
fortsetzen.

## Hochladen

„Datei hochladen …“ im Seitenkopf nimmt ein Kompass-Backup (`.tar`) an, etwa
von einer anderen Installation. Der Dialog zeigt, wie weit die Übertragung
ist und wie lange sie noch dauert; lassen Sie ihn offen, bis die Datei oben
ist. Danach ist die Datei geprüft und steht als „hochgeladen“ in der Liste.
Hochladen spielt noch nichts ein — das geht danach mit „Einspielen …“.

## Einspielen

Einspielen **ersetzt den gesamten Bestand** dieser Instanz — Nutzer,
Protokoll, Dokumente, alles. Der Dialog nennt, was verloren geht: die
Änderungen seit dem Zeitpunkt des Backups mit ihrer Zahl, auch die anderer
Personen. Stammt das Backup aus einer älteren Kompass-Fassung, bringt Kompass
den Stand beim Einspielen auf die laufende. Zur Bestätigung tippen Sie den
Namen der Umgebung ein und wählen „Einspielen“.

Bevor etwas ersetzt wird, legt Kompass ein Backup „vor Einspielen“ an — der
Weg zurück. Während des Einspielens sehen alle, auch Sie, eine Wartungsseite
mit den Schritten; sie lädt sich selbst nach. Danach sind alle Sitzungen
beendet: Mit „Anmelden“ melden Sie sich neu an. API-Tokens und
Backup-Einstellungen dieser Instanz bleiben erhalten. Die publizierte
Webseite, verschickte Mails und eingereichte Lastschriftdateien gehen nicht
zurück; wurde seit dem Stand des Backups publiziert, weist die Backup-Seite
Sie danach mit „Zum Publizieren“ darauf hin. Scheitert das Einspielen, legt
Kompass den vorigen Stand zurück, und es ist nichts verloren.

Der übliche Fall: Prod nach Test kopieren, um eine Änderung mit echten Daten
zu prüfen. Der umgekehrte Weg — Test nach Prod — ist die Ausnahme und
bedeutet, dass alles verloren geht, was in Prod seit dem Backup geschehen
ist.

## Einstellungen

Im Reiter „Einstellungen“ schalten Sie unter „Automatisch sichern“ das
nächtliche Backup ein und wählen die Uhrzeit. Unter „Aufheben“ legen Sie fest,
wie viele tägliche, wöchentliche und monatliche Backups bleiben; darunter
rechnet Kompass aus, wie viele Backups und wie viel Platz das ergibt.

Die „Frist“ bestimmt, ab wann die Kachel „Backup“ auf der
[Startseite](../startseite.md) das letzte geprüfte Backup als veraltet meldet —
Vorgabe 30 Tage. Ist der Zeitplan an, warnt sie zusätzlich, sobald ein
nächtliches Backup fehlt; ein Backup von Hand nach der Uhrzeit beendet die
Warnung für diesen Tag. Ist der Mailversand der Akte eingerichtet, bekommen
die Verantwortlichen bei Problemen eine Mail; sonst sind Fehler nur hier und
auf der Startseite sichtbar.

Backups erstellen und die Liste lesen darf ein Agent immer; einspielen nur, wenn Sie es unter
[Verwaltung → Agenten](agenten.md) mit „Darf ein Agent ein Backup einspielen?“ erlauben.

Legen Sie regelmäßig eine Kopie der Backups außerhalb des Geräts ab. Ein
Backup auf demselben Gerät schützt vor einem Fehler in Kompass, nicht vor
einem Ausfall des Geräts.

## Wer importieren darf

„Backup importieren“ ist das mächtigste Recht in Kompass. Einspielen ersetzt
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
