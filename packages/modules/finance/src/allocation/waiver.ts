import { hasPermission, invalid, isoNow, newId, notFound, ok, readSetting, requirePermission, validate, forbidden, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { abortIssue, abortReceive, issueGeneratedDocument, receiveGeneratedUpload } from '@kompass/module-dms';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { valueAt } from '../ledger/dated-values';
import { freeFundsAtInternal } from '../ledger/overview';
import { financeContactWaiverTerms, financeExpenseClaims, type FinanceContactWaiverTermsRow, type FinanceExpenseClaimRow, type FinanceExpensePositionRow } from '../schema';
import { expenseClaimViewInternal, isOwner, nextVersion, positionsOf, sumCents, type ExpenseClaimView } from './expenses';
import { WAIVER_SIGNED_DOCUMENT_TYPE, WAIVER_TEMPLATE_KEY } from './templates/shared';
import type { WaiverDeclarationInput } from './templates/waiver-declaration';
import { waiverDeadline, waiverIsTimely } from './waiver-rules';

/**
 * Der Verzicht (Aufwandsspende, F8a Annahme 9/10, Spec 8.2, E13): die vier
 * Prüfungen des Freigebers, die Verzichtserklärung als Modul-Vorlage und ihr
 * unterschriebener Rücklauf, die Anspruchsgrundlage je Person. Ins Protokoll
 * kommen Zustand und Nummer — nie Anspruchsgrundlage, Begründung, Name.
 */

const today = (deps: Deps) => isoNow(deps.clock).slice(0, 10);

// ── Die vier Prüfungen ──────────────────────────────────────────────────────

export type WaiverCheckKey = 'claimAgreed' | 'timely' | 'fundsAvailable' | 'declaration';

/** Eine Zeile der Prüfliste (`RequirementList`): erfüllt, sperrt, oder braucht eine Begründung (`reasonRequired`, nie Sperre). */
export interface WaiverCheck {
  key: WaiverCheckKey;
  done: boolean;
  blocked: boolean;
  warning: 'reasonRequired' | null;
  detail: Record<string, string | number | null>;
}

export interface WaiverEvaluation {
  checks: WaiverCheck[];
  agreedAfterPosition: boolean;
  late: boolean;
  freeCents: number;
  amountCents: number;
}

const DEFAULT_MONTHS = { claimMonths: 12, oneOffMonths: 3 };
const monthsAt = (db: DbOrTx, date: string) => {
  const claimMonths = valueAt(db, 'waiverClaimMonths', date);
  const oneOffMonths = valueAt(db, 'waiverOneOffMonths', date);
  return { claimMonths: typeof claimMonths === 'number' ? claimMonths : DEFAULT_MONTHS.claimMonths, oneOffMonths: typeof oneOffMonths === 'number' ? oneOffMonths : DEFAULT_MONTHS.oneOffMonths };
};

/**
 * Die vier Prüfungen (Annahme 9), berechnet für einen Verzichtstag:
 * *Anspruch vorab vereinbart* (Kontrollkästchen; eine Vereinbarung nach der
 * frühesten Position braucht eine Begründung), *Verzicht rechtzeitig*
 * (früheste Frist aller Positionen, jede mit den Monaten an ihrem Datum;
 * zu spät braucht eine Begründung), *Verein hätte zahlen können* (freie
 * Mittel am Verzichtstag ≥ Summe — sonst Sperre) und *Verzichtserklärung
 * liegt vor*. Ohne Rechteprüfung.
 */
export function evaluateWaiverInternal(db: DbOrTx, claim: FinanceExpenseClaimRow, positions: readonly FinanceExpensePositionRow[], at: { declaredOn: string; claimAgreedConfirmed: boolean }): WaiverEvaluation {
  const dates = positions.map((p) => p.positionDate).filter((d): d is string => !!d).sort();
  const earliest = dates[0] ?? null;
  const agreedAfterPosition = !!claim.waiverAgreedOn && !!earliest && claim.waiverAgreedOn > earliest;
  const deadlines = dates.map((d) => waiverDeadline(d, claim.recurring, monthsAt(db, d))).sort();
  const deadline = deadlines[0] ?? null;
  const late = deadline !== null && !waiverIsTimely(at.declaredOn, deadline);
  const freeCents = freeFundsAtInternal(db, at.declaredOn);
  const amountCents = sumCents(positions);
  const funds = freeCents >= amountCents;
  const declared = !!claim.waiverDeclarationDocumentId;
  return {
    agreedAfterPosition,
    late,
    freeCents,
    amountCents,
    checks: [
      { key: 'claimAgreed', done: at.claimAgreedConfirmed, blocked: !at.claimAgreedConfirmed, warning: agreedAfterPosition ? 'reasonRequired' : null, detail: { agreedOn: claim.waiverAgreedOn, earliestPosition: earliest } },
      { key: 'timely', done: !late, blocked: false, warning: late ? 'reasonRequired' : null, detail: { deadline } },
      { key: 'fundsAvailable', done: funds, blocked: !funds, warning: null, detail: { date: at.declaredOn, freeCents, amountCents } },
      { key: 'declaration', done: declared, blocked: !declared, warning: null, detail: { documentId: claim.waiverDeclarationDocumentId } },
    ],
  };
}

// ── Wer darf ────────────────────────────────────────────────────────────────

/** Freigeber (`finance.approve`) oder die antragstellende Person (`finance.expensesSubmit`). */
function loadForWaiver(deps: Deps, ctx: CallContext, claimId: string): Result<FinanceExpenseClaimRow> {
  const claim = deps.db.select().from(financeExpenseClaims).where(eq(financeExpenseClaims.id, claimId)).get();
  if (!claim) return notFound('financeExpenseClaim', claimId);
  if (!hasPermission(ctx, 'finance.approve') && !isOwner(deps, ctx, claim)) return financeConflict('expenseNotOwner');
  if (!claim.waiver) return invalid([{ path: 'claimId', message: 'notAWaiverClaim' }]);
  return ok(claim);
}

const mayUseWaiver = (ctx: CallContext) => hasPermission(ctx, 'finance.approve') || hasPermission(ctx, 'finance.expensesSubmit');

/** Ein Aufrufkontext mit einem zusätzlichen Recht — nur für den einen Aufruf der Akte, nachdem der Dienst selbst geprüft hat. */
const withPermission = (ctx: CallContext, permission: string): CallContext => (hasPermission(ctx, permission) ? ctx : { ...ctx, permissions: new Set([...ctx.permissions, permission]) });

// ── Verzichtserklärung ──────────────────────────────────────────────────────

const declarationSchema = z.object({ claimId: z.string().min(1), declaredOn: z.string().date() });

const addressLines = (c: { street: string | null; postalCode: string | null; city: string | null; country: string | null }) =>
  [c.street, [c.postalCode, c.city].filter((s) => !!s).join(' '), c.country].map((s) => (s ?? '').trim()).filter((s) => s !== '');

/**
 * Die Verzichtserklärung erzeugen (Annahme 10) — vor der Freigabe, vom
 * Freigeber oder von der antragstellenden Person selbst. Akteneintrag `VZE`
 * im Namen des Antrags; der Antrag zeigt auf die jüngste und trägt den
 * Verzichtstag. Der Betreff nennt die Nummer, nie die Person.
 */
export async function createWaiverDeclaration(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ExpenseClaimView>> {
  if (!mayUseWaiver(ctx)) return forbidden('finance.approve');
  const parsed = validate(deps, declarationSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const loaded = loadForWaiver(deps, ctx, v.claimId);
  if (!loaded.ok) return loaded;
  const claim = loaded.value;
  if (claim.state !== 'submitted') return financeConflict('expenseNotSubmitted');
  if (v.declaredOn > today(deps)) return invalid([{ path: 'declaredOn', message: 'inFuture' }]);
  if (!claim.waiverBasisText) return invalid([{ path: 'claimId', message: 'waiverBasisMissing' }]);

  const contact = deps.db.select().from(contacts).where(eq(contacts.id, claim.contactId)).get();
  if (!contact) return notFound('contact', claim.contactId);
  const setting = (key: string) => (readSetting<string>(deps, key) ?? '').trim();
  const templateInput: WaiverDeclarationInput = {
    organization: { name: setting('organization.name'), addressLines: addressLines({ street: setting('organization.street'), postalCode: setting('organization.postalCode'), city: setting('organization.city'), country: null }) },
    claimant: { name: displayName(contact), addressLines: addressLines(contact) },
    claimNumber: claim.number!,
    amountCents: sumCents(positionsOf(deps.db, claim.id)),
    basisText: claim.waiverBasisText,
    agreedOn: claim.waiverAgreedOn,
    declaredOn: v.declaredOn,
    place: setting('organization.city'),
  };

  const result = await issueGeneratedDocument(deps, withPermission(ctx, 'finance.approve'), {
    templateKey: WAIVER_TEMPLATE_KEY,
    input: templateInput,
    subject: `Verzichtserklärung zu Antrag ${claim.number}`,
    documentDate: v.declaredOn,
    links: [{ entityType: 'financeExpenseClaim', entityId: claim.id }],
    afterIssue: (tx, doc) => {
      const current = tx.select().from(financeExpenseClaims).where(eq(financeExpenseClaims.id, claim.id)).get()!;
      const changed = tx
        .update(financeExpenseClaims)
        .set({ waiverDeclarationDocumentId: doc.id, waiverDeclaredOn: v.declaredOn, updatedAt: nextVersion(deps, current.updatedAt) })
        .where(and(eq(financeExpenseClaims.id, claim.id), eq(financeExpenseClaims.state, 'submitted')))
        .run().changes;
      if (changed !== 1) abortIssue(financeConflict('expenseNotSubmitted'));
      financeAudit(tx, deps, ctx, { action: 'finance.expenseClaim.waiverDeclaration', entity: 'financeExpenseClaim', id: claim.id, after: { state: claim.state, number: claim.number }, summary: `Verzichtserklärung ${doc.number} zu Antrag ${claim.number} erzeugt` });
      return null;
    },
  });
  if (!result.ok) return result;
  return ok(expenseClaimViewInternal(deps, deps.db, claim.id)!);
}

const signedSchema = z.object({ claimId: z.string().min(1), bytes: z.custom<Uint8Array>((val) => val instanceof Uint8Array, { message: 'invalidBytes' }) });

/**
 * Die unterschriebene Verzichtserklärung als Eingang `VZU` ablegen — einmal,
 * im Namen des Antrags (Muster `attachSignedConfirmation`). Freigeber oder
 * antragstellende Person; der Freigeber braucht dafür kein
 * `finance.expensesSubmit`, das die Akte für diesen Bezug verlangt.
 */
export async function attachSignedWaiver(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ExpenseClaimView>> {
  if (!mayUseWaiver(ctx)) return forbidden('finance.approve');
  const parsed = validate(deps, signedSchema, input);
  if (!parsed.ok) return parsed;
  const loaded = loadForWaiver(deps, ctx, parsed.value.claimId);
  if (!loaded.ok) return loaded;
  const claim = loaded.value;
  if (claim.state === 'draft' || claim.state === 'rejected') return financeConflict('expenseNotSubmitted');
  if (claim.waiverSignedDocumentId) return financeConflict('waiverSignedAlready');

  const result = await receiveGeneratedUpload(deps, withPermission(ctx, 'finance.expensesSubmit'), {
    bytes: parsed.value.bytes,
    typeKey: WAIVER_SIGNED_DOCUMENT_TYPE,
    subject: `Verzichtserklärung zu Antrag ${claim.number} unterschrieben`,
    documentDate: today(deps),
    links: [{ entityType: 'financeExpenseClaim', entityId: claim.id }],
    afterReceive: (tx, doc) => {
      const changed = tx.update(financeExpenseClaims).set({ waiverSignedDocumentId: doc.id }).where(and(eq(financeExpenseClaims.id, claim.id), isNull(financeExpenseClaims.waiverSignedDocumentId))).run().changes;
      if (changed !== 1) abortReceive(financeConflict('waiverSignedAlready'));
      financeAudit(tx, deps, ctx, { action: 'finance.expenseClaim.waiverSigned', entity: 'financeExpenseClaim', id: claim.id, after: { state: claim.state, number: claim.number }, summary: `Unterschriebene Verzichtserklärung ${doc.number} zu Antrag ${claim.number} abgelegt` });
      return null;
    },
  });
  if (!result.ok) return result;
  return ok(expenseClaimViewInternal(deps, deps.db, claim.id)!);
}

// ── Anspruchsgrundlage je Person ────────────────────────────────────────────

const termsSchema = z.object({ contactId: z.string().min(1), basisText: z.string().trim().min(1).max(500), agreedOn: z.string().date() });

/**
 * Die Anspruchsgrundlage einer Person (`finance.setup`) — überschreibt die des
 * Vereins und wird beim Einreichen als Abschrift an den Antrag kopiert. Ins
 * Protokoll nur das Datum, nie der Wortlaut.
 */
export async function saveContactWaiverTerms(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FinanceContactWaiverTermsRow>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, termsSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (!deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, v.contactId)).get()) return notFound('contact', v.contactId);

  return deps.db.transaction((tx: DbOrTx) => {
    const before = tx.select().from(financeContactWaiverTerms).where(eq(financeContactWaiverTerms.contactId, v.contactId)).get();
    const fields = { basisText: v.basisText, agreedOn: v.agreedOn, updatedAt: isoNow(deps.clock), updatedByUserId: ctx.userId ?? 'system' };
    const id = before?.id ?? newId();
    if (before) tx.update(financeContactWaiverTerms).set(fields).where(eq(financeContactWaiverTerms.id, id)).run();
    else tx.insert(financeContactWaiverTerms).values({ id, contactId: v.contactId, ...fields }).run();
    financeAudit(tx, deps, ctx, { action: 'finance.contactWaiverTerms.save', entity: 'financeContactWaiverTerms', id, before: before ? { agreedOn: before.agreedOn } : undefined, after: { agreedOn: v.agreedOn }, summary: `Anspruchsgrundlage ${id} gespeichert` });
    return ok(tx.select().from(financeContactWaiverTerms).where(eq(financeContactWaiverTerms.id, id)).get()!);
  });
}
