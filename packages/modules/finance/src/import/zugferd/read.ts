import { notFound, ok, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type EmbeddedFile, type Result } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { getDocument } from '@kompass/module-dms';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { financeConflict } from '../../errors';
import { requireFinanceRead } from '../../ledger/access';
import { valueAt } from '../../ledger/dated-values';
import { entryViewInternal, saveDraft, type EntryView } from '../../ledger/entries';
import { normalizeIban } from '../../ledger/iban';
import { createOpenItem, openItemHasAnySettlementInternal, type OpenItemView } from '../../ledger/open-items';
import type { TaxCode } from '../../ledger/tax';
import { attachDocument } from '../../ledger/vouchers';
import { normalizeText } from '../../rules-pure';
import { financeAccounts, financeAllocationLines, financeCategories, financeEntries, financeEntryDocuments, financeMoneyLines, financeOpenItems, financeRawTransactions } from '../../schema';
import { contactForIbanInternal } from '../contact-ibans';
import { openRawTransactionsInternal } from '../suggestions';
import { isInvoiceAttachmentName, parseFacturX, type ParsedInvoice } from './parse';

/**
 * Rechnung aus dem PDF (F5b, Spec 6.6): ein Finanzbeleg mit eingebetteter
 * ZUGFeRD-/Factur-X-XML liefert Lieferant, Nummer, Datum, Brutto, Steuer,
 * Fälligkeit und IBAN — **auf Abruf gelesen, nie gespeichert** (Prinzip 5).
 * Die Akte prüft, ob der Aufrufer das Dokument lesen darf (`getDocument`,
 * Prinzip 6); die Belegarten tragen den Schutzbereich `finance`, ein
 * Finanzleser kommt also ohne `dms.view` an sie heran.
 *
 * Schreibend wird nur über die Dienste von `ledger/` gearbeitet
 * (`createOpenItem`, `saveDraft`, `attachDocument`), die selbst prüfen und
 * protokollieren — ohne Lieferant, Nummer oder IBAN (Spec 10.3).
 */

export interface InvoiceView extends ParsedInvoice {
  /** Aus dem Satz der Rechnung gegen die datierten Werte am Rechnungsdatum (Annahme 3); `null`, wenn keiner eindeutig passt. */
  taxCode: TaxCode | null;
  /** Steuer der Rechnung − berechnete Steuer, in Cent — nur gezeigt, nie gespeichert. `null` ohne Kennzeichen. */
  taxCentsDifference: number | null;
  /** Nur über die Zahlungsempfänger-IBAN (Annahme 5) — nie aus dem Lieferantennamen. */
  contactId: string | null;
  contactName: string | null;
}

export type InvoiceProposal =
  | { kind: 'noInvoice' }
  | { kind: 'unsupported'; code: 'currencyUnsupported' | 'toolsMissing' | 'notAnInvoice' | 'xmlInvalid' | 'xmlTooLarge' | 'doctypeRefused' | 'missingField' }
  | { kind: 'alreadyVoucher'; entryId: string; entryNumber: string | null; openItem: StillOpenItem | null }
  | { kind: 'paid'; invoice: InvoiceView; rawTransactionId: string; bookingDate: string; sure: true }
  | { kind: 'possiblyPaid'; invoice: InvoiceView; candidates: { rawTransactionId: string; bookingDate: string; accountName: string }[] }
  /** Befund Y: eine gebuchte Buchung passt schon dazu — anhängen statt einen zweiten Posten anlegen. */
  | { kind: 'probablyPaid'; invoice: InvoiceView; entries: PaidEntry[]; existingOpenItemId: string | null }
  | { kind: 'unpaid'; invoice: InvoiceView; existingOpenItemId: string | null };

/** Eine gebuchte, nicht stornierte Buchung, die die Rechnung wahrscheinlich schon bezahlt hat. */
export interface PaidEntry {
  entryId: string;
  entryNumber: string | null;
  entryDate: string;
  status: 'draft' | 'final';
}

/** Ein noch offener Posten derselben Rechnung — für den Hinweis, wenn die Rechnung schon Beleg ist. */
export interface StillOpenItem {
  id: string;
  paymentReference: string | null;
  itemDate: string;
}

type UnreadableCode = Exclude<Extract<InvoiceProposal, { kind: 'unsupported' }>['code'], 'currencyUnsupported' | 'toolsMissing'>;

type LoadedInvoice =
  | { state: 'none' }
  | { state: 'toolsMissing' }
  | { state: 'unreadable'; code: UnreadableCode }
  | { state: 'invoice'; invoice: InvoiceView; document: { id: string; phase: string; status: string } };

/** Zahlungsfenster um das Rechnungsdatum (Annahme 2). */
const PAID_WINDOW_DAYS = { before: 10, after: 90 };
const MAX_TEXT = 300;
const MAX_PAYMENT_REFERENCE = 120;

const documentSchema = z.object({ documentId: z.string().min(1) });
const createFromInvoiceSchema = z.object({
  documentId: z.string().min(1),
  /** Vorgabe: der Kontakt der Zahlungsempfänger-IBAN; `null` legt ohne Kontakt an. */
  contactId: z.string().min(1).nullable().optional(),
  /** Vorgabe: die Fälligkeit der Rechnung. */
  dueOn: z.string().date().nullable().optional(),
  /** Befund Y: Pflicht, wenn die Rechnung wahrscheinlich schon bezahlt ist (`probablyPaid`). */
  reason: z.string().trim().min(1).max(500).optional(),
});
const applySchema = z.object({ entryId: z.string().min(1), documentId: z.string().min(1) });

/**
 * `pdfdetach` fehlt: Das Paket `@kompass/text-extraction` wirft dann
 * `ToolMissingError` — das Finanzmodul importiert es nicht und erkennt den
 * Fehler am Namen. Hat er keinen erkennbaren Namen, zählt, was die Umgebung
 * selbst meldet: `probe()` mit `ok: false`. Alles andere ist ein technischer
 * Fehler und wirft weiter.
 */
async function toolsMissing(deps: Deps, error: unknown): Promise<boolean> {
  if (error instanceof Error && error.name === 'ToolMissingError') return true;
  const probe = await deps.textExtraction.probe().catch(() => ({ ok: false as const }));
  return !probe.ok;
}

/** Ein Kennzeichen nur, wenn die Rechnung genau einen Satz nennt (Annahme 3). */
function taxCodeOf(db: DbOrTx, invoice: ParsedInvoice): { code: TaxCode; ratePercent: number } | null {
  const distinct = new Map(invoice.taxes.map((t) => [`${t.ratePercent}|${t.categoryCode}`, t]));
  if (distinct.size !== 1) return null;
  const { ratePercent, categoryCode } = [...distinct.values()][0]!;
  if (ratePercent === 0 && (categoryCode === 'E' || categoryCode === 'AE')) return { code: 'none', ratePercent: 0 };
  if (ratePercent === valueAt(db, 'vatStandard', invoice.issueDate)) return { code: 'standard', ratePercent };
  if (ratePercent === valueAt(db, 'vatReduced', invoice.issueDate)) return { code: 'reduced', ratePercent };
  return null;
}

/** Steuer aus dem Brutto, wie Kompass sie rechnet (`ledger/tax.ts`): Brutto − round(Brutto × 100 / (100 + Satz)), Vorzeichen wie das Brutto. */
function computedTaxCents(grossCents: number, ratePercent: number): number {
  const gross = Math.abs(grossCents);
  const tax = gross - Math.round((gross * 100) / (100 + ratePercent));
  return grossCents < 0 ? -tax : tax;
}

function invoiceViewOf(db: DbOrTx, invoice: ParsedInvoice): InvoiceView {
  const tax = taxCodeOf(db, invoice);
  const taxCentsDifference = tax === null ? null : invoice.taxTotalCents - (tax.code === 'none' ? 0 : computedTaxCents(invoice.grandTotalCents, tax.ratePercent));
  const contactId = invoice.payeeIban ? contactForIbanInternal(db, invoice.payeeIban)?.contactId ?? null : null;
  const contact = contactId ? db.select().from(contacts).where(eq(contacts.id, contactId)).get() : undefined;
  return { ...invoice, taxCode: tax?.code ?? null, taxCentsDifference, contactId, contactName: contact ? displayName(contact) || null : null };
}

/**
 * Das Dokument über die Akte lesen (sie prüft die Rechte), die Anhänge über
 * `deps.textExtraction` holen und den ersten lesbaren Rechnungsanhang
 * parsen. Nur Anhänge mit Rechnungsnamen (Annahme 6); andere bleiben ungelesen.
 */
async function loadInvoiceInternal(deps: Deps, ctx: CallContext, documentId: string): Promise<Result<LoadedInvoice>> {
  const doc = await getDocument(deps, ctx, documentId);
  if (!doc.ok) return doc;

  let files: EmbeddedFile[];
  try {
    files = await deps.textExtraction.embeddedFiles({ bytes: doc.value.bytes });
  } catch (error) {
    if (await toolsMissing(deps, error)) return ok({ state: 'toolsMissing' });
    throw error;
  }

  let failure: UnreadableCode | null = null;
  for (const file of files.filter((f) => isInvoiceAttachmentName(f.name))) {
    const parsed = parseFacturX(file.bytes);
    if (parsed.ok) {
      const { id, phase, status } = doc.value.record;
      return ok({ state: 'invoice', invoice: invoiceViewOf(deps.db, parsed.invoice), document: { id, phase, status } });
    }
    failure ??= parsed.code;
  }
  return ok(failure === null ? { state: 'none' } : { state: 'unreadable', code: failure });
}

/** Für die schreibenden Dienste: eine Rechnung in Euro, sonst der passende Fehler. */
async function requireEuroInvoice(deps: Deps, ctx: CallContext, documentId: string): Promise<Result<Extract<LoadedInvoice, { state: 'invoice' }>>> {
  const loaded = await loadInvoiceInternal(deps, ctx, documentId);
  if (!loaded.ok) return loaded;
  const l = loaded.value;
  if (l.state === 'none') return notFound('invoice', documentId);
  if (l.state === 'toolsMissing') return financeConflict('invoiceToolsMissing');
  if (l.state === 'unreadable') return financeConflict('invoiceUnreadable', { code: l.code });
  if (l.invoice.currency !== 'EUR') return financeConflict('invoiceCurrencyUnsupported', { currency: l.invoice.currency });
  return ok(l);
}

/**
 * `finance.read`: die Rechnung eines Dokuments, das der Aufrufer in der Akte
 * lesen darf. `null`, wenn das PDF keinen Rechnungsanhang hat. Liest nur —
 * kein Protokolleintrag.
 */
export async function readInvoiceFromDocument(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<InvoiceView | null>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, documentSchema, input);
  if (!parsed.ok) return parsed;
  const loaded = await loadInvoiceInternal(deps, ctx, parsed.value.documentId);
  if (!loaded.ok) return loaded;
  const l = loaded.value;
  if (l.state === 'none') return ok(null);
  if (l.state === 'toolsMissing') return financeConflict('invoiceToolsMissing');
  if (l.state === 'unreadable') return financeConflict('invoiceUnreadable', { code: l.code });
  return ok(l.invoice);
}

/** Die Buchung, an der das Dokument als (nicht widerrufener) Beleg hängt — auch ein Entwurf. */
function voucherEntryInternal(db: DbOrTx, documentId: string): { entryId: string; entryNumber: string | null } | null {
  return (
    db
      .select({ entryId: financeEntries.id, entryNumber: financeEntries.number })
      .from(financeEntryDocuments)
      .innerJoin(financeEntries, eq(financeEntries.id, financeEntryDocuments.entryId))
      .where(and(eq(financeEntryDocuments.documentId, documentId), isNull(financeEntryDocuments.revokedAt)))
      .orderBy(asc(financeEntryDocuments.addedAt), asc(financeEntryDocuments.id))
      .get() ?? null
  );
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}

/**
 * Bezahlt (Annahme 2): offene Kontoumsätze auf Bank- oder
 * Zahlungsdienstkonten mit Betrag = −Zahlbetrag, gebucht zwischen 10 Tagen
 * vor und 90 Tagen nach dem Rechnungsdatum. Sicher nur mit gleicher IBAN oder
 * der Rechnungsnummer im Verwendungszweck; trifft nur der Betrag, entscheidet
 * der Mensch — auch zwischen mehreren sicheren Treffern.
 */
function paymentMatchInternal(db: DbOrTx, invoice: InvoiceView): Extract<InvoiceProposal, { kind: 'paid' | 'possiblyPaid' }> | null {
  const accounts = new Map(db.select({ id: financeAccounts.id, name: financeAccounts.name }).from(financeAccounts).where(inArray(financeAccounts.kind, ['bank', 'paymentService'])).all().map((a) => [a.id, a.name]));
  const target = -invoice.duePayableCents;
  const byAmount = openRawTransactionsInternal(db).filter((r) => {
    if (!accounts.has(r.accountId) || r.amountCents !== target || target === 0) return false;
    const days = daysBetween(invoice.issueDate, r.bookingDate);
    return days >= -PAID_WINDOW_DAYS.before && days <= PAID_WINDOW_DAYS.after;
  });
  const number = invoice.invoiceNumber.trim().toLowerCase();
  const sure = byAmount.filter(
    (r) => (invoice.payeeIban !== null && r.counterpartyIban !== null && normalizeIban(r.counterpartyIban) === invoice.payeeIban) || (number.length >= 3 && r.purpose.toLowerCase().includes(number)),
  );
  if (sure.length === 1) return { kind: 'paid', invoice, rawTransactionId: sure[0]!.id, bookingDate: sure[0]!.bookingDate, sure: true };
  const candidates = sure.length > 1 ? sure : byAmount;
  if (candidates.length === 0) return null;
  return { kind: 'possiblyPaid', invoice, candidates: candidates.map((r) => ({ rawTransactionId: r.id, bookingDate: r.bookingDate, accountName: accounts.get(r.accountId)! })) };
}

/**
 * Befund Y — schon bezahlt, aber nicht mehr offen: gebuchte Buchungen
 * (Entwurf oder festgeschrieben, weder storniert noch Storno) mit einer
 * Geldzeile über −Zahlbetrag im Zahlungsfenster. Sie passt wahrscheinlich, wenn
 * die Rechnungsnummer im Verwendungszweck des Kontoumsatzes oder im Text der
 * Buchung steht (Vergleich wie beim Zahlungsabgleich, `normalizeText`), oder
 * wenn der Zahlungsempfänger stimmt (IBAN der Gegenseite oder Kontakt einer
 * Zuordnung) und die Buchung noch keinen Beleg hat — mit Beleg ist sie die
 * Zahlung einer anderen Rechnung. Der Betrag allein reicht nie.
 */
function bookedPaymentsInternal(db: DbOrTx, invoice: InvoiceView): PaidEntry[] {
  const target = -invoice.duePayableCents;
  if (target === 0) return [];
  const rows = db
    .select({
      entryId: financeEntries.id, entryNumber: financeEntries.number, entryDate: financeEntries.entryDate, status: financeEntries.status, text: financeEntries.text,
      reversedBy: financeEntries.reversedByEntryId, reverses: financeEntries.reversesEntryId, purpose: financeRawTransactions.purpose, iban: financeRawTransactions.counterpartyIban,
    })
    .from(financeMoneyLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeMoneyLines.entryId))
    .leftJoin(financeRawTransactions, eq(financeRawTransactions.id, financeMoneyLines.rawTransactionId))
    .where(eq(financeMoneyLines.amountCents, target))
    .orderBy(asc(financeEntries.entryDate), asc(financeEntries.id))
    .all();
  const number = normalizeText(invoice.invoiceNumber);
  const found = new Map<string, PaidEntry>();
  for (const r of rows) {
    if (found.has(r.entryId) || r.reversedBy !== null || r.reverses !== null) continue;
    const days = daysBetween(invoice.issueDate, r.entryDate);
    if (days < -PAID_WINDOW_DAYS.before || days > PAID_WINDOW_DAYS.after) continue;
    let hit = number.length >= 3 && normalizeText(`${r.purpose ?? ''} ${r.text}`).includes(number);
    if (!hit) {
      const ibanHit = invoice.payeeIban !== null && r.iban !== null && normalizeIban(r.iban) === invoice.payeeIban;
      const contactHit =
        invoice.contactId !== null &&
        !!db.select({ id: financeAllocationLines.id }).from(financeAllocationLines).where(and(eq(financeAllocationLines.entryId, r.entryId), eq(financeAllocationLines.contactId, invoice.contactId))).get();
      const hasVoucher = !!db.select({ id: financeEntryDocuments.id }).from(financeEntryDocuments).where(and(eq(financeEntryDocuments.entryId, r.entryId), isNull(financeEntryDocuments.revokedAt))).get();
      hit = (ibanHit || contactHit) && !hasVoucher;
    }
    if (hit) found.set(r.entryId, { entryId: r.entryId, entryNumber: r.entryNumber, entryDate: r.entryDate, status: r.status });
  }
  return [...found.values()];
}

/**
 * Befund Y, zweiter Teil: ein noch offener Posten derselben Rechnung — an
 * diesem Dokument oder mit der Rechnungsnummer als Zahlungsreferenz beim
 * selben Kontakt —, an dem keine Zahlung hängt, auch keine geplante.
 */
function stillOpenItemInternal(db: DbOrTx, documentId: string, invoice: InvoiceView | null): StillOpenItem | null {
  const sameInvoice = invoice
    ? or(
        eq(financeOpenItems.documentId, documentId),
        and(eq(financeOpenItems.paymentReference, invoice.invoiceNumber.slice(0, MAX_PAYMENT_REFERENCE)), invoice.contactId ? eq(financeOpenItems.contactId, invoice.contactId) : isNull(financeOpenItems.contactId)),
      )
    : eq(financeOpenItems.documentId, documentId);
  const items = db
    .select({ id: financeOpenItems.id, paymentReference: financeOpenItems.paymentReference, itemDate: financeOpenItems.itemDate })
    .from(financeOpenItems)
    .where(and(isNull(financeOpenItems.cancelledAt), sameInvoice))
    .orderBy(asc(financeOpenItems.createdAt), asc(financeOpenItems.id))
    .all();
  return items.find((i) => !openItemHasAnySettlementInternal(db, i.id)) ?? null;
}

/** Eine nicht erledigte offene Zahlung zu diesem Dokument oder mit der Rechnungsnummer als Zahlungsreferenz. */
function existingOpenItemInternal(db: DbOrTx, documentId: string, invoiceNumber: string): string | null {
  return (
    db
      .select({ id: financeOpenItems.id })
      .from(financeOpenItems)
      .where(and(isNull(financeOpenItems.cancelledAt), or(eq(financeOpenItems.documentId, documentId), eq(financeOpenItems.paymentReference, invoiceNumber))))
      .orderBy(asc(financeOpenItems.createdAt), asc(financeOpenItems.id))
      .get()?.id ?? null
  );
}

/**
 * `finance.read`: was mit der Rechnung zu tun ist — keine Rechnung, nicht
 * unterstützt, schon gebucht, bezahlt (sicher), möglicherweise bezahlt (zur
 * Wahl) oder unbezahlt (mit vorhandener offener Zahlung, falls es sie gibt).
 * Liest nur — kein Protokolleintrag.
 */
export async function invoiceProposal(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<InvoiceProposal>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, documentSchema, input);
  if (!parsed.ok) return parsed;
  const documentId = parsed.value.documentId;
  const loaded = await loadInvoiceInternal(deps, ctx, documentId);
  if (!loaded.ok) return loaded;
  const l = loaded.value;

  if (l.state === 'none') return ok({ kind: 'noInvoice' });
  if (l.state === 'toolsMissing') return ok({ kind: 'unsupported', code: 'toolsMissing' });
  const voucher = voucherEntryInternal(deps.db, documentId);
  if (voucher) return ok({ kind: 'alreadyVoucher', ...voucher, openItem: stillOpenItemInternal(deps.db, documentId, l.state === 'invoice' ? l.invoice : null) });
  if (l.state === 'unreadable') return ok({ kind: 'unsupported', code: l.code });
  if (l.invoice.currency !== 'EUR') return ok({ kind: 'unsupported', code: 'currencyUnsupported' });

  const existingOpenItemId = existingOpenItemInternal(deps.db, documentId, l.invoice.invoiceNumber);
  // Befund Y: Die gebuchte Zahlung geht vor einem offenen Umsatz — sonst ginge die Rechnung ein zweites Mal zur Bank.
  const booked = bookedPaymentsInternal(deps.db, l.invoice);
  if (booked.length > 0) return ok({ kind: 'probablyPaid', invoice: l.invoice, entries: booked, existingOpenItemId });
  const payment = paymentMatchInternal(deps.db, l.invoice);
  if (payment) return ok(payment);
  return ok({ kind: 'unpaid', invoice: l.invoice, existingOpenItemId });
}

/**
 * `finance.entriesWrite`: aus einer unbezahlten Rechnung die offene Zahlung —
 * Rechnungsdatum, Zahlbetrag, Fälligkeit, das Dokument, die Rechnungsnummer
 * als Zahlungsreferenz und eine Zeilenvorlage mit Kennzeichen und Kontakt
 * (keine Kategorie, Annahme 4). Je Dokument nur eine (nicht stornierte), und
 * je Rechnungsnummer beim selben Kontakt auch nur eine (Befund Z). Eine
 * Gutschrift wird zur Forderung. Protokolliert über `createOpenItem`.
 */
export async function createOpenItemFromInvoice(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<OpenItemView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, createFromInvoiceSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const loaded = await requireEuroInvoice(deps, ctx, v.documentId);
  if (!loaded.ok) return loaded;
  const invoice = loaded.value.invoice;

  const exists = deps.db.select({ id: financeOpenItems.id }).from(financeOpenItems).where(and(eq(financeOpenItems.documentId, v.documentId), isNull(financeOpenItems.cancelledAt))).get();
  if (exists) return financeConflict('openItemExistsForDocument');

  const contactId = v.contactId !== undefined ? v.contactId : invoice.contactId;
  const reference = invoice.invoiceNumber.slice(0, MAX_PAYMENT_REFERENCE);
  // Befund Z: dieselbe Rechnung als zweites Dokument — derselbe Kontakt, dieselbe Nummer ist dieselbe Schuld.
  const sameInvoice = deps.db
    .select({ id: financeOpenItems.id, itemDate: financeOpenItems.itemDate })
    .from(financeOpenItems)
    .where(and(isNull(financeOpenItems.cancelledAt), eq(financeOpenItems.paymentReference, reference), contactId ? eq(financeOpenItems.contactId, contactId) : isNull(financeOpenItems.contactId)))
    .orderBy(asc(financeOpenItems.createdAt), asc(financeOpenItems.id))
    .get();
  if (sameInvoice) return financeConflict('openItemExistsForInvoice', { reference, date: sameInvoice.itemDate });
  // Befund Y: Eine gebuchte Buchung hat die Rechnung wahrscheinlich schon bezahlt — ein Posten nur mit Begründung.
  const booked = bookedPaymentsInternal(deps.db, invoice);
  if (booked.length > 0 && !v.reason) return financeConflict('invoiceProbablyPaidNeedsReason', { date: booked[0]!.entryDate });
  const template: Record<string, string> = {};
  if (invoice.taxCode) template.taxCode = invoice.taxCode;
  if (contactId) template.contactId = contactId;

  return createOpenItem(deps, ctx, {
    kind: invoice.duePayableCents < 0 ? 'receivable' : 'payable',
    itemDate: invoice.issueDate,
    contactId,
    amountCents: Math.abs(invoice.duePayableCents),
    dueOn: v.dueOn !== undefined ? v.dueOn : invoice.dueDate,
    documentId: v.documentId,
    paymentReference: reference,
    lineTemplate: Object.keys(template).length > 0 ? [template] : null,
    probablyPaidReason: booked.length > 0 ? v.reason : null,
  });
}

/**
 * `finance.entriesWrite`: die Angaben der Rechnung in einen Entwurf — Text
 * „{Lieferant} Rechnung {Nummer}“ (höchstens 300 Zeichen), auf jeder
 * Zuordnung ohne Kontakt den Kontakt der IBAN, auf jeder Zuordnung, deren
 * Kennzeichen noch die Vorgabe ihrer Kategorie ist, das Kennzeichen der
 * Rechnung; dazu das Dokument als Beleg, wenn es noch nicht daran hängt. Alles
 * über `saveDraft` und `attachDocument` — keine eigenen Schreibzugriffe.
 */
export async function applyInvoiceToDraft(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<EntryView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, applySchema, input);
  if (!parsed.ok) return parsed;
  const { entryId, documentId } = parsed.value;

  const entry = entryViewInternal(deps.db, entryId);
  if (!entry) return notFound('financeEntry', entryId);
  if (entry.status !== 'draft') return financeConflict('invoiceNotDraft');

  const loaded = await requireEuroInvoice(deps, ctx, documentId);
  if (!loaded.ok) return loaded;
  const { invoice, document } = loaded.value;
  // Vorab geprüft wie `attachDocument` — sonst stünde der neue Text schon im Entwurf, wenn das Anhängen scheitert.
  if (document.phase !== 'issued') return financeConflict('documentNotFinal');
  if (document.status === 'voided') return financeConflict('documentVoided');

  const categoryIds = [...new Set(entry.allocationLines.map((l) => l.categoryId))];
  const defaults = new Map(
    (categoryIds.length > 0 ? deps.db.select({ id: financeCategories.id, defaultTaxCode: financeCategories.defaultTaxCode }).from(financeCategories).where(inArray(financeCategories.id, categoryIds)).all() : []).map((c) => [c.id, c.defaultTaxCode]),
  );

  const saved = await saveDraft(deps, ctx, {
    id: entry.id,
    expectedVersion: entry.updatedAt,
    entryDate: entry.entryDate,
    text: `${invoice.sellerName} Rechnung ${invoice.invoiceNumber}`.slice(0, MAX_TEXT),
    moneyLines: entry.moneyLines.map((l) => ({ accountId: l.accountId, amountCents: l.amountCents, rawTransactionId: l.rawTransactionId, settlements: l.settlements.map((s) => ({ openItemId: s.openItemId, amountCents: s.amountCents })) })),
    allocationLines: entry.allocationLines.map((l) => ({
      categoryId: l.categoryId,
      amountCents: l.amountCents,
      taxCode: invoice.taxCode !== null && l.taxCode === defaults.get(l.categoryId) ? invoice.taxCode : l.taxCode,
      rateKind: l.rateKind,
      projectId: l.projectId,
      purposeId: l.purposeId,
      contactId: l.contactId ?? invoice.contactId,
      abroad: l.abroad,
      originLineId: l.originLineId,
      addsToAssets: l.addsToAssets,
    })),
  });
  if (!saved.ok) return saved;

  const linked = deps.db.select({ id: financeEntryDocuments.id }).from(financeEntryDocuments).where(and(eq(financeEntryDocuments.entryId, entry.id), eq(financeEntryDocuments.documentId, documentId))).get();
  if (!linked) {
    const attached = await attachDocument(deps, ctx, { entryId: entry.id, documentId });
    if (!attached.ok) return attached;
  }
  return ok(entryViewInternal(deps.db, entry.id)!);
}
