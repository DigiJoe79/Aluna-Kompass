
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
  /** Wie viele Anfragen gerade in Bearbeitung sind. Siehe `enterRequest`. */
  inFlight: number;
}

const holder: Holder = ((globalThis as unknown as { __kompass?: Holder }).__kompass ??= {
  deps: null,
  resetting: null,
  inFlight: 0,
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

/**
 * Die zweite Hälfte des Tores: wer noch drin ist.
 *
 * `depsReady()` hält auf, wer während eines Resets **ankommt**. Wer schon durch
 * ist, hielt bisher nichts auf — eine Anfrage, die ihre Deps geholt hat und
 * danach sekundenlang rechnet (Typst-Rendering, Draft-Vorschau, Astro-Build),
 * verlor die Datenbank unter sich, sobald zurückgesetzt wurde. `resetDeps`
 * wartet deshalb, bis dieser Zähler auf null steht.
 *
 * Angemeldet wird in `optionalSession()`, abgemeldet über `after()` — siehe
 * `request-context.ts`.
 */
export function enterRequest(): void {
  holder.inFlight += 1;
}

export function leaveRequest(): void {
  if (holder.inFlight > 0) holder.inFlight -= 1;
}

/**
 * Warten, bis keine Anfrage mehr in Bearbeitung ist — höchstens aber `graceMs`.
 *
 * Die Frist ist kein Schönheitsfehler, sondern die Absicherung gegen ein Leck:
 * Läuft `after()` einmal nicht (ein abgebrochener Client ist der Verdachtsfall,
 * `The destination stream closed early` steht in den Protokollen), bliebe der
 * Zähler stehen und der Reset für immer davor. Nach der Frist setzt er trotzdem
 * zurück — das Verhalten verfällt damit auf das von vorher, nie auf ein
 * schlechteres. Die Zeile im Protokoll ist der Unterschied zwischen einem Leck,
 * das auffällt, und einem, das nicht auffällt.
 *
 * Zehn Sekunden, nicht zwei: Mit zwei Sekunden zog die Frist in einem vollen
 * Durchlauf einmal, und zwar an der Stelle, an der der Astro-Bau der Vorschau
 * läuft — eine ehrlich lange Anfrage, kein Leck. Ein echtes Leck bliebe stehen
 * und meldete sich bei **jedem** folgenden Reset; einmal heisst, jemand hat
 * gearbeitet. Die Frist muss darüber liegen, sonst schneidet sie genau das ab,
 * wofür sie gebaut ist.
 */
async function drainRequests(graceMs: number): Promise<void> {
  const deadline = Date.now() + graceMs;
  while (holder.inFlight > 0) {
    if (Date.now() >= deadline) {
      console.warn(`[reset] ${holder.inFlight} Anfrage(n) noch offen nach ${graceMs}ms — es wird trotzdem zurückgesetzt`);
      holder.inFlight = 0;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export function getDeps(): AppDeps {
  if (!holder.deps) holder.deps = openDeps();
  return holder.deps;
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
export async function resetDeps(mode: 'empty' | 'seeded', graceMs = 10_000): Promise<void> {
  const env = readEnv();
  if (env.env !== 'test') throw new Error('resetDeps is only available in the test environment');

  // Den Worker anhalten, statt `getDeps()` zu sperren: Ein angehaltener Dienst
  // kann die Deps nicht mitten im Reset neu anlegen, und eine Anfrage, die
  // zufällig in dasselbe Fenster läuft, bekommt trotzdem eine Antwort.
  const background = await import('./background');
  await background.stopBackgroundWork();

  await drainRequests(graceMs);

  let done!: () => void;
  holder.resetting = new Promise<void>((resolve) => {
    done = resolve;
  });
  try {
    await resetMcpHandler();
    holder.deps?.close();
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
