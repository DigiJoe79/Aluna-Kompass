import { coreModule, defineModule, schema, unwrap, writeSettingInternal, type CallContext, type Deps } from '@kompass/core';
import { createTestDeps, ctxWith, fakeDocumentEngine, insertUser, systemContext } from '@kompass/core/testing';
import { z } from 'zod';
import { contactsModule } from '@kompass/module-contacts';
import { dmsModule } from '../src/manifest';
import { EXAMPLE_DOCUMENT_TYPES } from '../src/catalog';
import { receiveDocument } from '../src/incoming';
import { ensureDocumentType } from '../src/provision';
import { documentTypes } from '../src/schema';

/** `deps` und `ctx` mit installiertem dms-Modul und dem Startsatz an Dokumentarten. */
export const ALL_DMS = ['dms.view', 'dms.create', 'dms.file', 'dms.void', 'dms.deleteDraft', 'dms.manage'];

export function seedTypes(deps: Deps) {
  for (const [index, type] of EXAMPLE_DOCUMENT_TYPES.entries()) {
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

/** Ein Fixture-Modul mit eigener Vorlage und eigener Dokumentart — das Finanzmodul im Kleinen. */
export const probeModule = defineModule({
  key: 'probe',
  version: '0.0.0',
  permissions: ['probe.read', 'probe.issue'],
  linkedDocumentAccess: [{ entityType: 'probeThing', readPermission: 'probe.read', receivePermission: 'probe.issue' }],
  documentAreas: [{ key: 'probe', permission: 'probe.read' }],
  documentTemplates: [
    {
      key: 'probe-note',
      type: 'probe-note',
      schema: z.object({ text: z.string().min(1) }),
      permission: 'probe.issue',
      base: 'a4-plain',
      build: (data: { text: string }, c) => ({ slots: { kind: 'plain', title: 'Notiz' }, body: { typst: `NUMMER ${c.number} DATUM ${c.issuedAt.slice(0, 10)} ${data.text}` } }),
    },
  ],
});

/** Rendert den Körper in die Bytes, damit ein Test lesen kann, was im PDF stünde. */
export function setupWithProbe(permissions: readonly string[] = [...ALL_DMS, 'probe.read', 'probe.issue']) {
  const deps = createTestDeps({
    manifests: [coreModule, contactsModule, dmsModule, probeModule],
    documents: fakeDocumentEngine({ render: async ({ bodyTypst }) => ({ bytes: new TextEncoder().encode(`%PDF-1.4\n${bodyTypst}\n%%EOF\n`), pages: 1 }) }),
  });
  seedTypes(deps);
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['contacts', 'dms', 'probe'], 'test.enable'));
  deps.db.transaction((tx) => ensureDocumentType(tx, deps, systemContext(), { module: 'probe', key: 'probe-note', label: 'Notiz', prefix: 'NTZ', defaultDirection: 'outgoing', retentionClass: 'statutory10Y', owned: true }));
  const userId = insertUser(deps, { name: 'Test', email: 'test@kompass.local' });
  return { deps, ctx: ctxWith(permissions, userId), userId };
}

/**
 * Eine Akte mit einer geschützten Vereinsart. Drei Aufrufer:
 * `all` darf alles, `viewer` hat die Rechte der Akte ohne das Bereichsrecht,
 * `auditor` hat **nur** das Bereichsrecht.
 * Den Bereich setzt der Helfer direkt in der Tabelle — der Dienst dafür kommt mit VP3b.
 */
export async function setupWithArea() {
  const { deps, ctx: all } = setupWithProbe();
  deps.db.insert(documentTypes).values({ key: 'secret', label: 'Geheimsache', prefix: 'GEH', defaultDirection: 'incoming', retentionClass: 'statutory10Y', defaultFolder: null, isActive: true, sortOrder: 90, ownerModule: null, protectionArea: 'probe' }).run();
  const viewerId = insertUser(deps, { name: 'Viewer', email: 'viewer@kompass.local' });
  const auditorId = insertUser(deps, { name: 'Auditor', email: 'auditor@kompass.local' });
  const secret = unwrap(await receiveDocument(deps, all, { filename: 'g.pdf', typeKey: 'secret', subject: 'Streng geheimer Betreff', documentDate: '2026-09-01', folder: null, bytes: pdfBytes() }));
  const open = await fileFixture(deps, all);
  return { deps, all, viewer: ctxWith(ALL_DMS, viewerId), auditor: ctxWith(['probe.read'], auditorId), secretId: secret.id, openId: open.id };
}
