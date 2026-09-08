import { rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDeps, readEnv, seedDevelopment, setSetting, unwrap, type AppEnv, type CallContext } from '@kompass/core';
import { coreDocumentTemplates, createTypstRenderer } from '@kompass/documents';
import { animalsModule } from '@kompass/module-animals';
import { siteModule } from '@kompass/module-site';
import { importPrototype } from './import-prototype';

/** Liest `site.name` aus den Prototyp-Daten; null, wenn die Datei fehlt oder keinen Namen trägt. */
async function prototypeOrganizationName(prototypeDir: string): Promise<string | null> {
  try {
    const mod = (await import(pathToFileURL(path.join(prototypeDir, 'src/data/site.js')).href)) as {
      site?: { name?: unknown };
    };
    const name = mod.site?.name;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

export interface DevResetOptions {
  env: AppEnv;
  databasePath: string;
  mediaPath: string;
  prototypeDir: string;
}

/**
 * Verwirft die Entwicklungsdatenbank samt Medien und baut sie neu auf:
 * Seed (Verein, Rollen, Nutzer, Module) plus die Inhalte aus dem Prototyp.
 * Ausschliesslich für die Entwicklung — Test und Produktion sind gesperrt.
 */
export async function devReset(opts: DevResetOptions) {
  if (opts.env !== 'development') {
    throw new Error(`dev:reset runs only in the development environment, not in ${opts.env}`);
  }
  for (const target of [opts.databasePath, `${opts.databasePath}-wal`, `${opts.databasePath}-shm`, opts.mediaPath]) {
    await rm(target, { recursive: true, force: true });
  }
  const deps = createDeps({
    databasePath: opts.databasePath,
    mediaPath: opts.mediaPath,
    env: opts.env,
    modules: [siteModule, animalsModule],
    coreTemplates: coreDocumentTemplates(createTypstRenderer()),
  });
  try {
    const { adminEmail, adminPassword } = await seedDevelopment(deps);
    const ctx: CallContext = {
      userId: null,
      permissions: new Set(deps.registry.permissionKeys),
      channel: 'system',
      apiTokenId: null,
      ipAddress: null,
      requestId: 'DEV-RESET',
    };
    const counts = await importPrototype(deps, ctx, { prototypeDir: opts.prototypeDir });
    // Der Vereinsname ist Stammdatum des Kerns, keine Webseiten-Einstellung; der
    // Import lässt ihn deshalb in Ruhe. Für die Entwicklung ist der Name des
    // Prototyps aber die brauchbarere Vorgabe als der des Musterverein-Seeds.
    const organizationName = await prototypeOrganizationName(opts.prototypeDir);
    if (organizationName) unwrap(await setSetting(deps, ctx, { key: 'organization.name', value: organizationName }));
    return { adminEmail, adminPassword, counts, organizationName };
  } finally {
    deps.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = path.resolve(import.meta.dirname, '..');
  const runtime = readEnv({ SESSION_SECRET: 'dev-reset-only-not-a-real-secret-0000', ...process.env });
  devReset({
    env: runtime.env,
    // Vorgabe ist die Datenbank der App; die liest sie mit cwd apps/kompass als ./data.
    databasePath: process.env.DATABASE_PATH ?? path.join(root, 'apps/kompass/data/kompass.db'),
    mediaPath: process.env.MEDIA_PATH ?? path.join(root, 'apps/kompass/media'),
    prototypeDir: process.env.PROTOTYPE_DIR ?? '/Users/joe/Development/Aluna Tierhilfe e.V./Webseite/aluna-static',
  })
    .then(({ adminEmail, adminPassword, counts }) => {
      console.log('Zurückgesetzt und importiert:', counts);
      console.log(`Login: ${adminEmail} / ${adminPassword}`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
