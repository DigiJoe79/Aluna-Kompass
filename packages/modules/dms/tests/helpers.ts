import { coreModule, schema, type CallContext, type Deps } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { dmsModule } from '../src/manifest';
import { DEFAULT_DOCUMENT_TYPES } from '../src/catalog';
import { documentTypes } from '../src/schema';

/** `deps` und `ctx` mit installiertem dms-Modul und dem Startsatz an Dokumentarten. */
export const ALL_DMS = ['dms.view', 'dms.create', 'dms.file', 'dms.void', 'dms.deleteDraft', 'dms.manage'];

export function seedTypes(deps: Deps) {
  for (const [index, type] of DEFAULT_DOCUMENT_TYPES.entries()) {
    deps.db.insert(documentTypes).values({ ...type, sortOrder: index }).run();
  }
}

export function setupWithTypes(permissions: readonly string[] = ALL_DMS) {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule] });
  seedTypes(deps);
  const userId = insertUser(deps, { name: 'Test', email: 'test@kompass.local' });
  // Kein `media.upload`: Die Akte legt ihre Dateien im eigenen Speicher ab.
  const extra = permissions === ALL_DMS ? ['contacts.manage'] : [];
  return { deps, ctx: ctxWith([...permissions, ...extra], userId), userId };
}

export function auditActions(deps: Deps): string[] {
  return deps.db.select().from(schema.auditLog).all().map((e) => e.action);
}

import { createDraft, fileDocument } from '../src/drafts';

/** Ein minimales, gültiges PDF für Eingangstests. */
export function pdfBytes(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
}

/** Ein festgeschriebener Brief, wie ihn mehrere Tests als Ausgangslage brauchen. */
export async function fileFixture(deps: Deps, ctx: CallContext) {
  const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Fixture', body: 'Text' });
  if (!draft.ok) throw new Error('fixture: draft');
  const filed = await fileDocument(deps, ctx, { id: draft.value.id });
  if (!filed.ok) throw new Error('fixture: filing');
  return filed.value;
}
