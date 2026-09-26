import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { cp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { coreDocumentTemplates, createDocumentEngine } from '@kompass/documents';
import { coreModule, createDeps, databasePathIn, isProvided, providedPaths, readEnv, resetDataPath, seedDevelopment } from '@kompass/core';
import { createPdfTools, createTextExtraction } from '@kompass/text-extraction';
import { installedModules } from '../modules';
import { resetMcpHandler } from './mcp';

export type AppDeps = import('@kompass/core').AppDeps;

interface Holder {
  deps: AppDeps | null;
  /** Läuft gerade ein Reset, steht hier sein Versprechen. Siehe `depsReady`. */
  resetting: Promise<void> | null;
  /** Ob `closeOnExit` schon am Prozess hängt — genau einmal je Prozess. */
  exitHooked?: boolean;
  /** Der fertig geseedete Datenpfad als Kopiervorlage; siehe `resetDeps`. */
  seedSnapshot?: { dir: string; forDataPath: string };
}

const holder: Holder = ((globalThis as unknown as { __kompass?: Holder }).__kompass ??= {
  deps: null,
  resetting: null,
});

/**
 * Beim Beenden die Datenbank schliessen.
 *
 * Next beantwortet ein `SIGTERM` (`docker stop`) selbst mit `process.exit`. Ohne
 * `close()` überträgt SQLite die WAL-Datei nie in die Hauptdatei — am 19.09.
 * stand in Prod der ganze Bestand in `kompass.db-wal`. Im `exit`-Ereignis läuft
 * nur noch synchroner Code; `better-sqlite3` ist synchron, das reicht.
 */
function closeOnExit(): void {
  try {
    holder.deps?.close();
  } catch {
    // War schon zu.
  }
  holder.deps = null;
  if (holder.seedSnapshot) {
    rmSync(holder.seedSnapshot.dir, { recursive: true, force: true });
    holder.seedSnapshot = undefined;
  }
}

export function runtimeEnv() {
  return readEnv();
}

function openDeps(): AppDeps {
  const env = readEnv();
  return createDeps({
    dataPath: env.dataPath,
    env: env.env,
    modules: installedModules,
    coreTemplates: coreDocumentTemplates(),
    documents: createDocumentEngine({ documentTemplatesDir: env.documentTemplatesDir }),
    textExtraction: createTextExtraction(),
    pdf: createPdfTools(),
  });
}

/**
 * Vor dem Zugriff abwarten, falls gerade zurückgesetzt wird.
 *
 * `getDeps()` ist synchron und kann nicht warten — die Aufrufer können es. Wer
 * mitten in einen Reset läuft, bekommt deshalb nicht eine Ausnahme (das traf
 * auch Vorabrufe und endete als Fehler im Browser) und legt auch nicht die
 * Datenbank neu an, während sie gerade gelöscht wird (das liess den Reset mit
 * ENOTEMPTY scheitern). Er wartet.
 */
export async function depsReady(): Promise<void> {
  while (holder.resetting) await holder.resetting;
}

export function getDeps(): AppDeps {
  if (!holder.deps) holder.deps = openDeps();
  if (!holder.exitHooked) {
    holder.exitHooked = true;
    process.once('exit', closeOnExit);
  }
  return holder.deps;
}

/**
 * Eine Verbindung aus dem Verkehr ziehen, ohne sie jemandem unter den Händen
 * wegzureissen.
 *
 * Ein Route Handler holt seine Deps am Anfang und fasst die Datenbank erst am
 * Ende wieder an — dazwischen rendert Typst, baut Astro, läuft eine Vorschau.
 * Wurde sofort geschlossen, meldete `previewDraft` mitten darin
 * `TypeError: The database connection is not open`.
 *
 * Mitzählen, wer gerade arbeitet, klingt naheliegend und trägt nicht: `after()`
 * hängt an der Antwort, nicht am Handler. Bricht der Browser ab — beim Neuladen
 * eines `<iframe>` mit der Vorschau ständig — gilt die Antwort als erledigt,
 * während der Code weiterrechnet; gemessen am 14.09. begann `previewDraft` mit
 * einem Zählerstand von null. Ein `try/finally` um jeden Handler träfe es, wäre
 * aber eine Regel, an die siebzehn Routen und jede künftige denken müssten.
 *
 * Also gar keine Buchhaltung: Die Datei ist gelöscht, der neue Bestand steht
 * woanders, und wer noch auf der alten Verbindung rechnet, rechnet auf einem
 * Inode zu Ende, den niemand mehr liest. Geschlossen wird sie danach trotzdem —
 * sonst bliebe je Reset ein Dateizeiger liegen, und ein Testlauf macht
 * hundertfünfzig davon.
 */
function retire(deps: AppDeps | null, closeDelayMs: number): void {
  if (!deps) return;
  // `unref`, damit dieser Timer den Prozess nicht am Leben hält.
  setTimeout(() => {
    try {
      deps.close();
    } catch {
      // War schon zu — etwa weil ein Test den Halter selbst geleert hat.
    }
  }, closeDelayMs).unref();
}

/**
 * Wo der Schnappschuss des geseedeten Datenpfads liegt.
 *
 * Im Temp-Verzeichnis, nicht neben `dataPath`: Im Container ist `/data` ein
 * Volume, und ob `node` daneben schreiben darf, hängt vom Wirt ab. Prozess und
 * Datenpfad stehen im Namen, damit sich zwei Server (Worker, Worktrees) nicht
 * gegenseitig die Vorlage überschreiben.
 */
function seedSnapshotDir(dataPath: string): string {
  const key = createHash('sha1').update(dataPath).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `kompass-seed-${process.pid}-${key}`);
}

/** Nur für Tests: die Datenbank innerhalb des Schnappschusses. */
export function seedSnapshotDatabasePath(): string {
  return databasePathIn(seedSnapshotDir(readEnv().dataPath));
}

/**
 * Was der Schnappschuss enthält: den Bestand, sonst nichts.
 *
 * WAL und Shared-Memory bleiben draussen: Nach dem Checkpoint steht alles in
 * der Hauptdatei, und eine mitkopierte `-shm` beschreibt einen Zustand, den es
 * am Ziel nie gab. Bereitgestelltes Material (`providedFiles`, etwa das
 * Template im Volume) bleibt draussen, weil `resetDataPath` es stehen lässt —
 * und weil darin ein Symlink auf die Module des Images liegt, an dem `cp`
 * beim Zurückkopieren mit EINVAL scheiterte (Container-Ring, 26.09.).
 */
function snapshotFilter(dataPath: string, snapshotDir: string): (source: string) => boolean {
  const provided = providedPaths(dataPath, [coreModule, ...installedModules]);
  const providedInSnapshot = providedPaths(snapshotDir, [coreModule, ...installedModules]);
  return (source) =>
    !/\.db-(wal|shm)$/.test(source) && !isProvided(source, provided) && !isProvided(source, providedInSnapshot);
}

/**
 * Den Seed genau einmal je Prozess rechnen und danach nur noch kopieren.
 *
 * Gemessen am 26.09. (M5 Max): ein leerer Reset 0,02 s, ein geseedeter 0,89 s —
 * die Differenz ist `seedDevelopment` für Kern und alle Module, und die
 * E2E-Suite bezahlt sie vor jedem ihrer 359 Fälle. Der Seed selbst ist
 * deterministisch und per `seed.test.ts` je Modul geprüft; hier ändert sich
 * nicht, **was** ein Test vorfindet, sondern nur, wie es entsteht.
 *
 * Der Schnappschuss entsteht aus dem echten Datenpfad, nicht aus einem
 * anderen Verzeichnis: So bleibt jeder Pfad, den der Seed womöglich ablegt,
 * beim Zurückkopieren gültig. Er gilt für einen Prozess und einen Datenpfad;
 * ein `next dev` lädt geänderten Seed-Code erst mit dem nächsten Start — für
 * einen E2E-Lauf, der seinen Server selbst startet, ist das die Regel.
 */
async function seedFromSnapshot(deps: AppDeps, dataPath: string): Promise<AppDeps> {
  const snapshot = holder.seedSnapshot;
  const dir = seedSnapshotDir(dataPath);
  const filter = snapshotFilter(dataPath, dir);
  if (snapshot && snapshot.forDataPath === dataPath) {
    deps.close();
    await cp(snapshot.dir, dataPath, { recursive: true, force: true, filter });
    return openDeps();
  }
  await seedDevelopment(deps);
  // Alles in die Hauptdatei, damit die Kopie vollständig ist.
  deps.sqlite.pragma('wal_checkpoint(TRUNCATE)');
  await rm(dir, { recursive: true, force: true });
  await cp(dataPath, dir, { recursive: true, filter });
  holder.seedSnapshot = { dir, forDataPath: dataPath };
  return deps;
}

/**
 * Nur für E2E-Tests (APP_ENV=test): Datenbank verwerfen und neu aufsetzen.
 *
 * Der Hintergrunddienst wird dabei angehalten, nicht nur angetippt. Seit der
 * Texterkennung
 * ist dieser Ablauf nicht mehr allein: Der Textworker rief `getDeps()` aus einem
 * Timer heraus, also mitten in die `await`-Punkte hier hinein. Traf er das
 * Fenster zwischen dem Leeren und dem Löschen der Datei, legte er die Deps auf
 * der alten Datei an; der offene Handle hält den gelöschten Inode mitsamt
 * Inhalt am Leben, und der Reset blieb wirkungslos. Genau so überlebte am
 * 11.09. ein Sperrwort aus dem vorhergehenden Test seinen `resetDatabase` und
 * verhinderte im dritten Prüfring den Publish.
 *
 * Der neue Bestand wird am Ende **ausdrücklich** gesetzt statt über `getDeps()`
 * geholt — das ist der Teil, der die Lücke schliesst.
 */
export async function resetDeps(mode: 'empty' | 'seeded', closeDelayMs = 30_000): Promise<void> {
  const env = readEnv();
  if (env.env !== 'test') throw new Error('resetDeps is only available in the test environment');

  // Den Worker anhalten, statt `getDeps()` zu sperren: Ein angehaltener Dienst
  // kann die Deps nicht mitten im Reset neu anlegen, und eine Anfrage, die
  // zufällig in dasselbe Fenster läuft, bekommt trotzdem eine Antwort.
  const background = await import('./background');
  await background.stopBackgroundWork();

  let done!: () => void;
  holder.resetting = new Promise<void>((resolve) => {
    done = resolve;
  });
  try {
    await resetMcpHandler();
    retire(holder.deps, closeDelayMs);
    holder.deps = null;
    // Bestand weg, bereitgestelltes Material bleibt: Ohne die Unterscheidung
    // risse jeder Testlauf das Template aus dem Volume.
    await resetDataPath(env.dataPath, [coreModule, ...installedModules]);
    let deps = openDeps();
    if (mode === 'seeded') deps = await seedFromSnapshot(deps, env.dataPath);
    // Erst ganz zum Schluss sichtbar machen: Bis hierher soll niemand einen
    // halb eingerichteten Bestand zu sehen bekommen.
    holder.deps = deps;
  } finally {
    holder.resetting = null;
    done();
    background.restartBackgroundWork();
  }

  await resetMcpHandler();
  background.textWorker()?.wake();
}
