# Publizieren

Publizieren baut die Seite aus Template und Inhalten und lädt die fertigen
Dateien auf den Webspace des Vereins. Die Seite führt in zwei Schritten: erst
die Vorschau, die alle Inhalte prüft und zeigt, was sich ändert, dann das
Publizieren genau dieses Stands. Publiziert wird nur aus der Prod-Instanz und
aus der Test-Instanz auf Staging. Ist noch kein Template eingelesen, zeigt
die Seite einen Hinweis mit Link in die Einstellungen.

## Ziel

Oben steht, wohin diese Instanz publiziert: **Produktion** — die
Live-Webseite —, **Test** — eine Kopie der Seite unter einer Adresse, die
nicht im Suchindex steht — oder **Entwicklung**, von wo nicht publiziert
wird. Daneben die öffentliche Adresse als Link.

## Der Ablauf in zwei Schritten

Die Karte darunter zeigt immer genau einen Zustand und hat höchstens einen
Hauptknopf.

1. **Vorschau bauen.** Die Vorschau beginnt mit „Inhalte prüfen“ — alle
   Inhalte auf Sperrwörter, Übersetzungslücken, veraltete Verweise und offene
   Prüfungen — und baut dann die Seite so, wie sie publiziert würde. „Vorschau
   öffnen“ zeigt sie im Browser, im eigenen Netz, ohne dass etwas den Webspace
   erreicht.
2. **Publizieren.** Der Knopf „Jetzt publizieren“ (auf der Test-Instanz „Auf
   Test publizieren“) fragt noch einmal nach und startet den Publish.

Hat sich seit der Vorschau nichts geändert, was sie vom Stand der Webseite
unterscheidet, steht dort „Alles auf dem neuesten Stand“; ein stiller Link
„Trotzdem publizieren“ bleibt für den Fall, dass Sie es erzwingen wollen.

## Kurzbilanz und Hinweise

Eine fertige Vorschau fasst sich in einer Zeile zusammen: „12 geändert · 3
neu · 0 entfallen“ — Dateien gegenüber dem letzten Publish. Darunter stehen
die **Hinweise**, wenn es welche gibt:

- **Übersetzungslücken** — Felder, die in einer eingerichteten Sprache leer
  sind. Die Seite erscheint, aber an dieser Stelle in der Leitsprache oder
  leer, je nach Template.
- **Veraltete Verweise** — eine Variable zeigt auf einen Datensatz, der nicht
  mehr veröffentlicht ist. Das Feld wird leer ausgeliefert, das Template
  nimmt seinen Vorschlag.
- **Noch zu prüfen** — veröffentlichte Einträge, die seit ihrer letzten
  Änderung kein Mensch geprüft hat, heute die [Tierprofile](../tiere.md), die
  ein Agent über MCP geändert hat. Jeder Eintrag ist ein Link ins Profil.
- **Bilder nicht lesbar** — Dateien, die sich nicht verarbeiten ließen; der
  Bau ging ohne sie weiter.

Hinweise halten den Publish nicht auf — wer publiziert, übernimmt sie. Die
Einzelheiten (die Dateien der Änderungen und die Listen zu den Hinweisen)
klappen Sie unter „Einzelheiten“ auf; was leer ist, steht in einem Satz
zusammengefasst.

## Gesperrt

Ein **gesperrter Begriff** dagegen hält den Publish an. Die Karte zeigt dann
„Publizieren gesperrt“ und nennt den Begriff, die Stelle und einen Ausschnitt
mit dem markierten Treffer, höchstens drei, der Rest klappt auf. Ein Link
führt dorthin, wo Sie es ändern: bei einer Variablen auf die Seite
„Variablen“, bei einem Eintrag einer Sammlung in seine Maske. Treffer in
Tier- und Projektsichten und in Dateinamen haben keinen Link, weil sie in
einem anderen Bereich gepflegt werden. Wer die Webseite verwalten darf,
findet außerdem den Weg zur Liste der gesperrten Begriffe unter Einstellungen
→ Webseite → Gesperrte Begriffe (siehe
[Webseite einrichten](../einstellungen/webseite-einrichten.md)). Nach der
Korrektur bauen Sie die Vorschau neu.

## Bestätigen

Der Dialog gleicht beim Öffnen den Stand der Inhalte mit der Vorschau ab; das
dauert Sekunden und kopiert keine Bilder. Er hat höchstens zwei Knöpfe:
„Abbrechen“ und „Jetzt publizieren“. Hat sich der Inhalt seit der Vorschau
geändert, steht dort „Vorschau nicht mehr aktuell“ und statt „Jetzt
publizieren“ der Knopf „Vorschau neu bauen“. Der Dialog schließt, sobald ein
Lauf startet; den Fortschritt sehen Sie in der Karte und oben in der
Kopfzeile.

Publiziert wird der Stand der gezeigten Vorschau. Die Übertragung legt alle
Dateien erst in einem Zwischenverzeichnis ab und tauscht sie am Ende auf
einmal um — ein Abbruch mittendrin lässt keine halb alte, halb neue Seite
stehen. Der Publish steht mit Datum, Prüfsumme und Ergebnis im
Änderungsprotokoll. Kompass verweigert ihn auch, wenn das Template im
Verzeichnis geändert, aber nicht neu [eingelesen](template-einlesen.md)
wurde, oder wenn das Template ein Modul braucht, das unter Einstellungen →
Module ausgeschaltet ist.

## Laufanzeige und Abbrechen

Vorschau und Publish bauen die Seite; nach vielen neuen Bildern kann das
Minuten dauern. Sie laufen deshalb im Hintergrund, und Sie dürfen die Seite
verlassen oder neu laden. Es läuft immer nur einer; solange einer läuft, sind
die Startknöpfe gesperrt.

- **Oben auf jeder Seite** steht, was läuft: die Art, der Schritt und ein
  Zähler in Worten, etwa „Vorschau · Bildvarianten 342 von 1.533“ oder
  „Publizieren · Übertragen 38 von 61“. Das gilt auch, wenn der Lauf
  über MCP gestartet wurde. Ein Klick führt hierher.
- **Die Laufkarte** zeigt alle Schritte mit Zähler und Stand („wartet“,
  „läuft“, „fertig“), die Zeit seit dem Start und wer ihn gestartet hat; ein
  Lauf über MCP trägt die Marke „MCP“, den Namen des API-Tokens und die
  Person, für die er läuft („MCP · Hundeblicke-Sync · für Jana Weber“).
- **Abbrechen** fragt nach und beendet den Lauf im nächsten Schritt, und zwar
  nur hier, auf der Laufkarte. Während der Übertragung eines Publish geht das
  nicht mehr; der Knopf nennt dann den Grund.
- **Die letzte Vorschau** bleibt nach dem Neuladen stehen, auch wenn sie über
  MCP gebaut wurde. Hat sich der Inhalt seither geändert, heißt der
  Zustand „Vorschau nicht mehr aktuell“. Ein gelungener Publish verbraucht
  die Vorschau: Nach dem Neuladen beginnt die Seite wieder mit „Noch keine
  Vorschau“.

## Wenn ein Lauf endet

Die Karte nennt, ob sich die Webseite verändert hat:

- **Publiziert** — die Webseite zeigt jetzt diesen Stand; ein Link öffnet sie.
- **Publizieren gescheitert** — mit dem Grund (Anmeldung abgelehnt, Webserver
  nicht erreichbar, kein Platz mehr, Seite nicht baubar …) und der Auskunft,
  ob nichts oder nur ein Teil übertragen wurde. „Erneut publizieren“ ist
  möglich, solange die Vorschau noch zum Inhalt passt, sonst „Vorschau neu
  bauen“.
- **Abgebrochen, Zeitlimit erreicht, Unterbrochen** (etwa durch einen Neustart
  von Kompass) — ohne Rot, mit dem Schritt, in dem der Lauf stand, und
  „Erneut starten“. Beim Zeitlimit steht dabei, ob die Gesamtdauer oder der
  Stillstand des Zählers die Grenze war. Was schon gebaut war, bleibt im
  Cache; ein neuer Start macht dort weiter. „Protokoll ansehen“ öffnet das
  Protokoll des Laufs (nicht nach einem Abbruch durch Sie).

## Historie

Darunter stehen die letzten Publishes mit Zeitpunkt, Ergebnis, Änderungen und
wer ihn ausgelöst hat — bei einem Lauf über MCP mit der Marke „MCP“, dem
Namen des API-Tokens und der Person, ein Lauf, den ein Neustart beendete,
als „System (Neustart)“; das Protokoll öffnet in einem Dialog und lädt erst
dann.

## MCP

Ein Assistent startet die Läufe über `site_preview_build`,
`site_deploy_check` und `site_publish` und bekommt sofort eine Kennung
(`runId`) zurück. Das Ergebnis liest er mit `site_job_result` und der Art des
Laufs (`preview`, `deployCheck`, `publish`), bis dort derselbe `runId` als
letzter Lauf steht. Die Antwort ist gekürzt: Zahlen, die ersten 20 Pfade je
Liste und das Ende des Protokolls; `paths: 'all'` und `log: 'full'` liefern
alles. `site_export_check` prüft die Inhalte, ohne zu bauen, und ist jetzt in
Sekunden fertig; sein `contentHash` ist der, den eine Vorschau meldet.
`site_job_cancel` bricht den laufenden Lauf ab, `site_publish_get` liest einen
Eintrag der Historie mit Dateiliste und Protokoll. `site_publish` verlangt den
`expectedContentHash` der Vorschau, die der Assistent geprüft hat.

Den Verbindungstest zum Webspace finden Sie unter Einstellungen → Webseite →
Verbindung ([Webseite einrichten](../einstellungen/webseite-einrichten.md));
auf dieser Seite gibt es ihn nicht.
