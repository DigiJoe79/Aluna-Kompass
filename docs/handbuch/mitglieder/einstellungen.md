# Einstellungen Mitglieder

Unter **System → Mitglieder** richten Sie ein, was für alle Mitglieder gilt. Wer Beiträge verwaltet, darf es ändern.

## Mitgliedsarten

Die Arten der Mitgliedschaft mit Stimmrecht und Beitragsfreiheit. Eine Art, an der schon eine Mitgliedschaft stand,
deaktivieren Sie statt sie zu löschen; sie bleibt dann in der Liste, gedämpft.

## Beitragsordnung

Die Beitragsordnung hat Stände: Jeder gilt ab seinem Tag bis zum nächsten und nennt je Art Betrag, Rhythmus und, ob
der Betrag ein Mindestbetrag ist. Oben steht der geltende Stand, ein künftiger mit der Marke „kommt“, frühere sind
eingeklappt. **Neuen Stand anlegen …** belegt die Eingabe mit dem letzten Stand vor; tragen Sie den Tag ein, ab dem er
gilt, und den Tag des Beschlusses.

Ein Stand, nach dem schon Beiträge angelegt sind, bleibt fest: Tag und Beträge lassen sich nicht mehr ändern, den
Beschlusstag tragen Sie über **Bearbeiten …** nach. Für eine Änderung der Beträge legen Sie einen neuen Stand an.

Den Beschluss selbst hängen Sie als Dokument der Akte an. Mit **Gremien** kann ein Stand auf den Beschluss dort
verweisen (über einen Agenten: `members_fee_schedule_save` mit `resolutionId`); er steht dann mit Link neben dem
Beschlusstag.

## Mahnstufen

Je Stufe ein Brief, mit Name, Frist und Textbaustein. Die erste Stufe zählt ab der Fälligkeit, jede weitere ab dem
Versand der vorigen. Wird ein Beitrag erst nach seiner Fälligkeit angelegt — etwa bei einer rückwirkenden Aufnahme —,
zählt die erste Stufe ab dem Tag der Anlage plus Zahlungsziel: So lange hat das Mitglied laut Brief Zeit. Den Wortlaut jeder Stufe — etwa einen Hinweis, was die Satzung nach der letzten Mahnung
vorsieht — pflegen Sie im Textbaustein der Akte; Kompass schreibt selbst nichts dergleichen in den Brief.

Die Stufe gilt je Beitrag, nicht je Mitglied. Ein neuer Beitrag beginnt mit der ersten Stufe, auch wenn ein älterer schon
bei der letzten steht; der Mahnlauf schreibt dann je Stufe einen eigenen Brief mit genau ihren Beiträgen. Nach einer
Stundung beginnt die Zählung für diesen Beitrag neu: Mahnungen vor der neuen Fälligkeit zählen nicht mehr.

## Nummern und Fristen

- **Nächste Nummer**: für Gründungsmitglieder mit vorhandenen Nummern. Nur nach vorn; eine Nummer wird nie zweimal
  vergeben.
- **Kündigungsfrist**: Monate und Stichtag (Jahres-, Quartals- oder Monatsende). Danach schlägt Kompass das Ende
  eines Austritts vor.
- **Zahlungsziel in Briefen**: wie viele Tage eine Mahnung bis zur Zahlung lässt. Ist der erste Beitrag bei der
  Aufnahme schon fällig, nennt auch die Aufnahmebestätigung diese Frist ab dem Briefdatum.
- **Beitrag im Eintrittsjahr**: voll, anteilig je Monat oder erst ab dem Folgejahr.

## Agent

Unter [Verwaltung → Agenten](../einstellungen/agenten.md) steht der Schalter **„Darf ein Agent Mitglieder aufnehmen,
Läufe starten und Briefe ausstellen?“**. Ausgeschaltet (Vorgabe) gehen Aufnahme, Ablehnung, Beitrags- und Mahnlauf,
Briefe, Stundung und Erlass nur hier in Kompass; ein Agent darf Anträge erfassen, Daten pflegen und Vorschauen lesen.
