import { isoNow, newId, notFound, ok, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts, createContact, displayName, type ContactRecord } from '@kompass/module-contacts';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { isValidIban, normalizeIban } from '../ledger/iban';
import { activeMandateForIbanInternal } from '../direct-debit/mandate-state';
import { contactsForIbanInternal } from '../iban-holders';
import { financeContactBankAccounts, financeRawTransactions, type ContactIbanSourceKind, type FinanceContactBankAccountRow } from '../schema';

export { contactsForIbanInternal };

/**
 * Kontakt ↔ IBAN (F5, Spec 6.4 Vorschlag 5; Annahme 2): Kompass lernt die
 * Zuordnung nur aus Handlungen — beim Übernehmen eines Vorschlags mit Kontakt
 * und bei „Kontakt anlegen“ aus dem Umsatz — oder von Hand, nie rückwirkend
 * aus Altbuchungen. Arbeitsmaterial, löschbar. Die IBAN ist ein Bankdatum, der
 * Kontakt eine Person: Das Protokoll nennt nur, woher die Zuordnung stammt.
 */
/** `mandate` (L1): die IBAN eines Mandats gehört dem Mandatsgeber (Spec Mitglieder und Lastschrift § 7.2). */
export type ContactIbanSource = 'booking' | 'contactCreate' | 'manual' | 'mandate';

/** Die gespeicherte Herkunft (Plan U4 Task 3): Buchung und „Kontakt anlegen“ aus einem Umsatz sind beide gelernt. */
const SOURCE_KIND: Record<ContactIbanSource, ContactIbanSourceKind> = { booking: 'learned', contactCreate: 'learned', manual: 'manual', mandate: 'mandate' };

export interface ContactIbanView {
  id: string;
  contactId: string;
  iban: string;
  createdAt: string;
  /** Herkunft (Plan U4 Task 3); `null` bei Zuordnungen von davor. Von Hand: Person und Tag aus `createdByUserId`/`createdAt`. */
  source: ContactIbanSourceKind | null;
  /** Bei `learned`: der Tag des Umsatzes bzw. der Buchung. */
  learnedFromEntryDate: string | null;
  createdByUserId: string;
  /** Die anderen Kontakte, die dieselbe IBAN tragen (Gemeinschaftskonto). */
  coHolders: { contactId: string; name: string }[];
}

const viewOf = (row: FinanceContactBankAccountRow, coHolders: ContactIbanView['coHolders'] = []): ContactIbanView => ({
  id: row.id,
  contactId: row.contactId,
  iban: row.iban,
  createdAt: row.createdAt,
  source: row.source,
  learnedFromEntryDate: row.learnedFromEntryDate,
  createdByUserId: row.createdByUserId,
  coHolders,
});

const ibanField = z
  .string()
  .trim()
  .min(1)
  .max(42)
  .refine((v) => isValidIban(v), 'invalidIban')
  .transform((v) => normalizeIban(v));

/**
 * `mode` (Plan U4 Task 3, Nachtrag MCP-Test § 3): Trägt schon ein anderer Kontakt die IBAN, entscheidet die Rückfrage —
 * `shared` ein Gemeinschaftskonto (die bisherigen behalten sie, wie beim Lernen; M18), `move` „nur noch dieser“ (bei
 * den bisherigen entfernt). Ohne `mode` lehnt der Dienst ab und nennt die Inhaber.
 */
export const CONTACT_IBAN_MODES = ['shared', 'move'] as const;
const linkSchema = z.object({ contactId: z.string().min(1), iban: ibanField, mode: z.enum(CONTACT_IBAN_MODES).optional() });
const unlinkSchema = z.object({ id: z.string().min(1) });
const listSchema = z.object({ contactId: z.string().min(1) });
const createFromTransactionSchema = z.object({
  rawTransactionId: z.string().min(1),
  kind: z.enum(['person', 'organization']),
  firstName: z.string().trim().max(120).nullable().optional(),
  lastName: z.string().trim().max(120).nullable().optional(),
  name: z.string().trim().max(200).nullable().optional(),
});

function pairRow(db: DbOrTx, contactId: string, iban: string): FinanceContactBankAccountRow | undefined {
  return db.select().from(financeContactBankAccounts).where(and(eq(financeContactBankAccounts.contactId, contactId), eq(financeContactBankAccounts.iban, iban))).get();
}

function insertLinkInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, contactId: string, iban: string, learnedFrom: ContactIbanSource, learnedOn: string | null = null): FinanceContactBankAccountRow {
  const source = SOURCE_KIND[learnedFrom];
  const row: FinanceContactBankAccountRow = { id: newId(), contactId, iban, createdAt: isoNow(deps.clock), createdByUserId: ctx.userId ?? 'system', source, learnedFromEntryDate: source === 'learned' ? learnedOn : null };
  tx.insert(financeContactBankAccounts).values(row).run();
  financeAudit(tx, deps, ctx, { action: 'finance.contactIban.link', entity: 'financeContactBankAccount', id: row.id, after: { learnedFrom } });
  return row;
}

/**
 * Der eine aktive Kontakt, der eine IBAN trägt — `null`, wenn keiner, nur
 * archivierte oder gelöschte, oder mehrere aktive sie tragen. Ein
 * Gemeinschaftskonto (Eheleute, beide Mitglied) nennt so keinen Kontakt statt
 * still den zuletzt verknüpften: dieselbe Regel wie bei Name und E-Mail
 * (`contactForPartyInternal`, Befund 3 in 0.2.12). Ohne Rechteprüfung: für die
 * Vorschläge und ZUGFeRD.
 */
export function contactForIbanInternal(db: DbOrTx, iban: string): { contactId: string } | null {
  const rows = db
    .select({ contactId: financeContactBankAccounts.contactId })
    .from(financeContactBankAccounts)
    .innerJoin(contacts, eq(contacts.id, financeContactBankAccounts.contactId))
    .where(and(eq(financeContactBankAccounts.iban, normalizeIban(iban)), eq(contacts.status, 'active')))
    .limit(2)
    .all();
  return rows.length === 1 ? { contactId: rows[0]!.contactId } : null;
}

/**
 * Lernt eine Zuordnung in der Transaktion des Aufrufers (`bookFromTransaction`,
 * `createContactFromTransaction`). Nichts, wenn es sie schon gibt oder die IBAN
 * ungültig ist. Trägt die IBAN schon ein anderer Kontakt, entsteht trotzdem
 * eine zweite Zuordnung — ein Gemeinschaftskonto. Dann schlägt der Import
 * keinen Kontakt mehr vor, solange mehr als einer davon aktiv ist
 * (`contactForIbanInternal`).
 */
export function learnContactIbanInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, input: { contactId: string; iban: string; learnedFrom: ContactIbanSource; learnedOn?: string | null }): void {
  if (!isValidIban(input.iban)) return;
  const iban = normalizeIban(input.iban);
  if (pairRow(tx, input.contactId, iban)) return;
  insertLinkInternal(tx, deps, ctx, input.contactId, iban, input.learnedFrom, input.learnedOn ?? null);
}

/** Die anderen Kontakte mit derselben IBAN (Gemeinschaftskonto), älteste Zuordnung zuerst. */
function coHoldersInternal(db: DbOrTx, row: Pick<FinanceContactBankAccountRow, 'contactId' | 'iban'>): ContactIbanView['coHolders'] {
  return db
    .select({ contact: contacts })
    .from(financeContactBankAccounts)
    .innerJoin(contacts, eq(contacts.id, financeContactBankAccounts.contactId))
    .where(and(eq(financeContactBankAccounts.iban, row.iban), ne(financeContactBankAccounts.contactId, row.contactId)))
    .orderBy(asc(financeContactBankAccounts.createdAt))
    .all()
    .map((r) => ({ contactId: r.contact.id, name: displayName(r.contact) }));
}

const nameOf = (db: DbOrTx, contactId: string): string => {
  const row = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  return row ? displayName(row) : '';
};

/** Die Namen mehrerer Inhaber als ein Wert — Daten, kein Satz; den Satz baut die Sprachdatei. */
const joinNames = (names: string[]): string => names.join(', ');



/**
 * `finance.entriesWrite`: von Hand verknüpfen — idempotent. Trägt schon ein anderer Kontakt die IBAN, lehnt der Dienst
 * ohne `mode` ab und nennt die Inhaber (`contactIbanTaken`). `shared`: ein Gemeinschaftskonto, dieselbe Regel wie beim
 * Lernen (M18). `move` (Plan U4 Task 3): bei den bisherigen Inhabern entfernt — nicht, solange ein gültiges Mandat eines
 * bisherigen Inhabers über die IBAN läuft (`ibanHasMandate`). Das Protokoll nennt Herkunft, nie IBAN oder Namen.
 */
export async function linkContactIban(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ContactIbanView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, linkSchema, input);
  if (!parsed.ok) return parsed;
  const { contactId, iban, mode } = parsed.value;
  if (!deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contactId)).get()) return notFound('contact', contactId);

  const existing = pairRow(deps.db, contactId, iban);
  if (existing) return ok(viewOf(existing, coHoldersInternal(deps.db, existing)));
  const others = contactsForIbanInternal(deps.db, iban).filter((id) => id !== contactId);
  if (others.length > 0 && !mode) return financeConflict('contactIbanTaken', { contact: joinNames(others.map((id) => nameOf(deps.db, id))) });
  if (others.length > 0 && mode === 'move') {
    const mandate = activeMandateForIbanInternal(deps.db, others, iban, todayIn(deps));
    if (mandate) return financeConflict('ibanHasMandate', { contact: nameOf(deps.db, mandate.contactId), mandateId: mandate.id });
  }
  return deps.db.transaction((tx: DbOrTx) => {
    if (others.length > 0 && mode === 'move') {
      for (const row of tx.select().from(financeContactBankAccounts).where(and(eq(financeContactBankAccounts.iban, iban), inArray(financeContactBankAccounts.contactId, others))).all()) {
        tx.delete(financeContactBankAccounts).where(eq(financeContactBankAccounts.id, row.id)).run();
        financeAudit(tx, deps, ctx, { action: 'finance.contactIban.delete', entity: 'financeContactBankAccount', id: row.id, params: { withContact: false } });
      }
    }
    const row = insertLinkInternal(tx, deps, ctx, contactId, iban, 'manual');
    // U10 (Plan N3): Das Ergebnis nennt die Mitinhaber wie die Liste.
    return ok(viewOf(row, coHoldersInternal(tx, row)));
  });
}

/**
 * `finance.entriesWrite`; Löschregel `financeContactBankAccount` — Arbeitsmaterial. Nicht, solange ein gültiges Mandat
 * des Kontakts über die IBAN läuft (Plan U4 Task 3, `ibanHasMandate`): Erst das Mandat beenden.
 */
export async function unlinkContactIban(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string }>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, unlinkSchema, input);
  if (!parsed.ok) return parsed;
  const before = deps.db.select().from(financeContactBankAccounts).where(eq(financeContactBankAccounts.id, parsed.value.id)).get();
  if (!before) return notFound('financeContactBankAccount', parsed.value.id);
  const mandate = activeMandateForIbanInternal(deps.db, [before.contactId], before.iban, todayIn(deps));
  if (mandate) return financeConflict('ibanHasMandate', { contact: nameOf(deps.db, before.contactId), mandateId: mandate.id });
  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(financeContactBankAccounts).where(eq(financeContactBankAccounts.id, before.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.contactIban.delete', entity: 'financeContactBankAccount', id: before.id, params: { withContact: false } });
    return ok({ id: before.id });
  });
}

/** `finance.read`: IBANs sind Bankdaten. */
export async function listContactIbans(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ items: ContactIbanView[] }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listSchema, input);
  if (!parsed.ok) return parsed;
  const rows = deps.db.select().from(financeContactBankAccounts).where(eq(financeContactBankAccounts.contactId, parsed.value.contactId)).orderBy(asc(financeContactBankAccounts.createdAt), asc(financeContactBankAccounts.id)).all();
  return ok({ items: rows.map((row) => viewOf(row, coHoldersInternal(deps.db, row))) });
}

/**
 * Namensteile aus der Gegenpartei: „Nachname, Vorname“ oder „Vorname …
 * Nachname“ (das letzte Wort ist der Nachname). Nur für Felder, die der
 * Aufrufer nicht selbst angibt.
 */
function personNameFrom(counterparty: string | null): { firstName: string | null; lastName: string | null } {
  const text = (counterparty ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return { firstName: null, lastName: null };
  if (text.includes(',')) {
    const [last, ...rest] = text.split(',');
    return { lastName: last!.trim() || null, firstName: rest.join(',').trim() || null };
  }
  const words = text.split(' ');
  return { lastName: words.at(-1)!, firstName: words.length > 1 ? words.slice(0, -1).join(' ') : null };
}

/**
 * `finance.entriesWrite` **und** `contacts.manage`: legt den Kontakt über
 * `createContact` des Kontaktmoduls an — mit demselben `ctx`, damit dessen
 * Rechteprüfung und Protokoll gelten — und verknüpft die IBAN des Umsatzes
 * (`learnedFrom: 'contactCreate'`). Die Rolle „Spender“ setzt erst der erste
 * Vorgang. Zwei Transaktionen: Scheitert das Verknüpfen, bleibt der Kontakt —
 * er ist dann schlicht ohne IBAN angelegt.
 */
export async function createContactFromTransaction(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ contact: ContactRecord; bankAccountId: string | null }>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite') ?? requirePermission(ctx, 'contacts.manage');
  if (denied) return denied;
  const parsed = validate(deps, createFromTransactionSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const raw = deps.db.select().from(financeRawTransactions).where(eq(financeRawTransactions.id, v.rawTransactionId)).get();
  if (!raw) return notFound('financeRawTransaction', v.rawTransactionId);

  let contactInput: Record<string, unknown>;
  if (v.kind === 'person') {
    const derived = personNameFrom(raw.counterpartyName);
    contactInput = { kind: 'person', firstName: v.firstName ?? derived.firstName, lastName: v.lastName ?? derived.lastName ?? '' };
  } else {
    contactInput = { kind: 'organization', name: v.name ?? raw.counterpartyName ?? '' };
  }
  const created = await createContact(deps, ctx, contactInput);
  if (!created.ok) return created;

  let bankAccountId: string | null = null;
  if (raw.counterpartyIban && isValidIban(raw.counterpartyIban)) {
    const iban = normalizeIban(raw.counterpartyIban);
    deps.db.transaction((tx: DbOrTx) => learnContactIbanInternal(tx, deps, ctx, { contactId: created.value.id, iban, learnedFrom: 'contactCreate', learnedOn: raw.bookingDate }));
    bankAccountId = pairRow(deps.db, created.value.id, iban)?.id ?? null;
  }
  return ok({ contact: created.value, bankAccountId });
}
