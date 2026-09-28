# Dokumentvorlagen

Briefe und andere Dokumente entstehen aus Basis-Vorlagen: Briefbogen, Rand,
Schrift, Fußzeile. Kompass bringt Vorlagen mit; der Verein kann eigene daneben
legen. Hier sehen Sie, welche es gibt, und legen je Dokumentart fest, welche
gilt.

## Basis-Vorlagen

Eine Basis-Vorlage bestimmt, wie ein Dokument aussieht — der Briefbogen mit
Logo, Absender und Fußzeile, die Ränder, die Schrift. Kompass liefert je
Dokumentart eine Vorgabe mit: Brief, Briefbogen, Export des
Änderungsprotokolls. Der Verein kann eigene Vorlagen in das Verzeichnis
`/data/core/document-templates` legen (siehe [Betrieb](../betrieb.md)); sie
erscheinen hier.

Die Liste zeigt je Vorlage, ob sie bereit oder fehlerhaft ist. Eine
fehlerhafte Vorlage — ein Tippfehler in der Datei — wird nicht benutzt;
Kompass fällt auf die Vorgabe zurück und sagt es hier.

## Je Dokumentart eine Basis

Darunter steht je Dokumentart (Brief, Briefbogen, Export des
Änderungsprotokolls), welche Basis-Vorlage gilt: „Vorgabe der Vorlage“ oder
eine eigene. Prüfen Sie eine neue Basis, indem Sie einen Entwurf in der
[Akte](../akte/brief-schreiben.md) anlegen — die Vorschau dort zeigt sie mit
den echten Vereinsdaten, bevor ein Brief darauf festgeschrieben wird.

## Eigene Basis fehlt

Führt der Verein eigene Basis-Vorlagen, sollte er alle führen, die seine
Module nutzen — sonst erscheint etwa die Zuwendungsbestätigung im
mitgelieferten Standardkopf, während Briefe den Vereinskopf tragen. Kompass
meldet deshalb oben auf dieser Seite jede genutzte Basis, die die
Installation nicht selbst führt; die Checkliste der Finanzen nennt denselben
Punkt als optionalen Schritt. Ohne eigene Basen gibt es keinen Hinweis — dann
sieht alles einheitlich aus.

| Dokument | Modul | Basis |
| --- | --- | --- |
| Brief, Inhaltsverzeichnis einer Mappe | Akte | `a4-mit-briefkopf` |
| Zuwendungsbestätigung (Geld, Sachzuwendung, Sammelbestätigung), vereinfachter Zuwendungsnachweis | Finanzen | `a4-formular` |
| Verzichtserklärung (Aufwandsspende) | Finanzen | `a4-formular` |
| Kassenzählung | Finanzen | `a4-mit-briefkopf` |

Die Basis je Dokumentart lässt sich oben umstellen; die Tabelle nennt die
Vorgabe.

## Was hier nicht steht

Die Dokumente selbst — die Briefe, die Post — liegen in der
[Akte](../akte/dokumente-und-ordner.md). Diese Seite ist die Werkstatt
dahinter.
