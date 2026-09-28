# Nutzer und Rollen

Jede Person, die mit Kompass arbeitet, hat einen eigenen Zugang und eine oder
mehrere Rollen. Eine Rolle ist ein Bündel von Rechten, das Sie frei benennen
und zusammenstellen; die Rechte selbst sind fest. Wer ein Recht nicht hat,
sieht die Seite nicht — und jede Änderung an Nutzern und Rollen steht im
Änderungsprotokoll.

## Nutzer

„Nutzer anlegen“ fragt Name, E-Mail und Rollen und zeigt danach **einmalig**
ein Startpasswort — geben Sie es weiter, Kompass zeigt es nicht noch einmal.
Bis zur ersten Anmeldung steht der Nutzer auf „Erstlogin offen“. Das Menü je
Zeile: Rollen ändern, neues Startpasswort (wenn jemand seins vergessen hat),
deaktivieren.

Ein Nutzer wird **deaktiviert, nicht gelöscht**: Er kann sich nicht mehr
anmelden, aber alles, was er getan hat, bleibt mit seinem Namen im
Änderungsprotokoll. Den letzten Administrator lässt Kompass nicht
deaktivieren.

## Konto und Kontakt verknüpfen

Ein Nutzerkonto ist ein Zugang, ein Kontakt eine Person in der Adressliste. Oft ist beides derselbe Mensch — die Helferin, die sich anmeldet, steht auch als Kontakt im Verein. Mit der Verknüpfung weiß Kompass das. Fachmodule bauen darauf: Wer eine Auslage einreicht, soll sie nicht selbst freigeben können.

In der Nutzerverwaltung steht je Konto die Spalte „Kontakt“. „Verknüpfen“ öffnet die Kontaktauswahl (dafür brauchen Sie auch das Recht, Kontakte zu sehen); „Lösen“ beendet die Verknüpfung. Ein Konto hat höchstens einen Kontakt, ein Kontakt höchstens ein Konto.

**Der Verlauf bleibt.** Eine gelöste Verknüpfung wird nicht gelöscht, sondern beendet — mit Datum und dem Namen dessen, der sie gelöst hat. So lässt sich später sagen, wer wann mit wem verknüpft war.

**Das eigene Konto.** Ihr eigenes Konto dürfen Sie einmal selbst verknüpfen — sonst könnte ein Verein mit nur einem Verwalter es nie einrichten. Ändern oder lösen kann es danach nur eine zweite Person mit dem Recht, Nutzer zu verwalten.

Ein verknüpfter Kontakt lässt sich nicht löschen, solange die Verknüpfung besteht.

## Rollen

Eine Rolle hat einen Namen, eine Beschreibung und Rechte, gruppiert nach
Bereich: Verwaltung (Nutzer, Rollen, Einstellungen, Module), Rechenschaft
(Änderungsprotokoll, Aufbewahrung), Daten (Dokumente, Mediathek, Backup),
Wiedervorlagen und je Modul seine Rechte. Jedes Recht zeigt seinen
technischen Schlüssel — derselbe, den ein Assistent über MCP sieht.

Rollennamen sind Ihre Sache: Schatzmeisterin, Kassenprüfung, Schriftführung,
Beisitz. Die Rolle „Administration“ hat alle Rechte und ist gesperrt. Eine
Rolle wird nicht gelöscht; eine nicht mehr gebrauchte wird allen Nutzern
entzogen und bleibt für das Protokoll stehen.

## Niemand gibt mehr, als er hat

Wer Nutzer und Rollen verwaltet, ist dadurch noch nicht Administrator. Kompass
lässt niemanden ein Recht vergeben, das er selbst nicht hat — weder über eine
Rolle an einen Nutzer noch als neues Recht an eine Rolle. Und niemand verwaltet
ein Konto, das mehr Rechte hat als er selbst: Rollen ändern, neues
Startpasswort, Deaktivieren sind dort ausgegraut. Was eine Rolle schon hat,
darf man ihr trotzdem wegnehmen.

Die Rolle „Administration“ vergibt also nur, wer alle Rechte hat. Zwei
Administratoren können einander weiterhin bei allem helfen.

Ein Recht verdient beim Zusammenstellen besondere Vorsicht: **Backup
importieren** ersetzt den gesamten Bestand samt Änderungsprotokoll. Es gehört
nur zu Personen, denen Sie auch den Server anvertrauen würden — siehe
[Backup](backup.md#wer-importieren-darf).

## Rechte gelten überall

Ein Recht gilt für die Oberfläche und für MCP gleichermaßen — es gibt einen
Weg zu den Daten, und der prüft immer. Was jemand in der Schiene nicht sieht,
kann er auch über einen Assistenten nicht erreichen.
