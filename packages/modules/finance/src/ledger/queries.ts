import type { DbOrTx } from '@kompass/core';
import { and, eq, lte, sql } from 'drizzle-orm';
import { openItemsAtInternal } from './open-items';
import { financeAccounts, financeAllocationLines, financeCategories, financeEntries, financeMoneyLines, financePurposes } from '../schema';

export type AccountKind = 'bank' | 'cash' | 'paymentService';
export type Sphere = 'ideal' | 'assetManagement' | 'purposeOperation' | 'business';

export interface AccountBalance {
  accountId: string;
  kind: AccountKind;
  balanceCents: number;
}

export interface IncomeStatementCategory {
  categoryId: string;
  key: string;
  direction: 'income' | 'expense';
  sumCents: number;
  lineCount: number;
}

export interface IncomeStatementSphere {
  sphere: Sphere;
  incomeCents: number;
  expenseCents: number;
  resultCents: number;
  categories: IncomeStatementCategory[];
}

export interface IncomeStatement {
  spheres: IncomeStatementSphere[];
  transit: { categoryId: string; key: string; sumCents: number; lineCount: number }[];
  totalIncomeCents: number;
  totalExpenseCents: number;
  resultCents: number;
}

export interface PurposeBalance {
  purposeId: string;
  carryForwardCents: number;
  inflowCents: number;
  outflowCents: number;
  balanceCents: number;
}

export interface ProjectBalance {
  projectId: string;
  incomeCents: number;
  expenseCents: number;
  resultCents: number;
}

export interface AssetOverview {
  accounts: { accountId: string; balanceCents: number }[];
  receivablesCents: number;
  payablesCents: number;
  netAssetsCents: number;
  earmarkedCents: number;
  freeCents: number;
}

export interface Standing {
  finalizedThrough: string | null;
  draftCount: number;
  reviewedDraftCount: number;
}

/**
 * Kontostand am Stichtag: Anfangsbestand (ab seinem Stichtag) + Σ Geldzeilen
 * festgeschriebener Buchungen mit Datum ≤ Stichtag. Reine Abfrage, ohne
 * Rechteprüfung — für F2c und ihre Verbraucher (`getBalances`,
 * Vermögensübersicht, Kassenprüfung). `includeReviewedDrafts`: zählt zusätzlich
 * Entwürfe mit `reviewedAt` — für die vorläufige Summe „einschließlich
 * geprüfter Entwürfe“ (F3a); ein Entwurf ohne Prüfung zählt nie mit.
 */
export function accountBalancesAt(db: DbOrTx, date: string, opts: { includeReviewedDrafts?: boolean } = {}): AccountBalance[] {
  const accounts = db.select().from(financeAccounts).all();
  const statusCondition = opts.includeReviewedDrafts
    ? sql`(${financeEntries.status} = 'final' or (${financeEntries.status} = 'draft' and ${financeEntries.reviewedAt} is not null))`
    : eq(financeEntries.status, 'final');
  const sums = db
    .select({ accountId: financeMoneyLines.accountId, sumCents: sql<number>`coalesce(sum(${financeMoneyLines.amountCents}), 0)` })
    .from(financeMoneyLines)
    .innerJoin(financeEntries, eq(financeMoneyLines.entryId, financeEntries.id))
    .where(and(statusCondition, lte(financeEntries.entryDate, date)))
    .groupBy(financeMoneyLines.accountId)
    .all();
  const sumByAccount = new Map(sums.map((s) => [s.accountId, s.sumCents]));
  return accounts.map((a) => ({
    accountId: a.id,
    kind: a.kind as AccountKind,
    balanceCents: (a.openingBalanceCents !== null && a.openingDate !== null && a.openingDate <= date ? a.openingBalanceCents : 0) + (sumByAccount.get(a.id) ?? 0),
  }));
}

/**
 * EÜR nach Sphären, im Zeitraum `[from, to]` (beide eingeschlossen). Nur
 * Zuordnungszeilen festgeschriebener Buchungen — Geldzeilen kommen hier nicht
 * vor (Prüfstein 1). `transit` steht getrennt und geht in kein Ergebnis ein.
 */
export function incomeStatement(db: DbOrTx, range: { from: string; to: string }): IncomeStatement {
  const rows = db
    .select({
      categoryId: financeAllocationLines.categoryId,
      key: financeCategories.key,
      direction: financeCategories.direction,
      sphere: financeCategories.sphere,
      sumCents: sql<number>`coalesce(sum(${financeAllocationLines.amountCents}), 0)`,
      lineCount: sql<number>`count(*)`,
    })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
    .innerJoin(financeCategories, eq(financeAllocationLines.categoryId, financeCategories.id))
    .where(and(eq(financeEntries.status, 'final'), sql`${financeEntries.entryDate} >= ${range.from} and ${financeEntries.entryDate} <= ${range.to}`))
    .groupBy(financeAllocationLines.categoryId)
    .all();

  const transit = rows.filter((r) => r.direction === 'transit').map((r) => ({ categoryId: r.categoryId, key: r.key, sumCents: r.sumCents, lineCount: r.lineCount }));

  const spheresByKey = new Map<Sphere, IncomeStatementSphere>();
  for (const row of rows) {
    if (row.direction === 'transit' || !row.sphere) continue;
    const direction = row.direction as 'income' | 'expense';
    const sphere = row.sphere as Sphere;
    let entry = spheresByKey.get(sphere);
    if (!entry) {
      entry = { sphere, incomeCents: 0, expenseCents: 0, resultCents: 0, categories: [] };
      spheresByKey.set(sphere, entry);
    }
    entry.categories.push({ categoryId: row.categoryId, key: row.key, direction, sumCents: row.sumCents, lineCount: row.lineCount });
    if (direction === 'income') entry.incomeCents += row.sumCents;
    else entry.expenseCents += -row.sumCents;
  }
  const spheres = [...spheresByKey.values()].map((s) => ({ ...s, resultCents: s.incomeCents - s.expenseCents }));

  const totalIncomeCents = spheres.reduce((sum, s) => sum + s.incomeCents, 0);
  const totalExpenseCents = spheres.reduce((sum, s) => sum + s.expenseCents, 0);
  return { spheres, transit, totalIncomeCents, totalExpenseCents, resultCents: totalIncomeCents - totalExpenseCents };
}

/**
 * Zweckbestand je Zweck am Stichtag: Vortrag (ab seinem Stichtag) + Σ Zeilen
 * mit diesem Zweck. Alle Zwecke, auch ohne je eine Zeile gesehen zu haben —
 * die Vermögensübersicht summiert über alle positiven Bestände.
 */
export function purposeBalancesAt(db: DbOrTx, date: string): PurposeBalance[] {
  const purposes = db.select().from(financePurposes).all();
  const sums = db
    .select({
      purposeId: financeAllocationLines.purposeId,
      inflowCents: sql<number>`coalesce(sum(case when ${financeAllocationLines.amountCents} > 0 then ${financeAllocationLines.amountCents} else 0 end), 0)`,
      outflowCents: sql<number>`coalesce(sum(case when ${financeAllocationLines.amountCents} < 0 then -${financeAllocationLines.amountCents} else 0 end), 0)`,
    })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
    .where(and(eq(financeEntries.status, 'final'), lte(financeEntries.entryDate, date)))
    .groupBy(financeAllocationLines.purposeId)
    .all();
  const byPurpose = new Map(sums.filter((s) => s.purposeId !== null).map((s) => [s.purposeId as string, s]));

  return purposes.map((p) => {
    const carryForwardCents = p.carryForwardCents !== null && p.carryForwardDate !== null && p.carryForwardDate <= date ? p.carryForwardCents : 0;
    const line = byPurpose.get(p.id);
    const inflowCents = line?.inflowCents ?? 0;
    const outflowCents = line?.outflowCents ?? 0;
    return { purposeId: p.id, carryForwardCents, inflowCents, outflowCents, balanceCents: carryForwardCents + inflowCents - outflowCents };
  });
}

/** Projektsaldo im Zeitraum — nur Projekte, auf die eine festgeschriebene Zeile zeigt. */
export function projectBalances(db: DbOrTx, range: { from?: string; to?: string } = {}): ProjectBalance[] {
  const conditions = [eq(financeEntries.status, 'final'), sql`${financeAllocationLines.projectId} is not null`];
  if (range.from) conditions.push(sql`${financeEntries.entryDate} >= ${range.from}`);
  if (range.to) conditions.push(sql`${financeEntries.entryDate} <= ${range.to}`);

  const rows = db
    .select({
      projectId: financeAllocationLines.projectId,
      incomeCents: sql<number>`coalesce(sum(case when ${financeAllocationLines.amountCents} > 0 then ${financeAllocationLines.amountCents} else 0 end), 0)`,
      expenseCents: sql<number>`coalesce(sum(case when ${financeAllocationLines.amountCents} < 0 then -${financeAllocationLines.amountCents} else 0 end), 0)`,
    })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
    .where(and(...conditions))
    .groupBy(financeAllocationLines.projectId)
    .all();

  return rows.map((r) => ({ projectId: r.projectId as string, incomeCents: r.incomeCents, expenseCents: r.expenseCents, resultCents: r.incomeCents - r.expenseCents }));
}

/**
 * Vermögensübersicht am Stichtag: Konten + Forderungen − Verbindlichkeiten =
 * Reinvermögen; zweckgebunden = Σ der positiven Zweckbestände (ein Zweck im
 * Minus bindet nichts); frei = Rest.
 */
export function assetOverviewAt(db: DbOrTx, date: string): AssetOverview {
  const accounts = accountBalancesAt(db, date).map((a) => ({ accountId: a.accountId, balanceCents: a.balanceCents }));
  const accountsTotal = accounts.reduce((sum, a) => sum + a.balanceCents, 0);

  const openItems = openItemsAtInternal(db, date);
  const receivablesCents = openItems.filter((i) => i.kind === 'receivable').reduce((sum, i) => sum + i.openCents, 0);
  const payablesCents = openItems.filter((i) => i.kind === 'payable').reduce((sum, i) => sum + i.openCents, 0);
  const netAssetsCents = accountsTotal + receivablesCents - payablesCents;

  const earmarkedCents = purposeBalancesAt(db, date)
    .filter((p) => p.balanceCents > 0)
    .reduce((sum, p) => sum + p.balanceCents, 0);

  return { accounts, receivablesCents, payablesCents, netAssetsCents, earmarkedCents, freeCents: netAssetsCents - earmarkedCents };
}

/** Festgeschrieben bis …; N Buchungen offen — für alle Standanzeigen (Spec 5.4). */
export function standing(db: DbOrTx): Standing {
  const finalized = db.select({ max: sql<string | null>`max(${financeEntries.entryDate})` }).from(financeEntries).where(eq(financeEntries.status, 'final')).get();
  const drafts = db.select({ count: sql<number>`count(*)` }).from(financeEntries).where(eq(financeEntries.status, 'draft')).get();
  const reviewedDrafts = db
    .select({ count: sql<number>`count(*)` })
    .from(financeEntries)
    .where(and(eq(financeEntries.status, 'draft'), sql`${financeEntries.reviewedAt} is not null`))
    .get();
  return { finalizedThrough: finalized?.max ?? null, draftCount: drafts?.count ?? 0, reviewedDraftCount: reviewedDrafts?.count ?? 0 };
}
