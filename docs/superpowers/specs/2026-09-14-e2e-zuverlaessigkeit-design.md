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

Das Tor bekommt eine zweite Hälfte: von „wer kommt herein" auf „wer ist noch
drin".

- `deps.ts` führt einen Zähler der laufenden Anfragen mit `enterRequest()` und
  `leaveRequest()`.
- `optionalSession()` zählt nach `depsReady()` hoch und registriert die
  Gegenbuchung über `after()` aus `next/server` (Next 16.3.4; im Projekt bisher
  ungenutzt). `after()` läuft, nachdem die Antwort abgeschlossen ist — für Server
  Components, Route Handler und Server Actions gleichermassen.
- `layout.tsx` behält seinen `depsReady()`-Aufruf unverändert.
- `resetDeps()` wartet nach `stopBackgroundWork()`, bis der Zähler null ist,
  bevor es die Datenbank verwirft.

Mehrfaches `optionalSession()` in derselben Anfrage (Layout und Seite) zählt
mehrfach hoch und über je ein `after()` wieder herunter — das bleibt im
Gleichgewicht.

### Die Frist

Läuft `after()` einmal nicht — ein abgebrochener Client ist der Verdachtsfall,
`The destination stream closed early` steht in den Protokollen — leckt der
Zähler und der Reset hinge unbegrenzt. Deshalb wartet `resetDeps()` höchstens
eine Frist ab und setzt danach trotzdem zurück. Im Normalfall ist die
Fehlerklasse strukturell weg; im Leckfall degradiert das Verhalten auf das von
heute, nicht auf schlechteres. Überschreitet der Reset die Frist, schreibt er
eine Zeile ins Protokoll — sonst verschwindet ein Leck stillschweigend.

**Geklärt (14.09.):** Die Next-Dokumentation zu `after()` sagt zu, dass der
Rückruf auch dann läuft, wenn die Antwort nicht sauber durchkommt — bei einer
geworfenen Ausnahme ebenso wie bei `notFound()` und `redirect()`. Ein eigener
Test dafür entfällt damit; die Frist bleibt als Absicherung und wird über den
vollen Durchlauf beobachtet.

**Die Frist beträgt zehn Sekunden, nicht zwei.** Mit zwei Sekunden zog sie in
einem vollen Durchlauf einmal, und zwar am Astro-Bau der Vorschau — eine ehrlich
lange Anfrage, kein Leck. Ein echtes Leck bliebe stehen und meldete sich bei
jedem folgenden Reset; einmal heisst, jemand hat gearbeitet. Die Frist muss
darüber liegen, sonst schneidet sie genau das ab, wofür sie gebaut ist.

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

**B** (beide in `tests/deps-reset.test.ts`):
1. Eine lange laufende Anfrage, mitten darin `resetDeps()` — sie muss ihre
   Antwort noch erhalten, statt an einer geschlossenen Datenbank zu scheitern.
   Vor der Änderung rot, und zwar mit genau der Meldung aus der CI
   (`TypeError: The database connection is not open`).
2. Der Leckfall: Der Zähler steht, die Abmeldung bleibt aus. Der Reset muss nach
   der Frist trotzdem durchgehen.

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
