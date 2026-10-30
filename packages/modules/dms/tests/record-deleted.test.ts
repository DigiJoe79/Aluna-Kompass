import { schema, unwrap, writeSettingInternal } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { createContact, deleteContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDraft } from '../src/drafts';
import { receiveDocument } from '../src/incoming';
import { documentLinks, documents } from '../src/schema';
import { pdfBytes, setupWithTypes } from './helpers';

// I-C: Ein Kontakt wird gelöscht, sobald kein Halter mehr läuft — Bezüge der Akte zählen bei Personen nicht als Verweis.
// Die Akte löst deshalb selbst, was auf ihn zeigt, und nimmt Entwürfe mit, die an nichts anderem mehr hängen.
async function contactWithExpiredLetter() {
  const env = setupWithTypes();
  const { deps, ctx } = env;
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['contacts', 'dms']));
  const contactId = unwrap(await createContact(deps, ctx, { kind: 'person', firstName: 'Erika', lastName: 'Beispiel' })).id;
  // Der eingetragene Brief hält den Kontakt — seine Frist ist längst abgelaufen.
  const issued = unwrap(await receiveDocument(deps, ctx, { filename: 'alt.pdf', bytes: pdfBytes(), typeKey: 'invoice', subject: 'Alte Rechnung', documentDate: '2005-06-01', links: [{ entityType: 'contact', entityId: contactId, role: 'sender' }] }));
  return { ...env, contactId, issuedId: issued.id };
}
const linksTo = (deps: ReturnType<typeof setupWithTypes>['deps'], entityId: string) => deps.db.select().from(documentLinks).where(eq(documentLinks.entityId, entityId)).all();
const documentExists = (deps: ReturnType<typeof setupWithTypes>['deps'], id: string) => !!deps.db.select({ id: documents.id }).from(documents).where(eq(documents.id, id)).get();
const audit = (deps: ReturnType<typeof setupWithTypes>['deps'], action: string) => deps.db.select().from(schema.auditLog).all().filter((e) => e.action === action);

describe('DMS recordDeleted', () => {
  it('löst die Bezüge eines gelöschten Kontakts; das eingetragene Dokument bleibt', async () => {
    const { deps, ctx, contactId, issuedId } = await contactWithExpiredLetter();
    unwrap(await deleteContact(deps, ctx, { id: contactId }));
    expect(linksTo(deps, contactId)).toEqual([]);
    expect(documentExists(deps, issuedId)).toBe(true);
    expect(audit(deps, 'dms.unlink').map((e) => e.entityType)).toEqual(['documentLink']);
  });

  it('löscht einen Entwurf, der nur am Kontakt hing', async () => {
    const { deps, ctx, contactId } = await contactWithExpiredLetter();
    const draft = unwrap(await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Brief an Frau Beispiel', body: 'Text', links: [{ entityType: 'contact', entityId: contactId, role: 'recipient' }] }));
    unwrap(await deleteContact(deps, ctx, { id: contactId }));
    expect(documentExists(deps, draft.id)).toBe(false);
    expect(audit(deps, 'dms.draft.delete').map((e) => e.entityId)).toEqual([draft.id]);
  });

  it('lässt einen Entwurf stehen, der noch an einem anderen Datensatz hängt, und löst nur den Bezug zum Kontakt', async () => {
    const { deps, ctx, contactId } = await contactWithExpiredLetter();
    const draft = unwrap(
      await createDraft(deps, ctx, {
        typeKey: 'letter',
        subject: 'Projektbericht',
        body: 'Text',
        links: [
          { entityType: 'contact', entityId: contactId, role: 'recipient' },
          { entityType: 'project', entityId: 'p-1', role: 'about' },
        ],
      }),
    );
    unwrap(await deleteContact(deps, ctx, { id: contactId }));
    expect(documentExists(deps, draft.id)).toBe(true);
    expect(linksTo(deps, contactId)).toEqual([]);
    expect(linksTo(deps, 'p-1').map((l) => l.documentId)).toEqual([draft.id]);
  });
});
