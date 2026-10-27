import { hasPermission, notFound, ok, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { and, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import { z } from 'zod';
import { requireFinanceRead } from '../ledger/access';
import { allowanceCapCents, allowanceTotalCents, type AllowanceKind } from '../ledger/allowances';
import { valueAt } from '../ledger/dated-values';
import { taxContextAt } from '../ledger/tax';
import { turnoverLinesInternal as linesOf, turnoverOf } from '../ledger/turnover';
import { annualRevenueForGemInternal, operationsResultInternal, operationsRevenueInternal } from '../reporting/revenue';
import { financeAllocationLines, financeCategories, financeEntries, financeFiscalYears, type FinanceFiscalYearRow } from '../schema';

/**
 * Rechenschaft C Schwellenwächter (Spec § C, Finanz-Spec § 9.5): je Schwelle Wert, datierte Grenze am Jahresende und
 * Zustand — ruhig, nähert sich (ab `warnAtPercent`), überschritten. Live gerechnet (Prinzip 5).
 */
export type ThresholdKey = 'timelyUse' | 'business' | 'businessCombined' | 'smallBusinessPrevYear' | 'smallBusinessCurrent' | 'allowanceVolunteer' | 'allowanceTrainer' | 'simplifiedReceipt';
export type ThresholdState = 'quiet' | 'approaching' | 'exceeded' | 'noObligation' | 'notApplicable' | 'notModelled' | 'info';
export interface ThresholdView {
  key: ThresholdKey;
  state: ThresholdState;
  valueCents: number | null;
  limitCents: number | null;
  notes: string[];
  person: { contactId: string; name: string } | null;
}

const cents = (db: DbOrTx, key: Parameters<typeof valueAt>[1], date: string): number | null => {
  const v = valueAt(db, key, date);
  return v === null ? null : Number(v);
};


function stateOf(value: number, limit: number, warnPercent: number, below: ThresholdState = 'quiet'): ThresholdState {
  if (value > limit) return 'exceeded';
  return value * 100 >= limit * warnPercent ? 'approaching' : below;
}

const view = (key: ThresholdKey, state: ThresholdState, valueCents: number | null, limitCents: number | null, notes: string[] = [], person: ThresholdView['person'] = null): ThresholdView => ({ key, state, valueCents, limitCents, notes, person });

function allowanceView(db: DbOrTx, ctx: CallContext, year: FinanceFiscalYearRow, kind: AllowanceKind, warn: number): ThresholdView {
  const key = kind === 'volunteer' ? 'allowanceVolunteer' : 'allowanceTrainer';
  const calendarYear = Number(year.endsOn.slice(0, 4));
  const limit = allowanceCapCents(db, kind, calendarYear);
  const persons = [
    ...new Set(
      db
        .select({ contactId: financeAllocationLines.contactId })
        .from(financeAllocationLines)
        .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
        .innerJoin(financeCategories, eq(financeCategories.id, financeAllocationLines.categoryId))
        .where(and(eq(financeEntries.status, 'final'), ne(financeCategories.allowanceKind, 'none'), eq(financeCategories.allowanceKind, kind), gte(financeEntries.entryDate, `${calendarYear}-01-01`), lte(financeEntries.entryDate, `${calendarYear}-12-31`)))
        .all()
        .map((r) => r.contactId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const totals = persons.map((contactId) => ({ contactId, cents: allowanceTotalCents(db, contactId, kind, calendarYear) })).sort((a, b) => b.cents - a.cents);
  const top = totals[0];
  if (!limit) return view(key, 'notApplicable', top?.cents ?? 0, null);
  // Namen nur mit `finance.read` (Spec § C, Kacheln unter `finance.overview` ohne Namen).
  const contact = top && hasPermission(ctx, 'finance.read') ? db.select().from(contacts).where(inArray(contacts.id, [top.contactId])).get() : undefined;
  return view(key, stateOf(top?.cents ?? 0, limit, warn), top?.cents ?? 0, limit, [], contact ? { contactId: contact.id, name: displayName(contact) } : null);
}

/** Die Schwellen eines Jahres, ohne Rechteprüfung — für Kachel und Fristen. `ctx` entscheidet nur, ob Namen erscheinen. */
export function thresholdsInternal(deps: Deps, ctx: CallContext, year: FinanceFiscalYearRow): ThresholdView[] {
  const db = deps.db;
  const end = year.endsOn;
  const warn = cents(db, 'warnAtPercent', end) ?? 80;
  const lines = linesOf(db, year);
  const out: ThresholdView[] = [];

  const timelyLimit = cents(db, 'thresholdTimelyUse', end);
  const revenue = annualRevenueForGemInternal(db, year.id).totalCents;
  out.push(timelyLimit === null ? view('timelyUse', 'notApplicable', revenue, null) : view('timelyUse', stateOf(revenue, timelyLimit, warn, 'noObligation'), revenue, timelyLimit));

  const businessLimit = cents(db, 'thresholdBusiness', end);
  const business = operationsRevenueInternal(db, year.id, ['business']);
  out.push(businessLimit === null ? view('business', 'notApplicable', business, null) : view('business', stateOf(business, businessLimit, warn), business, businessLimit));

  const combinedLimit = cents(db, 'thresholdAllBusinessCombined', end);
  const combined = operationsRevenueInternal(db, year.id, ['business', 'purposeOperation']);
  // „Insgesamt ein Gewinn“ aus derselben Rechnung wie der Hinweis der Steuererklärung (E6a, § 64 Abs. 3 S. 2 AO).
  const result = operationsResultInternal(db, { from: year.startsOn, to: year.endsOn });
  out.push(combinedLimit === null ? view('businessCombined', 'notApplicable', combined, null) : view('businessCombined', stateOf(combined, combinedLimit, warn), combined, combinedLimit, [result > 0 ? 'resultPositive' : 'resultNotPositive']));

  // § 19 UStG: vor 2025 eine andere Rechenweise — nicht abgebildet; unter Regelbesteuerung am Jahresende ohne Bedeutung.
  // E6a (Joe-Frage 2, C1 6a): Umsatz je Kalenderjahr — das Kalenderjahr, in dem das Geschäftsjahr beginnt, und sein
  // Vorjahr; bei kalendergleichem Geschäftsjahr dasselbe wie bisher.
  const calendarYear = Number(year.startsOn.slice(0, 4));
  const calendar = (y: number) => ({ startsOn: `${y}-01-01`, endsOn: `${y}-12-31` });
  const prevLimit = cents(db, 'smallBusinessPrevYear', end);
  const currentLimit = cents(db, 'smallBusinessCurrentYear', end);
  const regular = taxContextAt(db, end)?.taxation === 'regular';
  const current = turnoverOf(db, linesOf(db, calendar(calendarYear)));
  if (prevLimit === null || currentLimit === null) {
    out.push(view('smallBusinessPrevYear', 'notModelled', null, null), view('smallBusinessCurrent', 'notModelled', null, null));
  } else if (regular) {
    out.push(view('smallBusinessPrevYear', 'notApplicable', null, prevLimit), view('smallBusinessCurrent', 'notApplicable', current, currentLimit));
  } else {
    const first = db.select({ startsOn: financeFiscalYears.startsOn }).from(financeFiscalYears).orderBy(financeFiscalYears.startsOn).get();
    const prev = calendar(calendarYear - 1);
    if (!first || first.startsOn > prev.endsOn) out.push(view('smallBusinessPrevYear', stateOf(current, prevLimit, warn), current, prevLimit, ['noPreviousYear']));
    else {
      const prevTurnover = turnoverOf(db, linesOf(db, prev));
      // Das Vorjahr liegt nur zum Teil in Kompass (erstes Geschäftsjahr beginnt im Jahr): ohne Hochrechnung (seit 2025).
      out.push(view('smallBusinessPrevYear', stateOf(prevTurnover, prevLimit, warn), prevTurnover, prevLimit, first.startsOn > prev.startsOn ? ['shortYearNotAnnualised'] : []));
    }
    out.push(view('smallBusinessCurrent', stateOf(current, currentLimit, warn), current, currentLimit));
  }

  out.push(allowanceView(db, ctx, year, 'volunteer', warn), allowanceView(db, ctx, year, 'trainer', warn));
  out.push(view('simplifiedReceipt', 'info', null, cents(db, 'simplifiedReceiptLimit', end)));
  return out;
}

const schema = z.object({ fiscalYearId: z.string().min(1) });

/** `finance.overview`: die Schwellen eines Geschäftsjahres; die Person einer Pauschale nur mit `finance.read`. */
export async function getThresholds(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ThresholdView[]>> {
  const denied = requireFinanceRead(ctx, 'overview');
  if (denied) return denied;
  const parsed = validate(deps, schema, input);
  if (!parsed.ok) return parsed;
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, parsed.value.fiscalYearId)).get();
  if (!year) return notFound('financeFiscalYear', parsed.value.fiscalYearId);
  return ok(thresholdsInternal(deps, ctx, year));
}
