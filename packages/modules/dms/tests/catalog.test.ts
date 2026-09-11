import { coreModule } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { dmsModule } from '../src/manifest';
import { DEFAULT_DOCUMENT_TYPES, documentTypeFor, listDocumentTypes } from '../src/catalog';
import { documentTypes } from '../src/schema';

const ALL_DMS = ['dms.view', 'dms.create', 'dms.file', 'dms.void', 'dms.deleteDraft', 'dms.manage'];

function setup(permissions: readonly string[] = ALL_DMS) {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule] });
  return { deps, ctx: ctxWith(permissions, insertUser(deps, { name: 'Test', email: 'test@kompass.local' })) };
}

describe('document types', () => {
  it('liefert Präfix und Fristklasse zu einem Schlüssel', () => {
    const { deps } = setup();
    deps.db.insert(documentTypes).values({ key: 'letter', label: 'Brief', prefix: 'BRF', defaultDirection: 'outgoing', retentionClass: 'statutory6Y' }).run();
    expect(documentTypeFor(deps.db, 'letter')?.prefix).toBe('BRF');
    expect(documentTypeFor(deps.db, 'gibtsnicht')).toBeNull();
  });

  it('verlangt dms.view', async () => {
    const { deps } = setup();
    const denied = await listDocumentTypes(deps, ctxWith(ALL_DMS.filter((p) => p !== 'dms.view')), {});
    expect(denied.ok).toBe(false);
  });

  it('hat für jede Vorgabeart ein dreistelliges Präfix', () => {
    for (const type of DEFAULT_DOCUMENT_TYPES) expect(type.prefix).toMatch(/^[A-Z]{3}$/);
  });
});
