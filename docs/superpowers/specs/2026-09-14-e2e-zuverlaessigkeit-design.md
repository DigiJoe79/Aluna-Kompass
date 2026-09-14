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
zwei Sekunden und setzt danach trotzdem zurück. Im Normalfall ist die
Fehlerklasse strukturell weg; im Leckfall degradiert das Verhalten auf das von
heute, nicht auf schlechteres. Überschreitet der Reset die Frist, schreibt er
eine Zeile ins Protokoll — sonst verschwindet ein Leck stillschweigend.

**Offen bis zum ersten Test:** Ob `after()` bei einem abgebrochenen Client
zuverlässig läuft, ist nicht aus der Dokumentation belegt. Der erste Test der
Umsetzung klärt genau das (siehe Abschnitt 4).

## 3. A — Die Hydration gehört in eine Fixture

`waitForHydration()` steht seit dem 14.09. in `e2e/helpers.ts:43` und wird in
genau drei Zeilen benutzt, alle in `media.spec.ts`. Das ist der Grund, warum der
Mechanismus weiterläuft: Er wird dort repariert, wo er gerade zugeschlagen hat.

Statt 149 Tests einzeln nachzurüsten, wartet eine Playwright-Fixture, die
`page.goto` umschliesst, nach jedem Seitenwechsel auf die Hydration. Tests, die
bewusst den nicht hydrierten Zustand prüfen wollen, umgehen sie ausdrücklich.
`waitForHydration()` bleibt für Fälle, in denen mitten auf der Seite gewartet
werden muss (Dialoge, nachgeladene Bereiche).

Die vorhandene Warnung in `helpers.ts` gilt weiter: Nach einem Seitenwechsel
gehört eine Prüfung auf die neue Adresse davor, sonst ist die Bedingung am alten
Dokument sofort erfüllt.

## 4. Tests

Strikt testgetrieben, jeder Teil rot bevor er grün wird.

**B:**
1. Ein Test, der `after()` unter abgebrochenem Client beobachtet — er entscheidet,
   ob die Frist aus Abschnitt 2 ein Randfall oder der Normalfall ist.
2. Ein Test in `apps/kompass`, der eine lange laufende Anfrage startet, mitten
   darin `resetDeps()` ruft und zusichert, dass die Anfrage ihre Antwort noch
   erhält, statt an einer geschlossenen Datenbank zu scheitern. Rot vor der
   Änderung — er stellt den heutigen Fehlschlag nach.
3. Ein Test, der den Leckfall erzwingt (Zähler steht, `after()` läuft nicht) und
   zusichert, dass der Reset nach der Frist trotzdem durchgeht und das Protokoll
   die Zeile trägt.

**A:**
4. Ein E2E-Fall, der unter gebremster Navigation (nicht unter CPU-Last, siehe
   `project_e2e_hydration_race_uploads`) belegt, dass eine Eingabe unmittelbar
   nach `goto` ankommt.

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
