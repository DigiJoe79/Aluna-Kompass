import type Database from 'better-sqlite3';
import { fixedClock, type FixedClock } from '../clock';
import type { CallContext } from '../context';
import { coreModule } from '../core-module';
import type { AppEnv, Deps } from '../deps';
import type { ModuleManifest } from '../modules/manifest';
import { createRegistry } from '../modules/registry';
import { createTestDb } from './test-db';

export { systemContext } from '../context';

export const TEST_NOW = '2026-09-05T08:00:00.000Z';

export interface TestDeps extends Deps {
  clock: FixedClock;
  sqlite: Database.Database;
}

export function createTestDeps(
  opts: { now?: string; manifests?: ModuleManifest[]; env?: AppEnv } = {},
): TestDeps {
  const { db, sqlite } = createTestDb();
  return {
    db,
    sqlite,
    clock: fixedClock(opts.now ?? TEST_NOW),
    env: opts.env ?? 'test',
    registry: createRegistry(opts.manifests ?? [coreModule]),
  };
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
