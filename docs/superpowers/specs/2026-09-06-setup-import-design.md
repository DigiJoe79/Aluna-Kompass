# Aluna Kompass — Backup einspielen bei der Ersteinrichtung (Design)

Status: freigegeben im Brainstorming, zur Umsetzung
Datum: 2026-09-06
Betrifft: `packages/core/src/backup/`, `packages/core/src/setup/`, `apps/kompass/src/app/setup/`
Löst: Backlog-Punkt 1; zahlt Backlog-Punkt 3 zur Hälfte ab

## 1. Ziel, Zuschnitt, Nicht-Ziele

**Ziel.** Die Seite „Erste Einrichtung" bietet zwei Wege: das erste Vorstandskonto
anlegen oder einen vorhandenen Bestand aus einem Backup übernehmen. Heute führt
der zweite Weg nur über einen Wegwerf-Admin, den der Import unmittelbar danach
überschreibt — ein Umweg, der bei jedem Neuaufsetzen fällig ist.

**Zuschnitt.** Der Import bei der Einrichtung ist unauthentifiziert und bleibt es.
Er verlangt keinen zusätzlichen Nachweis. Gehärtet wird nur, was ohnehin schlecht
gebaut wäre: die Größe des unauthentifizierten Uploads und die Größe des
entpackten Archivs.

**Entscheidungen aus dem Brainstorming (2026-09-06):**

| # | Entscheidung | Verworfen |
|---|---|---|
| 1 | Der Import bei der Einrichtung verlangt keinen Nachweis aus der Umgebung. | `SETUP_IMPORT_TOKEN` in der `.env`; Einmal-Token im Container-Log |
| 2 | Die Einrichtungsseite selbst bleibt unverändert offen. | Denselben Nachweis auch vor die Kontoanlage setzen |
| 3 | Der Upload läuft über einen Route Handler, der den Strom auf die Platte schreibt. | Server Action wie beim Admin-Import; Datei über das Volume statt über den Browser |
| 4 | Kein Bestätigungswort bei der Einrichtung. | Umgebungsnamen abtippen wie beim Admin-Import |
| 5 | Nach dem Import wird keine Sitzung angelegt; Weiterleitung auf `/login`. | Direkt anmelden wie bei `completeSetup` |
| 6 | Der Admin-Import unter `(shell)/admin/backup/` bleibt unangetastet. | Beide Wege gemeinsam auf Route Handler umstellen |

**Nicht-Ziele:** Ratenbegrenzung für die Einrichtung; Schema-Prüfung des
importierten Bestands; Umstellung des Admin-Imports (Backlog-Punkt 3); HTTPS und
Container-Härtung (eigenes Thema).

## 2. Bedrohungsmodell und was daraus folgt

`isSetupRequired` bedeutet „null Nutzer", und null Nutzer bedeutet frische
Datenbank. Es gibt keinen Zustand, in dem echte Daten vorliegen und die
Einrichtung noch offen ist. Ein Angriff auf diesen Zustand erbeutet nichts.

Entscheidend ist: **`/setup` ist heute bereits ein unauthentifizierter
Übernahme-Endpunkt.** Wer den frischen Container zuerst erreicht, legt das
Admin-Konto an und besitzt die Installation. Der Import ändert nicht, *wer*
übernehmen kann, sondern nur, *womit*. Ein Nachweis allein vor dem Import wäre
eine Asymmetrie ohne Gewinn: Ein Backup einspielen bräuchte ein Geheimnis,
Administrator werden nicht.

Geprüft und für unkritisch befunden:

- **Aussperrung statt Datenabfluss.** Spielt ein Fremder sein eigenes Archiv ein,
  hat der Betreiber kein Passwort und merkt es sofort. Der Schaden ist ein
  Container-Neustart, kein Datenverlust.
- **Tar-Slip.** `tar` ist auf `^7.5.22` gepinnt; node-tar verwirft seit v3
  führende `/` und überspringt Einträge mit `..`.
- **Fremdes Schema.** Ein präpariertes Archiv kann Trigger oder Views mitbringen,
  die danach mitlaufen. Das gilt heute schon für den Admin-Import und wird
  bewusst nicht behandelt.

Es bleiben zwei Dinge, die unabhängig von jeder Angriffsannahme falsch gebaut
wären und deshalb behoben werden: ein unauthentifizierter Endpunkt, der ein
halbes Gigabyte im Speicher puffert, und ein Entpackvorgang ohne Größengrenze.

## 3. Kern

**Aufteilung.** `importBackup` macht heute dreierlei in einem: Recht prüfen,
Bestätigungswort prüfen, importieren. Die eigentliche Arbeit — entpacken,
Manifest lesen, Migrationsstand und Integrität prüfen, Dateien tauschen, Marker
und Audit schreiben — wandert in eine modulinterne Funktion. Darüber stehen zwei
exportierte Services:

- `importBackup(deps, ctx, input)` — nach außen unverändert:
  `requirePermission('backup.import')`, Bestätigungswort, dann die interne
  Funktion.
- `importBackupAtSetup(deps, input)` — kein `ctx`, kein Recht, kein
  Bestätigungswort. Türsteher ist `isSetupRequired(deps)`.

Das Bestätigungswort entfällt bei der Einrichtung bewusst: Es schützt davor,
einen bestehenden Bestand zu überschreiben. Bei null Nutzern gibt es nichts zu
überschreiben, und eine Zeremonie ohne Zweck erzieht zum Wegklicken.

**Platzierung der Prüfung.** Der Import schreibt nicht in einer Transaktion, er
tauscht Dateien; die Forderung „in derselben Transaktion prüfen, in der er
schreibt" ist wörtlich nicht erfüllbar. Stattdessen nimmt die interne Funktion
den Türsteher als Rückruf entgegen und ruft ihn **unmittelbar vor `deps.close()`
auf, ohne `await` dazwischen**. Node ist einprozessig und `better-sqlite3`
synchron: Zwischen Prüfung und Schließen kann keine zweite Anfrage
dazwischenrutschen. Nach `deps.close()` ist eine Prüfung ohnehin unmöglich.

> **Tragende Annahme:** Die Anwendung läuft als ein Prozess. Sobald Kompass in
> mehreren Prozessen oder Containern gegen dieselbe Datenbank läuft, trägt diese
> Zusage nicht mehr und braucht eine Sperre auf Dateiebene.

**`completeSetup` wird mitgezogen.** Dort steht die Prüfung in
`setup/service.ts:33` vor `await hashPassword(...)`, also vor einem echten
Umschaltpunkt: Zwei gleichzeitige Aufrufe können beide passieren. Das Hashen
wandert vor die Prüfung, damit auch dort kein `await` zwischen Prüfung und
Schreiben liegt.

**Protokoll.** Es gibt keinen handelnden Nutzer. Der Eintrag läuft über
`systemContext()` mit `channel: 'system'`; die Zusammenfassung nennt die
Übernahme bei der Ersteinrichtung samt Umgebung und Erstelldatum aus dem
Manifest. `system.lastImportAt` und `system.lastImportSource` werden wie gehabt
nach dem Tausch in den neuen Bestand geschrieben.

**Rückgabe** ist wie bisher das Manifest.

## 4. Weg der Daten

**Zwei Schritte, ein Upload.**

1. `POST /setup/import` (Route Handler,
   `apps/kompass/src/app/setup/import/route.ts`) nimmt das Multipart-Feld
   `archive` entgegen und schreibt es strömend auf die Platte —
   `bodySizeLimit` gilt nur für Server Actions, Route Handler strömen den Rumpf
   frei. Danach liest er das Manifest und antwortet mit `{ id, manifest }`.
   Fehler beantwortet er mit `{ error: <Schlüssel> }` und passendem Status:
   `413` bei Überschreitung, `409` bei bereits abgeschlossener Einrichtung,
   sonst `400`.
2. Das Bestätigen ist eine gewöhnliche Server Action mit `useActionState`, die
   nur die `id` erhält und `importBackupAtSetup` ruft. Fehleranzeige und
   Formularverhalten bleiben identisch zum Rest der Anwendung; neuer Client-Code
   beschränkt sich auf das `fetch` des Uploads.

**Ablageplatz.** Genau ein Archiv zur Zeit, in einem festen Verzeichnis unter
`os.tmpdir()`: das Archiv und eine `staged.json` mit `id`, Manifest und
Zeitstempel. Jeder neue Upload räumt den Platz zuerst leer, ein erfolgreicher
Import räumt ihn danach, „Abbrechen" ebenfalls — über eine kleine Server
Action, die nur den Platz leert. Der Plattenbedarf ist damit auf ein Archiv
gedeckelt, ohne Verfallslogik; ein liegengebliebener Upload verschwindet
spätestens beim Neustart. Nicht unter `MEDIA_PATH`, denn dorthin
greift der Import selbst.

Die `id` ist eine ULID und wird beim Bestätigen gegen `staged.json` geprüft.
Passt sie nicht, wurde zwischenzeitlich ein anderes Archiv hochgeladen: Abbruch
mit `stagedMissing` statt stillem Einspielen des falschen Bestands.

**Beide Schritte prüfen eingangs `isSetupRequired`** und antworten sonst mit
Konflikt. Das ist Bequemlichkeit, nicht die Sicherung — verbindlich ist die
Prüfung im Kern direkt vor dem Dateitausch.

**Grenzen.**

- **Upload.** Beim Strömen mitzählen, bei Überschreitung abbrechen, Datei
  löschen, `413`. Die Grenze kommt aus der Umgebung
  (`BACKUP_MAX_UPLOAD_BYTES`, Vorgabe 512 MiB) — ein Betriebsparameter und damit
  nach Prinzip 2 zulässig. Sie wird in `envSchema` und `RuntimeEnv` in
  `packages/core/src/app.ts` ergänzt.
- **Entpackte Größe.** `extract()` summiert die Größenangaben der tar-Einträge
  und bricht oberhalb des Vierfachen der Upload-Grenze mit `backupTooLarge` ab.
  Gilt für beide Import-Wege.
- **Leerer Beiseite-Ordner.** Ist das Medienverzeichnis leer, entfällt das
  Anlegen des `.before-import-…`-Ordners.

## 5. Oberfläche und Texte

Die `AuthCard` bleibt bei 520 Pixel und behält das Kontoformular als Hauptweg.
Darunter ein Trenner und ein zweiter, ruhigerer Block: kurzer Satz, Dateifeld,
Knopf „Backup prüfen". Der Import ist sichtbar, aber nicht gleichrangig — die
erwartbare Handlung einer frischen Installation bleibt das Anlegen des Kontos.

Nach erfolgreichem Upload tauscht die Karte ihren Inhalt gegen eine
Zusammenfassung aus dem Manifest: Umgebung, Erstelldatum, Zahl der Nutzer,
Protokolleinträge, Dokumente und Medien. Dazu die eine Warnung, die hier etwas
wert ist:

> Nach dem Einspielen melden Sie sich mit einem Konto **aus diesem Backup** an.
> Die Zugangsdaten dieser Installation gibt es nicht.

Ohne diesen Satz spielt jemand ein fremdes oder altes Archiv ein und sperrt sich
aus; der Weg zurück ist ein neuer Container. Darunter „Einspielen" und
„Abbrechen"; Abbrechen räumt den Ablageplatz und zeigt wieder das Formular.

Nach dem Import wird **keine** Sitzung angelegt — anders als bei `completeSetup`,
das direkt anmeldet. Weiterleitung auf `/login?imported=1`; das Flag wertet
`login-form.tsx` bereits aus.

**Texte.** Neue Schlüssel unter `auth.setup.import.*` in `messages/de.json`. Die
bestehenden unter `backup.import.*` werden nicht wiederverwendet: Sie sprechen
durchgehend vom Überschreiben eines bestehenden Bestands („Überschreibt alles",
„Bestand überschreiben"), was hier falsch wäre. `auth.setup.intro` wird
umformuliert, weil es heute behauptet, dieser Schritt sei das Anlegen des Kontos.
Neue Fehlerschlüssel: `backupTooLarge`, `stagedMissing`. Vorhanden und
wiederverwendet: `backupFormatUnsupported`, `backupNewerThanApp`, `backupCorrupt`,
`setupAlreadyDone`.

## 6. Tests

Geschrieben vor der Umsetzung, in dieser Reihenfolge.

**Kern** (`packages/core/tests/backup.test.ts`, `setup.test.ts`):

- `importBackupAtSetup` auf frischer Installation: Erfolg, Nutzer aus dem Archiv
  vorhanden, Audit-Eintrag mit `channel: 'system'`.
- Auf eingerichteter Installation: `conflict('setupAlreadyDone')`, vorhandener
  Bestand unangetastet, keine `.before-import-…`-Datei angelegt.
- Entpackgrenze: Archiv mit übergroßen Einträgen → `backupTooLarge`, ohne dass
  eine Datei angefasst wurde.
- Leeres Medienverzeichnis: kein Beiseite-Ordner.
- `completeSetup`, Wettlauf: zwei gleichzeitige Aufrufe, genau einer gewinnt, ein
  Nutzer in der Datenbank. Dieser Test fällt vor der Umstellung durch und ist der
  Beleg, dass die Verschiebung des `await` wirkt.

**App:** Die Zählschleife des Uploads liegt in `lib/upload.ts` („schreibe Strom
nach Pfad, brich oberhalb von n Bytes ab") und ist damit ohne Next-Gerüst
prüfbar: unterhalb der Grenze geschrieben, oberhalb abgebrochen und Datei
gelöscht. Für Route Handler gibt es in `apps/kompass/tests/` bisher kein Muster;
es wird keines erfunden.

**E2E** (`apps/kompass/e2e/setup-import.spec.ts`): leerer Zustand über den
Reset-Token, `/setup` aufrufen, Archiv hochladen, Zusammenfassung prüfen,
einspielen, auf `/login` landen und sich mit einem Konto aus dem Archiv anmelden.

## 7. Bewusst nicht hier entschieden

- **Nachweis aus der Umgebung, Ratenbegrenzung der Einrichtung,
  Schema-Prüfung des fremden Bestands.** Begründung in Abschnitt 2. Kommt zurück
  auf den Tisch, wenn Kompass aus dem Internet erreichbar betrieben wird.
- **Admin-Import auf Route Handler umstellen.** Backlog-Punkt 3; erbt den hier
  gebauten Weg.
- **HTTPS und Container-Härtung.** Eigenes Thema, eigener Lauf.
