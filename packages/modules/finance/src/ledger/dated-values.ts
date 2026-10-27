import { invalid, isoNow, notFound, ok, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, count, eq, gt, gte, lt } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeDatedValues, financeEntries } from '../schema';
import { requireMasterDataRead } from './access';
import { DATED_SERIES, type DatedValueKey } from './dated-series';
import { isValidVatId } from './vat-id';
import { FEDERAL_STATES } from './working-days';

export type DatedValue = number | string | boolean;

/**
 * Der Wert, der an diesem Tag gilt. Überschreibung und ausgelieferte Reihe werden
 * gemischt; bei gleichem Stichtag gewinnt die Überschreibung. Vor dem ersten
 * Eintrag gibt es **keinen** Wert — der Aufrufer sagt dann, dass für diesen
 * Zeitraum nichts hinterlegt ist, statt mit dem falschen Jahr zu rechnen.
 */
export function valueAt(db: DbOrTx, key: DatedValueKey, date: string): DatedValue | null {
  const shipped = DATED_SERIES[key].series.map((e) => ({ validFrom: e.validFrom, value: e.value as DatedValue, rank: 0 }));
  const overrides = db.select().from(financeDatedValues).where(eq(financeDatedValues.key, key)).all().map((r) => ({ validFrom: r.validFrom, value: JSON.parse(r.value) as DatedValue, rank: 1 }));
  const valid = [...shipped, ...overrides].filter((e) => e.validFrom <= date).sort((a, b) => a.validFrom.localeCompare(b.validFrom) || a.rank - b.rank);
  return valid.at(-1)?.value ?? null;
}

function unitOf(key: string): DatedValueKey | null {
  return key in DATED_SERIES ? (key as DatedValueKey) : null;
}

const RATIO = /^(\d+)\/(\d+)$/;

/** Ein Bruch „Zähler/Nenner“ als Zahlenpaar — der Wert ist geprüft (`valueIssue`); ein fremder Text wirft. */
export function ratioOf(value: string): { numerator: number; denominator: number } {
  const match = RATIO.exec(value);
  if (!match) throw new Error(`Kein Bruch: ${value}`);
  return { numerator: Number(match[1]), denominator: Number(match[2]) };
}

function valueIssue(unit: (typeof DATED_SERIES)[DatedValueKey]['unit'], value: unknown): string | null {
  if (unit === 'flag') return typeof value === 'boolean' ? null : 'invalidDatedValue';
  if (unit === 'vatAdvancePeriod') return value === 'auto' || value === 'quarter' || value === 'month' ? null : 'invalidDatedValue';
  if (unit === 'federalState') return value === '' || (FEDERAL_STATES as readonly unknown[]).includes(value) ? null : 'invalidDatedValue';
  if (unit === 'vatId') return value === '' || (typeof value === 'string' && isValidVatId(value)) ? null : 'invalidDatedValue';
  if (unit === 'taxation') return value === 'smallBusiness' || value === 'regular' ? null : 'invalidDatedValue';
  if (unit === 'ratio') {
    const match = typeof value === 'string' ? RATIO.exec(value) : null;
    if (!match) return 'invalidDatedValue';
    const numerator = Number(match[1]);
    const denominator = Number(match[2]);
    return denominator > 0 && numerator <= denominator ? null : 'invalidDatedValue';
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return 'invalidDatedValue';
  if (unit === 'percent' && value > 100) return 'invalidDatedValue';
  return null;
}

const setSchema = z.object({ key: z.string().min(1), validFrom: z.string().date(), value: z.union([z.number(), z.string(), z.boolean()]) });

export async function setDatedValue(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ key: string; validFrom: string; value: DatedValue }>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, setSchema, input);
  if (!parsed.ok) return parsed;
  const key = unitOf(parsed.value.key);
  if (!key) return invalid([{ path: 'key', message: 'unknownDatedValueKey' }]);
  const issue = valueIssue(DATED_SERIES[key].unit, parsed.value.value);
  if (issue) return invalid([{ path: 'value', message: issue }]);

  return deps.db.transaction((tx: DbOrTx) => {
    writeDatedValueInternal(tx, deps, ctx, key, parsed.value.validFrom, parsed.value.value);
    return ok({ key, validFrom: parsed.value.validFrom, value: parsed.value.value });
  });
}

/** In der Transaktion, ohne Prüfung: einen Wert ab `validFrom` setzen und protokollieren (auch `saveVatSettings`). */
export function writeDatedValueInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, key: DatedValueKey, validFrom: string, value: DatedValue): void {
  const now = isoNow(deps.clock);
  tx.insert(financeDatedValues)
    .values({ key, validFrom, value: JSON.stringify(value), updatedAt: now, updatedByUserId: ctx.userId })
    .onConflictDoUpdate({ target: [financeDatedValues.key, financeDatedValues.validFrom], set: { value: JSON.stringify(value), updatedAt: now, updatedByUserId: ctx.userId } })
    .run();
  financeAudit(tx, deps, ctx, { action: 'finance.datedValue.set', entity: 'financeDatedValue', id: `${key}@${validFrom}`, after: { key, validFrom, value }, params: { key, fromOn: validFrom } });
}

const removeSchema = z.object({ key: z.string().min(1), validFrom: z.string().date() });

export async function removeDatedValue(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ key: string; validFrom: string }>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, removeSchema, input);
  if (!parsed.ok) return parsed;
  const before = deps.db.select().from(financeDatedValues).where(and(eq(financeDatedValues.key, parsed.value.key), eq(financeDatedValues.validFrom, parsed.value.validFrom))).get();
  if (!before) return notFound('financeDatedValue', `${parsed.value.key}@${parsed.value.validFrom}`);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(financeDatedValues).where(and(eq(financeDatedValues.key, parsed.value.key), eq(financeDatedValues.validFrom, parsed.value.validFrom))).run();
    financeAudit(tx, deps, ctx, { action: 'finance.datedValue.remove', entity: 'financeDatedValue', id: `${parsed.value.key}@${parsed.value.validFrom}`, before: { key: before.key, validFrom: before.validFrom, value: JSON.parse(before.value) as DatedValue }, params: { key: parsed.value.key, fromOn: parsed.value.validFrom } });
    return ok({ key: parsed.value.key, validFrom: parsed.value.validFrom });
  });
}

/**
 * Was das Entfernen eines Eintrags an `validFrom` berührt (N11 c, Joe 2026-10-27): die Tage ab `validFrom` bis vor
 * `nextFrom` — dem Tag, ab dem jeder der Schlüssel des Eintrags wieder einen eigenen späteren Wert hat (`null`: keiner,
 * die Lage ändert sich bis heute) — und die festgeschriebenen Buchungen darin. Für sie gilt danach der vorige Stand.
 */
export interface DatedValueRemovalImpact { validFrom: string; nextFrom: string | null; finalizedEntries: number }

/** Ohne Rechteprüfung: `DatedValueRemovalImpact` für die Schlüssel eines Eintrags an `validFrom`. */
export function datedValueRemovalImpactInternal(db: DbOrTx, keys: readonly DatedValueKey[], validFrom: string): DatedValueRemovalImpact {
  let nextFrom: string | null = null;
  for (const key of keys) {
    const shipped = DATED_SERIES[key].series.map((e) => e.validFrom).filter((d) => d > validFrom);
    const own = db.select({ validFrom: financeDatedValues.validFrom }).from(financeDatedValues).where(and(eq(financeDatedValues.key, key), gt(financeDatedValues.validFrom, validFrom))).all().map((r) => r.validFrom);
    const next = [...shipped, ...own].sort()[0];
    // Ohne späteren Wert eines Schlüssels reicht die Lage bis heute.
    if (next === undefined) return { validFrom, nextFrom: null, finalizedEntries: finalizedFrom(db, validFrom, null) };
    if (nextFrom === null || next > nextFrom) nextFrom = next;
  }
  return { validFrom, nextFrom, finalizedEntries: finalizedFrom(db, validFrom, nextFrom) };
}

function finalizedFrom(db: DbOrTx, from: string, before: string | null): number {
  const range = before ? and(gte(financeEntries.entryDate, from), lt(financeEntries.entryDate, before)) : gte(financeEntries.entryDate, from);
  return db.select({ n: count() }).from(financeEntries).where(and(eq(financeEntries.status, 'final'), range)).get()?.n ?? 0;
}

const previewSchema = removeSchema.strict();

/** `finance.setup`: die Vorschau vor `removeDatedValue` — welche festgeschriebenen Buchungen der Eintrag betrifft. */
export async function previewDatedValueRemoval(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DatedValueRemovalImpact>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, previewSchema, input);
  if (!parsed.ok) return parsed;
  const { key, validFrom } = parsed.value;
  const row = deps.db.select({ key: financeDatedValues.key }).from(financeDatedValues).where(and(eq(financeDatedValues.key, key), eq(financeDatedValues.validFrom, validFrom))).get();
  if (!row || !(key in DATED_SERIES)) return notFound('financeDatedValue', `${key}@${validFrom}`);
  return ok(datedValueRemovalImpactInternal(deps.db, [key as DatedValueKey], validFrom));
}

export interface DatedValueListEntry { key: string; unit: (typeof DATED_SERIES)[DatedValueKey]['unit']; entries: { validFrom: string; value: DatedValue; source: 'shipped' | 'override' }[] }

export async function listDatedValues(deps: Deps, ctx: CallContext): Promise<Result<DatedValueListEntry[]>> {
  const denied = requireMasterDataRead(ctx).failure;
  if (denied) return denied;
  const result = (Object.keys(DATED_SERIES) as DatedValueKey[]).map((key) => {
    const shipped = DATED_SERIES[key].series.map((e) => ({ validFrom: e.validFrom, value: e.value as DatedValue, source: 'shipped' as const }));
    const overrides = deps.db.select().from(financeDatedValues).where(eq(financeDatedValues.key, key)).all().map((r) => ({ validFrom: r.validFrom, value: JSON.parse(r.value) as DatedValue, source: 'override' as const }));
    const entries = [...shipped, ...overrides].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    return { key, unit: DATED_SERIES[key].unit, entries };
  });
  return ok(result);
}
