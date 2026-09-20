import { invalid, isoNow, notFound, ok, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeDatedValues } from '../schema';
import { requireFinanceRead } from './access';
import { DATED_SERIES, type DatedValueKey } from './dated-series';

type DatedValue = number | string;

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

function valueIssue(unit: (typeof DATED_SERIES)[DatedValueKey]['unit'], value: unknown): string | null {
  if (unit === 'taxation') return value === 'smallBusiness' || value === 'regular' ? null : 'invalidDatedValue';
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return 'invalidDatedValue';
  if (unit === 'percent' && value > 100) return 'invalidDatedValue';
  return null;
}

const setSchema = z.object({ key: z.string().min(1), validFrom: z.string().date(), value: z.union([z.number(), z.string()]) });

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
    const now = isoNow(deps.clock);
    const value = parsed.value.value;
    tx.insert(financeDatedValues)
      .values({ key, validFrom: parsed.value.validFrom, value: JSON.stringify(value), updatedAt: now, updatedByUserId: ctx.userId })
      .onConflictDoUpdate({ target: [financeDatedValues.key, financeDatedValues.validFrom], set: { value: JSON.stringify(value), updatedAt: now, updatedByUserId: ctx.userId } })
      .run();
    financeAudit(tx, deps, ctx, { action: 'finance.datedValue.set', entity: 'financeDatedValue', id: `${key}@${parsed.value.validFrom}`, after: { key, validFrom: parsed.value.validFrom, value }, summary: `Datierter Wert ${key}@${parsed.value.validFrom} gesetzt` });
    return ok({ key, validFrom: parsed.value.validFrom, value });
  });
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
    financeAudit(tx, deps, ctx, { action: 'finance.datedValue.remove', entity: 'financeDatedValue', id: `${parsed.value.key}@${parsed.value.validFrom}`, before: { key: before.key, validFrom: before.validFrom, value: JSON.parse(before.value) as DatedValue }, summary: `Datierter Wert ${parsed.value.key}@${parsed.value.validFrom} entfernt` });
    return ok({ key: parsed.value.key, validFrom: parsed.value.validFrom });
  });
}

export interface DatedValueListEntry { key: string; unit: (typeof DATED_SERIES)[DatedValueKey]['unit']; entries: { validFrom: string; value: DatedValue; source: 'shipped' | 'override' }[] }

export async function listDatedValues(deps: Deps, ctx: CallContext): Promise<Result<DatedValueListEntry[]>> {
  const denied = requireFinanceRead(ctx, 'overview');
  if (denied) return denied;
  const result = (Object.keys(DATED_SERIES) as DatedValueKey[]).map((key) => {
    const shipped = DATED_SERIES[key].series.map((e) => ({ validFrom: e.validFrom, value: e.value as DatedValue, source: 'shipped' as const }));
    const overrides = deps.db.select().from(financeDatedValues).where(eq(financeDatedValues.key, key)).all().map((r) => ({ validFrom: r.validFrom, value: JSON.parse(r.value) as DatedValue, source: 'override' as const }));
    const entries = [...shipped, ...overrides].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    return { key, unit: DATED_SERIES[key].unit, entries };
  });
  return ok(result);
}
