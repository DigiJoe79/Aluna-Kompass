import { coreModule, unwrap, writeSettingInternal } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { animalDeletionPreview, animalsModule, createAnimal, deleteAnimal } from '@kompass/module-animals';
import { contactsModule } from '@kompass/module-contacts';
import { EXAMPLE_DOCUMENT_TYPES, createDraft, dmsModule, documentTypes, unlinkDocument } from '@kompass/module-dms';
import { describe, expect, it } from 'vitest';

function setup() {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, animalsModule, dmsModule] });
  const userId = insertUser(deps, { name: 'Test', email: 'test@kompass.local' });
  for (const [index, type] of EXAMPLE_DOCUMENT_TYPES.entries()) deps.db.insert(documentTypes).values({ ...type, sortOrder: index }).run();
  deps.db.transaction((tx) => {
    writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['contacts', 'animals', 'dms'], 'test.enable');
  });
  const ctx = ctxWith(['animals.manage', 'animals.view', 'dms.view', 'dms.create', 'dms.manage', 'media.upload'], userId);
  return { deps, ctx };
}

describe('ein Tier mit Aktenbezug', () => {
  it('bleibt, solange ein Entwurf darauf zeigt, und geht, sobald der Bezug gelöst ist', async () => {
    const { deps, ctx } = setup();
    const animal = unwrap(await createAnimal(deps, ctx, { slug: 'rocky', name: 'Rocky', sex: 'male', birthText: {}, sizeText: {}, summary: {}, body: {} }));
    const draft = unwrap(await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Anfrage Tierarzt', body: 'x', links: [{ entityType: 'animal', entityId: animal.id, role: 'about' }] }));

    const preview = unwrap(await animalDeletionPreview(deps, ctx, animal.id));
    expect(preview.references).toEqual([{ label: 'Dokument „Anfrage Tierarzt“ (Entwurf)', entity: 'document', id: draft.id, href: `/dms/${draft.id}` }]);
    const refused = await deleteAnimal(deps, ctx, { id: animal.id });
    expect(refused.ok === false && refused.error.type === 'conflict' && refused.error.code).toBe('stillReferenced');

    const link = draft.links.find((l) => l.entityType === 'animal')!;
    unwrap(await unlinkDocument(deps, ctx, { id: link.id }));
    expect((await deleteAnimal(deps, ctx, { id: animal.id })).ok).toBe(true);
  });
});
