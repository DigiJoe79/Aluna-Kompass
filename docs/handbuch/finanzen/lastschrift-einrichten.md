# Lastschrift einrichten

Mit der SEPA-Basislastschrift zieht der Verein Mitgliedsbeiträge und Dauerspenden selbst ein. Dafür braucht er eine
Gläubiger-Identifikationsnummer der Deutschen Bundesbank, eine Lastschriftvereinbarung mit seiner Bank und ein Konto,
auf das eingezogen wird. Eingestellt wird das unter **Einrichtung → Finanzen → Lastschrift**.

## Was Sie eintragen

- **Lastschrift nutzen** schaltet Mandate, Zusagen mit Lastschrift und Einzüge ein. Ohne den Schalter zeigt die Seite
  **Finanzen → Lastschrift** nur den Weg hierher.
- **Gläubiger-Identifikationsnummer**: die Kennung von der Bundesbank, etwa `DE98ZZZ09999999999`. Kompass prüft Format
  und Prüfziffer; eine falsche Nummer wird am Feld abgelehnt.
- **Name des Gläubigers**: so steht der Verein im Mandat und in der Datei für die Bank. Leer gilt der Name des Vereins.
- **Konto für Einzüge**: ein Bankkonto mit IBAN. Leer gilt das Hauptkonto.
- **Vorabankündigung: Tage vor dem Einzug**: so viele Tage vor dem Einzug muss die Ankündigung beim Zahler sein
  (Vorgabe 14 nach SEPA-Regelwerk; kürzer nur, wenn mit den Zahlern vereinbart).
- **Bank: frühestens einreichen** und **Bank: spätestens einreichen**: wie viele Kalendertage vor dem Fälligkeitstag
  die Bank die Datei frühestens annimmt (Vorgabe 14) und wie viele Bankarbeitstage vorher sie spätestens dort sein muss
  (Vorgabe 2). Beides steht in der Lastschriftvereinbarung mit der Bank.
- **Sammelbuchung**: Die Bank schreibt einen Einzug als eine Summe gut. Sie legen das mit der Bank fest; Kompass ordnet
  beides zu, die Summe und die Einzelzeilen.
- **Mandatsreferenz**: Präfix und Stellen der fortlaufenden Nummer, Vorgabe `MND-000001`. Eine vergebene Referenz
  bleibt; ein neues Format gilt nur für neue Mandate.

Die beiden Fristen verwechselt man leicht: Die Vorabankündigung betrifft den Zahler und bestimmt, welche Fälligkeitstage
ein Posten haben kann. Die Fristen der Bank betreffen nur den Tag, an dem Sie die Datei einreichen — Kompass zeigt dieses
Fenster am Einzug und lehnt „Als eingereicht markieren“ außerhalb davon ab.

## Wo die Werte der Bank stehen

Fristen, Höchstbeträge und das Entgelt für eine Rücklastschrift legt jede Bank selbst fest. Sie stehen in der
**Vereinbarung über den Einzug von Forderungen durch SEPA-Lastschriften** (oft „Inkassovereinbarung“ oder
„Lastschriftvereinbarung“) und in den Sonderbedingungen bzw. im Preis- und Leistungsverzeichnis der Bank. Suchen Sie
dort nach „Einreichungsfrist“, „Vorlagefrist“ und „Rücklastschrift“. Kompass rechnet das Entgelt einer Rückgabe nicht
weiter; es wird als Bankgebühr gebucht.

## Wer darf was

Mandate, Zusagen und Einzüge bereitet vor, wer das Recht **Lastschrift vorbereiten** (`finance.directDebit`) hat. Das
Recht kommt an keine vorhandene Rolle von selbst; geben Sie es unter **Verwaltung → Rollen** der Rolle, die die Kasse
führt. Datei erzeugen, ein Mandat aktiv setzen und einen Einzug als eingereicht markieren darf ein Agent nur, wenn der
Verein es unter **Einrichtung → Finanzen** mit „Darf ein Agent festschreiben und Lastschriften bearbeiten?“ freigibt
(siehe [Finanzen einrichten](einrichten.md#darf-ein-agent-festschreiben-und-lastschriften-bearbeiten)); in der Vorgabe
ist das aus. Die Datei für die Bank gibt Kompass nie an einen Agenten heraus.
