import { ok, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { and, asc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { requireFinanceRead } from '../ledger/access';
import { SPHERES } from '../ledger/codes';
import { financeAllocationLines, financeCategories, financeEntries, financeFiscalYears, financeMoneyLines } from '../schema';
import type { ReportLinesFilter } from './types';

/** Eine Zuordnungszeile, wie ein Agent sie zu einer Berichtssumme holt (Spec § A, Finanz-Spec § 9.1). */
export interface FinanceLineView {
  lineId: string;
  entryId: string;
  entryNumber: string | null;
  entryDate: string;
  categoryId: string;
  sphere: string | null;
  direction: 'income' | 'expense' | 'transit';
  /** Vorzeichen wie gebucht: Ausgaben negativ. */
  amountCents: number;
  projectId: string | null;
  purposeId: string | null;
  contactName: string | null;
}

export const financeLinesSchema = z.object({
  fiscalYearId: z.string().min(1).optional(),
  sphere: z.enum(SPHERES).optional(),
  direction: z.enum(['income', 'expense']).optional(),
  categoryId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  purposeId: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  /** Wie `finance_balances`: geprüfte Entwürfe zählen mit; ein ungeprüfter Entwurf nie. */
  includeReviewedDrafts: z.boolean().optional(),
  /** Nur Zeilen mit bzw. ohne „Zuführung zum Vermögen“ (§ 62 Abs. 3 AO). */
  addsToAssets: z.boolean().optional(),
  /** Nur Zeilen mit bzw. ohne erhaltene Vermögensausstattung (§ 58 Nr. 3 AO). */
  assetEndowment: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

function conditionsOf(filter: ReportLinesFilter): SQL[] {
  const where: SQL[] = [
    filter.includeReviewedDrafts
      ? sql`(${financeEntries.status} = 'final' or (${financeEntries.status} = 'draft' and ${financeEntries.reviewedAt} is not null))`
      : eq(financeEntries.status, 'final'),
  ];
  // Über die Tage des Jahres, nicht `fiscal_year_id`: Ein Entwurf bekommt sein Jahr erst beim Festschreiben.
  if (filter.fiscalYearId) where.push(sql`exists (select 1 from ${financeFiscalYears} where ${financeFiscalYears.id} = ${filter.fiscalYearId} and ${financeEntries.entryDate} between ${financeFiscalYears.startsOn} and ${financeFiscalYears.endsOn})`);
  if (filter.sphere) where.push(eq(financeCategories.sphere, filter.sphere as (typeof SPHERES)[number]));
  if (filter.direction) where.push(eq(financeCategories.direction, filter.direction));
  if (filter.categoryId) where.push(eq(financeAllocationLines.categoryId, filter.categoryId));
  if (filter.projectId) where.push(eq(financeAllocationLines.projectId, filter.projectId));
  if (filter.purposeId) where.push(eq(financeAllocationLines.purposeId, filter.purposeId));
  if (filter.from) where.push(gte(financeEntries.entryDate, filter.from));
  if (filter.to) where.push(lte(financeEntries.entryDate, filter.to));
  if (filter.addsToAssets !== undefined) where.push(eq(financeAllocationLines.addsToAssets, filter.addsToAssets));
  if (filter.assetEndowment !== undefined) where.push(eq(financeAllocationLines.assetEndowment, filter.assetEndowment));
  if (filter.accountId) where.push(sql`exists (select 1 from ${financeMoneyLines} where ${financeMoneyLines.entryId} = ${financeEntries.id} and ${financeMoneyLines.accountId} = ${filter.accountId})`);
  return where;
}

/** Anzahl und Summe der Zeilen zu einem Filter — ohne Rechteprüfung, für `runFinanceReport` je Summe. */
export function countFinanceLinesInternal(db: DbOrTx, filter: ReportLinesFilter): { total: number; sumCents: number } {
  const row = db
    .select({ total: sql<number>`count(*)`, sumCents: sql<number>`coalesce(sum(${financeAllocationLines.amountCents}), 0)` })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
    .innerJoin(financeCategories, eq(financeCategories.id, financeAllocationLines.categoryId))
    .where(and(...conditionsOf(filter)))
    .get();
  return { total: row?.total ?? 0, sumCents: row?.sumCents ?? 0 };
}

/**
 * Die Zeilen hinter einer Summe — Zuordnungszeilen statt Buchungen, mit denselben Filtern wie die Berichte (Sphäre,
 * Richtung, Kategorie, Projekt, Zweck, Konto, Zeitraum). `finance.read`: Zeilen tragen Kontaktnamen. Älteste
 * zuerst; `total` und `sumCents` über alle Treffer, nicht nur die Seite.
 */
export async function listFinanceLines(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ lines: FinanceLineView[]; total: number; sumCents: number }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, financeLinesSchema, input);
  if (!parsed.ok) return parsed;
  const { limit, offset, ...filter } = parsed.value;
  const { total, sumCents } = countFinanceLinesInternal(deps.db, filter);
  const rows = deps.db
    .select({
      lineId: financeAllocationLines.id,
      entryId: financeEntries.id,
      entryNumber: financeEntries.number,
      entryDate: financeEntries.entryDate,
      categoryId: financeAllocationLines.categoryId,
      sphere: financeCategories.sphere,
      direction: financeCategories.direction,
      amountCents: financeAllocationLines.amountCents,
      projectId: financeAllocationLines.projectId,
      purposeId: financeAllocationLines.purposeId,
      contactId: financeAllocationLines.contactId,
    })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
    .innerJoin(financeCategories, eq(financeCategories.id, financeAllocationLines.categoryId))
    .where(and(...conditionsOf(filter)))
    .orderBy(asc(financeEntries.entryDate), asc(financeEntries.number), asc(financeAllocationLines.position))
    .limit(limit)
    .offset(offset)
    .all();
  const contactIds = [...new Set(rows.map((r) => r.contactId).filter((id): id is string => id !== null))];
  const names = new Map(contactIds.length > 0 ? deps.db.select().from(contacts).where(inArray(contacts.id, contactIds)).all().map((c) => [c.id, displayName(c)] as const) : []);
  const lines = rows.map(({ contactId, ...r }) => ({ ...r, direction: r.direction as FinanceLineView['direction'], contactName: contactId ? (names.get(contactId) ?? null) : null }));
  return ok({ lines, total, sumCents });
}
