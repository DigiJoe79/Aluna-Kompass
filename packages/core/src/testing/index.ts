import type Database from 'better-sqlite3';
import { fixedClock, type FixedClock } from '../clock';
import type { CallContext } from '../context';
import { coreModule } from '../core-module';
import { roles, users } from '../db/schema';
import type { AppEnv, Deps } from '../deps';
import { newId } from '../ids';
import { createMemoryMediaStore } from '../media/store';
import type { DocumentTemplate, ModuleManifest } from '../modules/manifest';
import { createRegistry } from '../modules/registry';
import { createTestDb } from './test-db';
import { readLocales } from '../i18n/locales';

export { systemContext } from '../context';

export const TEST_NOW = '2026-09-05T08:00:00.000Z';

export interface TestDeps extends Deps {
  clock: FixedClock;
  sqlite: Database.Database;
}

export function createTestDeps(
  opts: { now?: string; manifests?: ModuleManifest[]; env?: AppEnv; coreTemplates?: DocumentTemplate[] } = {},
): TestDeps {
  const { db, sqlite } = createTestDb();
  const deps: TestDeps = {
    db,
    sqlite,
    clock: fixedClock(opts.now ?? TEST_NOW),
    env: opts.env ?? 'test',
    registry: createRegistry(opts.manifests ?? [coreModule], { coreTemplates: opts.coreTemplates }),
    media: createMemoryMediaStore(),
    locales: () => readLocales(deps),
  };
  return deps;
}

export function ctxWith(permissions: readonly string[], userId: string | null = 'USER-TEST'): CallContext {
  return {
    userId,
    permissions: new Set(permissions),
    channel: 'ui',
    apiTokenId: null,
    ipAddress: '127.0.0.1',
    requestId: 'REQ-TEST',
  };
}

export function insertRole(deps: Deps, overrides: { name: string; isProtected?: boolean }): string {
  const id = newId();
  deps.db
    .insert(roles)
    .values({ id, name: overrides.name, description: '', isProtected: overrides.isProtected ?? false, createdAt: TEST_NOW })
    .run();
  return id;
}

export function insertUser(
  deps: Deps,
  overrides: { id?: string; name?: string; email?: string; isActive?: boolean; passwordHash?: string },
): string {
  const id = overrides.id ?? newId();
  deps.db
    .insert(users)
    .values({
      id,
      name: overrides.name ?? 'Test Person',
      email: overrides.email ?? `${id.toLowerCase()}@example.org`,
      passwordHash: overrides.passwordHash ?? '$argon2id$placeholder',
      isActive: overrides.isActive ?? true,
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
    })
    .run();
  return id;
}
