
import { coreDocumentTemplates, createDocumentEngine } from '@kompass/documents';
import { coreModule, createDeps, readEnv, resetDataPath, seedDevelopment } from '@kompass/core';
import { createTextExtraction } from '@kompass/text-extraction';
import { installedModules } from '../modules';
import { resetMcpHandler } from './mcp';

export type AppDeps = import('@kompass/core').AppDeps;

interface Holder {
  deps: AppDeps | null;
}

const holder: Holder = ((globalThis as unknown as { __kompass?: Holder }).__kompass ??= { deps: null });

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
export async function resetDeps(mode: 'empty' | 'seeded'): Promise<void> {
  const env = readEnv();
  if (env.env !== 'test') throw new Error('resetDeps is only available in the test environment');

  // Den Worker anhalten, statt `getDeps()` zu sperren: Ein angehaltener Dienst
  // kann die Deps nicht mitten im Reset neu anlegen, und eine Anfrage, die
  // zufällig in dasselbe Fenster läuft, bekommt trotzdem eine Antwort.
  const background = await import('./background');
  background.stopBackgroundWork();
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
    background.restartBackgroundWork();
  }

  await resetMcpHandler();
  background.textWorker()?.wake();
}
