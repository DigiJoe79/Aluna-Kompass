
import { coreDocumentTemplates, createDocumentEngine } from '@kompass/documents';
import { coreModule, createDeps, readEnv, resetDataPath, seedDevelopment } from '@kompass/core';
import { createTextExtraction } from '@kompass/text-extraction';
import { installedModules } from '../modules';
import { resetMcpHandler } from './mcp';

export type AppDeps = import('@kompass/core').AppDeps;

interface Holder {
  deps: AppDeps | null;
  /** Läuft gerade ein Reset, steht hier sein Versprechen. Siehe `depsReady`. */
  resetting: Promise<void> | null;
}

const holder: Holder = ((globalThis as unknown as { __kompass?: Holder }).__kompass ??= {
  deps: null,
  resetting: null,
});

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
    const deps = openDeps();
    if (mode === 'seeded') await seedDevelopment(deps);
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
