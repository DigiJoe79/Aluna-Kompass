import { coreModule, readSetting, setModuleEnabled, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { updateDocumentType } from '../src/catalog';
import { dmsModule } from '../src/manifest';
import { documentFolders, documentTypes } from '../src/schema';

function setup(locales?: string[]) {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule], ...(locales ? { locales } : {}) });
  const userId = insertUser(deps, { name: 'Test', email: 'test@kompass.local' });
  return { deps, ctx: ctxWith(['modules.manage', 'settings.manage', 'dms.manage'], userId) };
}

async function enableDms(deps: Parameters<typeof setModuleEnabled>[0], ctx: Parameters<typeof setModuleEnabled>[1]) {
  unwrap(await setModuleEnabled(deps, ctx, { key: 'contacts', enabled: true }));
  unwrap(await setModuleEnabled(deps, ctx, { key: 'dms', enabled: true }));
}

describe('Einschalten der Akte', () => {
  it('bringt genau zwei unklassifizierte Arten mit und keine Ordner', async () => {
    const { deps, ctx } = setup();
    await enableDms(deps, ctx);

    const types = deps.db.select().from(documentTypes).all();
    expect(types.map((t) => t.key).sort()).toEqual(['unclassified-in', 'unclassified-out']);
    expect(types.every((t) => t.retentionClass === 'statutory10Y')).toBe(true);
    expect(types.find((t) => t.key === 'unclassified-in')?.prefix).toBe('EIN');
    expect(types.find((t) => t.key === 'unclassified-out')?.prefix).toBe('AUS');
    // Der Ordnerbaum ist die Struktur des Vereins, nicht unsere.
    expect(deps.db.select().from(documentFolders).all()).toEqual([]);
  });

  it('zeigt mit den Vorgaben auf die beiden Arten', async () => {
    const { deps, ctx } = setup();
    await enableDms(deps, ctx);
    expect(readSetting<string>(deps, 'dms.defaultTypeIncoming')).toBe('unclassified-in');
    expect(readSetting<string>(deps, 'dms.defaultTypeOutgoing')).toBe('unclassified-out');
  });

  it('beschriftet in der führenden Sprache der Installation', async () => {
    const { deps, ctx } = setup(['en', 'de']);
    await enableDms(deps, ctx);
    expect(deps.db.select().from(documentTypes).all().map((t) => t.label).sort()).toEqual([
      'Unclassified (incoming)',
      'Unclassified (outgoing)',
    ]);
  });

  it('legt beim zweiten Einschalten nichts doppelt an', async () => {
    const { deps, ctx } = setup();
    await enableDms(deps, ctx);
    unwrap(await setModuleEnabled(deps, ctx, { key: 'dms', enabled: false }));
    unwrap(await setModuleEnabled(deps, ctx, { key: 'dms', enabled: true }));
    expect(deps.db.select().from(documentTypes).all()).toHaveLength(2);
  });

  it('lässt eine Art, die gerade Vorgabe ist, nicht stilllegen', async () => {
    const { deps, ctx } = setup();
    await enableDms(deps, ctx);
    const denied = await updateDocumentType(deps, ctx, { key: 'unclassified-out', isActive: false });
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.error.type).toBe('conflict');
    if (denied.error.type !== 'conflict') return;
    expect(denied.error.code).toBe('documentTypeIsDefault');
  });
});
