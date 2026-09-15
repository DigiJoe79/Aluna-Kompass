# Mitarbeiten

Schön, dass du hier bist. Aluna Kompass ist ein Werkzeug für gemeinnützige
Vereine, und es lebt davon, dass Leute es benutzen und sagen, was fehlt.

## Der kleinste Beitrag

Ein [Issue](https://github.com/DigiJoe79/Aluna-Kompass/issues) — was du
erwartet hast, was passiert ist, welche Fassung (steht im Fuß der Seitenleiste
und unter `/api/health`). Das hilft mehr, als die meisten denken.

**Sicherheitslücken nicht als Issue**, sondern über den privaten Meldeweg in
[`SECURITY.md`](SECURITY.md).

## Code

Die Regeln des Projekts stehen in [`AGENTS.md`](AGENTS.md) — Ziel, neun
Prinzipien, Coding-Regeln, alle Befehle. Das ist die maßgebliche Quelle; hier
steht nur, was du zuerst wissen musst.

```
pnpm install
pnpm dev          # Entwicklungsserver
pnpm verify       # vor jedem Push: Typecheck, Lint, Tests, E2E, Image, Container
```

`pnpm verify` braucht Docker und läuft rund sieben Minuten. Es ist derselbe
Satz Prüfungen wie in der CI — wer ihn lokal grün hat, bekommt online keine
Überraschung.

Vier Dinge, an denen ein Beitrag sonst hängenbleibt:

- **Tests zuerst.** Nicht als Zeremonie, sondern weil dieses Projekt seine
  Architekturregeln als Tests führt (Rechteprüfung, i18n, Farbtokens,
  Handbuch-Vollständigkeit, MCP-Parität). Ein Beitrag ohne Test fällt fast
  immer über einen davon.
- **Code Englisch, Oberfläche über `messages/de.json`.** Kein Text im JSX.
- **Rechteprüfung serverseitig, in der Service-Schicht** — nie im Adapter, nie
  nur in der Oberfläche.
- **Eine neue Seite bringt ihre Handbuchseite mit** (`docs/handbuch/`). Ein
  Test verlangt das.

## Größere Vorhaben

Vor dem Code steht eine kurze Spec unter `docs/superpowers/specs/`: was gebaut
wird und warum, welche Säule aus [`docs/nordstern.md`](docs/nordstern.md) sie
betrifft. Das klingt nach Overhead, spart aber die Diskussion, die sonst im
Pull Request stattfindet, wenn die Arbeit schon getan ist.

Wenn du nicht sicher bist, ob etwas ins Projekt passt: erst ein Issue, dann
Code. [`docs/nordstern.md`](docs/nordstern.md) sagt in Abschnitt 2 ausdrücklich,
was Kompass **nicht** werden soll — das ist der schnellste Weg
herauszufinden, ob eine Idee hier richtig ist.

## Commits

Ein Commit je Vorhaben, deutsch oder englisch, Conventional-Commit-Präfix
(`feat`, `fix`, `docs`, `test`, `build`, `ci`, `chore`). Die Betreffzeile sagt,
**was** sich für den Nutzer ändert, nicht welche Datei angefasst wurde. Der
Rumpf sagt warum.

Feature-Branches werden als **ein** Commit gemerged (Squash) — der Verlauf
deiner Zwischenschritte muss also nicht aufgeräumt sein.

## Lizenz

Mit einem Beitrag stellst du ihn unter die [Apache-2.0-Lizenz](LICENSE) des
Projekts.
