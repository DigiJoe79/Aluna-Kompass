import { expectedVersionField, isoNow, notFound, ok, requirePermission, staleVersion, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { ANNUAL_ACCOUNTS_EXPLANATION_MAX } from '../ledger/codes';
import { financeAnnualAccountsNotes, financeFiscalYears, financeReports } from '../schema';

/**
 * Jahresrechnung (0.4.5): der Erläuterungstext des Vereins je Geschäftsjahr — Markdown, höchstens 4.000 Zeichen,
 * änderbar bis zum Festschreiben, Teil des Daten-Hashs. Davor Arbeitsmaterial: leer löscht die Zeile.
 */
export { ANNUAL_ACCOUNTS_EXPLANATION_MAX };

export interface AnnualAccountsExplanationView {
  fiscalYearId: string;
  text: string;
  updatedAt: string | null;
  updatedByUserId: string | null;
  /** Eine nicht stornierte Jahresrechnung des Jahres ist festgeschrieben — die Erläuterung ändert sich erst nach dem Wiederöffnen. */
  locked: boolean;
}

/** Ohne Rechteprüfung: die Erläuterung eines Jahres oder `null`. */
export function annualAccountsExplanationInternal(db: DbOrTx, fiscalYearId: string): { text: string; updatedAt: string; updatedByUserId: string } | null {
  const row = db.select().from(financeAnnualAccountsNotes).where(eq(financeAnnualAccountsNotes.fiscalYearId, fiscalYearId)).get();
  return row ? { text: row.text, updatedAt: row.updatedAt, updatedByUserId: row.updatedByUserId } : null;
}

function finalAnnualAccounts(db: DbOrTx, fiscalYearId: string): boolean {
  return !!db
    .select({ id: financeReports.id })
    .from(financeReports)
    .where(and(eq(financeReports.reportKey, 'annualAccounts'), eq(financeReports.fiscalYearId, fiscalYearId), isNull(financeReports.voidedAt)))
    .get();
}

function viewOf(db: DbOrTx, fiscalYearId: string): AnnualAccountsExplanationView {
  const row = annualAccountsExplanationInternal(db, fiscalYearId);
  return { fiscalYearId, text: row?.text ?? '', updatedAt: row?.updatedAt ?? null, updatedByUserId: row?.updatedByUserId ?? null, locked: finalAnnualAccounts(db, fiscalYearId) };
}

const getSchema = z.object({ fiscalYearId: z.string().min(1) });

/** `finance.overview` oder `finance.read`: die Erläuterung eines Jahres (leer, wenn keine da ist). */
export async function getAnnualAccountsExplanation(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AnnualAccountsExplanationView>> {
  const denied = requireFinanceRead(ctx, 'overview');
  if (denied) return denied;
  const parsed = validate(deps, getSchema, input);
  if (!parsed.ok) return parsed;
  if (!deps.db.select({ id: financeFiscalYears.id }).from(financeFiscalYears).where(eq(financeFiscalYears.id, parsed.value.fiscalYearId)).get()) return notFound('financeFiscalYear', parsed.value.fiscalYearId);
  return ok(viewOf(deps.db, parsed.value.fiscalYearId));
}

export const annualAccountsExplanationSaveSchema = z.object({
  fiscalYearId: z.string().min(1),
  text: z.string().trim().max(ANNUAL_ACCOUNTS_EXPLANATION_MAX),
  /** Stand beim Öffnen; `null` heißt „es gab noch keine Erläuterung“ — dann ist eine inzwischen gespeicherte ein Konflikt. */
  expectedVersion: expectedVersionField.nullable(),
});

/**
 * `finance.reportsFinalize`: die Erläuterung setzen; leer löscht sie. Abgelehnt, solange eine nicht stornierte
 * Jahresrechnung des Jahres besteht. Das Protokoll trägt Jahr und Länge, nie den Text.
 */
export async function saveAnnualAccountsExplanation(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AnnualAccountsExplanationView>> {
  const denied = requirePermission(ctx, 'finance.reportsFinalize');
  if (denied) return denied;
  const parsed = validate(deps, annualAccountsExplanationSaveSchema, input);
  if (!parsed.ok) return parsed;
  const { fiscalYearId, text, expectedVersion } = parsed.value;
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, fiscalYearId)).get();
  if (!year) return notFound('financeFiscalYear', fiscalYearId);
  if (finalAnnualAccounts(deps.db, fiscalYearId)) return financeConflict('annualAccountsExplanationLocked', { designation: year.designation });
  const before = annualAccountsExplanationInternal(deps.db, fiscalYearId);
  // Review U1: Zwei Tabs, die beide leer begannen (`null`), oder ein Stand, dessen Erläuterung inzwischen geleert wurde,
  // überschreiben nicht still.
  if (before) {
    const stale = staleVersion(expectedVersion ?? (expectedVersion === null ? '' : undefined), before.updatedAt);
    if (stale) return stale;
  } else if (typeof expectedVersion === 'string') {
    const stale = staleVersion(expectedVersion, '');
    if (stale) return stale;
  }
  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const by = ctx.userId ?? 'system';
    if (text === '') tx.delete(financeAnnualAccountsNotes).where(eq(financeAnnualAccountsNotes.fiscalYearId, fiscalYearId)).run();
    else if (before) tx.update(financeAnnualAccountsNotes).set({ text, updatedAt: now, updatedByUserId: by }).where(eq(financeAnnualAccountsNotes.fiscalYearId, fiscalYearId)).run();
    else tx.insert(financeAnnualAccountsNotes).values({ fiscalYearId, text, updatedAt: now, updatedByUserId: by }).run();
    financeAudit(tx, deps, ctx, {
      action: 'finance.annualAccounts.explanationSave',
      entity: 'financeAnnualAccountsNote',
      id: fiscalYearId,
      before: { length: before?.text.length ?? 0 },
      after: { length: text.length },
      params: { designation: year.designation, length: text.length },
    });
    return ok(viewOf(tx, fiscalYearId));
  });
}
