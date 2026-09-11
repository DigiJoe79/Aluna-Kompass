import { coreModule } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { dmsModule } from '../src/manifest';
import { documentFolders, documents, documentTypes } from '../src/schema';
import { seedDms } from '../src/seed';
import { ALL_DMS } from './helpers';

function setup() {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule] });
  const userId = insertUser(deps, { name: 'Admin', email: 'admin@kompass.local' });
  return {
    deps,
    ctx: ctxWith([...ALL_DMS, 'media.upload', 'contacts.manage'], userId),
  };
}

describe('seedDms', () => {
  it('legt Arten, Ordner und Beispieldokumente an', async () => {
    const { deps, ctx } = setup();
    await seedDms(deps, ctx);
    expect(deps.db.select().from(documentTypes).all().length).toBeGreaterThanOrEqual(5);
    expect(deps.db.select().from(documentFolders).all().length).toBeGreaterThan(0);
    const docs = deps.db.select().from(documents).all();
    expect(docs.some((d) => d.phase === 'draft')).toBe(true);
    expect(docs.some((d) => d.phase === 'issued' && d.direction === 'outgoing')).toBe(true);
    expect(docs.some((d) => d.direction === 'incoming' && d.folder === null)).toBe(true);
  });

  it('läuft zweimal, ohne zu verdoppeln', async () => {
    const { deps, ctx } = setup();
    await seedDms(deps, ctx);
    const after = deps.db.select().from(documents).all().length;
    await seedDms(deps, ctx);
    expect(deps.db.select().from(documents).all().length).toBe(after);
  });
});
