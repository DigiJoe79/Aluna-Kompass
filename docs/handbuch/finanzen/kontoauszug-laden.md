# Kontoauszug laden

Unter „Hochgeladene Auszüge“ lädt der Verein den Kontoauszug seiner Bank
oder seines Zahlungsdiensts als Datei hoch — Kompass liest ihn, erkennt, was
es schon kennt, und hält Zweifelsfälle zurück, statt sie zu erraten.

## Das Format: CAMT.053

Kompass liest Kontoauszüge im Format CAMT.053 — der europäische Standard,
den fast jedes Online-Banking als Download anbietet (oft „CAMT“, manchmal
unter „Kontoauszug (XML)“ oder ähnlich benannt). Wo die Datei im
Online-Banking zu finden ist, steht auf der Seite [Auszug bei der Bank
holen](auszug-bei-der-bank-holen.md).

Ein Konto trägt genau **ein** Auszugsformat. Beim ersten Laden setzt Kompass
es automatisch; ein späterer Wechsel verlangt eine ausdrückliche
Bestätigung, weil danach mehr Zweifelsfälle auftreten können.

## Laden

Auf der Seite „Hochgeladene Auszüge“ wählt man das Konto und zieht die Datei
auf die Ablagefläche — auch mehrere auf einmal. Mehrere Dateien laufen
**nacheinander**, jede mit ihrem eigenen Ergebnis: „42 neu, 3 bereits
vorhanden, 2 zurückgehalten“.

- **Neu** heißt: ein Kontoumsatz, den Kompass noch nicht kennt.
- **Bereits vorhanden** heißt: Kompass hat diesen Kontoumsatz schon aus einem
  früheren, nicht verworfenen Auszug — er wird nicht doppelt angelegt.
- **Zurückgehalten** heißt: Kompass ist sich nicht sicher, ob es sich um
  einen bereits bekannten Kontoumsatz handelt oder um einen neuen. Solche
  Kandidaten stehen als Gegenüberstellung „Im Auszug“ und „Bereits
  vorhanden“ auf derselben Seite; ein Mensch entscheidet mit „Dieselbe
  Zahlung — nicht übernehmen“ oder „Eigene Zahlung — übernehmen“.

Ein Auszug, dessen IBAN nicht zum gewählten Konto passt, wird abgelehnt —
mit dem Hinweis, ein anderes Konto zu wählen oder die IBAN am Konto
nachzutragen. Derselbe Auszug lässt sich nicht zweimal laden; wurde er
falsch geladen, hilft „Verwerfen“ weiter (siehe unten).

## Lücken zwischen zwei Auszügen

Passt der Anfangsbestand eines neu geladenen Auszugs nicht zum Endbestand
des vorigen, meldet Kompass eine Lücke: „Es fehlen Umsätze zwischen … und
…“. Das ist eine Warnung, keine Sperre — der Import gelingt trotzdem. Die
Reihenfolge, in der Auszüge geladen werden, ist Kompass gleich: Der
fehlende Auszug lässt sich jederzeit nachreichen.

## Auszug verwerfen

Ein falsch geladener Auszug lässt sich verwerfen — mit Ansage: Kompass zeigt
vorher in Zahlen, was passiert (wie viele Kontoumsätze und Entwürfe
verschwinden, wie viele Belege in der Akte bleiben), und verlangt eine
Notiz zum Grund. Eine bereits festgeschriebene Buchung sperrt das
Verwerfen; in diesem Fall zeigt Kompass den Weg, diese Buchung zuerst
zurückzunehmen. Der Auszug selbst bleibt danach als Tatsache stehen — mit
Prüfsumme und Zählern, aber ohne seine Kontoumsätze und ohne die
Originaldatei.

## Wenn ein KI-Agent Auszüge lädt

Ein KI-Agent darf Kontoauszüge laden, aber nie festschreiben. Das ist
bewusst so eingerichtet, weil das Laden reine Fleißarbeit ist — das
Festschreiben bleibt einem Menschen vorbehalten.

Wichtig ist die Kehrseite: Lädt ein Agent einen Auszug, laufen die
Bankdaten darin — Namen, IBAN, Verwendungszwecke — durch das Sprachmodell,
das den Agenten antreibt. Bei einem **Cloud-Modell** (einem Dienst außerhalb
der eigenen Infrastruktur) macht das den Anbieter zu einem Auftragsverarbeiter:
Der Verein braucht dafür einen **Auftragsverarbeitungsvertrag** mit dem
Anbieter und einen Eintrag im **Verarbeitungsverzeichnis** der
Datenschutz-Dokumentation. Ein **lokal betriebenes Modell** — auf eigener
Hardware, ohne dass Daten den Verein verlassen — vermeidet diesen Aufwand,
weil keine dritte Stelle die Daten verarbeitet.

Wer einen Agenten Kontoauszüge laden lässt, sollte diese Frage vorher
klären, nicht danach.
