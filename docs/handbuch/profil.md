# Profil

Ihr eigener Zugang: Passwort ändern und API-Tokens verwalten. Ein Token
verbindet einen KI-Assistenten über MCP mit Kompass — er kann dann dasselbe
wie Sie, mit denselben Rechten, und jede Aktion steht unter Ihrem Namen im
Änderungsprotokoll. Ein Token wird nur einmal angezeigt.

## Passwort ändern

Aktuelles Passwort, neues Passwort zweimal, mindestens zwölf Zeichen. Danach
sind alle anderen Sitzungen abgemeldet; API-Tokens bleiben gültig. Name und
E-Mail ändert die Verwaltung unter Einstellungen → Nutzer, nicht Sie selbst
— beides steht in Protokolleinträgen, die sich nicht ändern.

## API-Tokens und MCP

MCP ist die Schnittstelle, über die ein KI-Assistent — etwa Claude — mit
Kompass arbeitet: Kontakte anlegen, Post einsortieren, Übersetzungen
vorschlagen, Fragen an die Akte stellen. Ein Token ist der Schlüssel dafür.

„Token erstellen“ fragt einen Namen („Buchhaltung Skript“, „Claude am
Laptop“) und zeigt das Token **einmal**. Kopieren Sie es sofort; Kompass
speichert nur einen Prüfwert und kann es nicht noch einmal zeigen. Die Liste
zeigt je Token Name, Erstellung und letzte Nutzung.

Der Assistent bekommt die Adresse `http://<nas>:3000/mcp` und das Token als
Bearer-Token. Er hat dann genau Ihre Rechte — nicht mehr — und jeder Vorgang
steht im Änderungsprotokoll mit Kanal „MCP“ und Ihrem Namen. Er bekommt
Angaben und Volltext, nie die Dateien selbst.

„Widerrufen“ sperrt ein Token sofort; der Eintrag bleibt mit dem Datum
stehen. Widerrufen Sie ein Token, sobald das Gerät, auf dem es lag, nicht
mehr Ihres ist.
