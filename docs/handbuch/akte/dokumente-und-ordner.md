# Dokumente und Ordner

Die Akte ist die Post des Vereins: jeder Brief, der hinausgeht, und jedes
Schreiben, das hereinkommt, als PDF mit Nummer, Art, Datum und Absender oder
Empfänger. Links die Ordner, rechts die Liste; ein Klick öffnet das Dokument
mit allem, was dazugehört.

## Die Ordnerspalte

„Alle Dokumente“ zeigt die ganze Akte, „Eingang“ die eingegangene Post,
die noch keinen Ordner hat, darunter die Ordner mit ihrer Anzahl. Die Ordner
legen Sie unter [Einstellungen → Akte
einrichten](../einstellungen/akte-einrichten.md) an; ein Pfad wie
„Behörden/Finanzamt“ ergibt einen Unterordner. Die Spalte ist zugleich
Ablagefläche: Eine Datei vom Rechner oder eine Zeile aus der Liste auf einen
Ordner ziehen sortiert dorthin — siehe [Post ablegen](post-ablegen.md).

## Die Liste

Je Dokument Nummer, Betreff, Art, Richtung, Datum, Absender oder Empfänger.
Die Spaltenköpfe sortieren; die Sortierung steht in der Adresse, ein
Lesezeichen behält sie. Hinter dem Betreff stehen Markierungen: ein Punkt,
wenn der Volltext gelesen ist, „nicht versandt“ bei einem festgeschriebenen
Brief ohne Versandvermerk, und die nächste Wiedervorlage mit Datum —
überfällig in Warnfarbe.

Das Suchfeld sucht in Betreff, Nummer und, ab drei Zeichen, im Inhalt der
Dokumente ([Volltext](volltext.md)). Filter: Art, Richtung, Zeitraum,
„nicht versandt“, „mit offener Wiedervorlage“.

Dokumente geschützter Arten sehen Sie nur mit dem Recht ihres Bereichs; ein Ordner kann deshalb mehr enthalten, als Sie sehen, und lässt sich dann nicht löschen. Mehr unter [Schutzbereiche](../einstellungen/schutzbereiche.md).

## Nummern

Jedes festgeschriebene Dokument hat eine Nummer aus Präfix der Art, Jahr und
laufender Zahl: `BRF-2026-014` ist der vierzehnte Brief des Jahres.
Nummern werden **nie wiedervergeben** — ein stornierter Brief behält seine,
und der nächste bekommt die nächste. Die Lücke ist kein Fehler; sie ist der
Beleg, dass nichts verschwunden ist.

Bekommt ein Eingang nachträglich eine andere Art, zieht er eine neue Nummer;
die alte bleibt als „Früher: …“ am Dokument und bleibt auffindbar — siehe
[Post ablegen](post-ablegen.md#angaben-nachträglich-ändern).

## Das Dokument

Die Detailseite zeigt links die Vorschau des PDFs und rechts, was dazugehört:
die Angaben (Art, Betreff, Datum, Ordner — hier auch änderbar), der
[Versand](festschreiben-und-versand.md), die Wiedervorlagen, die
Aufbewahrung mit Frist und Grund, der Volltext, die Bezüge zu Kontakt, Tier
oder Projekt, die [Bezüge zu anderen Dokumenten](bezuege-und-wiedervorlage.md)
und unter der Vorschau das Notizjournal.

**Notizen** sind Arbeitsmaterial neben dem Dokument, nie Teil davon: „Frau
Sommer hat telefonisch nachgefragt“. Jede Notiz trägt Name und Zeit; sie
wird angefügt, nicht geändert. Löschen darf, wer sie geschrieben hat, oder
wer die Akte verwaltet.

## Was nicht gelöscht wird

Ein festgeschriebenes Dokument lässt sich nicht löschen — nur
[stornieren](festschreiben-und-versand.md). Löschen lässt sich ein Entwurf,
der nie festgeschrieben wurde, und auch das steht im Änderungsprotokoll.

## Ordner und Jahrgänge als Bündel

Für die Kassenprüfung, den Steuerberater oder das eigene Archiv lässt sich ein Teil der Akte als ZIP-Datei herunterladen: über der Dokumentliste „Bündel exportieren“, dann den gewählten Ordner (samt Unterordnern) oder einen Jahrgang — das Jahr des Dokumentdatums. Sie brauchen dafür das Recht „Dokumente exportieren“.

Im Bündel liegen die PDFs unter ihrer Nummer, ein **Inhaltsverzeichnis als PDF** und dasselbe als **CSV** mit Nummer, Datum, Art, Betreff, Prüfsumme (SHA-256) und Status.

- **Jede Datei wird vor dem Einpacken geprüft.** Passt eine nicht mehr zu ihrer Prüfsumme, liegt sie nicht bei; im Verzeichnis steht „Datei verändert“.
- **Stornierte Dokumente** liegen bei und sind als storniert vermerkt.
- **Was Sie nicht lesen dürfen**, steht nur mit seiner Nummer im Verzeichnis („geschützt“ oder „kein Zugriff“) — so sehen Sie, dass das Bündel nicht vollständig ist.
- **Entwürfe** sind nie dabei.

Ein Bündel fasst höchstens 500 Dokumente und 500 MB; darüber nennt Kompass die Zahl und bittet um einen Unterordner oder ein einzelnes Jahr. Das Bündel wird nicht in der Akte abgelegt. Im Änderungsprotokoll steht, wer wann welche Nummern gezogen hat.
