import { isoNow, newId, notFound, ok, requireHumanChannel, requirePermission, schema, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { financeAllocationCorrections, financeEntries, financeEntryJustifications, financeFiscalYears, financePeriodEvents, type FinanceFiscalYearRow } from '../schema';
import { requireFinanceRead } from './access';
import { documentationOf } from './entries';
import { ensureFiscalYearFor, fiscalYearStatusInternal, type FiscalYearView } from './fiscal-years';

/** Ein Tag nach `iso` — der Startpunkt des Folgejahres, wenn `endsOn` sein letzter Tag ist. */
function dayAfter(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Wie `entries.ts`: direkt gelesen, ohne `deps` — auch mit einer offenen Transaktion aufrufbar. */
function statementSufficesBelowCentsInternal(db: DbOrTx): number {
  const row = db.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, 'finance.statementSufficesBelowCents')).get();
  return row ? (JSON.parse(row.value) as number) : 0;
}

export interface UndocumentedEntryPreview {
  entryId: string;
  number: string | null;
  justified: boolean;
}

export interface PeriodClosePreview {
  draftsInPeriod: { id: string; entryDate: string }[];
  undocumented: UndocumentedEntryPreview[];
  previousYearOpen: boolean;
  pendingCorrections: number;
  canClose: boolean;
}

function loadYear(db: DbOrTx, id: string): FinanceFiscalYearRow | null {
  return db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, id)).get() ?? null;
}

/** Das Jahr unmittelbar vor `year`, nach `startsOn` geordnet — oder `null`, wenn `year` das erste ist. */
function findPreviousYear(db: DbOrTx, year: FinanceFiscalYearRow): FinanceFiscalYearRow | null {
  const earlier = db
    .select()
    .from(financeFiscalYears)
    .where(and(lte(financeFiscalYears.startsOn, year.startsOn)))
    .orderBy(desc(financeFiscalYears.startsOn))
    .all()
    .filter((y) => y.id !== year.id);
  return earlier[0] ?? null;
}

function undocumentedEntriesOf(db: DbOrTx, yearId: string): UndocumentedEntryPreview[] {
  const belowCents = statementSufficesBelowCentsInternal(db);
  const entries = db.select().from(financeEntries).where(and(eq(financeEntries.status, 'final'), eq(financeEntries.fiscalYearId, yearId))).all();
  const result: UndocumentedEntryPreview[] = [];
  for (const entry of entries) {
    const documentation = documentationOf(db, entry.id, { statementSufficesBelowCents: belowCents });
    if (documentation.state !== 'missing') continue;
    const justified = !!db.select({ entryId: financeEntryJustifications.entryId }).from(financeEntryJustifications).where(eq(financeEntryJustifications.entryId, entry.id)).get();
    result.push({ entryId: entry.id, number: entry.number, justified });
  }
  return result;
}

function draftsInPeriodOf(db: DbOrTx, year: FinanceFiscalYearRow): { id: string; entryDate: string }[] {
  return db
    .select({ id: financeEntries.id, entryDate: financeEntries.entryDate })
    .from(financeEntries)
    .where(and(eq(financeEntries.status, 'draft'), gte(financeEntries.entryDate, year.startsOn), lte(financeEntries.entryDate, year.endsOn)))
    .all();
}

function pendingCorrectionsOf(db: DbOrTx, yearId: string): number {
  const entryIds = db.select({ id: financeEntries.id }).from(financeEntries).where(eq(financeEntries.fiscalYearId, yearId)).all().map((e) => e.id);
  if (entryIds.length === 0) return 0;
  const rows = db.select({ id: financeAllocationCorrections.id, entryId: financeAllocationCorrections.entryId }).from(financeAllocationCorrections).where(eq(financeAllocationCorrections.state, 'pending')).all();
  const idSet = new Set(entryIds);
  return rows.filter((r) => idSet.has(r.entryId)).length;
}

function buildPreview(db: DbOrTx, year: FinanceFiscalYearRow, today: string): PeriodClosePreview {
  const draftsInPeriod = draftsInPeriodOf(db, year);
  const undocumented = undocumentedEntriesOf(db, year.id);
  const previous = findPreviousYear(db, year);
  const previousYearOpen = previous !== null && fiscalYearStatusInternal(db, previous.id) === 'open';
  const pendingCorrections = pendingCorrectionsOf(db, year.id);
  const ended = today > year.endsOn;
  const canClose = draftsInPeriod.length === 0 && undocumented.every((u) => u.justified) && !previousYearOpen && ended;
  return { draftsInPeriod, undocumented, previousYearOpen, pendingCorrections, canClose };
}

const idSchema = z.object({ id: z.string().min(1) });

/** `finance.read`. Was dem Abschluss im Weg steht — für die Oberfläche und den Agenten, bevor jemand auf den Knopf drückt. */
export async function previewPeriodClose(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PeriodClosePreview>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const year = loadYear(deps.db, parsed.value.id);
  if (!year) return notFound('financeFiscalYear', parsed.value.id);
  const today = isoNow(deps.clock).slice(0, 10);
  return ok(buildPreview(deps.db, year, today));
}

const justifySchema = z.object({ entryId: z.string().min(1), note: z.string().trim().min(1).max(500) });

/**
 * `finance.periodClose`. Eine unbelegte, festgeschriebene Buchung bekommt
 * eine Begründung — am Datensatz, nie im Protokoll (Spec 5.4).
 */
export async function justifyUndocumentedEntry(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ entryId: string }>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const parsed = validate(deps, justifySchema, input);
  if (!parsed.ok) return parsed;
  const entry = deps.db.select().from(financeEntries).where(eq(financeEntries.id, parsed.value.entryId)).get();
  if (!entry) return notFound('financeEntry', parsed.value.entryId);
  if (entry.status !== 'final') return financeConflict('entryNotFinal');

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    tx.insert(financeEntryJustifications)
      .values({ entryId: entry.id, note: parsed.value.note, byUserId: ctx.userId ?? 'system', at: now })
      .onConflictDoUpdate({ target: financeEntryJustifications.entryId, set: { note: parsed.value.note, byUserId: ctx.userId ?? 'system', at: now } })
      .run();
    financeAudit(tx, deps, ctx, { action: 'finance.entry.justify', entity: 'financeEntryJustification', id: entry.id, after: { entryId: entry.id }, summary: `Buchung ${entry.number ?? entry.id} ohne Beleg begründet` });
    return ok({ entryId: entry.id });
  });
}

const closeSchema = z.object({ id: z.string().min(1) });

/**
 * `finance.periodClose`, **`humanOnly`**: kein Entwurf in der Periode, jede
 * unbelegte Buchung begründet, das Vorjahr abgeschlossen, das Jahr zu Ende.
 * Schreibt ein Ereignis, kein Feld, und legt bei Bedarf das Folgejahr an.
 */
export async function closeFiscalYear(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FiscalYearView>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const humanOnly = requireHumanChannel(deps, ctx, 'finance.mcpHumanOnlyAllowed');
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, closeSchema, input);
  if (!parsed.ok) return parsed;
  const year = loadYear(deps.db, parsed.value.id);
  if (!year) return notFound('financeFiscalYear', parsed.value.id);
  if (fiscalYearStatusInternal(deps.db, year.id) === 'closed') return financeConflict('fiscalYearAlreadyClosed', { year: year.designation });

  const today = isoNow(deps.clock).slice(0, 10);
  const preview = buildPreview(deps.db, year, today);
  if (preview.draftsInPeriod.length > 0) return financeConflict('draftsInPeriod', { count: preview.draftsInPeriod.length });
  const unjustified = preview.undocumented.filter((u) => !u.justified).length;
  if (unjustified > 0) return financeConflict('undocumentedEntries', { count: unjustified });
  if (preview.previousYearOpen) return financeConflict('previousYearOpen');
  if (!(today > year.endsOn)) return financeConflict('fiscalYearNotEnded', { year: year.designation });

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const eventId = newId();
    tx.insert(financePeriodEvents).values({ id: eventId, fiscalYearId: year.id, kind: 'closed', at: now, byUserId: ctx.userId ?? 'system', reason: null }).run();
    const nextYear = ensureFiscalYearFor(tx, deps, ctx, dayAfter(year.endsOn));
    void nextYear; // fehlschlagen darf hier nicht: der Nachfolger ist immer im gültigen Bereich.
    financeAudit(tx, deps, ctx, { action: 'finance.period.close', entity: 'financePeriodEvent', id: eventId, after: { fiscalYearId: year.id, kind: 'closed' }, summary: `Geschäftsjahr ${year.designation} abgeschlossen` });
    return ok({ ...year, status: 'closed' as const });
  });
}
