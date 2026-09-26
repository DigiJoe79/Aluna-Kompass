import { expectedVersionField, isoNow, listUserNamesWithPermission, newId, notFound, ok, requirePermission, staleVersion, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { financeEntryCounters, financeFiscalYears, financePeriodEvents, type FinanceFiscalYearRow } from '../schema';
import { requireMasterDataRead } from './access';

export type FiscalYearStatus = 'open' | 'closed';
export type FiscalYearView = FinanceFiscalYearRow & { status: FiscalYearStatus };

const dayAfter = (iso: string): string => { const d = new Date(`${iso}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
/** Zwölf Monate ab `start`, letzter Tag eingeschlossen: 2027-07-01 → 2028-06-30. */
const yearEnd = (start: string): string => { const d = new Date(`${start}T00:00:00.000Z`); d.setUTCFullYear(d.getUTCFullYear() + 1); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

export function fiscalYearForInternal(db: DbOrTx, date: string): FinanceFiscalYearRow | null {
  return db.select().from(financeFiscalYears).where(and(lte(financeFiscalYears.startsOn, date), gte(financeFiscalYears.endsOn, date))).get() ?? null;
}

/** Das jüngste Ereignis entscheidet; ohne Ereignis ist ein Geschäftsjahr offen. */
export function fiscalYearStatusInternal(db: DbOrTx, yearId: string): FiscalYearStatus {
  const latest = db.select().from(financePeriodEvents).where(eq(financePeriodEvents.fiscalYearId, yearId)).orderBy(desc(financePeriodEvents.at)).limit(1).get();
  if (!latest) return 'open';
  return latest.kind === 'closed' ? 'closed' : 'open';
}

/**
 * Das Geschäftsjahr zu einem Datum — und wenn es fehlt, **nur der unmittelbare
 * Nachfolger** des jüngsten. So entsteht das neue Jahr mit der ersten Buchung im
 * Januar von selbst, aber ein Tippfehler („2062“) legt keine vierzig Jahre an,
 * und vor dem ersten Jahr gibt es nichts: Das richtet ein Mensch ein.
 */
export function ensureFiscalYearFor(tx: DbOrTx, deps: Deps, ctx: CallContext, date: string): Result<FinanceFiscalYearRow> {
  const existing = fiscalYearForInternal(tx, date);
  if (existing) return ok(existing);
  const latest = tx.select().from(financeFiscalYears).orderBy(desc(financeFiscalYears.endsOn)).limit(1).get();
  // Prozesstest-Befund 10 (Task 2): Grund **und** Abhilfe — wer ein Geschäftsjahr anlegen kann.
  const none = () => {
    const names = listUserNamesWithPermission({ db: tx }, 'finance.setup');
    return financeConflict('noFiscalYearForDate', { date, names: names.length > 0 ? names.join(', ') : '—' });
  };
  if (!latest) return none();
  const startsOn = dayAfter(latest.endsOn);
  const endsOn = yearEnd(startsOn);
  if (date < startsOn || date > endsOn) return none();

  const now = isoNow(deps.clock);
  let designation = startsOn.slice(0, 4);
  if (tx.select({ id: financeFiscalYears.id }).from(financeFiscalYears).where(eq(financeFiscalYears.designation, designation)).get()) designation = `${designation}-2`;
  const row: FinanceFiscalYearRow = { id: newId(), startsOn, endsOn, designation, taxReturnFiledOn: null, createdAt: now, updatedAt: now };
  tx.insert(financeFiscalYears).values(row).run();
  financeAudit(tx, deps, ctx, { action: 'finance.fiscalYear.autoCreate', entity: 'financeFiscalYear', id: row.id, after: row, summary: `Geschäftsjahr ${row.designation} als Nachfolger angelegt` });
  return ok(row);
}

/** Nur in einer Transaktion. Fortlaufend je Geschäftsjahr, Form `<Bezeichnung>-<0001>`. */
export function allocateEntryNumber(tx: DbOrTx, yearId: string): string {
  const year = tx.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, yearId)).get()!;
  const counter = tx.select().from(financeEntryCounters).where(eq(financeEntryCounters.fiscalYearId, yearId)).get();
  const next = (counter?.last ?? 0) + 1;
  if (counter) tx.update(financeEntryCounters).set({ last: next }).where(eq(financeEntryCounters.fiscalYearId, yearId)).run();
  else tx.insert(financeEntryCounters).values({ fiscalYearId: yearId, last: next }).run();
  return `${year.designation}-${String(next).padStart(4, '0')}`;
}

const DESIGNATION = /^[A-Za-z0-9 ()-]{1,24}$/;

const rangeSchema = z.object({ startsOn: z.string().date(), endsOn: z.string().date() }).superRefine((v, c) => {
  if (v.endsOn < v.startsOn) c.addIssue({ code: 'custom', path: ['endsOn'], message: 'endBeforeStart' });
  else if (yearEnd(v.startsOn) < v.endsOn) c.addIssue({ code: 'custom', path: ['endsOn'], message: 'fiscalYearTooLong' });
});

function hasAnyFiscalYear(db: DbOrTx): boolean {
  return !!db.select({ id: financeFiscalYears.id }).from(financeFiscalYears).limit(1).get();
}

function hasEntryNumbers(db: DbOrTx, yearId: string): boolean {
  return !!db.select({ y: financeEntryCounters.fiscalYearId }).from(financeEntryCounters).where(eq(financeEntryCounters.fiscalYearId, yearId)).get();
}

function designationOf(startsOn: string, endsOn: string): string {
  const shortYear = yearEnd(startsOn) !== endsOn;
  return shortYear ? `${startsOn.slice(0, 4)} (Rumpfjahr)` : startsOn.slice(0, 4);
}

export async function createFirstFiscalYear(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FiscalYearView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, rangeSchema, input);
  if (!parsed.ok) return parsed;
  if (hasAnyFiscalYear(deps.db)) return financeConflict('fiscalYearExists');

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const row: FinanceFiscalYearRow = { id: newId(), startsOn: parsed.value.startsOn, endsOn: parsed.value.endsOn, designation: designationOf(parsed.value.startsOn, parsed.value.endsOn), taxReturnFiledOn: null, createdAt: now, updatedAt: now };
    tx.insert(financeFiscalYears).values(row).run();
    financeAudit(tx, deps, ctx, { action: 'finance.fiscalYear.create', entity: 'financeFiscalYear', id: row.id, after: row, summary: `Geschäftsjahr ${row.designation} angelegt` });
    return ok({ ...row, status: 'open' as const });
  });
}

const updateSchema = z.object({
  id: z.string().min(1),
  designation: z.string().regex(DESIGNATION).optional(),
  taxReturnFiledOn: z.string().date().nullable().optional(),
  expectedVersion: expectedVersionField,
});

export async function updateFiscalYear(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FiscalYearView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, updateSchema, input);
  if (!parsed.ok) return parsed;
  const before = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, parsed.value.id)).get();
  if (!before) return notFound('financeFiscalYear', parsed.value.id);
  const stale = staleVersion(parsed.value.expectedVersion, before.updatedAt);
  if (stale) return stale;
  if (parsed.value.designation !== undefined && parsed.value.designation !== before.designation && hasEntryNumbers(deps.db, before.id)) {
    return financeConflict('designationLocked');
  }
  return deps.db.transaction((tx: DbOrTx) => {
    const after: FinanceFiscalYearRow = {
      ...before,
      designation: parsed.value.designation ?? before.designation,
      taxReturnFiledOn: parsed.value.taxReturnFiledOn === undefined ? before.taxReturnFiledOn : parsed.value.taxReturnFiledOn,
      updatedAt: isoNow(deps.clock),
    };
    tx.update(financeFiscalYears).set(after).where(eq(financeFiscalYears.id, before.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.fiscalYear.update', entity: 'financeFiscalYear', id: before.id, before, after, summary: `Geschäftsjahr ${after.designation} geändert` });
    return ok({ ...after, status: fiscalYearStatusInternal(tx, before.id) });
  });
}

export async function listFiscalYears(deps: Deps, ctx: CallContext): Promise<Result<FiscalYearView[]>> {
  const denied = requireMasterDataRead(ctx).failure;
  if (denied) return denied;
  const rows = deps.db.select().from(financeFiscalYears).orderBy(desc(financeFiscalYears.startsOn)).all();
  return ok(rows.map((row) => ({ ...row, status: fiscalYearStatusInternal(deps.db, row.id) })));
}
