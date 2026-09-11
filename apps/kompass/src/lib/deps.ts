
import { coreDocumentTemplates, createDocumentEngine } from '@kompass/documents';
import { coreModule, createDeps, readEnv, resetDataPath, seedDevelopment } from '@kompass/core';
import { createTextExtraction } from '@kompass/text-extraction';
import { installedModules } from '../modules';
import { resetMcpHandler } from './mcp';

export type AppDeps = import('@kompass/core').AppDeps;

interface Holder {
  deps: AppDeps | null;
  /** Solange gesetzt, gibt es keine Deps — weder alte noch neue. Siehe `resetDeps`. */
  resetting: boolean;
}

const holder: Holder = ((globalThis as unknown as { __kompass?: Holder }).__kompass ??= {
  deps: null,
  resetting: false,
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

export function getDeps(): AppDeps {
  // Während des Resets ist die Datei unter uns weg. Wer jetzt anlegt, öffnet
  // sie ein letztes Mal und hält den gelöschten Inode am Leben — siehe
  // `resetDeps`. Ein Fehler ist die ehrlichere Antwort als ein Handle, der auf
  // Bestand zeigt, den es nicht mehr gibt.
  if (holder.resetting) throw new Error('deps are being reset');
  if (!holder.deps) holder.deps = openDeps();
  return holder.deps;
}

/**
 * Nur für E2E-Tests (APP_ENV=test): Datenbank verwerfen und neu aufsetzen.
 *
 * Der Halter wird dabei **gesperrt**, nicht nur geleert. Seit der Texterkennung
 * ist dieser Ablauf nicht mehr allein: Der Textworker ruft `getDeps()` aus einem
 * Timer heraus, also mitten in die `await`-Punkte hier hinein. Trifft er das
 * Fenster zwischen dem Leeren und dem Löschen der Datei, legt er die Deps auf
 * der alten Datei an; der offene Handle hält den gelöschten Inode mitsamt
 * Inhalt am Leben, und der Reset bleibt wirkungslos. Genau so überlebte am
 * 11.09. ein Sperrwort aus dem vorhergehenden Test seinen `resetDatabase` und
 * verhinderte im dritten Prüfring den Publish.
 */
export async function resetDeps(mode: 'empty' | 'seeded'): Promise<void> {
  const env = readEnv();
  if (env.env !== 'test') throw new Error('resetDeps is only available in the test environment');

  holder.resetting = true;
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
    holder.resetting = false;
  }

  await resetMcpHandler();
  const { textWorker } = await import('./background');
  textWorker()?.wake();
}
