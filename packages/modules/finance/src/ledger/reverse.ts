import { isoNow, newId, notFound, ok, requireHumanChannel, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { ENTRY_LOCKS, type EntryLock } from '../locks';
import { financeAccounts, financeEntries, financeMoneyLines, type FinanceAccountRow } from '../schema';
import { firstNegativeCashDay, formatEuro } from './cash-check';
import { entryViewInternal, writeLinesInternal, type AllocationLineWrite, type EntryView, type MoneyLineWrite } from './entries';
import { abortFinalize, finalizeInternal, FinalizeAborted } from './finalize';
import { fiscalYearStatusInternal } from './fiscal-years';
import type { TaxCode } from './tax';

/** Die negierten Zeilen des Originals — nie Rohumsatz, nie `originLineId` des Storno selbst. */
function negatedLines(original: EntryView): { moneyLines: MoneyLineWrite[]; allocationLines: AllocationLineWrite[] } {
  return {
    moneyLines: original.moneyLines.map((l) => ({ accountId: l.accountId, amountCents: -l.amountCents })),
    allocationLines: original.allocationLines.map((l) => ({
      categoryId: l.categoryId,
      amountCents: -l.amountCents,
      taxCode: l.taxCode as TaxCode,
      rateKind: l.rateKind as 'standard' | 'reduced',
      projectId: l.projectId,
      purposeId: l.purposeId,
      contactId: l.contactId,
      abroad: l.abroad,
      originLineId: null,
      addsToAssets: l.addsToAssets,
    })),
  };
}

/** Dieselben Zeilen wie das Original — für den Ersatz-Entwurf (`correctionOfEntryId`); ohne Rohumsatz. */
function originalLines(original: EntryView): { moneyLines: MoneyLineWrite[]; allocationLines: AllocationLineWrite[] } {
  return {
    moneyLines: original.moneyLines.map((l) => ({ accountId: l.accountId, amountCents: l.amountCents })),
    allocationLines: original.allocationLines.map((l) => ({
      categoryId: l.categoryId,
      amountCents: l.amountCents,
      taxCode: l.taxCode as TaxCode,
      rateKind: l.rateKind as 'standard' | 'reduced',
      projectId: l.projectId,
      purposeId: l.purposeId,
      contactId: l.contactId,
      abroad: l.abroad,
      originLineId: l.originLineId,
      addsToAssets: l.addsToAssets,
    })),
  };
}

function accountRow(tx: DbOrTx, id: string): FinanceAccountRow {
  return tx.select().from(financeAccounts).where(eq(financeAccounts.id, id)).get()!;
}

/**
 * Storno als Gegenbuchung — die eigentliche Arbeit, in einer bereits offenen
 * Transaktion, mit austauschbaren `ENTRY_LOCKS` für den Test (Finanz-Spec
 * 5.4). Rechte- und Kanalprüfung liegen bei `reverseEntry`.
 */
export function reverseInternal(
  tx: DbOrTx,
  deps: Deps,
  ctx: CallContext,
  input: { id: string; cashWarningReason?: string; withCorrectionDraft?: boolean },
  locks: readonly EntryLock[] = ENTRY_LOCKS,
): Result<{ reversal: EntryView; correctionDraft: EntryView | null }> {
  const original = entryViewInternal(tx, input.id);
  if (!original) return notFound('financeEntry', input.id);
  if (original.status !== 'final') return financeConflict('entryNotFinal');
  if (original.reversesEntryId) return financeConflict('entryIsReversal', { number: original.number ?? original.id });
  if (original.reversedByEntryId) {
    const by = entryViewInternal(tx, original.reversedByEntryId);
    return financeConflict('entryAlreadyReversed', { number: original.number ?? original.id, by: by?.number ?? original.reversedByEntryId });
  }
  for (const lock of locks) {
    const hit = lock(tx, original.id);
    if (hit && hit.scope === 'entry') return financeConflict('entryLocked', { number: original.number ?? original.id, reason: hit.reason });
  }

  const yearOpen = original.fiscalYearId !== null && fiscalYearStatusInternal(tx, original.fiscalYearId) === 'open';
  const entryDate = yearOpen ? original.entryDate : isoNow(deps.clock).slice(0, 10);

  const lines = negatedLines(original);
  const accountsInLine = new Map<string, FinanceAccountRow>();
  for (const line of lines.moneyLines) if (!accountsInLine.has(line.accountId)) accountsInLine.set(line.accountId, accountRow(tx, line.accountId));
  const hasCashLine = [...accountsInLine.values()].some((a) => a.kind === 'cash');

  let cashCheck: 'refuse' | 'reasonGiven' = 'refuse';
  if (hasCashLine) {
    for (const [accountId, account] of accountsInLine) {
      if (account.kind !== 'cash') continue;
      const extra = lines.moneyLines.filter((l) => l.accountId === accountId).map((l) => ({ date: entryDate, amountCents: l.amountCents }));
      const negative = firstNegativeCashDay(tx, account, entryDate, extra);
      if (negative) {
        if (!input.cashWarningReason) return financeConflict('cashNegativeNeedsReason', { account: account.name, date: negative.date, amount: formatEuro(negative.balanceCents) });
        cashCheck = 'reasonGiven';
      }
    }
  }

  const now = isoNow(deps.clock);
  const reversalId = newId();
  tx.insert(financeEntries)
    .values({
      id: reversalId,
      number: null,
      entryDate,
      text: 'Storno',
      status: 'draft',
      reversesEntryId: original.id,
      cashWarningReason: input.cashWarningReason ?? null,
      createdByUserId: ctx.userId ?? 'system',
      createdChannel: ctx.channel,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  writeLinesInternal(tx, reversalId, lines);

  const result = finalizeInternal(tx, deps, ctx, reversalId, { cashCheck, textFromNumber: () => `Storno ${original.number}` });
  if (!result.ok) abortFinalize(result);
  const reversal = result.value;

  tx.update(financeEntries).set({ reversedByEntryId: reversalId }).where(eq(financeEntries.id, original.id)).run();
  tx.update(financeMoneyLines).set({ rawReleasedAt: now }).where(eq(financeMoneyLines.entryId, original.id)).run();

  let correctionDraft: EntryView | null = null;
  if (input.withCorrectionDraft && !hasCashLine) {
    const draftId = newId();
    const draftNow = isoNow(deps.clock);
    tx.insert(financeEntries)
      .values({ id: draftId, number: null, entryDate: original.entryDate, text: original.text, status: 'draft', correctionOfEntryId: original.id, createdByUserId: ctx.userId ?? 'system', createdChannel: ctx.channel, createdAt: draftNow, updatedAt: draftNow })
      .run();
    writeLinesInternal(tx, draftId, originalLines(original));
    correctionDraft = entryViewInternal(tx, draftId);
  }

  financeAudit(tx, deps, ctx, {
    action: 'finance.entry.reverse',
    entity: 'financeEntry',
    id: reversalId,
    after: { status: reversal.status, number: reversal.number, entryDate: reversal.entryDate, reversesEntryId: reversal.reversesEntryId, channel: ctx.channel, cashWarning: reversal.cashWarningReason !== null },
    summary: `Buchung ${original.number} storniert durch ${reversal.number}`,
  });

  return ok({ reversal: entryViewInternal(tx, reversalId)!, correctionDraft });
}

const reverseSchema = z.object({ id: z.string().min(1), cashWarningReason: z.string().trim().min(1).max(500).optional(), withCorrectionDraft: z.boolean().optional() });

/** `finance.entriesFinalize`, **`humanOnly`**: Gegenbuchung mit negierten Zeilen, sofort festgeschrieben. */
export async function reverseEntry(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ reversal: EntryView; correctionDraft: EntryView | null }>> {
  const denied = requirePermission(ctx, 'finance.entriesFinalize');
  if (denied) return denied;
  const humanOnly = requireHumanChannel(deps, ctx, 'finance.mcpHumanOnlyAllowed');
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, reverseSchema, input);
  if (!parsed.ok) return parsed;

  try {
    return deps.db.transaction((tx: DbOrTx) => reverseInternal(tx, deps, ctx, parsed.value));
  } catch (error) {
    if (error instanceof FinalizeAborted) return error.failure;
    throw error;
  }
}
