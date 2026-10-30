import { unwrap, type CallContext } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { linkDocument, listDocuments, textPdf } from '@kompass/module-dms';
import { savePartnerPaymentDraft, savePartnerProfile } from '@kompass/module-finance';
import { describe, expect, it } from 'vitest';
import { fileSignedMinutes } from '../src/minutes/signed';
import { getResolutionContext } from '../src/resolution-rows';
import { sealMeeting } from '../src/seal/seal';
import { endMeeting } from '../src/session';
import { adopt, receivedDocument, RECORDING, session, setupGovernance } from './helpers';

/**
 * Spec § 8.1 „Beschlüsse als Beleg“ (G7). Partnerzahlung: seit dem Befund vom 2026-10-29 (Entscheidung Joe) ein eigenes
 * Feld `resolutionId` an der Zahlung, geprüft wie Rücklage und Beitragsordnung, und der Beschluss nennt die Zahlung unter
 * „Verwendet in“ (W-13). Projekt: weiter über ein Dokument der Akte, das an beiden hängt — rot, siehe unten.
 */
describe('a resolution as evidence for a partner payment and a project (G7)', () => {
  it('a partner payment cites the sealed resolution in its own field, and the resolution names the payment', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting, items } = await session(deps, ctx, { items: ['simple'], voters: 3 });
    const resolution = await adopt(deps, ctx, items[0]!.id);
    const financeCtx: CallContext = { ...systemContext(), permissions: new Set(['finance.read', 'finance.entriesWrite', 'finance.setup', 'contacts.manage', 'governance.read']) };
    const org = unwrap(await createContact(deps, financeCtx, { kind: 'organization', name: 'Partnerverein e.V.' }));
    const partner = unwrap(await savePartnerProfile(deps, financeCtx, { contactId: org.id, status: 'publicBody' }));
    const draft = (resolutionId: string) => savePartnerPaymentDraft(deps, financeCtx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'Förderung', retroactive: false, positions: [], resolutionId });
    // Erst festgeschrieben trägt der Beschluss die Zahlung.
    expect(await draft(resolution.id)).toMatchObject({ ok: false, error: { issues: [{ path: 'resolutionId', message: 'resolutionNotFinal' }] } });
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    unwrap(await fileSignedMinutes(deps, ctx, { meetingId: meeting.id, bytes: textPdf(['Protokoll']) }));
    unwrap(await sealMeeting(deps, ctx, { meetingId: meeting.id }));
    const payment = unwrap(await draft(resolution.id));
    expect(payment).toMatchObject({ resolutionId: resolution.id, resolution: { href: `/governance/resolutions/${resolution.id}` } });
    expect(unwrap(await getResolutionContext(deps, ctx, { id: resolution.id })).usedBy).toEqual([{ kind: 'partnerPayment', id: payment.id, label: '' }]);
  });

  // Befund G7 (2026-10-29): rot — `governanceResolution` ist über `linkedDocumentAccess` ein reservierter Bezugstyp;
  // `linkDocument` lehnt ihn mit `linkTypeReserved` ab. `it.fails` hält den Befund für das Projekt fest, bis Joe entscheidet.
  it.fails('one document links to the resolution and to a project', async () => {
    const { deps, ctx } = setupGovernance([...RECORDING, 'dms.view', 'dms.create']);
    const { items } = await session(deps, ctx, { items: ['simple'], voters: 3 });
    const resolution = await adopt(deps, ctx, items[0]!.id);
    const docId = await receivedDocument(deps, 'Förderzusage Partnerprojekt');
    const dmsCtx: CallContext = { ...systemContext(), permissions: new Set(['dms.view', 'dms.create']) };
    const results = await Promise.all([
      linkDocument(deps, dmsCtx, { documentId: docId, entityType: 'governanceResolution', entityId: resolution.id, role: 'about' }),
      linkDocument(deps, dmsCtx, { documentId: docId, entityType: 'project', entityId: 'P1', role: 'about' }),
    ]);
    expect(results.map((r) => (r.ok ? 'ok' : (r.error as { code?: string }).code))).toEqual(['ok', 'ok']);
    expect(unwrap(await listDocuments(deps, dmsCtx, { linkedTo: { entityType: 'governanceResolution', entityId: resolution.id } })).documents.map((d) => d.id)).toEqual([docId]);
  });
});
