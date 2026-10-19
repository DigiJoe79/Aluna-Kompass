# Rücklastschrift

Gibt die Bank des Zahlers eine Lastschrift zurück — Konto erloschen, keine Deckung, Widerspruch —, bucht Ihre Bank den
Betrag zurück, oft mit einem Entgelt. Kompass erkennt die Rückgabe im Kontoauszug und führt Sie in zwei Schritten
durch.

## In der Arbeitsliste

Der Umsatz trägt einen Vorschlag: „Rückgabe zum Einzug zum …“, woran Kompass ihn erkennt (End-to-End-Referenz oder
Mandatsreferenz und Betrag) und den Grund der Bank im Klartext. Er hat zwei Zeilen: Die Rate wird „zurückgegeben“ — eine
Spende ist keine Forderung —, ein Beitrag wird wieder offen. Das Entgelt geht auf Bankgebühren und wird nicht
weiterberechnet. Erkennt Kompass die Rückgabe nicht, bleibt der Umsatz „unsicher“.

Bucht die Bank das Entgelt als eigenen Umsatz („Entgelt Rücklastschrift“), schlägt Kompass ihn als Bankgebühr vor und
nennt den Einzug, aus dem die Rückgaben des Tages stammen. Gibt es an diesem Tag genau eine Rückgabe, steht das Entgelt
nach dem Festschreiben auch an ihr. Bei mehreren Rückgaben am selben Tag ordnet Kompass es keiner zu; es bleibt eine
eigene Buchung.

Mit dem Festschreiben steht am Einzug, am Mandat und an der Zusage „Rückgabe zu klären“.

## Rückgabe klären

Am Einzug (oder an der Rate der Zusage) öffnet **Rückgabe klären …** einen Dialog mit drei Wegen:

- **Mit dem nächsten Einzug erneut einziehen**: Der Posten kommt in die nächste Vorschau. Er braucht eine neue
  Ankündigung, die die Vorschau anbietet.
- **Zur Überweisung auffordern**: Der Posten wird nicht mehr eingezogen; ein Beitrag bleibt offen, eine Rate wird wieder
  erwartet.
- **Nicht mehr einfordern**: Die Rate gilt als ausgelassen, ein Beitrag wird erlassen.

Ist der Beitrag inzwischen anders bezahlt, etwa per Überweisung, hebt die Rückgabe die doppelte Zahlung auf. Der Dialog
bietet dann **War schon bezahlt – nichts zu tun** an (und weiter „Zur Überweisung auffordern“); erneut einziehen oder
erlassen geht für einen bezahlten Beitrag nicht.

Dazu der Haken **Mandat beenden**. Kompass setzt ihn vor, wenn der Grund der Bank dafür spricht (Konto erloschen, kein
Mandat, Widerspruch des Zahlers) — fragen Sie dann nach, bevor erneut eingezogen wird. Kompass zieht nie von selbst
erneut ein.
