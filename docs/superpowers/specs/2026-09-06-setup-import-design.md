# Import auf der Einrichtungsseite — Design

Stand 2026-09-06. Betrifft Backlog-Punkt 1.

## Zweck

Eine frisch gestartete Installation soll einen vorhandenen Bestand einspielen
können, ohne vorher ein Wegwerf-Konto anzulegen. Heute führt der einzige Weg
zum Import über die angemeldete Verwaltung — man richtet also erst einen
Administrator ein, den der Import unmittelbar danach überschreibt.

Das trifft jeden Umzug auf neue Hardware und jeden Neuaufbau der Testumgebung.

## Zuschnitt

**Enthalten:** Einspielen eines Backups, zu dem die Zugangsdaten bekannt sind.

**Nicht enthalten:** Wiederherstellen eines Backups ohne dessen Zugangsdaten.
Der Import ersetzt die Nutzertabelle; danach gelten ausschließlich die Konten
aus dem Archiv. Ein Ablauf, der an dieser Stelle einen neuen Administrator
setzen dürfte, wäre zugleich ein Weg, sich in eine fremde Installation zu
setzen. Statt Mechanik gibt es deshalb einen Hinweis vor dem Bestätigen.

## Sicherheitslage

Der Endpunkt ist ohne Anmeldung erreichbar. Das ist vertretbar, weil er
dieselbe Bedingung trägt wie die Einrichtung selbst und dasselbe Fenster nutzt:
Wer eine uneingerichtete Instanz erreicht, kann heute schon `completeSetup`
aufrufen und sich zum Administrator machen. Der Import fügt keine neue Klasse
von Übernahme hinzu, sondern einen zweiten Weg zum selben Ergebnis. Ein
zusätzlicher Nachweis nur für den Import wäre inkonsequent — dann müsste die
Einrichtung ihn ebenso verlangen.

Neu ist etwas anderes: der Import **nimmt eine Datei entgegen und entpackt ein
Archiv**. Diese Angriffsfläche hat `completeSetup` nicht, und sie wird unten
ausdrücklich behandelt.

## Ablauf

`/setup` bleibt unverändert; darunter steht ein Verweis „Sie haben ein Backup?
Bestand wiederherstellen". Der Normalfall — ein neuer Verein ohne Backup —
sieht dieselbe schlichte Seite wie bisher, und ihr E2E-Test bleibt gültig.

```
apps/kompass/src/app/setup/import/
  page.tsx            Seite, pro Anfrage gerendert, verweigert wenn eingerichtet
  import-form.tsx     Client: Datei wählen → hochladen → Manifest → bestätigen
  actions.ts          Bestätigungs-Action
  upload/route.ts     Route Handler, nimmt die Datei im Strom entgegen
```

1. **Hochladen.** `POST` an `upload/route.ts`. Der Handler schreibt die Datei im
   Strom auf die Platte, liest mit `inspectBackup` das Manifest und antwortet
   mit `{ kennung, manifest }`. Die Kennung ist eine ULID, kein Pfad.
2. **Anzeigen.** Umgebung, Erstellzeitpunkt, Anzahl Nutzer, Dokumente und
   Medien. Darunter der Hinweis, dass anschließend die Zugangsdaten aus diesem
   Backup gelten, und die Schaltfläche „Diesen Bestand einspielen".
3. **Einspielen.** Die Action erhält nur die Kennung, löst sie gegen die Ablage
   auf und ruft den Kern. Danach Weiterleitung nach `/login?imported=1`.

**Server Actions scheiden für den Upload aus.** Sie puffern ihren Body im
Speicher und übertragen die Datei zweimal — einmal für die Vorschau, einmal für
den Import. Für den einzigen Endpunkt, an dem Unangemeldete Speicher belegen
können, ist das die falsche Wahl. Der angemeldete Import bleibt vorerst, wie er
ist; ihn mitzuziehen steht als eigener Backlog-Punkt.

**Nur ein angefangener Upload gleichzeitig.** Vor jeder Annahme räumt der
Handler die Ablage. Der Platzbedarf ist damit durch ein Archiv begrenzt, egal
wie oft jemand hochlädt.

**Die Ablage liegt neben der Datenbank** unter `<dirname(DATABASE_PATH)>/uploads`,
nicht in `/tmp`: sie überlebt keinen Containerneustart als Leiche im Abbild und
liegt auf demselben Dateisystem wie das Ziel.

**Die Kennung wird geprüft, bevor sie zu einem Pfad wird.** Sie muss dem
ULID-Muster entsprechen (`^[0-9A-HJKMNP-TV-Z]{26}$`); alles andere wird
abgewiesen, ohne das Dateisystem zu berühren. Der aufgelöste Pfad muss zudem
innerhalb der Ablage liegen.

## Absicherung im Kern

```ts
export async function importBackupForSetup(
  deps: AppDeps,
  input: { archivePath: string; workDir: string },
): Promise<Result<{ manifest: BackupManifest }>>
```

Kein `CallContext`, keine Rechteprüfung — es gibt keinen Nutzer, dem Rechte
gehören könnten. Bedingung ist `isSetupRequired(deps)`, geprüft **unmittelbar
vor dem Austausch**, nicht am Anfang. `completeSetup` verfährt ebenso und
verlässt sich nicht auf seinen Aufrufer.

**Grenze dieser Zusicherung:** Der Import tauscht Dateien auf der Platte, keine
Transaktion umspannt das. Fiele eine Einrichtung genau zwischen Prüfung und
Austausch, würde der frisch angelegte Administrator durch das Backup ersetzt.
Das ist kein Rechtegewinn für jemanden, der nicht ohnehin alles könnte. Eine
Sperrdatei wäre dafür unverhältnismäßig.

Seite, Route Handler und Action prüfen ebenfalls, aber nur zur Bedienbarkeit:
Wer eine eingerichtete Installation aufruft, soll eine Weiterleitung sehen und
keinen Fehler nach dem Hochladen. Maßgeblich ist die Prüfung im Kern.

**Der Endpunkt schließt sich selbst.** Nach einem erfolgreichen Import enthält
die Datenbank Nutzer, `isSetupRequired` ist falsch, und kein weiterer Import ist
möglich. Es braucht kein Aufräumen und kein Ablaufdatum.

**Ein Archiv mit `counts.users = 0` wird abgelehnt.** Sonst bliebe die
Installation unbenutzbar *und* dauerhaft offen: niemand könnte sich anmelden,
der unangemeldete Endpunkt bliebe erreichbar.

**Änderungsprotokoll** wie beim angemeldeten Import, mit `userId: null` und
Kanal `system`. Der Eintrag landet in der eingespielten Datenbank — deren
Verlauf trägt damit den Vermerk, wann und aus welcher Umgebung sie bei einer
Einrichtung eingespielt wurde.

## Archivbehandlung

`tar.extract` bekommt einen Filter, der drei Dinge durchsetzt:

- **Nur erwartete Einträge:** `manifest.json`, `kompass.db`, alles unter
  `media/`. Anderes wird verworfen, nicht entpackt.
- **Keine Ausbrüche:** absolute Pfade und `..` werden abgewiesen. `node-tar` tut
  das in der Vorgabe; die Spec verlangt eine ausdrückliche Prüfung, damit eine
  geänderte Voreinstellung nicht unbemerkt durchschlägt.
- **Obergrenze für die entpackte Gesamtgröße: 8 GB.** Der Filter kennt die Größe
  jedes Eintrags und summiert; beim Überschreiten bricht das Entpacken ab. Der
  Wert lässt einem 2-GB-Archiv reichlich Luft — Medien sind bereits komprimiert,
  nur die Datenbank dehnt sich nennenswert — und stoppt zugleich ein Archiv, das
  auf Terabyte aufgeht.

Diese Grenzen gelten auch dem angemeldeten Import, weil beide dieselbe
`extract`-Funktion nutzen.

**Upload-Grenze im Route Handler: 2 GB**, unabhängig vom globalen
`bodySizeLimit`. Großzügig genug für einen Verein mit Jahren an Fotos,
vertretbar, weil immer nur ein angefangener Upload existiert. Beim Überschreiten
bricht der Handler den Strom ab, statt weiterzuschreiben.

## Tests

| Ebene | Zusicherung |
|---|---|
| Kern | Import gelingt bei leerer Datenbank |
| Kern | Import wird abgelehnt, sobald ein Nutzer existiert |
| Kern | Archiv mit `counts.users = 0` wird abgelehnt |
| Kern | Protokolleintrag entsteht, mit `userId: null` und Kanal `system` |
| Archiv | Eintrag mit `..` im Pfad wird nicht entpackt |
| Archiv | Eintrag außerhalb der drei erlaubten wird verworfen |
| Archiv | Überschreiten der Entpackgrenze bricht ab |
| E2E | leere Datenbank → Verweis auf `/setup` → hochladen → Manifest → bestätigen → Anmeldung mit den Zugangsdaten aus dem Backup |

Der E2E-Test deckt als einziger den ganzen Weg einschließlich Route Handler und
Weiterleitung ab. Er fängt insbesondere die Vorrender-Falle: `/setup` und
`/login` wurden am 2026-09-06 statisch vorgerendert und schickten eine
eingerichtete Installation dauerhaft auf die Einrichtungsseite. `/setup/import`
liest die Datenbank ebenso und muss pro Anfrage gerendert werden.

## Offene Punkte

Keine.
