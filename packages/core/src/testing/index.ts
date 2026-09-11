import type Database from 'better-sqlite3';
import { fixedClock, type FixedClock } from '../clock';
import type { CallContext } from '../context';
import { coreModule } from '../core-module';
import { roles, settings, users } from '../db/schema';
import type { AppEnv, Deps } from '../deps';
import { newId } from '../ids';
import { createMemoryFileStore } from '../files/store';
import type { DocumentEngine } from '../documents/engine';
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

/** Attrappe der Dokument-Engine für Kern-Tests: liefert Fake-PDF-Bytes, drei Basen. */
export function fakeDocumentEngine(overrides: Partial<DocumentEngine> = {}): DocumentEngine {
  const bases = [
    { id: 'a4-plain', label: 'A4 ohne Briefkopf', kind: 'report', checksum: 'a'.repeat(64) },
    { id: 'a4-mit-briefkopf', label: 'A4 mit Briefkopf', kind: 'letter', checksum: 'b'.repeat(64) },
    { id: 'a4-ohne-briefkopf', label: 'A4 Folgeblatt', kind: 'letter', checksum: 'c'.repeat(64) },
  ];
  return {
    bases: () => bases,
    base: (id) => bases.find((b) => b.id === id),
    probe: async (id) => (bases.some((b) => b.id === id) ? { ok: true } : { ok: false, error: 'not found' }),
    render: async ({ baseId, slots }) => new TextEncoder().encode(`%PDF-fake ${baseId} ${slots.title ?? ''}`),
    ...overrides,
  };
}

export function createTestDeps(
  opts: {
    now?: string;
    manifests?: ModuleManifest[];
    env?: AppEnv;
    coreTemplates?: DocumentTemplate[];
    documents?: DocumentEngine;
    locales?: string[];
  } = {},
): TestDeps {
  const { db, sqlite } = createTestDb();
  /** Je Modul ein eigener In-Memory-Speicher, damit Tests sie nicht vermischen. */
  const memoryStores = new Map<string, ReturnType<typeof createMemoryFileStore>>();
  if (opts.locales) {
    db.insert(settings)
      .values({ key: 'i18n.locales', value: JSON.stringify(opts.locales), updatedAt: opts.now ?? TEST_NOW })
      .run();
  }
  const deps: TestDeps = {
    db,
    sqlite,
    clock: fixedClock(opts.now ?? TEST_NOW),
    env: opts.env ?? 'test',
    registry: createRegistry(opts.manifests ?? [coreModule], { coreTemplates: opts.coreTemplates }),
    media: createMemoryFileStore(),
    files: (moduleKey: string) => {
      const store = memoryStores.get(moduleKey) ?? createMemoryFileStore();
      memoryStores.set(moduleKey, store);
      return store;
    },
    documents: opts.documents ?? fakeDocumentEngine(),
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
