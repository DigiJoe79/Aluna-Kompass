# Aluna Kompass — E2E-Zuverlässigkeit: Reset und Hydration (Design)

Stand 2026-09-14. Querschnitt, kein Roadmap-Schritt. Betrifft die Testinfrastruktur
(`apps/kompass/e2e/`, `apps/kompass/src/lib/deps.ts`), nicht das Produkt.

## 1. Der Befund

Jeder vierte Push ist rot: 14 von 57 abgeschlossenen CI-Läufen (Stand 14.09.).
Gemessen am Code ist das kein Testproblem — nur 23 von 566 Commits der letzten
zwei Wochen fassen ausschliesslich Test- oder CI-Dateien an, davon etwa acht als
Wackler-Reparatur. Die Kosten liegen nicht im Commit, sondern in der
Unterbrechung: jeder rote Lauf kostet eine Untersuchungsrunde.

Die 14 roten Läufe haben nicht 14 Ursachen, sondern zwei Mechanismen:

**A — Eingabe verpufft vor der Hydration.** Ein Feld steht schon im
servergerenderten HTML: sichtbar, stabil, ohne Wirkung, solange React die
Handler nicht angehängt hat. Playwright schreibt hinein, niemand hört zu.
Belege: `help.spec.ts:33` (14.09.), `media.spec.ts:83` und `:99`, der
Betreff-Wackler im DMS-Empfangsdialog (dreimal rot: 34651887243, 34648765247,
34596214428), dazu die Reparaturen `ddcb72f`, `faaeecb`, `2c16818`.

**B — Der Reset kappt laufende Anfragen.** `resetDatabase` des nächsten Tests
verwirft die Datenbank, während eine Anfrage des vorigen noch rechnet. Belege:
`TypeError: The database connection is not open` aus `previewDraft`
(`drafts.ts:296`), `Error: deps are being reset`, `The destination stream closed
early`, der Timeout in `site-publish.spec.ts` (34650791332).

Beide Mechanismen wurden bisher **pro Testfall** repariert, nie an der Wurzel —
vier Commits für A, einer für B (`3f6379b`, Text-Worker). Jede Reparatur heilte
genau einen Testfall, während der Mechanismus sich den nächsten suchte.

### Nicht die Ursache

Die zweigleisige Prüfung (`test` gegen `next dev`, `image` gegen das gebaute
Image) steht **nicht** zur Debatte. Die Ringe fallen etwa gleich oft um (8× `test`,
7× `image`), und in den drei Läufen, in denen beide dasselbe Commit geprüft
haben, hat jeder Ring etwas rot gemeldet, das der andere durchwinkte — jedes Mal
ein Wackler, nie ein Produktfehler. Sie fangen keine unterschiedlichen
Fehlerklassen, sie würfeln unabhängig. Zwei volle Durchläufe sind 298
Gelegenheiten pro Push; einen zu streichen halbiert die Quote, beseitigt aber
keinen Wackler und senkt die Abdeckung. `pnpm verify` fährt lokal ohnehin beide.

Nach A und B wird neu gemessen. Erst dann ist die Ringfrage wieder offen.

## 2. B — Der Reset wartet auf die laufenden Anfragen

### Heute

`depsReady()` (`deps.ts:43`) ist ein Tor am **Eingang**: Wer während eines Resets
ankommt, wartet. Wer bereits durch ist, hält nichts auf. Eine Anfrage, die
`optionalSession()` passiert hat und danach sekundenlang rechnet — Typst-PDF,
Draft-Vorschau, Astro-Build — verliert die Datenbank unter sich.

`apps/kompass/src/app/dms/[id]/preview/route.ts` ist der belegte Fall: Zeile 15
ruft `optionalSession()`, Zeile 35 rechnet in `previewDraft`.

### Neu

`resetDeps()` zieht die alte Verbindung aus dem Verkehr und schliesst sie erst
eine halbe Minute später (`retire()` in `deps.ts`). Wer noch auf ihr rechnet,
rechnet auf einer bereits gelöschten Datei zu Ende, die niemand mehr liest;
alles Neue bekommt längst den frischen Bestand. Geschlossen wird trotzdem, sonst
bliebe je Reset ein Dateizeiger liegen, und ein Lauf macht hundertfünfzig davon.

### Verworfen: mitzählen, wer gerade arbeitet

Der erste Anlauf (20f2963) zählte die laufenden Anfragen: `enterRequest()` in
`optionalSession()`, Abmeldung über `after()`, und `resetDeps` wartete auf null.
**Das trägt nicht**, und der Lauf 34896633331 hat es gezeigt — `dms.spec.ts:437`
scheiterte weiter.

`after()` hängt an der **Antwort**, nicht am **Handler**. Bricht der Browser ab
— beim Neuladen eines `<iframe>` mit der Vorschau ständig — gilt die Antwort als
erledigt, während der Code weiterrechnet. Mit einer Sonde in der Vorschau-Route
gemessen: `previewDraft` begann seine Arbeit bei einem Zählerstand von **null**.
In der Gegenrichtung blieb der Zähler stehen, und die Frist zog nach zehn
Sekunden. Die Next-Dokumentation sagt zu, dass `after()` auch bei Fehlern läuft
— sie sagt nichts darüber, *wann* relativ zum Handler-Code, und genau darauf kam
es an.

Ein `try/finally` um jeden Handler wäre korrekt, aber eine Regel, an die
siebzehn Route Handler und jeder künftige denken müssten — dieselbe Sorte
Fussangel, die A gerade beseitigt hat. Deshalb gar keine Buchhaltung.

## 3. A — Die Hydration gehört in eine Fixture

`waitForHydration()` steht seit dem 14.09. in `e2e/helpers.ts:43` und wird in
genau drei Zeilen benutzt, alle in `media.spec.ts`. Das ist der Grund, warum der
Mechanismus weiterläuft: Er wird dort repariert, wo er gerade zugeschlagen hat.

Statt 149 Tests einzeln nachzurüsten, wartet eine Playwright-Fixture, die
`page.goto` umschliesst, nach jedem Seitenwechsel auf die Hydration.
`waitForHydration()` bleibt für Fälle, in denen mitten auf der Seite gewartet
werden muss (Dialoge, nachgeladene Bereiche).

**Das Signal kommt aus der Anwendung.** Von aussen ist eine nicht hydrierte
Seite nicht von einer fertigen zu unterscheiden, und die Abstände sind zu klein,
um darauf zu bauen: an einer gebremsten Seite gemessen 1324 ms bis zum ersten
hydrierten Element, 1376 ms bis zur Kopfleiste, die Effekte danach. Eine Fixture,
die auf das erste `__reactProps$` wartete, war zweimal von dreimal rot. Deshalb
setzt `HydrationMarker` als letztes Kind im Layout `data-hydrated`, sobald alle
Effekte durch sind — React führt sie in Baumreihenfolge aus, dieser läuft also
nach dem des `ShellFrame`, der auf die Taste `?` hört.

Das ist Produktionscode für einen Testzweck, und die Abwägung fällt bewusst so
aus: Die Alternative wäre, auf Zeitfenster von fünfzig Millisekunden zu bauen.

Nicht jede Adresse führt in die Anwendung — `/site/preview` liefert die gebaute
Website aus einem Route Handler, ganz ohne React. Die Fixture erkennt das am
fehlenden Next-Skript im fertigen Dokument, statt fünf Sekunden ins Leere zu
warten.

## 4. Tests

Strikt testgetrieben, jeder Teil rot bevor er grün wird.

**B** (alle in `tests/deps-reset.test.ts`):
1. Eine Anfrage, die ihre Deps am Anfang holt, lange rechnet und die Datenbank
   erst danach anfasst — genau die Reihenfolge der Vorschau-Route. Vor der
   Änderung rot mit der Meldung aus der CI.
2. Der Reset liefert trotzdem einen frischen Bestand für alles Neue.
3. Die abgelegte Verbindung bleibt nicht für immer offen.

**A:**
3. `e2e/hydration.spec.ts` löst den Wackler absichtlich aus. Zwei Wege dorthin
   führten nicht zum Ziel und stehen in der Datei dokumentiert: Chunks bremsen
   greift nicht, weil `goto` ohnehin auf `load` wartet (30 gebremste Anfragen,
   Test blieb grün); den Renderer drosseln greift auch nicht, obwohl es das
   Fenster nachweislich öffnet (0 ms ungedrosselt, 330 ms bei `rate: 20`) — die
   Drosselung bremst den Tastendruck mit. Erst beides getrennt —
   `waitUntil: 'commit'` und eine Bremse allein auf den Skripten — trifft die
   Lage des Läufers, auf dem nur der Browser langsam ist.

Danach: `pnpm verify` lokal, nicht auf die CI warten.

## 5. Abgrenzung

Nicht Teil dieser Arbeit:

- Die Ringstruktur (siehe Abschnitt 1, „Nicht die Ursache").
- `retries` in den Playwright-Konfigurationen. Ein Wiederholungsversuch
  verdeckt beide Mechanismen, statt sie zu beseitigen; die Frage wird erst nach
  der Messung wieder gestellt.
- Die Lücke in `e2e/warmup.ts` (Route Handler und dynamische Segmente werden
  nicht vorgewärmt, Ursache des `dms`-Fehlschlags vom 14.09. im `test`-Ring).
  Eigener Befund, eigener Commit — er gehört zum dev-Ring, nicht zu A oder B.

## 6. Erfolgskriterium

Die Rotquote wird nach der Umsetzung über die nächsten zwanzig Läufe erneut
gemessen. Bleiben Wackler übrig, sind sie nach Mechanismus zu benennen, bevor
wieder ein einzelner Testfall repariert wird.
