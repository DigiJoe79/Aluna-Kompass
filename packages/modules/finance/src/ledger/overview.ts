import { isoNow, ok, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { requireFinanceRead } from './access';
import { fiscalYearStatusInternal } from './fiscal-years';
import { accountBalancesAt, assetOverviewAt, incomeStatement, purposeBalancesAt, standing, type AssetOverview, type IncomeStatement, type Standing } from './queries';
import { financeAccounts, financeCategories, financeFiscalYears, financePurposes } from '../schema';

export interface BalancesView {
  date: string;
  accounts: { accountId: string; name: string; kind: 'bank' | 'cash' | 'paymentService'; balanceCents: number; withReviewedCents: number }[];
  purposes: { purposeId: string; name: string; balanceCents: number; targetCents: number | null; negative: boolean; fulfilledWithRest: boolean }[];
  assets: AssetOverview;
  standing: Standing;
}

const balancesSchema = z.object({ date: z.string().date().optional() });

/**
 * Bestände (Spec 9.7, 10.5): Konten, Zwecke, Vermögensübersicht und Stand —
 * Stufe `overview`, **ohne Personenbezug**: keine IBAN, keine
 * Zweckbeschreibung, keine Kontakte. Warnungen, nie Sperren (Spec 5.6).
 */
export async function getBalances(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<BalancesView>> {
  const denied = requireFinanceRead(ctx, 'overview');
  if (denied) return denied;
  const parsed = validate(deps, balancesSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const date = parsed.value.date ?? isoNow(deps.clock).slice(0, 10);

  const accountRows = deps.db.select().from(financeAccounts).all();
  const accountNames = new Map(accountRows.map((a) => [a.id, a.name]));
  const withReviewedByAccount = new Map(accountBalancesAt(deps.db, date, { includeReviewedDrafts: true }).map((a) => [a.accountId, a.balanceCents]));
  const accounts = accountBalancesAt(deps.db, date).map((a) => ({ accountId: a.accountId, name: accountNames.get(a.accountId) ?? '', kind: a.kind, balanceCents: a.balanceCents, withReviewedCents: withReviewedByAccount.get(a.accountId) ?? a.balanceCents }));

  const purposeRows = deps.db.select().from(financePurposes).all();
  const purposeInfo = new Map(purposeRows.map((p) => [p.id, p]));
  const purposes = purposeBalancesAt(deps.db, date).map((p) => {
    const row = purposeInfo.get(p.purposeId);
    return {
      purposeId: p.purposeId,
      name: row?.name ?? '',
      balanceCents: p.balanceCents,
      targetCents: row?.targetCents ?? null,
      negative: p.balanceCents < 0,
      fulfilledWithRest: row?.fulfilledAt !== null && row?.fulfilledAt !== undefined && p.balanceCents > 0,
    };
  });

  return ok({ date, accounts, purposes, assets: assetOverviewAt(deps.db, date), standing: standing(deps.db) });
}

const incomeStatementSchema = z
  .object({ fiscalYearId: z.string().min(1).optional(), from: z.string().date().optional(), to: z.string().date().optional() })
  .superRefine((v, c) => {
    const hasYear = v.fiscalYearId !== undefined;
    const hasPeriod = v.from !== undefined && v.to !== undefined;
    const hasPartialPeriod = (v.from !== undefined) !== (v.to !== undefined);
    if (hasPartialPeriod) c.addIssue({ code: 'custom', path: ['to'], message: 'periodNeedsBothDates' });
    else if (hasYear === hasPeriod) c.addIssue({ code: 'custom', path: ['fiscalYearId'], message: 'fiscalYearOrPeriod' });
  });

/**
 * EÜR (Spec 9.2, 9.7) — Stufe `overview`, ohne Personenbezug. `preliminary`:
 * das Jahr ist offen (Wasserzeichen, Spec 9.1). Nimmt ein Geschäftsjahr oder
 * einen Zeitraum, nie beides und nie keines.
 */
export async function getIncomeStatement(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<IncomeStatement & { preliminary: boolean; categoryNames: Record<string, string> }>> {
  const denied = requireFinanceRead(ctx, 'overview');
  if (denied) return denied;
  const parsed = validate(deps, incomeStatementSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  let from: string;
  let to: string;
  let preliminary: boolean;
  if (v.fiscalYearId) {
    const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, v.fiscalYearId)).get();
    if (!year) return ok({ spheres: [], transit: [], totalIncomeCents: 0, totalExpenseCents: 0, resultCents: 0, preliminary: false, categoryNames: {} });
    from = year.startsOn;
    to = year.endsOn;
    preliminary = fiscalYearStatusInternal(deps.db, year.id) === 'open';
  } else {
    from = v.from!;
    to = v.to!;
    preliminary = true;
  }

  const statement = incomeStatement(deps.db, { from, to });
  const categoryIds = [...new Set<string>([...statement.spheres.flatMap((s) => s.categories.map((c) => c.categoryId)), ...statement.transit.map((c) => c.categoryId)])];
  const categoryNames: Record<string, string> = {};
  if (categoryIds.length > 0) {
    for (const row of deps.db.select({ id: financeCategories.id, name: financeCategories.name }).from(financeCategories).where(inArray(financeCategories.id, categoryIds)).all()) {
      categoryNames[row.id] = row.name;
    }
  }
  return ok({ ...statement, preliminary, categoryNames });
}
