import { type CallContext, type DbOrTx, type Deps, expectedVersionField, invalid, newId, notFound, ok, requirePermission, type Result, staleVersion, todayIn, validate } from '@kompass/core';
import { linkDocumentInternal, receiveGeneratedUpload, type ReceivedDocument } from '@kompass/module-dms';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { dayBefore, fiscalYearStatusInternal } from '../ledger/fiscal-years';
import { valueAt } from '../ledger/dated-values';
import { financeFiscalYears, financeFundsUseOpenings, type FinanceFiscalYearRow, type FinanceFundsUseOpeningRow } from '../schema';
import { nextVersion } from './expenses';
import { addYearsToDay, fundsUseOpeningEffects, type FundsUseOpeningInput, type FundsUseZeroReason } from './funds-use-rules';
import { checkPickedDocument, uploadInputSchema } from './reserves';

/**
 * Anfangsvortrag der Mittelverwendung je Entstehungsjahr (M1 Task 3, Spec 0.4.5 Teil M, Prüfung L-4): nur für die zwei
 * Jahre vor dem ersten Kompass-Jahr, je mit der Einnahmensumme jenes Jahres — Kompass prüft die damalige Grenze
 * (`thresholdTimelyUse`) und setzt den Vortrag sonst mit Grund auf 0. Mit Beleg, auditiert; geändert nur, solange das erste
 * Geschäftsjahr offen ist (nach dem Abschluss erst nach dem Wiederöffnen). Nie gelöscht.
 */

export interface FundsUseOpeningView {
  id: string;
  offset: 1 | 2;
  designation: string;
  endsOn: string;
  revenueCents: number;
  amountCents: number;
  limitCents: number | null;
  effectiveCents: number;
  zeroReason: FundsUseZeroReason | null;
  dueBy: string;
  documentId: string | null;
  updatedAt: string;
}

export interface FundsUseOpeningsOverview {
  firstFiscalYear: { id: string; designation: string; startsOn: string } | null;
  /** Das erste Geschäftsjahr ist offen — nie abgeschlossen oder wiedergeöffnet. */
  changeable: boolean;
  /** Das Ende des Jahres vor dem ersten Kompass-Jahr — `endsOn` des Vortrags mit offset 1. */
  expectedEndsOn: { offset1: string } | null;
  openings: FundsUseOpeningView[];
}

const limitAt = (db: DbOrTx, endsOn: string): number | null => (valueAt(db, 'thresholdTimelyUse', endsOn) as number | null) ?? null;

function firstFiscalYearInternal(db: DbOrTx): FinanceFiscalYearRow | null {
  return db.select().from(financeFiscalYears).orderBy(asc(financeFiscalYears.startsOn)).limit(1).get() ?? null;
}

function rows(db: DbOrTx): FinanceFundsUseOpeningRow[] {
  return db.select().from(financeFundsUseOpenings).orderBy(asc(financeFundsUseOpenings.offset)).all();
}

const toInput = (db: DbOrTx, r: FinanceFundsUseOpeningRow): FundsUseOpeningInput => ({ offset: r.offset as 1 | 2, designation: r.designation, endsOn: r.endsOn, revenueCents: r.revenueCents, amountCents: r.amountCents, limitCents: limitAt(db, r.endsOn) });

/** Die Anfangsvorträge als Eingabe der Fortschreibung (`fundsUseChain`), ohne Rechteprüfung. */
export function fundsUseOpeningsInternal(db: DbOrTx): FundsUseOpeningInput[] {
  return rows(db).map((r) => toInput(db, r));
}

/** Die Anfangsvorträge mit ihrer Wirkung, ohne Rechteprüfung — auch für den Bericht des ersten Jahres. */
export function fundsUseOpeningViewsInternal(db: DbOrTx): FundsUseOpeningView[] {
  const all = rows(db);
  const inputs = all.map((r) => toInput(db, r));
  const effects = fundsUseOpeningEffects(inputs);
  return all.map((r, i) => {
    const e = effects.find((x) => x.offset === r.offset)!;
    return { id: r.id, offset: r.offset as 1 | 2, designation: r.designation, endsOn: r.endsOn, revenueCents: r.revenueCents, amountCents: r.amountCents, limitCents: inputs[i]!.limitCents, effectiveCents: e.effectiveCents, zeroReason: e.zeroReason, dueBy: e.dueBy, documentId: r.documentId, updatedAt: r.updatedAt };
  });
}

export const listFundsUseOpeningsSchema = z.object({}).strict();

/** `finance.overview`: die Anfangsvorträge, das erste Geschäftsjahr und ob sie sich noch ändern lassen. */
export async function listFundsUseOpenings(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FundsUseOpeningsOverview>> {
  const denied = requireFinanceRead(ctx, 'overview');
  if (denied) return denied;
  const parsed = validate(deps, listFundsUseOpeningsSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const first = firstFiscalYearInternal(deps.db);
  return ok({
    firstFiscalYear: first ? { id: first.id, designation: first.designation, startsOn: first.startsOn } : null,
    changeable: !!first && fiscalYearStatusInternal(deps.db, first.id) === 'open',
    expectedEndsOn: first ? { offset1: dayBefore(first.startsOn) } : null,
    openings: fundsUseOpeningViewsInternal(deps.db),
  });
}

export const saveFundsUseOpeningSchema = z.object({
  offset: z.union([z.literal(1), z.literal(2)]),
  designation: z.string().trim().min(1).max(40),
  endsOn: z.string().date(),
  revenueCents: z.number().int().nonnegative().max(100_000_000_000),
  amountCents: z.number().int().nonnegative().max(100_000_000_000),
  expectedVersion: expectedVersionField,
  /** Beim Anlegen genau eines von beiden; beim Ändern ohne beides bleibt der vorhandene Beleg. */
  documentId: z.string().min(1).optional(),
  upload: uploadInputSchema.optional(),
});

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const isPdf = (bytes: Uint8Array) => PDF_MAGIC.every((b, i) => bytes[i] === b);
const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const megabytes = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;

const auditAfter = (r: FinanceFundsUseOpeningRow) => ({ offset: r.offset, endsOn: r.endsOn, revenueCents: r.revenueCents, amountCents: r.amountCents });

/** `finance.setup`: einen Anfangsvortrag anlegen oder ändern (je offset höchstens einer). */
export async function saveFundsUseOpening(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FundsUseOpeningView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, saveFundsUseOpeningSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const first = firstFiscalYearInternal(deps.db);
  if (!first) return notFound('financeFiscalYear', 'first');
  if (fiscalYearStatusInternal(deps.db, first.id) !== 'open') return financeConflict('fundsUseOpeningLocked', { designation: first.designation });

  const before = deps.db.select().from(financeFundsUseOpenings).where(eq(financeFundsUseOpenings.offset, v.offset)).get() ?? null;
  if (before) {
    const stale = staleVersion(v.expectedVersion, before.updatedAt);
    if (stale) return stale;
  }
  const expected1 = dayBefore(first.startsOn);
  if (v.offset === 1 && v.endsOn !== expected1) return invalid([{ path: 'endsOn', message: 'endsOnMismatch' }]);
  if (v.offset === 2) {
    const newer = deps.db.select().from(financeFundsUseOpenings).where(eq(financeFundsUseOpenings.offset, 1)).get();
    if (!newer) return financeConflict('fundsUseOpeningPreviousMissing');
    if (v.endsOn < addYearsToDay(newer.endsOn, -1) || v.endsOn >= newer.endsOn) return invalid([{ path: 'endsOn', message: 'endsOnMismatch' }]);
  }
  if (v.amountCents > v.revenueCents) return invalid([{ path: 'amountCents', message: 'amountAboveRevenue' }]);
  if (v.documentId && v.upload) return invalid([{ path: 'upload', message: 'pickOrUploadNotBoth' }]);
  if (!before && !v.documentId && !v.upload) return financeConflict('fundsUseOpeningDocumentRequired');

  // Der Beleg hängt am Anfangsvortrag selbst (Bezug `financeFundsUseOpening`, ablegen mit `finance.setup`) — nicht am
  // Geschäftsjahr, dessen Ablage `finance.periodClose` verlangt (Abnahme M1).
  const id = before?.id ?? newId();
  const write = (tx: DbOrTx, documentId: string | null): FinanceFundsUseOpeningRow => {
    const fields = { designation: v.designation, endsOn: v.endsOn, revenueCents: v.revenueCents, amountCents: v.amountCents, ...(documentId ? { documentId } : {}) };
    const now = nextVersion(deps, before?.updatedAt);
    if (before) tx.update(financeFundsUseOpenings).set({ ...fields, updatedAt: now }).where(eq(financeFundsUseOpenings.id, id)).run();
    else tx.insert(financeFundsUseOpenings).values({ id, offset: v.offset, ...fields, documentId, createdByUserId: ctx.userId ?? 'system', createdAt: now, updatedAt: now }).run();
    const after = tx.select().from(financeFundsUseOpenings).where(eq(financeFundsUseOpenings.id, id)).get()!;
    financeAudit(tx, deps, ctx, { action: 'finance.fundsUseOpening.save', entity: 'financeFundsUseOpening', id, before: before ? auditAfter(before) : undefined, after: auditAfter(after), params: { offset: v.offset, created: !before } });
    return after;
  };
  const view = (id: string) => ok(fundsUseOpeningViewsInternal(deps.db).find((o) => o.id === id)!);

  if (v.upload) {
    if (v.upload.bytes.byteLength > DOCUMENT_MAX_BYTES) return financeConflict('resolutionFileTooLarge', { file: v.upload.fileName, limit: megabytes(DOCUMENT_MAX_BYTES) });
    if (!isPdf(v.upload.bytes)) return financeConflict('resolutionFileNotPdf', { file: v.upload.fileName });
    const result = await receiveGeneratedUpload(deps, ctx, {
      bytes: v.upload.bytes,
      typeKey: 'finance-tax-return',
      subject: `Beleg Anfangsvortrag Mittelverwendung ${v.designation}`,
      documentDate: v.upload.documentDate ?? todayIn(deps),
      links: [{ entityType: 'financeFundsUseOpening', entityId: id }],
      afterReceive: (tx: DbOrTx, doc: ReceivedDocument) => write(tx, doc.id),
    });
    if (!result.ok) return result;
    return view(result.value.after!.id);
  }

  if (v.documentId) {
    const docProblem = await checkPickedDocument(deps, ctx, v.documentId);
    if (docProblem) return docProblem;
  }
  const saved = deps.db.transaction((tx: DbOrTx) => {
    const after = write(tx, v.documentId ?? null);
    if (v.documentId) linkDocumentInternal(tx, deps, { documentId: v.documentId, entityType: 'financeFundsUseOpening', entityId: id });
    return after;
  });
  return view(saved.id);
}
