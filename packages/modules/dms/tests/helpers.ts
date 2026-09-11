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
  return { deps, ctx: ctxWith([...permissions, 'media.upload', 'contacts.manage'], userId), userId };
}

export function auditActions(deps: Deps): string[] {
  return deps.db.select().from(schema.auditLog).all().map((e) => e.action);
}

/** Ein minimales, gültiges PDF für Eingangstests. */
export function pdfBytes(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
}
