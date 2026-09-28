import { notFound, ok, readSetting, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contactRoles, contacts, displayName } from '@kompass/module-contacts';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { allowanceCapCents, overCapCents } from '../ledger/allowances';
import { boardMembersMaintainedInternal } from '../ledger/board';
import { requireFinanceRead } from '../ledger/access';
import { financeAllocationLines, financeCategories, financeEntries, financeExpenseClaims, financeFiscalYears, financeMoneyLines, financeOpenItemSettlements, financeOpenItems, financePartnerPaidLines, financePartnerPayments } from '../schema';
import { basisInForceOn } from './basis-rules';

/**
 * Personenübersicht (F8b Task 4, Spec 8.2, Annahme 9, 10): Pauschalen und
 * Erstattungen je Kalenderjahr (§ 3 Nr. 26/26a EStG), Zahlungen an
 * Vorstandsmitglieder und nahestehende Personen mit Freigeber (E21). Nur
 * `finance.read` — unter `overview` steht dafür `BlockedState`.
 */

function yearRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** Entgeltzeilen (Pauschalen) je Kontakt und Art, festgeschriebene Buchungen im Jahr. */
function allowanceSumsByContact(db: DbOrTx, range: { from: string; to: string }): { contactId: string; volunteerCents: number; trainerCents: number }[] {
  const rows = db
    .select({ contactId: financeAllocationLines.contactId, allowanceKind: financeCategories.allowanceKind, sumCents: sql<number>`coalesce(sum(-${financeAllocationLines.amountCents}), 0)` })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
    .innerJoin(financeCategories, eq(financeAllocationLines.categoryId, financeCategories.id))
    .where(and(eq(financeEntries.status, 'final'), ne(financeCategories.allowanceKind, 'none'), sql`${financeAllocationLines.contactId} is not null`, sql`${financeEntries.entryDate} >= ${range.from} and ${financeEntries.entryDate} <= ${range.to}`))
    .groupBy(financeAllocationLines.contactId, financeCategories.allowanceKind)
    .all();
  const byContact = new Map<string, { contactId: string; volunteerCents: number; trainerCents: number }>();
  for (const row of rows) {
    const contactId = row.contactId as string;
    const entry = byContact.get(contactId) ?? { contactId, volunteerCents: 0, trainerCents: 0 };
    if (row.allowanceKind === 'volunteer') entry.volunteerCents += row.sumCents;
    else if (row.allowanceKind === 'trainer') entry.trainerCents += row.sumCents;
    byContact.set(contactId, entry);
  }
  return [...byContact.values()];
}

/** Pauschalen-Zeilen ohne Person — ein Hinweis, keine Sperre (Annahme 9). */
function allowanceLinesWithoutPersonCount(db: DbOrTx, range: { from: string; to: string }): number {
  return (
    db
      .select({ count: sql<number>`count(*)` })
      .from(financeAllocationLines)
      .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
      .innerJoin(financeCategories, eq(financeAllocationLines.categoryId, financeCategories.id))
      .where(and(eq(financeEntries.status, 'final'), ne(financeCategories.allowanceKind, 'none'), isNull(financeAllocationLines.contactId), sql`${financeEntries.entryDate} >= ${range.from} and ${financeEntries.entryDate} <= ${range.to}`))
      .get()?.count ?? 0
  );
}

/**
 * Erstattungen (Annahme 9): Zeilen mit `allowanceKind = 'none'` an
 * Buchungen, die einen Posten mit `originType: 'financeExpenseClaim'`
 * begleichen (nach `contactId`, Sammelüberweisungen zählen jede Zeile für
 * sich) — nur, wo Geld an die Person geflossen ist. Befund AJ:
 * Aufwandsspenden-Buchungen über `claim.entryId` (deren Ausgabezeilen kein
 * `contactId` tragen — der Betrag gehört zu `claim.contactId`) sind keine
 * Erstattung; sie stehen gesondert unter `waived` (verzichtet, als
 * Aufwandsspende).
 */
function reimbursementSumsByContact(db: DbOrTx, range: { from: string; to: string }): { reimbursed: Map<string, number>; waived: Map<string, number>; claims: Map<string, Set<string>> } {
  const sums = new Map<string, number>();
  const waived = new Map<string, number>();
  /** D4 „· n Anträge“ (Design-Nachtrag Phase 4): die Anträge, deren Erstattung im Jahr gebucht ist. */
  const claims = new Map<string, Set<string>>();
  const addTo = (target: Map<string, number>, contactId: string | null, cents: number) => {
    if (!contactId) return;
    target.set(contactId, (target.get(contactId) ?? 0) + cents);
  };
  const add = (contactId: string | null, cents: number) => addTo(sums, contactId, cents);

  const settling = db
    .select({ entryId: financeMoneyLines.entryId, claimId: financeOpenItems.originId })
    .from(financeOpenItemSettlements)
    .innerJoin(financeMoneyLines, eq(financeOpenItemSettlements.moneyLineId, financeMoneyLines.id))
    .innerJoin(financeOpenItems, eq(financeOpenItemSettlements.openItemId, financeOpenItems.id))
    .where(eq(financeOpenItems.originType, 'financeExpenseClaim'))
    .all();
  const claimsOfEntry = new Map<string, string[]>();
  for (const r of settling) if (r.claimId) claimsOfEntry.set(r.entryId, [...(claimsOfEntry.get(r.entryId) ?? []), r.claimId]);
  const settlingEntryIds = new Set(settling.map((r) => r.entryId));
  if (settlingEntryIds.size > 0) {
    const rows = db
      .select({ contactId: financeAllocationLines.contactId, amountCents: financeAllocationLines.amountCents, entryDate: financeEntries.entryDate, entryId: financeAllocationLines.entryId })
      .from(financeAllocationLines)
      .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
      .innerJoin(financeCategories, eq(financeAllocationLines.categoryId, financeCategories.id))
      .where(and(eq(financeEntries.status, 'final'), eq(financeCategories.allowanceKind, 'none'), inArray(financeAllocationLines.entryId, [...settlingEntryIds])))
      .all();
    for (const row of rows) {
      if (row.entryDate < range.from || row.entryDate > range.to) continue;
      add(row.contactId, Math.abs(row.amountCents));
      if (row.contactId) {
        const set = claims.get(row.contactId) ?? new Set<string>();
        for (const claimId of claimsOfEntry.get(row.entryId) ?? []) set.add(claimId);
        claims.set(row.contactId, set);
      }
    }
  }

  const waiverClaims = db.select().from(financeExpenseClaims).where(and(eq(financeExpenseClaims.waiver, true), sql`${financeExpenseClaims.entryId} is not null`)).all();
  for (const claim of waiverClaims) {
    const lines = db
      .select({ amountCents: financeAllocationLines.amountCents, entryDate: financeEntries.entryDate })
      .from(financeAllocationLines)
      .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
      .innerJoin(financeCategories, eq(financeAllocationLines.categoryId, financeCategories.id))
      .where(and(eq(financeAllocationLines.entryId, claim.entryId!), eq(financeCategories.direction, 'expense')))
      .all();
    for (const line of lines) {
      if (line.entryDate < range.from || line.entryDate > range.to) continue;
      addTo(waived, claim.contactId, Math.abs(line.amountCents));
    }
  }
  return { reimbursed: sums, waived, claims };
}

export interface PersonYearRow {
  contactId: string;
  contactName: string;
  allowanceVolunteerCents: number;
  allowanceTrainerCents: number;
  reimbursementCents: number;
  /** Anzahl der Anträge hinter `reimbursementCents` (D4 „· n Anträge“). */
  reimbursementClaimCount: number;
  /** Befund AJ: Auslagen mit Aufwandsverzicht — kein Geld an die Person, deshalb keine Erstattung; gesondert als Aufwandsspende. */
  waivedCents: number;
  /** Grenzen zum 31.12. des Jahres (Reihen `allowanceVolunteer`/`allowanceTrainer`). */
  allowanceVolunteerCapCents: number;
  allowanceTrainerCapCents: number;
  /** Befund AI: Grenze überschritten — und um wie viel (dieser Teil ist nicht steuerfrei). */
  allowanceVolunteerExceeded: boolean;
  allowanceVolunteerOverCents: number;
  allowanceTrainerExceeded: boolean;
  allowanceTrainerOverCents: number;
}

export const personYearOverviewSchema = z.object({ year: z.number().int().min(2000).max(2100) });

/** `finance.read`: Pauschalen und Erstattungen je Person, für ein Kalenderjahr (Annahme 9). */
export async function personYearOverview(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ rows: PersonYearRow[]; linesWithoutPersonCount: number }>> {
  const denied = requirePermission(ctx, 'finance.read');
  if (denied) return denied;
  const parsed = validate(deps, personYearOverviewSchema, input);
  if (!parsed.ok) return parsed;
  const range = yearRange(parsed.value.year);
  const yearEnd = `${parsed.value.year}-12-31`;

  const allowances = allowanceSumsByContact(deps.db, range);
  const reimbursements = reimbursementSumsByContact(deps.db, range);
  const contactIds = new Set([...allowances.map((a) => a.contactId), ...reimbursements.reimbursed.keys(), ...reimbursements.waived.keys()]);
  const allowanceVolunteerCapCents = allowanceCapCents(deps.db, 'volunteer', parsed.value.year);
  const allowanceTrainerCapCents = allowanceCapCents(deps.db, 'trainer', parsed.value.year);

  const rows: PersonYearRow[] = [...contactIds].map((contactId) => {
    const a = allowances.find((x) => x.contactId === contactId);
    const contact = deps.db.select().from(contacts).where(eq(contacts.id, contactId)).get();
    const volunteerOver = overCapCents(a?.volunteerCents ?? 0, allowanceVolunteerCapCents);
    const trainerOver = overCapCents(a?.trainerCents ?? 0, allowanceTrainerCapCents);
    return {
      contactId,
      contactName: contact ? displayName(contact) : contactId,
      allowanceVolunteerCents: a?.volunteerCents ?? 0,
      allowanceTrainerCents: a?.trainerCents ?? 0,
      reimbursementCents: reimbursements.reimbursed.get(contactId) ?? 0,
      reimbursementClaimCount: reimbursements.claims.get(contactId)?.size ?? 0,
      waivedCents: reimbursements.waived.get(contactId) ?? 0,
      allowanceVolunteerCapCents,
      allowanceTrainerCapCents,
      allowanceVolunteerExceeded: volunteerOver > 0,
      allowanceVolunteerOverCents: volunteerOver,
      allowanceTrainerExceeded: trainerOver > 0,
      allowanceTrainerOverCents: trainerOver,
    };
  });
  rows.sort((x, y) => x.contactName.localeCompare(y.contactName, 'de'));
  return ok({ rows, linesWithoutPersonCount: allowanceLinesWithoutPersonCount(deps.db, range) });
}

// ── E21 — Zahlungen an Vorstandsmitglieder und nahestehende Personen ───────

export interface RelatedPartyPaymentRow {
  entryId: string;
  entryDate: string;
  entryNumber: string | null;
  contactId: string;
  contactName: string;
  role: 'board-member' | 'related-party';
  amountCents: number;
  categoryId: string;
  categoryName: string;
  approvedByUserId: string | null;
  /** Datenfeld (Annahme 10): eine Pauschale an ein Vorstandsmitglied ohne bestätigten Einrichtungspunkt. */
  boardAllowanceWithoutBasis: boolean;
  /** E21 „Art“ (Design-Nachtrag Phase 4): Herkunft der Zahlung und ihre Nummer (`KE-…`, `PZ-…`); `other` zeigt die Kategorie. */
  originKind: RelatedPartyOriginKind;
  originNumber: string | null;
}

/** Woher eine Zeile kommt — E21 „Art“ (Design 4f): Auslage, Aufwandsspende, Zahlung an Partner oder sonst die Kategorie. */
export type RelatedPartyOriginKind = 'expenseClaim' | 'waiver' | 'partnerPayment' | 'other';

interface LineOrigin {
  kind: RelatedPartyOriginKind;
  number: string | null;
  approvedByUserId: string | null;
}

/** Wer eine Zeile freigegeben hat und woher sie kommt: Antrag → `approvedByUserId`; Zahlung an Partner mit Posten → `approvedByUserId`; nachträglich freigegeben über `paid_lines` → deren `approvedByUserId`; sonst `null` (Annahme 10). */
function originOfLine(db: DbOrTx, lineId: string, entryId: string): LineOrigin {
  // Aufwandsspende: die Buchung selbst ist `claim.entryId`.
  const waiverClaim = db.select({ approvedByUserId: financeExpenseClaims.approvedByUserId, number: financeExpenseClaims.number }).from(financeExpenseClaims).where(eq(financeExpenseClaims.entryId, entryId)).get();
  if (waiverClaim) return { kind: 'waiver', number: waiverClaim.number, approvedByUserId: waiverClaim.approvedByUserId };
  // Übliche Zahlung: die Buchung begleicht einen offenen Posten mit Herkunft.
  const moneyLines = db.select({ id: financeMoneyLines.id }).from(financeMoneyLines).where(eq(financeMoneyLines.entryId, entryId)).all();
  if (moneyLines.length > 0) {
    const settlement = db
      .select({ openItemId: financeOpenItemSettlements.openItemId })
      .from(financeOpenItemSettlements)
      .where(inArray(financeOpenItemSettlements.moneyLineId, moneyLines.map((m) => m.id)))
      .get();
    if (settlement) {
      const item = db.select().from(financeOpenItems).where(eq(financeOpenItems.id, settlement.openItemId)).get();
      if (item?.originType === 'financeExpenseClaim' && item.originId) {
        const claim = db.select({ approvedByUserId: financeExpenseClaims.approvedByUserId, number: financeExpenseClaims.number }).from(financeExpenseClaims).where(eq(financeExpenseClaims.id, item.originId)).get();
        if (claim) return { kind: 'expenseClaim', number: claim.number, approvedByUserId: claim.approvedByUserId };
      }
      if (item?.originType === 'financePartnerPayment' && item.originId) {
        const payment = db.select({ approvedByUserId: financePartnerPayments.approvedByUserId, number: financePartnerPayments.number }).from(financePartnerPayments).where(eq(financePartnerPayments.id, item.originId)).get();
        if (payment) return { kind: 'partnerPayment', number: payment.number, approvedByUserId: payment.approvedByUserId };
      }
    }
  }
  // Nachträglich freigegebene Zahlung an Partner: die Zeile steht als bezahlte Zeile am Vorgang.
  const paidLine = db.select({ paymentId: financePartnerPaidLines.paymentId }).from(financePartnerPaidLines).where(eq(financePartnerPaidLines.paidLineId, lineId)).get();
  if (paidLine) {
    const payment = db.select({ approvedByUserId: financePartnerPayments.approvedByUserId, number: financePartnerPayments.number }).from(financePartnerPayments).where(eq(financePartnerPayments.id, paidLine.paymentId)).get();
    if (payment) return { kind: 'partnerPayment', number: payment.number, approvedByUserId: payment.approvedByUserId };
  }
  return { kind: 'other', number: null, approvedByUserId: null };
}

export const relatedPartyPaymentsSchema = z.object({ fiscalYearId: z.string().min(1) });

/**
 * `finance.read`: E21. Nahestehende Rollen (Zeitraum schneidet das Jahr) × festgeschriebene Ausgabezeilen im Zeitraum der Rolle (Annahme 10).
 * Befund T: `boardMembersMissing`, wenn im Jahr kein Kontakt die Rolle „Vorstand“ trägt — dann wäre die Liste stumm leer.
 */
export async function relatedPartyPayments(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ rows: RelatedPartyPaymentRow[]; boardMembersMissing: boolean }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, relatedPartyPaymentsSchema, input);
  if (!parsed.ok) return parsed;
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, parsed.value.fiscalYearId)).get();
  if (!year) return notFound('financeFiscalYear', parsed.value.fiscalYearId);

  const roles = deps.db
    .select()
    .from(contactRoles)
    .where(and(inArray(contactRoles.role, ['board-member', 'related-party']), sql`${contactRoles.since} <= ${year.endsOn}`, sql`(${contactRoles.until} is null or ${contactRoles.until} >= ${year.startsOn})`))
    .all();

  // Befund AK: die Grundlage gilt ab einem Tag — verglichen wird mit dem Zahlungstag, nicht mit heute.
  const boardBasisFrom = readSetting<boolean>(deps, 'finance.boardRemunerationAllowed') ? readSetting<string | null>(deps, 'finance.boardRemunerationValidFrom') : null;

  const rows: RelatedPartyPaymentRow[] = [];
  for (const role of roles) {
    const from = role.since > year.startsOn ? role.since : year.startsOn;
    const to = role.until && role.until < year.endsOn ? role.until : year.endsOn;
    const lines = deps.db
      .select({ id: financeAllocationLines.id, amountCents: financeAllocationLines.amountCents, entryId: financeAllocationLines.entryId, categoryId: financeAllocationLines.categoryId, entryDate: financeEntries.entryDate, entryNumber: financeEntries.number, allowanceKind: financeCategories.allowanceKind, categoryName: financeCategories.name })
      .from(financeAllocationLines)
      .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
      .innerJoin(financeCategories, eq(financeAllocationLines.categoryId, financeCategories.id))
      .where(and(eq(financeEntries.status, 'final'), eq(financeAllocationLines.contactId, role.contactId), eq(financeCategories.direction, 'expense'), sql`${financeEntries.entryDate} >= ${from} and ${financeEntries.entryDate} <= ${to}`))
      .all();
    if (lines.length === 0) continue;
    const contact = deps.db.select().from(contacts).where(eq(contacts.id, role.contactId)).get();
    for (const line of lines) {
      const origin = originOfLine(deps.db, line.id, line.entryId);
      rows.push({
        entryId: line.entryId, entryDate: line.entryDate, entryNumber: line.entryNumber, contactId: role.contactId, contactName: contact ? displayName(contact) : role.contactId,
        role: role.role as 'board-member' | 'related-party', amountCents: Math.abs(line.amountCents), categoryId: line.categoryId, categoryName: line.categoryName,
        approvedByUserId: origin.approvedByUserId, originKind: origin.kind, originNumber: origin.number,
        boardAllowanceWithoutBasis: role.role === 'board-member' && line.allowanceKind !== 'none' && !basisInForceOn(boardBasisFrom, line.entryDate),
      });
    }
  }
  rows.sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  return ok({ rows, boardMembersMissing: !boardMembersMaintainedInternal(deps.db, year.startsOn, year.endsOn) });
}
