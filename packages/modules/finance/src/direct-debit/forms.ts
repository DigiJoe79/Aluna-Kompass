import { invalid, notFound, ok, readSetting, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts } from '@kompass/module-contacts';
import { abortIssue, documentLinks, documents, issueGeneratedDocument, receiveGeneratedUpload } from '@kompass/module-dms';
import { and, desc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance, uploadLimitProblem } from '../errors';
import { postalAddressLines } from '../typst-pure';
import { activateMandate, DIRECT_DEBIT_PERMISSION, MANDATE_ENTITY, mandateRowInternal, mandateState, type MandateView } from './mandates';
import { MANDATE_DOCUMENT_TYPE, MANDATE_FORM_TEMPLATE_KEY, MANDATE_TITLE, type MandateFormInput } from './templates/mandate-form';

const formSchema = z.object({ mandateId: z.string().min(1) });

/** Name des Zahlungsempfängers: die Einstellung, sonst der Vereinsname. */
export function creditorNameInternal(deps: Deps): string {
  return (readSetting<string | null>(deps, 'finance.sepa.creditorName') ?? '').trim() || (readSetting<string>(deps, 'organization.name') ?? '').trim();
}

export function organizationAddressLinesInternal(deps: Deps): string[] {
  const setting = (key: string) => (readSetting<string | null>(deps, key) ?? '').trim() || null;
  return postalAddressLines({ street: setting('organization.street'), postalCode: setting('organization.postalCode'), city: setting('organization.city'), country: null });
}

/**
 * Das Mandatsformular als festgeschriebenes Dokument der Akte (`finance.directDebit`, Handoff D6 Schritt 1): Art
 * `sepa-mandate`, Schutzbereich Finanzen, vorausgefüllt mit Gläubiger, Gläubiger-ID, Referenz, Kontoinhaber, Anschrift
 * und IBAN, verknüpft mit dem Mandat. Die unterschriebene Rücksendung wird später als „unterschriebene Fassung von“
 * diesem Dokument abgelegt (`activateMandate`). Betreff nennt die Referenz, nie die Person. Liegt schon ein gültiges
 * Formular vor, das nach der letzten Änderung des Mandats entstand, kommt es wieder (`created: false`) — jeder Klick auf
 * „Formular öffnen“ ergäbe sonst eine neue Nummer.
 */
export async function mandateFormPdf(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ documentId: string; number: string; created: boolean }>> {
  const denied = requirePermission(ctx, DIRECT_DEBIT_PERMISSION);
  if (denied) return denied;
  const parsed = validate(deps, formSchema, input);
  if (!parsed.ok) return parsed;
  const mandate = mandateRowInternal(deps.db, parsed.value.mandateId);
  if (!mandate) return notFound('financeMandate', parsed.value.mandateId);
  if (mandateState(mandate, todayIn(deps)) === 'ended') return financeConflict('mandateEnded', { reference: mandate.reference, date: mandate.endedOn! });
  const existing = deps.db
    .select({ id: documents.id, number: documents.number, createdAt: documents.createdAt })
    .from(documents)
    .innerJoin(documentLinks, and(eq(documentLinks.documentId, documents.id), eq(documentLinks.entityType, MANDATE_ENTITY), eq(documentLinks.entityId, mandate.id)))
    .where(and(eq(documents.typeKey, MANDATE_DOCUMENT_TYPE), eq(documents.phase, 'issued'), ne(documents.status, 'voided')))
    .orderBy(desc(documents.createdAt))
    .get();
  if (existing && existing.createdAt >= mandate.updatedAt) return ok({ documentId: existing.id, number: existing.number!, created: false });
  const creditorId = readSetting<string | null>(deps, 'finance.sepa.creditorId');
  if (!creditorId) return financeConflict('sepaCreditorIdMissing');
  const contact = deps.db.select().from(contacts).where(eq(contacts.id, mandate.contactId)).get();
  const templateInput: MandateFormInput = {
    creditor: { name: creditorNameInternal(deps), addressLines: organizationAddressLinesInternal(deps), creditorId },
    reference: mandate.reference,
    debtor: { name: mandate.debtorName, addressLines: contact ? postalAddressLines(contact) : [], iban: mandate.iban },
  };
  const result = await issueGeneratedDocument(deps, ctx, {
    templateKey: MANDATE_FORM_TEMPLATE_KEY,
    input: templateInput,
    subject: `${MANDATE_TITLE} ${mandate.reference}`,
    documentDate: todayIn(deps),
    // R10: Der Zahler ist Empfänger, damit das Formular zur Unterschrift auch per E-Mail gehen kann.
    links: [{ entityType: MANDATE_ENTITY, entityId: mandate.id }, { entityType: 'contact', entityId: mandate.contactId, role: 'recipient' }],
    afterIssue: (tx: DbOrTx, doc) => {
      if (!mandateRowInternal(tx, mandate.id)) abortIssue(notFound('financeMandate', mandate.id));
      financeAudit(tx, deps, ctx, { action: 'finance.mandate.form', entity: 'financeMandate', id: mandate.id, after: { reference: mandate.reference }, params: { reference: mandate.reference, documentNumber: doc.number } });
      return null;
    },
  });
  if (!result.ok) return result;
  return ok({ documentId: result.value.document.id, number: result.value.document.number!, created: true });
}

/** Die Art der unterschriebenen Rücksendung in der Akte (eingehend, Schutzbereich `finance`). */
export const MANDATE_SIGNED_DOCUMENT_TYPE = 'sepa-mandate-signed';

export const mandateSignedSchema = z.object({
  mandateId: z.string().min(1),
  signedOn: z.iso.date(),
  bytes: z.custom<Uint8Array>((val) => val instanceof Uint8Array, { message: 'invalidBytes' }),
});

/**
 * Unterschrift ablegen (Handoff 2a § 1.4, D6): die unterschriebene Rücksendung als Eingang am Mandat in die Akte (Art
 * `sepa-mandate-signed`, Betreff mit Referenz) und das Mandat aktiv mit dem Tag der Unterschrift — ein Schritt für die
 * Ablagefläche am Mandat. humanOnly wie `activateMandate`. Vorher geprüft, damit kein Dokument ohne Aktivierung liegen
 * bleibt: Mandat vorbereitet, Tag nicht in der Zukunft.
 */
export async function fileSignedMandate(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MandateView>> {
  const denied = requirePermission(ctx, DIRECT_DEBIT_PERMISSION);
  if (denied) return denied;
  const human = requireHumanChannelFinance(deps, ctx);
  if (human) return human;
  const parsed = validate(deps, mandateSignedSchema, input);
  if (!parsed.ok) return parsed;
  const tooLarge = uploadLimitProblem(deps, parsed.value.bytes);
  if (tooLarge) return tooLarge;
  const v = parsed.value;
  if (v.signedOn > todayIn(deps)) return invalid([{ path: 'signedOn', message: 'inFuture' }]);
  const row = mandateRowInternal(deps.db, v.mandateId);
  if (!row) return notFound('financeMandate', v.mandateId);
  const state = mandateState(row, todayIn(deps));
  if (state === 'ended') return financeConflict('mandateEnded', { reference: row.reference, date: row.endedOn! });
  if (state !== 'pending') return financeConflict('mandateSigned');
  const received = await receiveGeneratedUpload(deps, ctx, {
    bytes: v.bytes,
    typeKey: MANDATE_SIGNED_DOCUMENT_TYPE,
    subject: `${MANDATE_TITLE} ${row.reference}, unterschrieben`,
    documentDate: v.signedOn,
    links: [{ entityType: MANDATE_ENTITY, entityId: row.id, role: 'about' }],
    recordNumber: row.reference,
  });
  if (!received.ok) return received;
  return activateMandate(deps, ctx, { mandateId: row.id, signedOn: v.signedOn, signedDocumentId: received.value.document.id });
}
