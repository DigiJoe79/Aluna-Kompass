# Briefe formatieren

Das Feld **Text** eines Briefentwurfs nimmt gewöhnlichen Fließtext. Ein paar
Zeichen geben dem Text zusätzlich Form: eine Raute macht eine Überschrift,
Sternchen machen fett. Diese Schreibweise heißt Markdown.

Sie müssen nichts davon benutzen. Ein Brief aus reinen Absätzen wird genauso
sauber gesetzt. Und was auf dieser Seite nicht steht, kann der Brief auch nicht —
der Abschnitt [Was nicht im Brief ankommt](#was-nicht-im-brief-ankommt) sagt, was
beim Erzeugen des PDFs stillschweigend wegfällt.

## Absätze und Zeilenumbrüche

Eine **Leerzeile** trennt zwei Absätze. Ein einfacher Zeilenwechsel trennt nichts:
Der Text läuft weiter, als stünde er in einer Zeile. Das ist praktisch, wenn Sie
lange Sätze beim Tippen umbrechen wollen.

Brauchen Sie den Umbruch wirklich — bei einer Anschrift etwa —, setzen Sie **zwei
Leerzeichen** ans Zeilenende.

## Auszeichnungen im Satz

| Sie schreiben | Im Brief steht |
|---|---|
| `**wichtig**` | **wichtig** |
| `_betont_` | _betont_ |
| `**_beides zugleich_**` | **_beides zugleich_** |
| `~~gestrichen~~` | ~~gestrichen~~ |
| `` `Wert` `` | ein Wert in Schreibmaschinenschrift |

## Überschriften

Eine Raute je Ebene, danach ein Leerzeichen:

```
## Tagesordnung
### Beiträge im Überblick
```

Für einen Brief reichen zwei Ebenen. Es gibt bis zu sechs, aber ab der dritten
unterscheiden sie sich kaum noch sichtbar — wer sie braucht, gliedert vermutlich
zu tief.

## Listen

Ein Strich für Aufzählungen, eine Zahl mit Punkt für Nummerierungen:

```
- Ihren Mitgliedsausweis
- Unterlagen zur Abstimmung

1. Begrüßung
2. Bericht des Vorstands
```

Unterpunkte rücken Sie um **zwei Leerzeichen** ein:

```
- Unterlagen zur Abstimmung
  - den zugesandten Antrag
  - eine etwaige Vollmacht
```

Eine Nummerierung beginnt im Brief immer bei 1, auch wenn Sie mit `5.` anfangen.

## Hinweiskasten

Eine Zeile, die mit `>` beginnt, wird im Brief zu einem abgesetzten Kasten:

```
> Wer verhindert ist, kann sich vertreten lassen.
```

## Trennlinie

Drei Striche allein in einer Zeile ziehen eine dünne Linie quer über die Seite:

```
---
```

## Tabellen

Senkrechte Striche trennen die Spalten, die zweite Zeile trennt den Kopf vom
Rumpf. Ein Doppelpunkt in dieser zweiten Zeile bestimmt die Ausrichtung: links,
rechts oder — auf beiden Seiten — mittig.

```
| Beitragsart | Betrag | Fällig |
|:------------|-------:|:------:|
| Erwachsene | 60,00 € | 01.03. |
| Ermäßigt | 30,00 € | 01.03. |
```

Die Spalten müssen nicht bündig untereinander stehen, das macht nur das Tippen
angenehmer. Geht eine Tabelle über den Seitenumbruch, wiederholt sich die
Kopfzeile oben auf der nächsten Seite.

## Verweise

```
[unsere Satzung](https://example.org/satzung)
[E-Mail an den Vorstand](mailto:vorstand@example.org)
[Rückruf](tel:+4930123456)
```

Eine Adresse, die Sie einfach so hinschreiben, wird ebenfalls zum Verweis. Im
gedruckten Brief sieht man von alldem nur den Text — anklickbar ist er im PDF.

Andere Arten von Adressen werden **nicht** verknüpft; dort bleibt nur der Text
stehen. Das ist Absicht: Ein Brief soll niemanden irgendwohin schicken, wo er
nicht hinwollte.

## Seitenumbruch

Eine Zeile, in der nur das steht, beginnt eine neue Seite:

```
::seitenumbruch
```

Steht er am Ende des Textes, passiert nichts — es entsteht keine leere Seite.
Zwei Umbrüche hintereinander ergeben genau einen.

## Karten nebeneinander

Für Angaben, die nebeneinander gehören — Ort und Zeit etwa — gibt es ein
zweispaltiges Raster. Jede Überschrift mit drei Rauten beginnt darin eine neue
Karte:

```
:::karten
### Ort

Vereinsheim am Mühlenweg 4
12345 Musterstadt

### Zeit

Samstag, 14. März 2026
um 15:00 Uhr
:::
```

## Sonderzeichen

Sie können tippen, was Sie wollen. Rauten, Dollarzeichen, Klammern, Klammeraffen,
Schrägstriche und Backslashes kommen genau so im Brief an. Auch Uhrzeiten wie
`15:00` und Verhältnisse wie `2:1` bleiben unangetastet.

Eine Zeile, die mit `=`, `-`, `+` oder einer Zahl mit Punkt beginnt, deuten wir
als Text und nicht als Überschrift oder Liste, solange Sie sie nicht als solche
gemeint haben — wollen Sie eine Liste, setzen Sie wie oben beschrieben `- ` davor.

## Was nicht im Brief ankommt

Diese Dinge dürfen Sie schreiben, sie erscheinen aber **nicht** im PDF, und es
gibt keine Warnung:

- **Bilder** (`![Beschriftung](datei.png)`) — der Briefkopf trägt das Logo, weitere
  Bilder kennt der Brief nicht.
- **Fußnoten** (`[^1]`)
- **Abhakkästchen** (`- [ ] offen`) — daraus wird ein gewöhnlicher Aufzählungspunkt.
- **HTML** jeder Art (`<b>`, `<div>`)

Wenn Sie eines davon brauchen, sagen Sie Bescheid — das ist eine Lücke, keine
Entscheidung für die Ewigkeit.

## Auf der Webseite gilt etwas anderes

Texte für die Vereinswebseite werden mit derselben Schreibweise verfasst, aber
anders gesetzt. Dort **funktionieren Bilder**, dafür bedeutet ein Seitenumbruch
nichts — es gibt keine Seiten. Verlassen Sie sich für Webseitentexte also nicht
Zeile für Zeile auf diese Seite.

## Ein vollständiges Beispiel

Der folgende Brief benutzt alles, was oben steht. Er ist zugleich ein Testfall:
Bei jedem Testlauf wird genau dieser Text durch die Briefpipeline geschickt und
muss ein PDF ergeben. Wenn Sie ihn ändern, ändern Sie einen Test.

<!-- beispielbrief -->

````markdown
# Einladung zur Mitgliederversammlung

Sehr geehrte Mitglieder,

hiermit laden wir Sie herzlich zur ordentlichen Mitgliederversammlung ein. Diese Zeile
endet mit einem harten Umbruch,  
und hier geht es in der nächsten Zeile weiter.

## Tagesordnung

1. Begrüßung und Feststellung der Beschlussfähigkeit
2. Bericht des Vorstands
   1. Rückblick auf das vergangene Jahr
   2. Ausblick
3. Kassenbericht und Entlastung

## Was Sie mitbringen sollten

- Ihren Mitgliedsausweis
- Unterlagen zur Abstimmung
  - den zugesandten Antrag
  - eine etwaige **Vollmacht**
- gute Laune

> Wer verhindert ist, kann sich vertreten lassen. Eine Vollmacht in Textform genügt.

### Beiträge im Überblick

| Beitragsart | Betrag | Fällig |
|:------------|-------:|:------:|
| Erwachsene | 60,00 € | 01.03. |
| Ermäßigt | 30,00 € | 01.03. |
| Fördernd | ab 120,00 € | jährlich |

---

## Formatierungen, die der Brief beherrscht

Text kann **fett**, _kursiv_, **_beides zugleich_** oder ~~gestrichen~~ sein.
Ein Wert steht als `Code` mitten im Satz.

```
beitrag = 60,00 EUR
faellig = 01.03.
```

Verweise: [unsere Satzung](https://example.org/satzung), [E-Mail an den Vorstand](mailto:vorstand@example.org),
[Rückruf](tel:+4930123456) und einfach so https://example.org

:::karten
### Ort

Vereinsheim am Mühlenweg 4
12345 Musterstadt

### Zeit

Samstag, 14. März 2026
um 15:00 Uhr
:::

::seitenumbruch

## Zeichen, die unverändert ankommen sollen

Sonderzeichen aus Typst: #panic("x"), [Klammern], $x^2$, @label, ~ und der Pfad C:\temp.

= Diese Zeile ist eine Überschrift, keine Überschrift.

\- Dieser Gedankenstrich ist kein Listenpunkt.

und/oder // dieser Text darf nicht verschwinden

Wir schreiben
2026. Ein gutes Jahr für den Verein.

Mit freundlichen Grüßen

Der Vorstand
````
