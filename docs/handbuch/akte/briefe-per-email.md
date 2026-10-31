# Briefe per E-Mail

Ein festgeschriebener Brief kann als PDF-Anhang einer E-Mail an den Kontakt
hinausgehen. Das Dokument bleibt das PDF in der Akte; die Mail ist nur der
Umschlag. Den Versandvermerk setzt Kompass selbst, sobald der Mailserver die
Mail angenommen hat.

## Zustellweg

Jeder Kontakt hat unter „Kontakt bearbeiten“ den Abschnitt **Briefe**:
„Automatisch“ heißt per E-Mail, wenn eine E-Mail-Adresse hinterlegt ist,
sonst per Post; „Immer per Post“ gilt auch dann, wenn eine Adresse da ist.
„Zurzeit“ zeigt, was „Automatisch“ für diesen Kontakt ergibt. Genommen wird
der Hauptkontaktweg vom Typ E-Mail, sonst die erste E-Mail-Adresse. Hat eine
Person keine eigene und gehört sie zu einer Organisation, geht die Mail an
die Adresse der Organisation — Empfänger im Brief bleibt die Person.

## Senden

Die Karte **Versand** am Brief nennt den Zustellweg: „Noch nicht versandt.
… bekommt Briefe per E-Mail“ (oder „per Post“). „Per E-Mail senden …“
zeigt Empfänger, Betreff, den Begleittext, wie er hinausgeht, und den
Anhang. Hat der Kontakt keine Adresse oder will er Post, nennt der Dialog
den Grund und den Ausweg. Ist der E-Mail-Versand in der Installation
ausgeschaltet, sagt die Karte das, und der Knopf fehlt. Senden kann nur ein Mensch in Kompass, kein Agent — es sei denn, der Verein schaltet unter
[Verwaltung → Agenten](../einstellungen/agenten.md) „Darf ein Agent Dokumente per E-Mail senden?“ ein.

Die Mail geht im Hintergrund hinaus, höchstens so viele je Minute, wie unter
[Einstellungen › Akte › Versand](../einstellungen/akte-einrichten.md)
steht. Bis dahin steht „wird gesendet“; danach der Vermerk mit Zeit, Weg und
wer ausgelöst hat. Mehrere Sendungen eines Briefs stehen untereinander, die
neueste oben. In den Läufen (Beitragslauf, Mahnlauf, Serienlauf der
Zuwendungsbestätigungen) sendet „{n} per E-Mail senden“ alle Briefe der
Gruppe „Per E-Mail“; die übrigen kommen als ein PDF zum Drucken.

## Was „nicht zugestellt“ heißt

„Nicht zugestellt“ gibt es nur, wenn der Mailserver die Mail abgelehnt hat
— die Karte und der Ausgang nennen seinen Grund. Rückläufer, die später als
Mail im Vereinspostfach ankommen, sieht Kompass nicht: Es empfängt keine
Mails. „Erneut senden“ legt eine neue Sendung an die heutige Adresse an;
die alte bleibt „nicht zugestellt“ stehen. „E-Mail-Adresse korrigieren“
führt zum Kontakt. In den Läufen schickt „Per Post schicken“ (im Hinweis
unter den Gruppen oder im Menü ⋯ der Zeile) eine solche Zeile in die
Post-Gruppe, Grund „von Hand verschoben“; „Zurück zu E-Mail“ holt sie
zurück, solange sie keinen Versandvermerk trägt.

## Ausgang

Unter **Ausgang** in der Ordnerspalte der Akte stehen alle Sendungen, die
neueste zuerst, mit Zustand und Empfänger (ohne Adresse), filterbar nach
Zustand und Zeitraum. Die Startseite zählt „Nicht zugestellte E-Mails“.
Die Adresse einer Sendung wird 90 Tage nach dem Versand entfernt; der
Versandvermerk am Brief bleibt.

In einer Testinstallation geht jede Mail an eine Umleitung, nie an den
Kontakt; ohne Umleitung bleibt sie „gesperrt“ im Ausgang. Beides sagt die
Seite in einem Hinweis.
