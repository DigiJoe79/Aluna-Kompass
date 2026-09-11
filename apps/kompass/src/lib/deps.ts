
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

export function getDeps(): AppDeps {
  if (!holder.deps) {
    const env = readEnv();
    holder.deps = createDeps({
      dataPath: env.dataPath,
      env: env.env,
      modules: installedModules,
      coreTemplates: coreDocumentTemplates(),
      documents: createDocumentEngine({ documentTemplatesDir: env.documentTemplatesDir }),
      textExtraction: createTextExtraction(),
    });
  }
  return holder.deps;
}

/** Nur für E2E-Tests (APP_ENV=test): Datenbank verwerfen und neu aufsetzen. */
export async function resetDeps(mode: 'empty' | 'seeded'): Promise<void> {
  const env = readEnv();
  if (env.env !== 'test') throw new Error('resetDeps is only available in the test environment');
  await resetMcpHandler();
  holder.deps?.close();
  holder.deps = null;
  // Bestand weg, bereitgestelltes Material bleibt: Ohne die Unterscheidung
  // risse jeder Testlauf das Template aus dem Volume.
  await resetDataPath(env.dataPath, [coreModule, ...installedModules]);
  const deps = getDeps();
  if (mode === 'seeded') await seedDevelopment(deps);
  await resetMcpHandler();
  const { textWorker } = await import('./background');
  textWorker()?.wake();
}