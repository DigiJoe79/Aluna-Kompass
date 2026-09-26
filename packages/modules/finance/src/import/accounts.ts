import { isoNow, ok, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { or, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireFinanceRead } from '../ledger/access';
import { financeAccounts } from '../schema';
import { importedThroughInternal, reconcileBankInternal, type BankReconciliation } from './queries';

/** Ganze Tage zwischen zwei Datumsangaben (`YYYY-MM-DD`) — wie `dashboard.ts`, hier für die Kontokarte (Task 7). */
function daysBetween(today: string, date: string): number {
  return Math.round((Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${date}T00:00:00.000Z`)) / 86_400_000);
}

export interface AccountStatementView {
  accountId: string;
  importedThrough: string | null;
  lastStatementDaysAgo: number | null;
  /** Befund 5: der letzte Auszug reicht über den Stichtag hinaus — die Karte sagt das, statt „vor 0 Tagen“. */
  lastStatementInFuture: boolean;
  reconciliation: BankReconciliation | null;
}

const accountStatementsSchema = z.object({ date: z.string().date().optional() });

/**
 * Ein eigener Lesedienst im Import-Bereich (F4 Task 7, „Offen aus Lauf 3“):
 * `ledger/` darf `import/` nicht kennen (Richtungswächter
 * `tests/direction.test.ts`), `BalancesView` bleibt deshalb unverändert.
 * Trägt „importiert bis“, „letzter Auszug vor N Tagen“ und den Abstimmstand
 * je Bank- und Zahlungsdienstkonto — Kassen kennen keinen Auszug. Stufe wie
 * `getBalances`: `finance.read` oder `finance.overview`.
 */
export async function getAccountStatements(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ accounts: AccountStatementView[] }>> {
  const denied = requireFinanceRead(ctx, 'overview');
  if (denied) return denied;
  const parsed = validate(deps, accountStatementsSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const date = parsed.value.date ?? isoNow(deps.clock).slice(0, 10);

  const rows = deps.db.select().from(financeAccounts).where(or(eq(financeAccounts.kind, 'bank'), eq(financeAccounts.kind, 'paymentService'))).all();
  const accounts: AccountStatementView[] = rows.map((a) => {
    const through = importedThroughInternal(deps.db, a.id);
    return {
      accountId: a.id,
      importedThrough: through,
      // Befund 5: ein Auszug, der bis in die Zukunft reicht, zeigt nie negative Tage ("vor -4 Tagen").
      lastStatementDaysAgo: through === null ? null : Math.max(0, daysBetween(date, through)),
      lastStatementInFuture: through !== null && through > date,
      reconciliation: reconcileBankInternal(deps.db, a.id, date),
    };
  });
  return ok({ accounts });
}
