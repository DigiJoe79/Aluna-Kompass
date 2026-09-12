import { isoNow, newId, unwrap, type CallContext, type Deps } from '@kompass/core';
import { contacts } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { EXAMPLE_DOCUMENT_TYPES } from './catalog';
import { recordDispatch } from './dispatch';
import { createDraft, fileDocument } from './drafts';
import { receiveDocument } from './incoming';
import { addNote } from './notes';
import { relateDocuments } from './relations';
import { documentFolders, documentRules, documentSnippets, documents, documentTypes } from './schema';
import { createSnippet } from './snippets';

export async function seedDms(deps: Deps, ctx: CallContext): Promise<void> {
  const existing = deps.db.select({ id: documents.id }).from(documents).all();
  if (existing.length > 0) return;

  // Die beiden unklassifizierten Arten stehen schon: `installDms` hat sie beim
  // Einschalten angelegt. Hier kommen nur die Beispiele dazu, die noch fehlen —
  // je Schlüssel, nicht alles oder nichts.
  const existingKeys = new Set(deps.db.select({ key: documentTypes.key }).from(documentTypes).all().map((row) => row.key));
  let sortOrder = existingKeys.size;
  for (const type of EXAMPLE_DOCUMENT_TYPES) {
    if (existingKeys.has(type.key)) continue;
    deps.db.insert(documentTypes).values({ ...type, sortOrder: sortOrder += 1 }).run();
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
      // Festes Datum, damit der Versandvermerk danach liegen kann.
      documentDate: '2026-02-10',
      links,
    }),
  );
  unwrap(await fileDocument(deps, ctx, { id: draft.id }));

  // 3. Eingangsdokument im Eingangskorb (folder: null)
  const samplePdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  const inbound = unwrap(
    await receiveDocument(deps, ctx, {
      filename: '2026-02-15 Bescheid.pdf',
      bytes: samplePdf,
      typeKey: 'authority',
      subject: 'Freistellungsbescheid',
      documentDate: '2026-02-15',
      folder: null,
    }),
  );

  // 4. Der Eingang antwortet auf den Brief; der Brief ist per Post raus.
  unwrap(await relateDocuments(deps, ctx, { documentId: inbound.id, relatedDocumentId: draft.id, kind: 'repliesTo' }));
  unwrap(await recordDispatch(deps, ctx, { id: draft.id, sentAt: '2026-02-12', sentVia: 'post', note: 'mit Anmeldeformular' }));

  // 4b. Ein zweiter Brief, festgeschrieben und **nicht** versandt — die Liste
  // soll beides zeigen.
  const thanks = unwrap(
    await createDraft(deps, ctx, {
      typeKey: 'letter',
      subject: 'Dankschreiben an die Tierarztpraxis',
      body: 'Vielen Dank für die kurzfristige Behandlung.',
      documentDate: '2026-03-02',
      links,
    }),
  );
  unwrap(await fileDocument(deps, ctx, { id: thanks.id }));

  // 5. Eine Notiz am Eingang.
  unwrap(await addNote(deps, ctx, { documentId: inbound.id, body: 'Bescheid liegt im Original im Ordner Behörden, Fach 3.' }));

  // 6. Zwei Bausteine, je Schlüssel — der Abbruch oben zählt Dokumente, nicht
  // Bausteine, deshalb hier die eigene Prüfung.
  for (const snippet of [
    { name: 'Grußformel', body: 'Mit freundlichen Grüßen\n\nDer Vorstand' },
    { name: 'Bitte um Rückmeldung', subject: 'Bitte um Rückmeldung', body: 'wir bitten um Ihre Rückmeldung bis zum genannten Termin.' },
  ]) {
    const exists = deps.db.select().from(documentSnippets).where(eq(documentSnippets.name, snippet.name)).get();
    if (!exists) unwrap(await createSnippet(deps, ctx, snippet));
  }
}
