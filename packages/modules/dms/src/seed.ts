import { isoNow, newId, unwrap, type CallContext, type Deps } from '@kompass/core';
import { contacts } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { DEFAULT_DOCUMENT_TYPES } from './catalog';
import { createDraft, fileDocument } from './drafts';
import { receiveDocument } from './incoming';
import { documentFolders, documentRules, documents, documentTypes } from './schema';

export async function seedDms(deps: Deps, ctx: CallContext): Promise<void> {
  const existing = deps.db.select({ id: documents.id }).from(documents).all();
  if (existing.length > 0) return;

  const typesCount = deps.db.select().from(documentTypes).all().length;
  if (typesCount === 0) {
    for (const [index, type] of DEFAULT_DOCUMENT_TYPES.entries()) {
      deps.db.insert(documentTypes).values({ ...type, sortOrder: index }).run();
    }
  }

  const folders = ['behoerden', 'behoerden/finanzamt', 'vertraege', 'protokolle'];
  for (const path of folders) {
    const existingFolder = deps.db.select().from(documentFolders).where(eq(documentFolders.path, path)).get();
    if (!existingFolder) {
      deps.db.insert(documentFolders).values({ path, createdAt: isoNow(deps.clock) }).run();
    }
  }

  const existingRule = deps.db.select().from(documentRules).where(eq(documentRules.matchContains, 'Finanzamt')).get();
  if (!existingRule) {
    deps.db.insert(documentRules).values({
      id: newId(),
      matchField: 'filename',
      matchContains: 'Finanzamt',
      thenTypeKey: 'authority',
      thenFolder: 'behoerden/finanzamt',
      isActive: true,
      sortOrder: 0,
    }).run();
  }

  // 1. Entwurf
  await createDraft(deps, ctx, {
    typeKey: 'minutes',
    subject: 'Protokoll Vorstandssitzung Quartal 1',
    body: '## Tagesordnung\n\n1. Begrüßung\n2. Berichte\n3. Verschiedenes',
    folder: 'protokolle',
  });

  // 2. Festgeschriebener Brief an einen Kontakt
  const contact = deps.db.select({ id: contacts.id }).from(contacts).limit(1).get();
  const links = contact ? [{ entityType: 'contact', entityId: contact.id, role: 'recipient' as const }] : [];
  const draft = unwrap(
    await createDraft(deps, ctx, {
      typeKey: 'letter',
      subject: 'Einladung zur ordentlichen Mitgliederversammlung',
      body: 'Sehr geehrte Damen und Herren,\n\nhiermit laden wir Sie herzlich ein.',
      links,
    }),
  );
  unwrap(await fileDocument(deps, ctx, { id: draft.id }));

  // 3. Eingangsdokument im Eingangskorb (folder: null)
  const samplePdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  unwrap(
    await receiveDocument(deps, ctx, {
      filename: '2026-02-15 Bescheid.pdf',
      bytes: samplePdf,
      typeKey: 'authority',
      subject: 'Freistellungsbescheid',
      documentDate: '2026-02-15',
      folder: null,
    }),
  );
}
