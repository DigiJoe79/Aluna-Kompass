import { isoNow, newId, notFound, ok, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { requireFinanceRead } from '../ledger/access';
import { financeContactTaxDetails, type FinanceContactTaxDetailsRow } from '../schema';
import { AO52_VALUES } from '../format/tax-purposes';
import { CONTACT_REVERSE_CHARGE, REVERSE_CHARGE_DECLINE_REASONS, type ContactReverseCharge, type ReverseChargeDeclineReason } from '../ledger/codes';

/**
 * Rechenschaft D2 (Spec § D2, Anlage Gem Zeilen 65 und 70): Finanzamt, Steuernummer und begünstigter Zweck einer
 * Körperschaft, die eine Vermögensausstattung (§ 58 Nr. 3 AO) von uns erhält oder uns gibt — eine Zeile je Kontakt für
 * Empfänger und Geber; seit E6a dazu das Merkmal „Rechnungen mit Umkehr der Steuerschuld (§ 13b)“. Das Partnerprofil zeigt die seines Kontakts (`PartnerView.taxDetails`). Das Protokoll nennt nur,
 * welche Angaben es gibt, nie die Angaben selbst und nie den Kontakt.
 */

export interface ContactTaxDetails {
  taxOffice: string | null;
  taxNumber: string | null;
  beneficiaryPurpose: string | null;
  /** E6a: „Rechnungen mit Umkehr der Steuerschuld (§ 13b)“ — Vorgabe für jede Ausgabe an den Kontakt. */
  reverseCharge: ContactReverseCharge | null;
  /** E6b: gemerktes „Nein, weil …“ der Prüffrage § 13b; schließt `reverseCharge` aus. */
  reverseChargeDecline: ReverseChargeDecline | null;
}

/** E6b: Grund, Freitext (nur bei `other`), Tag und Person des gemerkten Nein. Der Freitext steht nur hier, nie im Protokoll. */
export interface ReverseChargeDecline {
  reason: ReverseChargeDeclineReason;
  text: string | null;
  on: string;
  byUserId: string;
}

function declineOf(row: FinanceContactTaxDetailsRow): ReverseChargeDecline | null {
  if (row.reverseChargeDeclineReason === null) return null;
  return { reason: row.reverseChargeDeclineReason, text: row.reverseChargeDeclineText, on: row.reverseChargeDeclineOn ?? '', byUserId: row.reverseChargeDeclineByUserId ?? '' };
}

function detailsOfRow(row: FinanceContactTaxDetailsRow): ContactTaxDetails {
  return { taxOffice: row.taxOffice, taxNumber: row.taxNumber, beneficiaryPurpose: row.beneficiaryPurpose, reverseCharge: row.reverseCharge, reverseChargeDecline: declineOf(row) };
}

const NO_DECLINE = { reverseChargeDeclineReason: null, reverseChargeDeclineText: null, reverseChargeDeclineOn: null, reverseChargeDeclineByUserId: null } as const;

/** Ohne Rechteprüfung: die Steuerdaten eines Kontakts, oder `null`. */
export function contactTaxDetailsInternal(db: DbOrTx, contactId: string): ContactTaxDetails | null {
  const row = db.select().from(financeContactTaxDetails).where(eq(financeContactTaxDetails.contactId, contactId)).get();
  return row ? detailsOfRow(row) : null;
}

const getSchema = z.object({ contactId: z.string().min(1) });

/** `finance.read`: die Steuerdaten eines Kontakts, oder `null`. */
export async function getContactTaxDetails(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<(ContactTaxDetails & { contactId: string }) | null>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, getSchema, input);
  if (!parsed.ok) return parsed;
  const details = contactTaxDetailsInternal(deps.db, parsed.value.contactId);
  return ok(details ? { contactId: parsed.value.contactId, ...details } : null);
}

/** Leer heißt „keine Angabe“: Ein leerer Text wird `null`. */
const field = z.string().trim().max(200).nullable().optional().transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));
/** Der begünstigte Zweck ist eine Nummer aus § 52 Abs. 2 AO (Designer Runde 7, Abweichung 6), leer heißt keine Angabe. */
const purposeField = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v))
  .refine((v) => v === undefined || v === null || AO52_VALUES.includes(v), { message: 'notAo52Purpose' });
const saveSchema = z.object({ contactId: z.string().min(1), taxOffice: field, taxNumber: field, beneficiaryPurpose: purposeField, reverseCharge: z.enum(CONTACT_REVERSE_CHARGE).nullable().optional() });

/** `finance.entriesWrite`: Steuerdaten eines Kontakts anlegen oder ändern; nicht genannte Felder bleiben. */
export async function saveContactTaxDetails(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FinanceContactTaxDetailsRow>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, saveSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (!deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, v.contactId)).get()) return notFound('contact', v.contactId);
  return deps.db.transaction((tx: DbOrTx) => {
    const before = tx.select().from(financeContactTaxDetails).where(eq(financeContactTaxDetails.contactId, v.contactId)).get();
    const fields = {
      taxOffice: v.taxOffice === undefined ? (before?.taxOffice ?? null) : v.taxOffice,
      taxNumber: v.taxNumber === undefined ? (before?.taxNumber ?? null) : v.taxNumber,
      beneficiaryPurpose: v.beneficiaryPurpose === undefined ? (before?.beneficiaryPurpose ?? null) : v.beneficiaryPurpose,
      reverseCharge: v.reverseCharge === undefined ? (before?.reverseCharge ?? null) : v.reverseCharge,
      updatedAt: isoNow(deps.clock),
      updatedByUserId: ctx.userId ?? 'system',
    };
    const id = before?.id ?? newId();
    // E6b: Merkmal und gemerktes Nein schließen sich aus — wer das Merkmal setzt, löscht das Nein.
    const row = fields.reverseCharge !== null ? { ...fields, ...NO_DECLINE } : fields;
    if (before) tx.update(financeContactTaxDetails).set(row).where(eq(financeContactTaxDetails.id, id)).run();
    else tx.insert(financeContactTaxDetails).values({ id, contactId: v.contactId, ...row }).run();
    // Das Merkmal § 13b ist ein Code, kein Personenbezug; der Kontakt selbst steht nie im Protokoll.
    const flags = (r: Pick<FinanceContactTaxDetailsRow, 'taxOffice' | 'taxNumber' | 'beneficiaryPurpose' | 'reverseCharge'>) => ({ hasTaxOffice: r.taxOffice !== null, hasTaxNumber: r.taxNumber !== null, hasBeneficiaryPurpose: r.beneficiaryPurpose !== null, reverseCharge: r.reverseCharge });
    financeAudit(tx, deps, ctx, { action: 'finance.contactTaxDetails.save', entity: 'financeContactTaxDetails', id, before: before ? flags(before) : undefined, after: flags(fields) });
    return ok(tx.select().from(financeContactTaxDetails).where(eq(financeContactTaxDetails.id, id)).get()!);
  });
}

const declineSchema = z
  .object({ contactId: z.string().min(1), reason: z.enum(REVERSE_CHARGE_DECLINE_REASONS), text: z.string().trim().max(200).optional() })
  .superRefine((v, c) => {
    if (v.reason === 'other' && !v.text) c.addIssue({ code: 'custom', path: ['text'], message: 'required' });
  });

/** Liest die Zeile des Kontakts oder legt eine leere an (in der Transaktion). */
function rowFor(tx: DbOrTx, deps: Deps, ctx: CallContext, contactId: string): FinanceContactTaxDetailsRow {
  const existing = tx.select().from(financeContactTaxDetails).where(eq(financeContactTaxDetails.contactId, contactId)).get();
  if (existing) return existing;
  const id = newId();
  tx.insert(financeContactTaxDetails).values({ id, contactId, taxOffice: null, taxNumber: null, beneficiaryPurpose: null, reverseCharge: null, updatedAt: isoNow(deps.clock), updatedByUserId: ctx.userId ?? 'system' }).run();
  return tx.select().from(financeContactTaxDetails).where(eq(financeContactTaxDetails.id, id)).get()!;
}

const viewOf = (row: FinanceContactTaxDetailsRow): ContactTaxDetails & { contactId: string } => ({ contactId: row.contactId, ...detailsOfRow(row) });

/**
 * `finance.entriesWrite` (E6b, Spec Teil 3): „Nein, weil …“ der Prüffrage § 13b je Kontakt merken — Kompass fragt bei
 * diesem Kontakt nicht wieder. Löscht das Merkmal § 13b (beides schließt sich aus). `text` nur bei `other` (Pflicht),
 * sonst verworfen; er steht nie im Protokoll, dort nur der Grund als Code.
 */
export async function declineReverseCharge(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ContactTaxDetails & { contactId: string }>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, declineSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (!deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, v.contactId)).get()) return notFound('contact', v.contactId);
  return deps.db.transaction((tx: DbOrTx) => {
    const before = rowFor(tx, deps, ctx, v.contactId);
    tx.update(financeContactTaxDetails)
      .set({
        reverseCharge: null,
        reverseChargeDeclineReason: v.reason,
        reverseChargeDeclineText: v.reason === 'other' ? v.text! : null,
        reverseChargeDeclineOn: todayIn(deps),
        reverseChargeDeclineByUserId: ctx.userId ?? 'system',
        updatedAt: isoNow(deps.clock),
        updatedByUserId: ctx.userId ?? 'system',
      })
      .where(eq(financeContactTaxDetails.id, before.id))
      .run();
    financeAudit(tx, deps, ctx, {
      action: 'finance.contactTaxDetails.reverseChargeDecline',
      entity: 'financeContactTaxDetails',
      id: before.id,
      before: { reverseCharge: before.reverseCharge, reverseChargeDecline: before.reverseChargeDeclineReason },
      after: { reverseCharge: null, reverseChargeDecline: v.reason },
      params: { reason: v.reason },
    });
    return ok(viewOf(tx.select().from(financeContactTaxDetails).where(eq(financeContactTaxDetails.id, before.id)).get()!));
  });
}

/**
 * `finance.entriesWrite` (E6b): „Wieder fragen“ — löscht das gemerkte Nein, nicht das Merkmal. Ohne Nein unverändert
 * und ohne Protokolleintrag.
 */
export async function clearReverseChargeDecline(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ContactTaxDetails & { contactId: string }>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, getSchema, input);
  if (!parsed.ok) return parsed;
  const { contactId } = parsed.value;
  if (!deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contactId)).get()) return notFound('contact', contactId);
  return deps.db.transaction((tx: DbOrTx) => {
    const before = tx.select().from(financeContactTaxDetails).where(eq(financeContactTaxDetails.contactId, contactId)).get();
    if (!before) return ok({ contactId, taxOffice: null, taxNumber: null, beneficiaryPurpose: null, reverseCharge: null, reverseChargeDecline: null });
    if (before.reverseChargeDeclineReason === null) return ok(viewOf(before));
    tx.update(financeContactTaxDetails).set({ ...NO_DECLINE, updatedAt: isoNow(deps.clock), updatedByUserId: ctx.userId ?? 'system' }).where(eq(financeContactTaxDetails.id, before.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.contactTaxDetails.reverseChargeAsk', entity: 'financeContactTaxDetails', id: before.id, before: { reverseChargeDecline: before.reverseChargeDeclineReason }, after: { reverseChargeDecline: null }, params: {} });
    return ok(viewOf(tx.select().from(financeContactTaxDetails).where(eq(financeContactTaxDetails.id, before.id)).get()!));
  });
}
