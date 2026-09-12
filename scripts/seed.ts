import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDeps, readEnv, seedDevelopment, type AppEnv } from '@kompass/core';
import { coreDocumentTemplates, createDocumentEngine } from '@kompass/documents';
import { animalsModule } from '@kompass/module-animals';
import { projectsModule } from '@kompass/module-projects';
import { contactsModule } from '@kompass/module-contacts';
import { dmsModule } from '@kompass/module-dms';
import { siteModule } from '@kompass/module-site';

export interface SeedOptions {
  env: AppEnv;
  dataPath: string;
}

/**
 * Der Entwicklungs-Seed mit allen installierten Modulen — ohne etwas zu
 * verwerfen. `pnpm --filter @kompass/core seed` kennt nur den Kern: Er
 * schaltet kein Modul ein und lässt deren Seeds aus (Befund 5 der Durchsicht
 * vom 2026-09-12). `dev:reset` kennt die Module, verwirft aber alles und
 * braucht den Prototyp. Dies ist der Weg dazwischen: Was fehlt, kommt dazu;
 * was da ist, bleibt. Läuft nur in `development`, wie `seedDevelopment` selbst.
 */
export async function seedWithModules(opts: SeedOptions): Promise<{ adminEmail: string; adminPassword: string }> {
  const deps = createDeps({
    dataPath: opts.dataPath,
    env: opts.env,
    modules: [siteModule, projectsModule, animalsModule, contactsModule, dmsModule],
    coreTemplates: coreDocumentTemplates(),
    documents: createDocumentEngine(),
  });
  try {
    return await seedDevelopment(deps);
  } finally {
    deps.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = path.resolve(import.meta.dirname, '..');
  const runtime = readEnv({ SESSION_SECRET: 'seed-only-not-a-real-secret-value-0000', ...process.env });
  seedWithModules({
    env: runtime.env,
    // Vorgabe ist das Datenverzeichnis der App; die liest es mit cwd apps/kompass als ./data.
    dataPath: process.env.DATA_PATH ?? path.join(root, 'apps/kompass/data'),
  })
    .then(({ adminEmail, adminPassword }) => {
      console.log(`Seed abgeschlossen. Login: ${adminEmail} / ${adminPassword}`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
