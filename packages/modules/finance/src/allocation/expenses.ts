import {
  expectedVersionField,
  forbidden,
  hasPermission,
  invalid,
  isoNow,
  listUserNamesWithPermission,
  newId,
  notFound,
  ok,
  readSetting,
  requirePermission,
  schema,
  staleVersion,
  systemContext,
  validate,
  type CallContext,
  type DbOrTx,
  type Deps,
  type Result,
  type ValidationIssue,
} from '@kompass/core';
import { addContactRole, contactIdForUserInternal, contactRoles, contacts, displayName, userIdForContactInternal } from '@kompass/module-contacts';
import { abortReceive, DOCUMENT_MAX_BYTES, documentLinks, linkDocumentInternal, readLinkedDocument, receiveGeneratedUpload } from '@kompass/module-dms';
import { listProjects, projects } from '@kompass/module-projects';
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { valueAt } from '../ledger/dated-values';
import { DATED_SERIES } from '../ledger/dated-series';
import { isValidIban, maskIban, normalizeIban } from '../ledger/iban';
import { openCentsInternal, openItemSettlementsInternal } from '../ledger/open-items';
import { tripAmountCents } from '../ledger/trip-amount';
import {
  financeContactBankAccounts,
  financeContactWaiverTerms,
  financeDatedValues,
  financeExpenseClaims,
  financeExpenseCounters,
  financeExpensePositions,
  financeOpenItems,
  type FinanceExpenseClaimRow,
  type FinanceExpensePositionRow,
} from '../schema';

/**
 * Auslagen, Seite der einreichenden Person (F8a Task 2, Spec 8.2): Entwurf mit
 * laufender Sicherung, Beleg im Namen des Vorgangs, Einreichen, eigene Liste,
 * „Neu einreichen“. Alles unter `finance.expensesSubmit` — dem einzigen
 * Finanzrecht, das kein `finance.read` voraussetzt (Spec 10.1). Wer „ich“ ist,
 * sagt die Verknüpfung Nutzerkonto ↔ Kontakt (Annahme 2); Eigentümerin eines
 * Antrags ist der Kontakt, nicht das Konto (Annahme 6). Ins Protokoll kommen
 * nur Zustand, Nummer, Zähler, Beträge und IDs — nie Kontakt-ID, IBAN,
 * „Wofür“, Strecke oder Anlass (`AUDIT_FIELDS`).
 */

export type ExpensePositionView = FinanceExpensePositionRow;

export interface ExpenseClaimPaid {
  settledCents: number;
  /** Datum der jüngsten festgeschriebenen Zahlung auf den offenen Posten. */
  paidOn: string | null;
  state: 'unpaid' | 'partly' | 'paid';
}

export interface ExpenseClaimView extends FinanceExpenseClaimRow {
  positions: ExpensePositionView[];
  totalCents: number;
  contactName: string;
  ibanMasked: string | null;
  /** Berechnet aus dem offenen Posten (Spec 5.3) — nie gespeichert; `null` ohne Posten. */
  paid: ExpenseClaimPaid | null;
  /** „Freigeben kann: …“ — wer `finance.approve` trägt, ohne Anleger und ohne die antragstellende Person. */
  approverNames: string[];
  stateLabelKey: 'draft' | 'submitted' | 'approved' | 'paid' | 'rejected';
  /** Ladestand für die laufende Sicherung (`expectedVersion`) — der `updatedAt` des Antrags. */
  version: string;
}

// ── Hilfen ──────────────────────────────────────────────────────────────────

const today = (deps: Deps) => isoNow(deps.clock).slice(0, 10);

/**
 * Der nächste Ladestand: jetzt — oder, falls die Uhr nicht weiter ist als der
 * letzte Stand (zwei Sicherungen in derselben Millisekunde), eine Millisekunde
 * danach. So wechselt die Version mit jedem Speichern, und ein alter Stand
 * überschreibt nie einen neuen (Review Focus 5).
 */
export function nextVersion(deps: Deps, previous: string | undefined): string {
  const now = isoNow(deps.clock);
  if (previous === undefined || now > previous) return now;
  return new Date(Date.parse(previous) + 1).toISOString();
}

/** Der eigene Kontakt über die Nutzer-Verknüpfung; fehlt sie, die Meldung mit denen, die sie setzen können. */
function ownContactInternal(deps: Deps, ctx: CallContext): Result<string> {
  const contactId = ctx.userId ? contactIdForUserInternal(deps.db, ctx.userId) : null;
  if (contactId) return ok(contactId);
  const names = listUserNamesWithPermission(deps, 'users.manage');
  return financeConflict('expenseNeedsContactLink', { names: names.length > 0 ? names.join(', ') : '—' });
}

/** Ist der Aufrufer die antragstellende Person? Ohne Verknüpfung nie. */
export function isOwner(deps: Deps, ctx: CallContext, claim: FinanceExpenseClaimRow): boolean {
  return !!ctx.userId && contactIdForUserInternal(deps.db, ctx.userId) === claim.contactId;
}

/** Den eigenen Antrag laden: erst der eigene Kontakt, dann der Antrag, dann die Eigentümerin. */
function loadOwnClaim(deps: Deps, ctx: CallContext, id: string): Result<FinanceExpenseClaimRow> {
  const own = ownContactInternal(deps, ctx);
  if (!own.ok) return own;
  const claim = deps.db.select().from(financeExpenseClaims).where(eq(financeExpenseClaims.id, id)).get();
  if (!claim) return notFound('financeExpenseClaim', id);
  if (claim.contactId !== own.value) return financeConflict('expenseNotOwner');
  return ok(claim);
}

export function positionsOf(db: DbOrTx, claimId: string): FinanceExpensePositionRow[] {
  return db.select().from(financeExpensePositions).where(eq(financeExpensePositions.claimId, claimId)).orderBy(asc(financeExpensePositions.sortOrder)).all();
}

export const sumCents = (positions: readonly Pick<FinanceExpensePositionRow, 'amountCents'>[]) => positions.reduce((s, p) => s + p.amountCents, 0);

function userName(db: DbOrTx, userId: string | null): string | null {
  if (!userId) return null;
  return db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, userId)).get()?.name ?? null;
}

function paidOf(db: DbOrTx, claim: FinanceExpenseClaimRow): ExpenseClaimPaid | null {
  if (!claim.openItemId) return null;
  const item = db.select().from(financeOpenItems).where(eq(financeOpenItems.id, claim.openItemId)).get();
  if (!item) return null;
  const settledCents = item.amountCents - openCentsInternal(db, item.id);
  const dates = openItemSettlementsInternal(db, item.id).map((s) => s.entryDate).sort();
  const state: ExpenseClaimPaid['state'] = settledCents >= item.amountCents ? 'paid' : settledCents > 0 ? 'partly' : 'unpaid';
  return { settledCents, paidOn: dates.at(-1) ?? null, state };
}

/** Die Sicht eines Antrags — ohne Rechteprüfung; die Dienste prüfen vorher. */
export function expenseClaimViewInternal(deps: Deps, db: DbOrTx, claimId: string): ExpenseClaimView | null {
  const claim = db.select().from(financeExpenseClaims).where(eq(financeExpenseClaims.id, claimId)).get();
  if (!claim) return null;
  const positions = positionsOf(db, claim.id);
  const contact = db.select().from(contacts).where(eq(contacts.id, claim.contactId)).get();
  const paid = paidOf(db, claim);
  const excluded = new Set([userName(db, claim.submittedByUserId), userName(db, userIdForContactInternal(db, claim.contactId))].filter((n): n is string => n !== null));
  const stateLabelKey: ExpenseClaimView['stateLabelKey'] = claim.state === 'approved' && paid?.state === 'paid' ? 'paid' : claim.state;
  return {
    ...claim,
    positions,
    totalCents: sumCents(positions),
    contactName: contact ? displayName(contact) : '',
    ibanMasked: claim.iban ? maskIban(claim.iban) : null,
    paid,
    approverNames: listUserNamesWithPermission({ db }, 'finance.approve').filter((name) => !excluded.has(name)),
    stateLabelKey,
    version: claim.updatedAt,
  };
}

function claimAudit(claim: Pick<FinanceExpenseClaimRow, 'state' | 'waiver' | 'recurring'>, positions: readonly Pick<FinanceExpensePositionRow, 'amountCents'>[]) {
  return { state: claim.state, positionCount: positions.length, totalCents: sumCents(positions), waiver: claim.waiver, recurring: claim.recurring };
}

export const waiversEnabled = (deps: Deps) => readSetting<boolean>(deps, 'finance.expenseWaiversEnabled') === true;

// ── Entwurf ─────────────────────────────────────────────────────────────────

const optionalText = z.string().trim().max(200).nullable().optional();

const positionInputSchema = z.object({
  id: z.string().min(1).optional(),
  kind: z.enum(['receipt', 'trip']),
  positionDate: z.string().date().nullable().optional(),
  /** Nur für Belege; der Betrag einer Fahrt wird berechnet. */
  amountCents: z.number().int().min(0).max(100_000_000).optional(),
  purpose: z.string().trim().max(500).optional(),
  projectId: z.string().min(1).nullable().optional(),
  tripFrom: optionalText,
  tripTo: optionalText,
  tripReason: optionalText,
  tripKm: z.number().int().min(0).max(100_000).nullable().optional(),
});

const draftSchema = z.object({
  id: z.string().min(1).optional(),
  expectedVersion: expectedVersionField,
  iban: z.string().trim().max(50).nullable().optional(),
  waiver: z.boolean(),
  recurring: z.boolean().optional(),
  positions: z.array(positionInputSchema).max(100),
});

type PositionInput = z.infer<typeof positionInputSchema>;

/** Fahrt: km × Satz am Positionsdatum, erst wenn beides da ist — sonst 0 und kein Satz. */
function tripFields(db: DbOrTx, p: PositionInput): { amountCents: number; tripRateCentsPerKm: number | null } {
  if (!p.positionDate || !p.tripKm) return { amountCents: 0, tripRateCentsPerKm: null };
  const rate = valueAt(db, 'mileageRate', p.positionDate);
  if (typeof rate !== 'number') return { amountCents: 0, tripRateCentsPerKm: null };
  return { amountCents: tripAmountCents(p.tripKm, rate), tripRateCentsPerKm: rate };
}

const blankToNull = (s: string | null | undefined) => (s === undefined || s === null || s === '' ? null : s);

/**
 * Laufende Sicherung (Annahme 3): idempotent über `id`, nimmt unvollständige
 * Positionen an und verwirft nichts. Die Positionen werden als Ganzes ersetzt;
 * eine Position, die bleibt (gleiche `id`), behält ihren Beleg. Der
 * Fahrtbetrag wird mit dem Satz am Positionsdatum berechnet und gespeichert
 * (Annahme 4). `expectedVersion` weist einen alten Stand ab (`staleVersion`).
 */
export async function saveExpenseDraft(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ExpenseClaimView>> {
  const denied = requirePermission(ctx, 'finance.expensesSubmit');
  if (denied) return denied;
  const parsed = validate(deps, draftSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const own = ownContactInternal(deps, ctx);
  if (!own.ok) return own;
  let before: FinanceExpenseClaimRow | undefined;
  if (v.id) {
    const loaded = loadOwnClaim(deps, ctx, v.id);
    if (!loaded.ok) return loaded;
    before = loaded.value;
    if (before.state !== 'draft') return financeConflict('expenseNotDraft');
    const stale = staleVersion(v.expectedVersion, before.updatedAt);
    if (stale) return stale;
  }
  if (v.waiver && !waiversEnabled(deps)) return financeConflict('expenseWaiversDisabled');

  const existing = new Map(before ? positionsOf(deps.db, before.id).map((p) => [p.id, p]) : []);
  const issues: ValidationIssue[] = [];
  v.positions.forEach((p, i) => {
    if (p.id !== undefined && !existing.has(p.id)) issues.push({ path: `positions.${i}.id`, message: 'unknownPosition' });
  });
  if (issues.length > 0) return invalid(issues);
  for (const projectId of new Set(v.positions.map((p) => p.projectId).filter((id): id is string => !!id))) {
    if (!deps.db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get()) return notFound('project', projectId);
  }

  return deps.db.transaction((tx: DbOrTx) => {
    const now = nextVersion(deps, before?.updatedAt);
    const claimId = before?.id ?? newId();
    const fields = {
      iban: blankToNull(v.iban) === null ? null : normalizeIban(v.iban!),
      waiver: v.waiver,
      recurring: v.recurring ?? before?.recurring ?? false,
      updatedAt: now,
    };
    if (before) tx.update(financeExpenseClaims).set(fields).where(eq(financeExpenseClaims.id, claimId)).run();
    else tx.insert(financeExpenseClaims).values({ id: claimId, contactId: own.value, submittedByUserId: ctx.userId!, state: 'draft', createdAt: now, ...fields }).run();

    const kept = new Set(v.positions.map((p) => p.id).filter((id): id is string => !!id));
    for (const id of existing.keys()) if (!kept.has(id)) tx.delete(financeExpensePositions).where(eq(financeExpensePositions.id, id)).run();
    v.positions.forEach((p, sortOrder) => {
      const old = p.id ? existing.get(p.id) : undefined;
      const receipt = p.kind === 'receipt';
      const trip = receipt ? { amountCents: p.amountCents ?? 0, tripRateCentsPerKm: null } : tripFields(tx, p);
      const row = {
        sortOrder,
        kind: p.kind,
        positionDate: p.positionDate ?? null,
        amountCents: trip.amountCents,
        purpose: p.purpose ?? '',
        projectId: p.projectId ?? null,
        documentId: receipt ? (old?.documentId ?? null) : null,
        documentNumber: receipt ? (old?.documentNumber ?? null) : null,
        tripFrom: receipt ? null : blankToNull(p.tripFrom),
        tripTo: receipt ? null : blankToNull(p.tripTo),
        tripReason: receipt ? null : blankToNull(p.tripReason),
        tripKm: receipt ? null : (p.tripKm ?? null),
        tripRateCentsPerKm: trip.tripRateCentsPerKm,
      };
      if (old) tx.update(financeExpensePositions).set(row).where(eq(financeExpensePositions.id, old.id)).run();
      else tx.insert(financeExpensePositions).values({ id: newId(), claimId, ...row }).run();
    });

    const saved = tx.select().from(financeExpenseClaims).where(eq(financeExpenseClaims.id, claimId)).get()!;
    const positions = positionsOf(tx, claimId);
    financeAudit(tx, deps, ctx, {
      action: 'finance.expenseClaim.saveDraft',
      entity: 'financeExpenseClaim',
      id: claimId,
      before: before ? claimAudit(before, [...existing.values()]) : undefined,
      after: claimAudit(saved, positions),
      summary: `Auslage (Entwurf) ${claimId} gesichert`,
    });
    return ok(expenseClaimViewInternal(deps, tx, claimId)!);
  });
}

// ── Beleg ───────────────────────────────────────────────────────────────────

const receiptSchema = z.object({
  claimId: z.string().min(1),
  positionId: z.string().min(1),
  bytes: z.custom<Uint8Array>((val) => val instanceof Uint8Array, { message: 'invalidBytes' }),
  fileName: z.string().trim().min(1).max(300),
});

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const isPdf = (bytes: Uint8Array) => PDF_MAGIC.every((b, i) => bytes[i] === b);
const megabytes = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

/** Annahme 5: `voucher-invoice`, wenn der Verein es als Belegart führt, sonst die erste seiner Belegarten. */
function receiptTypeKey(deps: Deps): string | null {
  const types = readSetting<string[]>(deps, 'finance.voucherTypes');
  return types.includes('voucher-invoice') ? 'voucher-invoice' : (types[0] ?? null);
}

/**
 * Ein PDF je Belegposition, abgelegt im Namen des Antrags
 * (`receiveGeneratedUpload`, Bezug `financeExpenseClaim`) — die einreichende
 * Person braucht kein Recht der Akte. Ein zweites PDF ersetzt das erste an der
 * Position; der alte Bezug bleibt in der Akte. Kein PDF (am Magic Byte) oder
 * zu groß → Meldung mit dem Dateinamen, der Entwurf bleibt, wie er ist. Der
 * Betreff nennt Antrag und Position, nie die Person. Die Version des Antrags
 * bleibt: Die laufende Sicherung schreibt den Beleg nie, sie darf deshalb nicht
 * an ihm scheitern.
 */
export async function uploadExpenseReceipt(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ExpenseClaimView>> {
  const denied = requirePermission(ctx, 'finance.expensesSubmit');
  if (denied) return denied;
  const parsed = validate(deps, receiptSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const loaded = loadOwnClaim(deps, ctx, v.claimId);
  if (!loaded.ok) return loaded;
  const claim = loaded.value;
  if (claim.state !== 'draft') return financeConflict('expenseNotDraft');
  const positions = positionsOf(deps.db, claim.id);
  const index = positions.findIndex((p) => p.id === v.positionId);
  if (index < 0) return notFound('financeExpensePosition', v.positionId);
  const position = positions[index]!;
  if (position.kind !== 'receipt') return invalid([{ path: 'positionId', message: 'notAReceipt' }]);

  if (v.bytes.byteLength > DOCUMENT_MAX_BYTES) return financeConflict('expenseFileTooLarge', { file: v.fileName, limit: megabytes(DOCUMENT_MAX_BYTES) });
  if (!isPdf(v.bytes)) return financeConflict('expenseFileNotPdf', { file: v.fileName });
  const typeKey = receiptTypeKey(deps);
  if (!typeKey) return invalid([{ path: 'typeKey', message: 'unknownDocumentType' }]);

  const result = await receiveGeneratedUpload(deps, ctx, {
    bytes: v.bytes,
    typeKey,
    subject: `Beleg zu Auslage ${claim.number ?? claim.id} · Position ${index + 1}`,
    documentDate: position.positionDate ?? today(deps),
    links: [{ entityType: 'financeExpenseClaim', entityId: claim.id }],
    afterReceive: (tx, doc) => {
      const state = tx.select({ state: financeExpenseClaims.state }).from(financeExpenseClaims).where(eq(financeExpenseClaims.id, claim.id)).get()?.state;
      if (state !== 'draft') abortReceive(financeConflict('expenseNotDraft'));
      const changed = tx.update(financeExpensePositions).set({ documentId: doc.id, documentNumber: doc.number }).where(and(eq(financeExpensePositions.id, position.id), eq(financeExpensePositions.claimId, claim.id))).run().changes;
      if (changed !== 1) abortReceive(notFound('financeExpensePosition', position.id));
      financeAudit(tx, deps, ctx, {
        action: 'finance.expensePosition.receipt',
        entity: 'financeExpensePosition',
        id: position.id,
        before: position.documentId ? { claimId: claim.id, documentId: position.documentId } : undefined,
        after: { claimId: claim.id, documentId: doc.id },
        summary: `Beleg ${doc.number} an Position ${index + 1} der Auslage ${claim.number ?? claim.id}`,
      });
      return null;
    },
  });
  if (!result.ok) return result;
  return ok(expenseClaimViewInternal(deps, deps.db, claim.id)!);
}

const receiptReadSchema = z.object({ claimId: z.string().min(1), documentId: z.string().min(1) });

/**
 * Einen Beleg des Antrags lesen — die antragstellende Person ihre eigenen
 * ohne `finance.read` (Review Focus 1), alle anderen nur mit. Die
 * Eigentümer-Prüfung steht hier im Dienst; `readLinkedDocument` prüft danach
 * den Bezug auf den Antrag und die Datei. Liefert Bytes: kein MCP-Werkzeug.
 */
export async function readExpenseReceipt(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ bytes: Uint8Array; filename: string; number: string | null }>> {
  const canRead = hasPermission(ctx, 'finance.read');
  if (!canRead && !hasPermission(ctx, 'finance.expensesSubmit')) return forbidden('finance.read');
  const parsed = validate(deps, receiptReadSchema, input);
  if (!parsed.ok) return parsed;
  const claim = deps.db.select().from(financeExpenseClaims).where(eq(financeExpenseClaims.id, parsed.value.claimId)).get();
  if (!claim) return notFound('financeExpenseClaim', parsed.value.claimId);
  if (!canRead && !isOwner(deps, ctx, claim)) return forbidden('finance.read');

  // Die Eigentümerin liest mit dem Recht, das die Akte für diesen Bezug verlangt — nur für diesen einen Aufruf.
  const readCtx: CallContext = canRead ? ctx : { ...ctx, permissions: new Set([...ctx.permissions, 'finance.read']) };
  const result = await readLinkedDocument(deps, readCtx, { documentId: parsed.value.documentId, entityType: 'financeExpenseClaim', entityId: claim.id });
  if (!result.ok) return result;
  return ok({ bytes: result.value.bytes, filename: result.value.filename, number: result.value.record.number });
}

// ── Einreichen ──────────────────────────────────────────────────────────────

const idSchema = z.object({ id: z.string().min(1) });
const submitSchema = z.object({ id: z.string().min(1), expectedVersion: expectedVersionField });

function allocateClaimNumber(tx: DbOrTx, year: number): string {
  const counter = tx.select().from(financeExpenseCounters).where(eq(financeExpenseCounters.year, year)).get();
  const next = (counter?.last ?? 0) + 1;
  if (counter) tx.update(financeExpenseCounters).set({ last: next }).where(eq(financeExpenseCounters.year, year)).run();
  else tx.insert(financeExpenseCounters).values({ year, last: next }).run();
  return `KE-${year}-${String(next).padStart(3, '0')}`;
}

/**
 * Die Prüfungen des Einreichens (Annahme 3), in der Reihenfolge, in der die
 * Oberfläche sie zeigt: mindestens eine Position, je Beleg ein PDF, je Fahrt
 * Kilometer, Anlass und Betrag, dann die Felder, dann IBAN oder Verzicht.
 */
function submitProblem(deps: Deps, claim: FinanceExpenseClaimRow, positions: readonly FinanceExpensePositionRow[]): Result<null> {
  if (claim.waiver && !waiversEnabled(deps)) return financeConflict('expenseWaiversDisabled');
  // Befund 8: der Schalter allein reicht nicht — ohne Anspruchsgrundlage (Person oder Verein) wird kein Verzicht eingereicht.
  if (claim.waiver && waiverBasisInternal(deps, deps.db, claim.contactId).waiverBasisText === null) return financeConflict('waiverBasisMissing');
  if (positions.length === 0) return financeConflict('expenseNothingToSubmit');
  const missing = positions.findIndex((p) => p.kind === 'receipt' && !p.documentId);
  if (missing >= 0) return financeConflict('expensePositionNeedsReceipt', { position: missing + 1 });
  if (positions.some((p) => p.kind === 'trip' && (!p.tripKm || !p.tripReason || p.amountCents <= 0))) return financeConflict('expenseTripNeedsKm');
  const issues: ValidationIssue[] = [];
  positions.forEach((p, i) => {
    if (!p.positionDate) issues.push({ path: `positions.${i}.positionDate`, message: 'required' });
    if (p.kind === 'receipt' && p.purpose.trim() === '') issues.push({ path: `positions.${i}.purpose`, message: 'required' });
    if (p.kind === 'receipt' && p.amountCents <= 0) issues.push({ path: `positions.${i}.amountCents`, message: 'required' });
  });
  if (issues.length > 0) return invalid(issues);
  if (!claim.waiver && !(claim.iban && isValidIban(claim.iban))) return financeConflict('expenseIbanOrWaiver');
  return ok(null);
}

/** Anspruchsgrundlage für den Verzicht: die der Person, sonst die des Vereins — als Abschrift am Antrag. */
function waiverBasisInternal(deps: Deps, db: DbOrTx, contactId: string): { waiverBasisText: string | null; waiverAgreedOn: string | null } {
  const terms = db.select().from(financeContactWaiverTerms).where(eq(financeContactWaiverTerms.contactId, contactId)).get();
  if (terms) return { waiverBasisText: terms.basisText, waiverAgreedOn: terms.agreedOn };
  const text = readSetting<string>(deps, 'finance.expenseWaiverBasisText');
  return { waiverBasisText: text ? text : null, waiverAgreedOn: null };
}

/**
 * Einreichen: Prüfungen, Nummer `KE-<Jahr>-NNN` (Jahr des Einreichens), der
 * Antrag wird unveränderlich bis auf die Freigabefelder (Trigger). Bei
 * Verzicht kommt die Anspruchsgrundlage als Abschrift an den Antrag. Danach
 * die Kontaktrolle `claimant`, falls sie noch nicht läuft.
 */
export async function submitExpenseClaim(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ExpenseClaimView>> {
  const denied = requirePermission(ctx, 'finance.expensesSubmit');
  if (denied) return denied;
  const parsed = validate(deps, submitSchema, input);
  if (!parsed.ok) return parsed;
  const loaded = loadOwnClaim(deps, ctx, parsed.value.id);
  if (!loaded.ok) return loaded;
  const claim = loaded.value;
  if (claim.state !== 'draft') return financeConflict('expenseNotDraft');
  const stale = staleVersion(parsed.value.expectedVersion, claim.updatedAt);
  if (stale) return stale;
  const positions = positionsOf(deps.db, claim.id);
  const problem = submitProblem(deps, claim, positions);
  if (!problem.ok) return problem;

  const done = deps.db.transaction((tx: DbOrTx) => {
    const submittedAt = isoNow(deps.clock);
    const number = allocateClaimNumber(tx, deps.clock.now().getUTCFullYear());
    const basis = claim.waiver ? waiverBasisInternal(deps, tx, claim.contactId) : { waiverBasisText: null, waiverAgreedOn: null };
    const changed = tx
      .update(financeExpenseClaims)
      .set({ state: 'submitted', number, submittedAt, ...basis, updatedAt: nextVersion(deps, claim.updatedAt) })
      .where(and(eq(financeExpenseClaims.id, claim.id), eq(financeExpenseClaims.state, 'draft')))
      .run().changes;
    if (changed !== 1) return financeConflict('expenseNotDraft');
    financeAudit(tx, deps, ctx, {
      action: 'finance.expenseClaim.submit',
      entity: 'financeExpenseClaim',
      id: claim.id,
      before: { state: 'draft' },
      after: { ...claimAudit({ ...claim, state: 'submitted' }, positions), number, submittedAt },
      summary: `Antrag ${number} eingereicht`,
    });
    return ok(null);
  });
  if (!done.ok) return done;
  await ensureClaimantRoleInternal(deps, claim.contactId, today(deps));
  return ok(expenseClaimViewInternal(deps, deps.db, claim.id)!);
}

/**
 * Die Kontaktrolle `claimant` setzen, wenn keine läuft — im Systemkontext wie
 * `donor`: Die einreichende Person braucht `contacts.manage` nicht. Die Rolle
 * ist eine Beschriftung, kein Halter (die Frist hängt am Antrag).
 */
async function ensureClaimantRoleInternal(deps: Deps, contactId: string, since: string): Promise<void> {
  const running = deps.db.select({ id: contactRoles.id }).from(contactRoles).where(and(eq(contactRoles.contactId, contactId), eq(contactRoles.role, 'claimant'), isNull(contactRoles.until))).get();
  if (running) return;
  await addContactRole(deps, { ...systemContext(), permissions: new Set(['contacts.manage']) }, { id: contactId, role: 'claimant', since });
}

// ── Entwurf löschen, neu einreichen ─────────────────────────────────────────

/**
 * Den eigenen Entwurf löschen (Löschregel `financeExpenseClaimDraft`): erst die
 * Positionen, dann die Bezüge der Akte auf ihn, dann den Antrag. Die Belege
 * bleiben in der Akte.
 */
export async function deleteExpenseDraft(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string }>> {
  const denied = requirePermission(ctx, 'finance.expensesSubmit');
  if (denied) return denied;
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const loaded = loadOwnClaim(deps, ctx, parsed.value.id);
  if (!loaded.ok) return loaded;
  const claim = loaded.value;
  if (claim.state !== 'draft') return financeConflict('expenseNotDraft');

  return deps.db.transaction((tx: DbOrTx) => {
    const positions = positionsOf(tx, claim.id);
    tx.delete(financeExpensePositions).where(eq(financeExpensePositions.claimId, claim.id)).run();
    tx.delete(documentLinks).where(and(eq(documentLinks.entityType, 'financeExpenseClaim'), eq(documentLinks.entityId, claim.id))).run();
    tx.delete(financeExpenseClaims).where(and(eq(financeExpenseClaims.id, claim.id), eq(financeExpenseClaims.state, 'draft'))).run();
    financeAudit(tx, deps, ctx, {
      action: 'finance.expenseClaim.draftDelete',
      entity: 'financeExpenseClaim',
      id: claim.id,
      before: { state: claim.state, positionCount: positions.length, totalCents: sumCents(positions) },
      summary: `Auslage (Entwurf) ${claim.id} gelöscht`,
    });
    return ok({ id: claim.id });
  });
}

/**
 * „Neu einreichen“ (Annahme 11): ein abgelehnter Antrag wird als Entwurf
 * kopiert, mit Verweis. Dieselben Belege, neue Bezüge der Akte auf die Kopie;
 * Kategorie und Zweck bleiben leer (die Freigabe entscheidet neu). Sind
 * Aufwandsspenden inzwischen ausgeschaltet, entsteht die Kopie ohne Verzicht
 * (Review Focus 3).
 */
export async function copyExpenseClaim(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ExpenseClaimView>> {
  const denied = requirePermission(ctx, 'finance.expensesSubmit');
  if (denied) return denied;
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const loaded = loadOwnClaim(deps, ctx, parsed.value.id);
  if (!loaded.ok) return loaded;
  const source = loaded.value;
  if (source.state !== 'rejected') return financeConflict('expenseNotRejected');

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const id = newId();
    const waiver = source.waiver && waiversEnabled(deps);
    tx.insert(financeExpenseClaims).values({ id, contactId: source.contactId, submittedByUserId: ctx.userId!, state: 'draft', iban: source.iban, waiver, recurring: source.recurring, copiedFromClaimId: source.id, createdAt: now, updatedAt: now }).run();
    const positions = positionsOf(tx, source.id);
    for (const p of positions) {
      tx.insert(financeExpensePositions).values({ ...p, id: newId(), claimId: id, categoryId: null, purposeId: null }).run();
      if (p.documentId) linkDocumentInternal(tx, deps, { documentId: p.documentId, entityType: 'financeExpenseClaim', entityId: id });
    }
    financeAudit(tx, deps, ctx, {
      action: 'finance.expenseClaim.copy',
      entity: 'financeExpenseClaim',
      id,
      after: { ...claimAudit({ state: 'draft', waiver, recurring: source.recurring }, positions), copiedFromClaimId: source.id },
      summary: `Antrag ${source.number} als Auslage (Entwurf) ${id} neu angelegt`,
    });
    return ok(expenseClaimViewInternal(deps, tx, id)!);
  });
}

// ── Lesen ───────────────────────────────────────────────────────────────────

export interface ExpenseFormStart {
  /** „Für wen?“ — der eigene Kontakt, nicht editierbar. */
  contactName: string;
  /** Vorbelegung: die IBAN des jüngsten eigenen Antrags, sonst eine bekannte Bankverbindung des Kontakts. */
  iban: string | null;
  /** Der Verzicht wird nur angeboten, wenn der Verein Aufwandsspenden führt (E13). */
  waiversEnabled: boolean;
  /** Befund 8: ohne Anspruchsgrundlage (Person oder Verein) bietet das Formular den Verzicht nicht an, auch wenn `waiversEnabled` gilt. */
  waiverAvailable: boolean;
  waiverUnavailableReason: 'basisMissing' | null;
  /** Wer die Grundlage hinterlegen kann (`finance.setup`) — nur gefüllt, solange `waiverAvailable` false ist. */
  waiverUnavailableNames: string[];
  /** Die Stufen des Kilometersatzes (mitgeliefert und eigene), aufsteigend — die Oberfläche rechnet damit vor, der Dienst rechnet beim Sichern. */
  mileageRates: { validFrom: string; centsPerKm: number }[];
  /** Die aktiven Projekte, nur ID und Name (in der ersten Sprache) — für das Feld „Projekt“ auch ohne `projects.view`. */
  projects: { id: string; name: string }[];
}

/**
 * Die Namen der aktiven Projekte für das Formular. Wer nur Auslagen einreicht,
 * trägt `projects.view` nicht; Namen aktiver Projekte sind aber kein Geheimnis.
 * Wie `readExpenseReceipt`: `listProjects` mit dem zusätzlichen Recht nur für
 * diesen einen Aufruf, und hinaus gehen nur ID und Name.
 */
async function activeProjectNamesInternal(deps: Deps, ctx: CallContext): Promise<{ id: string; name: string }[]> {
  const readCtx: CallContext = hasPermission(ctx, 'projects.view') ? ctx : { ...ctx, permissions: new Set([...ctx.permissions, 'projects.view']) };
  const result = await listProjects(deps, readCtx);
  if (!result.ok) return [];
  const leading = deps.locales()[0] ?? 'de';
  return result.value.filter((p) => p.status === 'active').map((p) => ({ id: p.id, name: (p.name as Record<string, string>)[leading] || p.slug }));
}

/**
 * Was das Formular „Auslage einreichen“ vor dem ersten Speichern braucht
 * (F8a Task 5): legt nichts an. Ohne Kontaktverknüpfung dieselbe Meldung wie
 * beim Sichern — die Oberfläche zeigt dann den Sperrzustand statt Feldern.
 */
export async function expenseFormStart(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ExpenseFormStart>> {
  const denied = requirePermission(ctx, 'finance.expensesSubmit');
  if (denied) return denied;
  const parsed = validate(deps, z.object({}).strict(), input ?? {});
  if (!parsed.ok) return parsed;
  const own = ownContactInternal(deps, ctx);
  if (!own.ok) return own;

  const contact = deps.db.select().from(contacts).where(eq(contacts.id, own.value)).get();
  const lastClaimIban = deps.db
    .select({ iban: financeExpenseClaims.iban })
    .from(financeExpenseClaims)
    .where(and(eq(financeExpenseClaims.contactId, own.value), isNotNull(financeExpenseClaims.iban)))
    .orderBy(desc(financeExpenseClaims.updatedAt))
    .get()?.iban;
  const knownIban = deps.db
    .select({ iban: financeContactBankAccounts.iban })
    .from(financeContactBankAccounts)
    .where(eq(financeContactBankAccounts.contactId, own.value))
    .orderBy(desc(financeContactBankAccounts.createdAt))
    .get()?.iban;

  const steps = new Set([
    ...DATED_SERIES.mileageRate.series.map((e) => e.validFrom),
    ...deps.db.select({ validFrom: financeDatedValues.validFrom }).from(financeDatedValues).where(eq(financeDatedValues.key, 'mileageRate')).all().map((r) => r.validFrom),
  ]);
  const mileageRates = [...steps]
    .sort()
    .map((validFrom) => ({ validFrom, centsPerKm: valueAt(deps.db, 'mileageRate', validFrom) }))
    .filter((r): r is { validFrom: string; centsPerKm: number } => typeof r.centsPerKm === 'number');

  const basis = waiverBasisInternal(deps, deps.db, own.value);
  const waiverAvailable = basis.waiverBasisText !== null;
  return ok({
    contactName: contact ? displayName(contact) : '',
    iban: lastClaimIban ?? knownIban ?? null,
    waiversEnabled: waiversEnabled(deps),
    waiverAvailable,
    waiverUnavailableReason: waiverAvailable ? null : 'basisMissing',
    waiverUnavailableNames: waiverAvailable ? [] : listUserNamesWithPermission(deps, 'finance.setup'),
    mileageRates,
    projects: await activeProjectNamesInternal(deps, ctx),
  });
}

const listSchema = z.object({
  state: z.enum(['open', 'done']).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

const isDone = (c: ExpenseClaimView) => c.stateLabelKey === 'paid' || c.stateLabelKey === 'rejected';

/**
 * Die eigenen Anträge (Annahme 6): nur die des eigenen Kontakts, jüngste
 * zuerst. „Offen“ = Entwurf, eingereicht, freigegeben und noch nicht
 * ausgezahlt; „Erledigt“ = ausgezahlt oder abgelehnt.
 */
export async function listMyExpenseClaims(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ items: ExpenseClaimView[]; total: number }>> {
  const denied = requirePermission(ctx, 'finance.expensesSubmit');
  if (denied) return denied;
  const parsed = validate(deps, listSchema, input);
  if (!parsed.ok) return parsed;
  const own = ownContactInternal(deps, ctx);
  if (!own.ok) return own;
  const ids = deps.db
    .select({ id: financeExpenseClaims.id })
    .from(financeExpenseClaims)
    .where(eq(financeExpenseClaims.contactId, own.value))
    .orderBy(desc(financeExpenseClaims.createdAt), desc(financeExpenseClaims.id))
    .all()
    .map((r) => r.id);
  const views = ids.map((id) => expenseClaimViewInternal(deps, deps.db, id)!);
  const filtered = parsed.value.state === undefined ? views : views.filter((c) => (parsed.value.state === 'done' ? isDone(c) : !isDone(c)));
  return ok({ items: filtered.slice(parsed.value.offset, parsed.value.offset + parsed.value.limit), total: filtered.length });
}

/** Ein Antrag: die antragstellende Person ihren eigenen (`finance.expensesSubmit`), alle anderen mit `finance.read`. */
export async function getExpenseClaim(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ExpenseClaimView>> {
  const canRead = hasPermission(ctx, 'finance.read');
  if (!canRead && !hasPermission(ctx, 'finance.expensesSubmit')) return forbidden('finance.expensesSubmit');
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const claim = deps.db.select().from(financeExpenseClaims).where(eq(financeExpenseClaims.id, parsed.value.id)).get();
  if (!claim) return notFound('financeExpenseClaim', parsed.value.id);
  if (!canRead && !isOwner(deps, ctx, claim)) return financeConflict('expenseNotOwner');
  return ok(expenseClaimViewInternal(deps, deps.db, claim.id)!);
}

