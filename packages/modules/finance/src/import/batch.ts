import { notFound, ok, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { financeConflict } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { entryViewInternal, type EntryView } from '../ledger/entries';
import { checkFinalizableInternal } from '../ledger/finalize';
import { accountBalancesAt } from '../ledger/queries';
import { financeAccounts, financeEntries, financeImportRuns } from '../schema';

/**
 * Sammel-Festschreiben aus der Arbeitsliste vorschauen (F5, Annahme 9; Spec
 * 5.4): je Konto die Summe, der festgeschriebene Buchbestand vorher und
 * danach und der Endsaldo laut jüngstem Auszug — dazu, was einem Entwurf im
 * Weg steht. Die Prüfungen sind dieselben wie beim Festschreiben
 * (`checkFinalizableInternal`); geschrieben wird nichts. Festschreiben selbst
 * bleibt `finalizeReviewed`: alle oder keiner.
 */
export interface BatchAccountPreview {
  accountId: string;
  accountName: string;
  kind: string;
  sumCents: number;
  /** Festgeschriebener Buchbestand über alle Tage — ohne Entwürfe. */
  bookCentsNow: number;
  bookCentsAfter: number;
  /** Endsaldo des jüngsten fertigen, nicht verworfenen Auszugs; `null` bei einer Kasse oder ohne Auszug. */
  statementClosingCents: number | null;
  statementDate: string | null;
  matches: boolean | null;
}

export interface BatchFinalizePreview {
  entries: number;
  byAccount: BatchAccountPreview[];
  numbersToBeAssigned: number;
  problems: { entryId: string; code: string }[];
}

const previewSchema = z.object({ ids: z.array(z.string().min(1)).min(1).optional() });

/** Weit genug in der Zukunft, dass jede Buchung zählt — der Buchbestand „jetzt“ meint alles Festgeschriebene. */
const ALL_DAYS = '9999-12-31';

function latestStatementInternal(db: DbOrTx, accountId: string): { closingCents: number | null; periodTo: string | null } | null {
  return (
    db
      .select({ closingCents: financeImportRuns.closingCents, periodTo: financeImportRuns.periodTo })
      .from(financeImportRuns)
      .where(and(eq(financeImportRuns.accountId, accountId), isNotNull(financeImportRuns.finishedAt), isNull(financeImportRuns.discardedAt)))
      .orderBy(desc(financeImportRuns.periodTo), desc(financeImportRuns.startedAt))
      .limit(1)
      .get() ?? null
  );
}

/**
 * `finance.read`. Ohne `ids` alle geprüften Entwürfe (wie der Kopfknopf im
 * Journal); gibt es keinen, `batchNothingReviewed`. Mit `ids` dieselben
 * Vorbedingungen wie `finalizeReviewed`: jeder ein Entwurf, jeder geprüft.
 */
export async function previewBatchFinalize(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<BatchFinalizePreview>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, previewSchema, input ?? {});
  if (!parsed.ok) return parsed;

  let entries: EntryView[];
  if (parsed.value.ids) {
    entries = [];
    for (const id of parsed.value.ids) {
      const view = entryViewInternal(deps.db, id);
      if (!view) return notFound('financeEntry', id);
      entries.push(view);
    }
    const notDraft = entries.find((e) => e.status !== 'draft');
    if (notDraft) return financeConflict('entryNotDraft', { number: notDraft.number ?? notDraft.id });
    const unreviewed = entries.filter((e) => e.reviewedAt === null).length;
    if (unreviewed > 0) return financeConflict('notReviewed', { count: unreviewed });
  } else {
    const ids = deps.db
      .select({ id: financeEntries.id })
      .from(financeEntries)
      .where(and(eq(financeEntries.status, 'draft'), isNotNull(financeEntries.reviewedAt)))
      .orderBy(asc(financeEntries.entryDate), asc(financeEntries.createdAt))
      .all();
    if (ids.length === 0) return financeConflict('batchNothingReviewed');
    entries = ids.map((r) => entryViewInternal(deps.db, r.id)!);
  }

  const problems: { entryId: string; code: string }[] = [];
  for (const entry of entries) {
    const problem = checkFinalizableInternal(deps.db, entry.id);
    if (problem && problem.error.type === 'conflict') problems.push({ entryId: entry.id, code: problem.error.code });
    else if (problem) problems.push({ entryId: entry.id, code: problem.error.type });
  }

  const sums = new Map<string, number>();
  for (const entry of entries) for (const line of entry.moneyLines) sums.set(line.accountId, (sums.get(line.accountId) ?? 0) + line.amountCents);
  const balances = new Map(accountBalancesAt(deps.db, ALL_DAYS).map((b) => [b.accountId, b.balanceCents] as const));
  const byAccount: BatchAccountPreview[] = [...sums.entries()].map(([accountId, sumCents]) => {
    const account = deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, accountId)).get()!;
    const bookCentsNow = balances.get(accountId) ?? 0;
    const bookCentsAfter = bookCentsNow + sumCents;
    // Eine Kasse kennt keinen Auszug — sie wird gezählt (Spec 5.5).
    const statement = account.kind === 'cash' ? null : latestStatementInternal(deps.db, accountId);
    const statementClosingCents = statement?.closingCents ?? null;
    return {
      accountId, accountName: account.name, kind: account.kind, sumCents, bookCentsNow, bookCentsAfter,
      statementClosingCents, statementDate: statementClosingCents === null ? null : (statement?.periodTo ?? null),
      matches: statementClosingCents === null ? null : bookCentsAfter === statementClosingCents,
    };
  });

  return ok({ entries: entries.length, byAccount, numbersToBeAssigned: entries.length, problems });
}
