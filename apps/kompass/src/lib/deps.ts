import { rmSync } from 'node:fs';
import { createDeps, readEnv, seedDevelopment, type Deps } from '@kompass/core';

export type AppDeps = Deps & { migrationCount: number; close(): void };

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
    holder.deps = createDeps({ databasePath: env.databasePath, mediaPath: env.mediaPath, env: env.env });
  }
  return holder.deps;
}

/** Nur für E2E-Tests (APP_ENV=test): Datenbank verwerfen und neu aufsetzen. */
export async function resetDeps(mode: 'empty' | 'seeded'): Promise<void> {
  const env = readEnv();
  if (env.env !== 'test') throw new Error('resetDeps is only available in the test environment');
  holder.deps?.close();
  holder.deps = null;
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${env.databasePath}${suffix}`, { force: true });
  rmSync(env.mediaPath, { recursive: true, force: true });
  const deps = getDeps();
  if (mode === 'seeded') await seedDevelopment(deps);
}
