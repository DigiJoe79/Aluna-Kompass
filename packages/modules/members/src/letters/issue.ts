import { invalid, notFound, ok, readLocales, readSetting, recordAudit, requireHumanChannel, requirePermission, todayIn, validate, nameOrEmpty, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { qrRows } from '@kompass/documents/qr';
import type { TransferBlockData } from '@kompass/documents/transfer-block';
import { contacts, deliveryForContactInternal, displayName, formatPostalAddress } from '@kompass/module-contacts';
import { issueGeneratedDocument, linkDocumentInternal, type IssuedDocument } from '@kompass/module-dms';
import { activeRunItemsInternal, addBusinessDays, addCalendarDays, epcQrPayload, greetingFor, isTargetBusinessDay, issuePrenotification, mandateRowInternal, recordPrenotificationInternal, returnsByItemInternal } from '@kompass/module-finance';
import { formatEuro } from '@kompass/module-finance/format';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { membersConflict } from '../errors';
import { effectiveFee, typeAt } from '../fee-agreement';
import { feePaymentReference } from '../fee-period';
import { feeViewsInternal, liveCharges } from '../fees';
import { mandateForChargeInternal, recordTransferRequestsInternal } from '../payment-method';
import { memberFeeCharges, memberMemberships, memberTypes, type FeeChargeRow, type MembershipRow } from '../schema';
import { admissionLetter, ADMISSION_TEMPLATE_KEY } from './admission';
import type { ChargeFacts, DirectDebitFacts, LetterFacts } from './facts';
import { FEE_NOTICE_TEMPLATE_KEY, feeNoticeLetter } from './fee-notice';
import { REJECTION_TEMPLATE_KEY, rejectionLetter } from './rejection';
import { PAYMENT_REQUEST_TEMPLATE_KEY, REMINDER_TEMPLATE_KEY, reminderLetter } from './reminder';
import { RESIGNATION_TEMPLATE_KEY, resignationLetter } from './resignation';
import { announcedCollectionDay, day, TRANSFER_LABELS, type MemberLetterInput } from './shared';

const HUMAN_ONLY_SETTING = 'members.mcpHumanOnlyAllowed';
export const MEMBER_LETTER_KINDS = ['admission', 'resignation', 'rejection', 'feeNotice', 'reminder', 'paymentRequest'] as const;
export type MemberLetterKind = (typeof MEMBER_LETTER_KINDS)[number];

const TEMPLATE_OF: Record<MemberLetterKind, string> = {
  admission: ADMISSION_TEMPLATE_KEY,
  resignation: RESIGNATION_TEMPLATE_KEY,
  rejection: REJECTION_TEMPLATE_KEY,
  feeNotice: FEE_NOTICE_TEMPLATE_KEY,
  reminder: REMINDER_TEMPLATE_KEY,
  paymentRequest: PAYMENT_REQUEST_TEMPLATE_KEY,
};

/** Das Recht, unter dem ein Brief entsteht: Briefe zur Mitgliedschaft `members.manage`, zu Beiträgen `members.fees` (Spec § 8). */
export const LETTER_PERMISSION: Record<MemberLetterKind, string> = {
  admission: 'members.manage',
  resignation: 'members.manage',
  rejection: 'members.manage',
  feeNotice: 'members.fees',
  reminder: 'members.fees',
  paymentRequest: 'members.fees',
};

export type MemberLetterData =
  | { kind: 'admission' | 'resignation' | 'rejection' }
  | { kind: 'feeNotice'; data: { year: number } }
  | { kind: 'reminder'; data: { levelName: string; levelText: string | null; chargeIds: string[]; returnedOn: string | null } }
  /** M22: ohne Tag — er kommt aus der festgeschriebenen Rückgabe der Posten. */
  | { kind: 'paymentRequest'; data: { chargeIds: string[] } };

export type MemberLetterRequest = MemberLetterData & { membershipId: string };

export interface IssuedMemberLetter {
  documentId: string;
  number: string;
  /** Empfänger: das Mitglied oder bei Minderjährigen die gesetzliche Vertretung. */
  contactId: string;
  /** M39: die eigene Ankündigung an einen Kontoinhaber, der nicht Empfänger ist — ausgestellt oder mit Grund abgelehnt. */
  prenotification?: { documentId: string; number: string } | { refused: string } | null;
}

/** Minderjährig am Tag `on` (Geburtstag zählt). Ohne Geburtsdatum gilt eine eingetragene Vertretung. */
function isMinor(birthDate: string | null, on: string): boolean {
  if (!birthDate) return true;
  const adult = `${Number(birthDate.slice(0, 4)) + 18}${birthDate.slice(4)}`;
  return on < adult;
}

/** An wen der Brief geht: das Mitglied, oder bei Minderjährigen die gesetzliche Vertretung (Spec § 3.2). */
export function letterRecipientOf(row: Pick<MembershipRow, 'contactId' | 'guardianContactId' | 'birthDate'>, today: string): string {
  return row.guardianContactId && isMinor(row.birthDate, today) ? row.guardianContactId : row.contactId;
}

const hasAddress = (c: { street: string | null; postalCode: string | null; city: string | null } | undefined) => !!c && (!!c.street?.trim() || !!c.city?.trim() || !!c.postalCode?.trim());

/** Empfänger, Anschrift, Anrede — oder `addressMissing`, wenn weder Anschrift noch E-Mail da ist (Review Focus 3). */
export function recipientFacts(db: DbOrTx, contactId: string): Result<{ recipient: string; greeting: string }> {
  const contact = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  if (!contact) return notFound('contact', contactId);
  const organization = contact.belongsToId ? (db.select().from(contacts).where(eq(contacts.id, contact.belongsToId)).get() ?? null) : null;
  const postal = hasAddress(contact) || hasAddress(organization ?? undefined);
  if (!postal && deliveryForContactInternal(db, contactId).channel !== 'email') return membersConflict('addressMissing');
  return ok({ recipient: formatPostalAddress(contact, organization), greeting: greetingFor(contact) });
}

/** Die Beiträge als Briefzeilen, früheste zuerst. */
function chargeFacts(db: DbOrTx, deps: Deps, rows: FeeChargeRow[], memberNumber: string): ChargeFacts[] {
  const method = new Map(rows.map((r) => [r.id, r.paymentMethod]));
  return feeViewsInternal(db, deps, rows)
    .map((v) => ({ chargeId: v.chargeId, period: v.period, year: v.periodStart.slice(0, 4), dueOn: v.dueOn, amountCents: v.amountCents, paidCents: v.paidCents, openCents: v.openCents, reference: feePaymentReference(v.periodStart, v.periodEnd, memberNumber), method: method.get(v.chargeId) ?? 'transfer' }))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.period.localeCompare(b.period));
}

/** Konto des Vereins aus den Einstellungen; ohne IBAN kein Überweisungsblock. */
function bankOf(deps: Deps): LetterFacts['bank'] {
  const iban = (readSetting<string>(deps, 'organization.iban') ?? '').trim();
  if (!iban) return null;
  const bic = (readSetting<string>(deps, 'organization.bic') ?? '').trim();
  return { iban, bic: bic || null };
}

function transferData(f: LetterFacts, amountCents: number, reference: string): TransferBlockData | null {
  if (!f.bank || amountCents <= 0) return null;
  const payload = epcQrPayload({ recipient: f.organizationName, iban: f.bank.iban, amountCents, reference });
  return { name: f.organizationName, iban: f.bank.iban, bic: f.bank.bic, amount: formatEuro(amountCents), reference, qr: payload ? qrRows(payload) : null, labels: TRANSFER_LABELS };
}

/**
 * Lastschrift für die Beiträge mit Zahlweg Lastschrift (Plan N1 E3), mit dem Mandat, von dem der erste von ihnen am
 * Briefdatum eingezogen würde: Referenz und Gläubiger-ID für den Brief. `null` ohne solche Beiträge oder ohne Mandat.
 */
function directDebitFor(db: DbOrTx, deps: Deps, charges: FeeChargeRow[], today: string, recipientId: string): (DirectDebitFacts & { mandateId: string; holderContactId: string }) | null {
  const first = charges.filter((c) => c.paymentMethod === 'directDebit').sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
  const mandateId = first ? mandateForChargeInternal(db, first, today) : null;
  if (!mandateId) return null;
  const mandate = mandateRowInternal(db, mandateId);
  if (!mandate) return null;
  // M39: Gehört das Konto jemand anderem als dem Empfänger, nennt der Brief ihn, und die Ankündigung geht an ihn.
  const holderName = mandate.contactId !== recipientId ? mandate.debtorName : null;
  return { mandateId: mandate.id, mandateReference: mandate.reference, creditorId: readSetting<string | null>(deps, 'finance.sepa.creditorId'), holderName, holderContactId: mandate.contactId };
}

/**
 * Der früheste Einzugstag, den ein heute ausgestellter Brief ankündigen kann: heute plus `finance.sepa.preNotificationDays`,
 * auf den nächsten Bankarbeitstag — dieselbe Frist, nach der der Einzug die Ankündigung als rechtzeitig zählt.
 */
function earliestAnnouncedCollection(deps: Deps, today: string): string {
  const day = addCalendarDays(today, readSetting<number>(deps, 'finance.sepa.preNotificationDays'));
  return isTargetBusinessDay(day) ? day : addBusinessDays(day, 1);
}

const typeNameOf = (db: DbOrTx, deps: Deps, typeId: string | undefined): string => {
  const type = typeId ? db.select().from(memberTypes).where(eq(memberTypes.id, typeId)).get() : undefined;
  return nameOrEmpty(type?.name[readLocales(deps)[0]!]);
};

interface Composed {
  input: MemberLetterInput;
  /** Bei Lastschrift: die Einzüge, die der Brief ankündigt (Spec § 7.5). */
  prenotification: { mandateId: string; plan: { dueOn: string; amountCents: number }[] } | null;
  /** M39: Die Einzüge, die eine eigene Ankündigung an den Kontoinhaber nennen muss (er ist nicht der Empfänger). */
  holderPrenotification?: { mandateId: string; plan: { dueOn: string; amountCents: number }[] } | null;
  /** Die Beiträge, zu denen der Brief zur Überweisung auffordert (Plan N1 E3). */
  transferChargeIds: string[];
}

/** Läuft die Mitgliedschaft im Jahr (M23)? Aufgenommen, eingetreten bis Jahresende, nicht vor Jahresbeginn beendet. */
const runsIn = (row: MembershipRow, year: number) => !!row.memberNumber && !!row.joinedOn && row.joinedOn <= `${year}-12-31` && (!row.endsOn || row.endsOn >= `${year}-01-01`);

/** M22: der Tag des Einzugs, der zum Posten zurückkam (der jüngste) — `null` ohne festgeschriebene Rückgabe. */
function returnedOnOf(db: DbOrTx, openItemId: string | null): string | null {
  if (!openItemId) return null;
  const items = activeRunItemsInternal(db, { source: 'openItem', sourceId: openItemId });
  const returns = returnsByItemInternal(db, items.map((r) => r.item.id));
  return items.filter((r) => returns.has(r.item.id)).map((r) => r.collectionDate).sort().at(-1) ?? null;
}

function compose(deps: Deps, row: MembershipRow, f: LetterFacts, request: MemberLetterData, recipientId: string): Result<Composed> {
  const db = deps.db;
  const memberNumber = row.memberNumber ?? '';
  // Der Plan der Ankündigung nennt den Tag, den der Brief als Einzugstag nennt (E1): Nur an ihm deckt sie den Einzug.
  const earliest = earliestAnnouncedCollection(deps, f.today);
  // R4, R11: je Einzug der Verwendungszweck des Beitrags — der Zahler ordnet zu, und ein späterer Zahlwegwechsel findet die Ankündigung.
  const plan = (charges: ChargeFacts[]) => charges.filter((c) => c.openCents > 0 && c.method === 'directDebit').map((c) => ({ dueOn: announcedCollectionDay(c.dueOn, earliest), amountCents: c.openCents, remittance: c.reference }));
  const announcedPlan = (dd: { mandateId: string } | null, charges: ChargeFacts[]) => (dd && plan(charges).length > 0 ? { mandateId: dd.mandateId, plan: plan(charges) } : null);
  // M39: Der Brief an den Empfänger kündigt nur an, wenn ihm das Konto gehört; sonst eine eigene Ankündigung an den Inhaber.
  const announce = (dd: { mandateId: string; holderName?: string | null } | null, charges: ChargeFacts[]) =>
    dd?.holderName ? { prenotification: null, holderPrenotification: announcedPlan(dd, charges) } : { prenotification: announcedPlan(dd, charges) };
  switch (request.kind) {
    case 'admission': {
      if (!row.joinedOn || !row.memberNumber) return membersConflict('membershipNotActive');
      const fee = effectiveFee(db, row.id, row.joinedOn);
      const year = row.joinedOn.slice(0, 4);
      const rows = liveCharges(db).filter((c) => c.membershipId === row.id && c.periodStart.startsWith(`${year}-`));
      const charges = chargeFacts(db, deps, rows, memberNumber);
      const dd = directDebitFor(db, deps, rows, f.today, recipientId);
      const input = admissionLetter(f, {
        typeName: typeNameOf(db, deps, typeAt(db, row.id, row.joinedOn)?.typeId),
        joinedOn: row.joinedOn,
        fee: 'none' in fee ? null : { amountCents: fee.exempt ? 0 : fee.amountCents, interval: fee.interval, method: fee.paymentMethod },
        charges,
        directDebit: dd,
        transfer: (c) => transferData(f, c.openCents, c.reference),
        paymentTermDays: readSetting<number>(deps, 'members.paymentTermDays'),
        earliestCollection: dd ? earliest : null,
      });
      const firstTransfer = input.transfer ? charges.find((c) => c.openCents > 0 && (c.method === 'transfer' || !dd)) : undefined;
      return ok({ input, ...announce(dd, charges), transferChargeIds: firstTransfer ? [firstTransfer.chargeId] : [] });
    }
    case 'resignation':
      if (!row.endsOn) return membersConflict('membershipNotActive');
      return ok({ input: resignationLetter(f, { noticeOn: row.endNoticeOn, endsOn: row.endsOn }), prenotification: null, transferChargeIds: [] });
    case 'rejection':
      // M23: Ablehnung nur für einen Antrag (offen oder abgelehnt), nie für ein aufgenommenes Mitglied.
      if (row.memberNumber) return membersConflict('membershipNotApplied');
      return ok({ input: rejectionLetter(f, { appliedOn: row.appliedOn }), prenotification: null, transferChargeIds: [] });
    case 'feeNotice': {
      const { year } = request.data;
      // M23: nur für ein Jahr, in dem die Mitgliedschaft läuft.
      if (!runsIn(row, year)) return membersConflict('membershipNotInYear', { year });
      const rows = liveCharges(db).filter((c) => c.membershipId === row.id && c.periodStart.startsWith(`${year}-`));
      const charges = chargeFacts(db, deps, rows, memberNumber);
      const dd = directDebitFor(db, deps, rows, f.today, recipientId);
      const input = feeNoticeLetter(f, { year, charges, directDebit: dd, transfer: (c) => transferData(f, c.openCents, c.reference), earliestCollection: dd ? earliest : null, paymentTermDays: readSetting<number>(deps, 'members.paymentTermDays') });
      const transferChargeIds = charges.filter((c) => c.openCents > 0 && (c.method === 'transfer' || !dd)).map((c) => c.chargeId);
      return ok({ input, ...announce(dd, charges), transferChargeIds });
    }
    case 'reminder':
    case 'paymentRequest': {
      const ids = request.data.chargeIds;
      const rows = ids.length === 0 ? [] : db.select().from(memberFeeCharges).where(inArray(memberFeeCharges.id, ids)).all();
      const foreign = ids.find((id) => !rows.some((r) => r.id === id && r.membershipId === row.id));
      if (foreign) return notFound('memberFeeCharge', foreign);
      // M22: Die Zahlungsaufforderung nach einer Rücklastschrift nur für zurückgegebene Posten; der Tag kommt aus der Rückgabe.
      let returnedOn = request.kind === 'reminder' ? request.data.returnedOn : null;
      if (request.kind === 'paymentRequest') {
        const days = rows.map((r) => returnedOnOf(db, r.openItemId));
        if (days.some((d) => d === null)) return membersConflict('paymentRequestNeedsReturn');
        returnedOn = (days as string[]).sort().at(-1)!;
      }
      const input = reminderLetter(f, {
        levelName: request.kind === 'reminder' ? request.data.levelName : null,
        levelText: request.kind === 'reminder' ? request.data.levelText : null,
        charges: chargeFacts(db, deps, rows, memberNumber),
        returnedOn,
        paymentTermDays: readSetting<number>(deps, 'members.paymentTermDays'),
        transfer: (amount, reference) => transferData(f, amount, reference),
      });
      // Mahnung und Zahlungsaufforderung fordern zu allen genannten Beiträgen zur Überweisung auf.
      return ok({ input, prenotification: null, transferChargeIds: input.transfer ? ids : [] });
    }
  }
}

/**
 * Stellt einen Brief der Mitgliedschaft als festgeschriebenes Dokument der Akte aus (Plan M4 Task 2). Ohne eigene
 * Rechteprüfung über das Recht der Vorlage hinaus (das prüft die Akte) — Dienste und Läufe rufen es. Rendern braucht
 * Zeit außerhalb einer Transaktion; was in der Transaktion des Ausstellens geschehen soll, kommt über `afterIssue`.
 * Bei Lastschrift kündigen Aufnahmebestätigung und Beitragsmitteilung die Einzüge an: eine Zeile in den Ankündigungen
 * der Finanzen mit diesem Dokument, kein zweites (Spec § 7.5).
 */
export async function issueMemberLetterInternal(
  deps: Deps,
  ctx: CallContext,
  request: MemberLetterRequest,
  opts: {
    afterIssue?: (tx: DbOrTx, doc: IssuedDocument, contactId: string) => void;
    /** R5: die eigene Ankündigung an einen fremden Kontoinhaber, ausgestellt — etwa für den Versandplan eines Laufs. */
    afterHolderNotice?: (tx: DbOrTx, documentId: string, holderContactId: string) => void;
  } = {},
): Promise<Result<IssuedMemberLetter>> {
  const row = deps.db.select().from(memberMemberships).where(eq(memberMemberships.id, request.membershipId)).get();
  if (!row) return notFound('membership', request.membershipId);
  const today = todayIn(deps);
  const contactId = letterRecipientOf(row, today);
  const recipient = recipientFacts(deps.db, contactId);
  if (!recipient.ok) return recipient;
  const member = contactId === row.contactId ? null : deps.db.select().from(contacts).where(eq(contacts.id, row.contactId)).get();
  const facts: LetterFacts = {
    memberName: member ? displayName(member) : null,
    memberNumber: row.memberNumber ?? '',
    recipient: recipient.value.recipient,
    greeting: recipient.value.greeting,
    organizationName: (readSetting<string>(deps, 'organization.name') ?? '').trim(),
    bank: bankOf(deps),
    today,
  };
  const composed = compose(deps, row, facts, request, contactId);
  if (!composed.ok) return composed;
  const { input, prenotification, holderPrenotification, transferChargeIds } = composed.value;
  const issued = await issueGeneratedDocument(deps, ctx, {
    templateKey: TEMPLATE_OF[request.kind],
    input,
    subject: input.subject,
    documentDate: today,
    links: [
      { entityType: 'membership', entityId: row.id, role: 'about' },
      { entityType: 'contact', entityId: contactId, role: 'recipient' },
    ],
    afterIssue: (tx, doc) => {
      if (prenotification) recordPrenotificationInternal(tx, deps, ctx, { mandateId: prenotification.mandateId, documentId: doc.id, plan: prenotification.plan });
      if (transferChargeIds.length > 0) recordTransferRequestsInternal(tx, deps, transferChargeIds, doc.id);
      recordAudit(tx, deps, ctx, { action: 'members.letter.issue', entityType: 'membership', entityId: row.id, after: { kind: request.kind, documentId: doc.id }, params: { memberNumber: row.memberNumber, kind: request.kind, documentNumber: doc.number } });
      opts.afterIssue?.(tx, doc, contactId);
      return null;
    },
  });
  if (!issued.ok) return issued;
  // M39: Die Vorabankündigung geht an den Zahler, also den Inhaber des Mandats — als Lastschriftankündigung der Finanzen.
  let holderLetter: IssuedMemberLetter['prenotification'] = null;
  if (holderPrenotification) {
    const notice = await issuePrenotification(deps, ctx, holderPrenotification);
    holderLetter = notice.ok ? { documentId: notice.value.documentId, number: notice.value.number } : { refused: refusalCode(notice) };
    const holderContactId = mandateRowInternal(deps.db, holderPrenotification.mandateId)?.contactId;
    if (notice.ok && holderContactId) {
      // R5: Die Ankündigung gehört auch zur Mitgliedschaft (Briefe am Mitglied, Druck des Laufs) und, im Lauf, in dessen Versandplan.
      deps.db.transaction((tx: DbOrTx) => {
        linkDocumentInternal(tx, deps, { documentId: notice.value.documentId, entityType: 'membership', entityId: row.id });
        opts.afterHolderNotice?.(tx, notice.value.documentId, holderContactId);
      });
    }
  }
  return ok({ documentId: issued.value.document.id, number: issued.value.document.number ?? '', contactId, prenotification: holderLetter });
}

const id = z.string().min(1);
/** Flach, ohne Union und ohne bedingte Pflicht im Schema (M11, N5): Was die Art verlangt, prüft der Dienst. */
export const memberLetterIssueSchema = z
  .object({
    kind: z.enum(['admission', 'resignation', 'rejection', 'feeNotice', 'paymentRequest']),
    membershipId: id,
    /** Nur `feeNotice`: das Jahr der Beiträge. */
    year: z.number().int().min(2000).max(9999).optional(),
    /** Nur `paymentRequest`: die Beiträge, zu denen aufgefordert wird. */
    chargeIds: z.array(id).min(1).max(50).optional(),
  });

/**
 * Einen Brief einzeln ausstellen (nur ein Mensch, wie das Ausstellen in der Akte): Aufnahme, Austritt, Ablehnung
 * (`members.manage`), Beitragsmitteilung und Zahlungsaufforderung nach einer Rückgabe (`members.fees`). Die Mahnung
 * entsteht nur im Mahnlauf, weil ihre Stufe erst mit dem Lauf feststeht.
 */
export async function issueMemberLetter(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<IssuedMemberLetter>> {
  const kind = typeof input === 'object' && input !== null && 'kind' in input ? (input as { kind: unknown }).kind : undefined;
  const denied = requirePermission(ctx, LETTER_PERMISSION[kind as MemberLetterKind] ?? 'members.manage');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, HUMAN_ONLY_SETTING);
  if (human) return human;
  const parsed = validate(deps, memberLetterIssueSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (v.kind === 'feeNotice' && v.year === undefined) return invalid([{ path: 'year', message: 'required' }]);
  if (v.kind === 'paymentRequest' && v.chargeIds === undefined) return invalid([{ path: 'chargeIds', message: 'required' }]);
  const request: MemberLetterRequest =
    v.kind === 'feeNotice' ? { kind: 'feeNotice', membershipId: v.membershipId, data: { year: v.year! } }
    : v.kind === 'paymentRequest' ? { kind: 'paymentRequest', membershipId: v.membershipId, data: { chargeIds: v.chargeIds! } }
    : { kind: v.kind, membershipId: v.membershipId };
  return issueMemberLetterInternal(deps, ctx, request);
}

/** Was ein Ablauf der Mitgliedschaft über seinen Brief meldet: ausgestellt, abgelehnt mit Grund, oder keiner. */
export type LetterOutcome = { documentId: string; number: string } | { refused: string } | null;

/**
 * Der Brief zu einem Ablauf (Aufnahme, Austritt, Ablehnung), nachdem dieser gespeichert ist: Der Ablauf hängt nie am
 * Brief (Entscheid Joe 2026-10-18, BEWERTUNG Frage 6) — fehlt die Anschrift, meldet das Ergebnis den Grund.
 */
export async function letterAfterStep(deps: Deps, ctx: CallContext, wanted: boolean | undefined, fallback: boolean, request: MemberLetterRequest): Promise<LetterOutcome> {
  const human = requireHumanChannel(deps, ctx, HUMAN_ONLY_SETTING);
  const issue = wanted ?? (fallback && human === null);
  if (!issue) return null;
  if (human) return { refused: refusalCode(human) };
  const issued = await issueMemberLetterInternal(deps, ctx, request);
  return issued.ok ? { documentId: issued.value.documentId, number: issued.value.number } : { refused: refusalCode(issued) };
}

const refusalCode = (failure: Failure): string => ('code' in failure.error && typeof failure.error.code === 'string' ? failure.error.code : failure.error.type);
