# Sicherheit

Aluna Kompass verwaltet personenbezogene und steuerrelevante Daten eines
Vereins. Wer eine Schwachstelle findet, hilft allen, die das Werkzeug
einsetzen — danke dafür.

## Eine Sicherheitslücke melden

**Bitte nicht über ein öffentliches Issue.** Ein offenes Issue macht die Lücke
bekannt, bevor sie geschlossen ist, und trifft dann jede laufende Installation.

Der Weg ist GitHubs privater Meldekanal:

1. [Security-Seite des Projekts](https://github.com/DigiJoe79/Aluna-Kompass/security) öffnen
2. **Report a vulnerability** wählen
3. Beschreiben, was passiert und wie es sich nachvollziehen lässt

Die Meldung ist nur für dich und die Betreuer des Projekts sichtbar.

Hilfreich in einer Meldung: welche Fassung betroffen ist (die Version steht im
Fuß der Seitenleiste und unter `/api/health`), was ein Angreifer damit
erreichen kann, und welche Rechte oder welchen Zugang er dafür braucht.

## Was du erwarten kannst

Dies ist ein Projekt, das neben anderer Arbeit entsteht — feste Fristen wären
ein Versprechen, das niemand hält. Was gilt:

- **Eingangsbestätigung** innerhalb einer Woche.
- **Einschätzung**, ob und wie schwer die Lücke wiegt, innerhalb von zwei Wochen.
- **Rückmeldung**, sobald ein Fix steht oder wenn absehbar ist, dass es länger
  dauert.
- Auf Wunsch wirst du in der Veröffentlichung genannt; sag, unter welchem Namen.

Wir veröffentlichen eine Lücke erst, wenn ein Fix verfügbar ist, und nennen sie
dann in den Release Notes.

## Welche Fassungen gepflegt werden

Kompass wird als ein Container-Image ausgeliefert. Gepflegt wird die jeweils
neueste veröffentlichte Fassung. Ältere Fassungen bekommen keine Rückportierung
— wer eine gemeldete Lücke geschlossen haben will, aktualisiert das Image
(siehe `docs/handbuch/betrieb.md`).

## Was hier nicht hineingehört

- **Fehler ohne Sicherheitsbezug** gehören in ein normales Issue.
- **Schwachstellen in Abhängigkeiten** meldest du am besten direkt dort; wenn
  Kompass sie ausnutzbar macht, ist das hier trotzdem richtig.
- **Lücken in der Installation eines bestimmten Vereins** (offener Port,
  schwaches Passwort) sind Sache dieses Vereins, nicht des Projekts.

## Quellcode der mitgelieferten Fremdsoftware

Das Image enthält Software Dritter unter GPL und LGPL. Anfragen nach deren
Quellcode laufen über ein normales Issue, nicht über diesen Kanal — sie sind
nicht vertraulich. Die Aufstellung steht in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
