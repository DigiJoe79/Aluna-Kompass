import { isoNow, newId, notFound, ok, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts, createContact, displayName, type ContactRecord } from '@kompass/module-contacts';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { isValidIban, normalizeIban } from '../ledger/iban';
import { financeContactBankAccounts, financeRawTransactions, type FinanceContactBankAccountRow } from '../schema';

/**
 * Kontakt ↔ IBAN (F5, Spec 6.4 Vorschlag 5; Annahme 2): Kompass lernt die
 * Zuordnung nur aus Handlungen — beim Übernehmen eines Vorschlags mit Kontakt
 * und bei „Kontakt anlegen“ aus dem Umsatz — oder von Hand, nie rückwirkend
 * aus Altbuchungen. Arbeitsmaterial, löschbar. Die IBAN ist ein Bankdatum, der
 * Kontakt eine Person: Das Protokoll nennt nur, woher die Zuordnung stammt.
 */
export type ContactIbanSource = 'booking' | 'contactCreate' | 'manual';

export interface ContactIbanView {
  id: string;
  contactId: string;
  iban: string;
  createdAt: string;
}

const viewOf = (row: FinanceContactBankAccountRow): ContactIbanView => ({ id: row.id, contactId: row.contactId, iban: row.iban, createdAt: row.createdAt });

const ibanField = z
  .string()
  .trim()
  .min(1)
  .max(42)
  .refine((v) => isValidIban(v), 'invalidIban')
  .transform((v) => normalizeIban(v));

const linkSchema = z.object({ contactId: z.string().min(1), iban: ibanField });
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

function insertLinkInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, contactId: string, iban: string, learnedFrom: ContactIbanSource): FinanceContactBankAccountRow {
  const row: FinanceContactBankAccountRow = { id: newId(), contactId, iban, createdAt: isoNow(deps.clock), createdByUserId: ctx.userId ?? 'system' };
  tx.insert(financeContactBankAccounts).values(row).run();
  financeAudit(tx, deps, ctx, { action: 'finance.contactIban.link', entity: 'financeContactBankAccount', id: row.id, after: { learnedFrom }, summary: `Kontakt-IBAN ${row.id} verknüpft` });
  return row;
}

/**
 * Der Kontakt, dem eine IBAN zuletzt zugeordnet wurde — `null`, wenn keiner
 * (oder nur ein inzwischen gelöschter Kontakt) sie trägt. Ohne Rechteprüfung:
 * für die Vorschläge (Task 4).
 */
export function contactForIbanInternal(db: DbOrTx, iban: string): { contactId: string } | null {
  const row = db
    .select({ contactId: financeContactBankAccounts.contactId })
    .from(financeContactBankAccounts)
    .innerJoin(contacts, eq(contacts.id, financeContactBankAccounts.contactId))
    .where(eq(financeContactBankAccounts.iban, normalizeIban(iban)))
    .orderBy(desc(financeContactBankAccounts.createdAt), desc(financeContactBankAccounts.id))
    .limit(1)
    .get();
  return row ? { contactId: row.contactId } : null;
}

/**
 * Lernt eine Zuordnung in der Transaktion des Aufrufers (`bookFromTransaction`,
 * `createContactFromTransaction`). Nichts, wenn es sie schon gibt oder die IBAN
 * ungültig ist. Trägt die IBAN schon ein anderer Kontakt, entsteht trotzdem
 * eine zweite Zuordnung — ein Gemeinschaftskonto — und die jüngste gewinnt.
 */
export function learnContactIbanInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, input: { contactId: string; iban: string; learnedFrom: ContactIbanSource }): void {
  if (!isValidIban(input.iban)) return;
  const iban = normalizeIban(input.iban);
  if (pairRow(tx, input.contactId, iban)) return;
  insertLinkInternal(tx, deps, ctx, input.contactId, iban, input.learnedFrom);
}

/**
 * `finance.entriesWrite`: von Hand verknüpfen — idempotent. Anders als das
 * Lernen aus einer Handlung verweigert es eine IBAN, die schon ein anderer
 * Kontakt trägt: Wer von Hand zuordnet, entscheidet bewusst und löst zuerst
 * die vorhandene Zuordnung.
 */
export async function linkContactIban(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ContactIbanView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, linkSchema, input);
  if (!parsed.ok) return parsed;
  const { contactId, iban } = parsed.value;
  if (!deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contactId)).get()) return notFound('contact', contactId);

  const existing = pairRow(deps.db, contactId, iban);
  if (existing) return ok(viewOf(existing));
  const other = contactForIbanInternal(deps.db, iban);
  if (other && other.contactId !== contactId) {
    const owner = deps.db.select().from(contacts).where(eq(contacts.id, other.contactId)).get()!;
    return financeConflict('contactIbanTaken', { contact: displayName(owner) });
  }
  return deps.db.transaction((tx: DbOrTx) => ok(viewOf(insertLinkInternal(tx, deps, ctx, contactId, iban, 'manual'))));
}

/** `finance.entriesWrite`; Löschregel `financeContactBankAccount` — Arbeitsmaterial. */
export async function unlinkContactIban(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string }>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, unlinkSchema, input);
  if (!parsed.ok) return parsed;
  const before = deps.db.select().from(financeContactBankAccounts).where(eq(financeContactBankAccounts.id, parsed.value.id)).get();
  if (!before) return notFound('financeContactBankAccount', parsed.value.id);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(financeContactBankAccounts).where(eq(financeContactBankAccounts.id, before.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.contactIban.delete', entity: 'financeContactBankAccount', id: before.id, summary: `Kontakt-IBAN ${before.id} gelöst` });
    return ok({ id: before.id });
  });
}

/** `finance.read`: IBANs sind Bankdaten. */
export async function listContactIbans(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ items: ContactIbanView[] }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listSchema, input);
  if (!parsed.ok) return parsed;
  const rows = deps.db.select().from(financeContactBankAccounts).where(eq(financeContactBankAccounts.contactId, parsed.value.contactId)).orderBy(asc(financeContactBankAccounts.createdAt)).all();
  return ok({ items: rows.map(viewOf) });
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
    deps.db.transaction((tx: DbOrTx) => learnContactIbanInternal(tx, deps, ctx, { contactId: created.value.id, iban, learnedFrom: 'contactCreate' }));
    bankAccountId = pairRow(deps.db, created.value.id, iban)?.id ?? null;
  }
  return ok({ contact: created.value, bankAccountId });
}
