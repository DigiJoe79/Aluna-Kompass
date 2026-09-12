import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDeps, readSetting } from '@kompass/core';
import { coreDocumentTemplates, createDocumentEngine } from '@kompass/documents';
import { documents } from '@kompass/module-dms';
import { describe, expect, it } from 'vitest';
import { seedWithModules } from '../../../scripts/seed';
import { installedModules } from '@/modules';

/**
 * `pnpm seed` kennt die Module — anders als der Seed des Kerns, der beim
 * Durchklicken am 2026-09-12 eine leere Akte hinterliess (Befund 5).
 */
describe('scripts/seed', () => {
  it('schaltet die Module ein und lässt ihre Seeds laufen, ohne Vorhandenes zu verwerfen', async () => {
    const dataPath = mkdtempSync(path.join(tmpdir(), 'kompass-seed-'));
    try {
      const first = await seedWithModules({ env: 'development', dataPath });
      expect(first.adminEmail).toBe('admin@kompass.local');
      const deps = createDeps({ dataPath, env: 'development', modules: installedModules, coreTemplates: coreDocumentTemplates(), documents: createDocumentEngine() });
      try {
        expect(readSetting<string[]>(deps, 'modules.enabled').sort()).toEqual(installedModules.map((m) => m.key).sort());
        const count = deps.db.select().from(documents).all().length;
        expect(count).toBeGreaterThan(0);
        deps.close();
        await seedWithModules({ env: 'development', dataPath });
        const again = createDeps({ dataPath, env: 'development', modules: installedModules, coreTemplates: coreDocumentTemplates(), documents: createDocumentEngine() });
        expect(again.db.select().from(documents).all().length).toBe(count);
        again.close();
      } finally {
        /* deps oben geschlossen */
      }
    } finally {
      rmSync(dataPath, { recursive: true, force: true });
    }
  });
});
