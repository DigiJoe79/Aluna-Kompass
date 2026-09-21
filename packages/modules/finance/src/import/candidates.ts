import { isoNow, newId, notFound, ok, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { financeImportCandidates, financeRawTransactions, type FinanceImportCandidateRow } from '../schema';
import type { CamtLine } from './camt';
import { rawTransactionViewInternal, type RawTransactionView } from './queries';

/**
 * Ein Kandidat zeigt beide Seiten (Spec 6.1): die Zeile des Auszugs, wie sie
 * gelesen wurde, und — falls vorhanden — den vorhandenen Kontoumsatz mit
 * seiner Buchungsnummer und seinem Zustand.
 */
export interface CandidateView {
  id: string;
  runId: string;
  accountId: string;
  line: CamtLine;
  existing: RawTransactionView | null;
  decision: 'same' | 'own' | null;
  decidedAt: string | null;
  decidedByUserId: string | null;
  rawTransactionId: string | null;
}

function candidateViewInternal(db: DbOrTx, row: FinanceImportCandidateRow): CandidateView {
  const existingRow = row.matchesRawTransactionId ? db.select().from(financeRawTransactions).where(eq(financeRawTransactions.id, row.matchesRawTransactionId)).get() : undefined;
  return {
    id: row.id,
    runId: row.runId,
    accountId: row.accountId,
    line: JSON.parse(row.line) as CamtLine,
    existing: existingRow ? rawTransactionViewInternal(db, existingRow) : null,
    decision: row.decision as 'same' | 'own' | null,
    decidedAt: row.decidedAt,
    decidedByUserId: row.decidedByUserId,
    rawTransactionId: row.rawTransactionId,
  };
}

const listCandidatesSchema = z.object({ runId: z.string().min(1).optional(), open: z.boolean().optional() });

/** `finance.read` — die Zeile trägt Gegenpartei, IBAN und Zweck (Spec 10.1). */
export async function listCandidates(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ candidates: CandidateView[] }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listCandidatesSchema, input ?? {});
  if (!parsed.ok) return parsed;

  const conditions: SQL[] = [];
  if (parsed.value.runId) conditions.push(eq(financeImportCandidates.runId, parsed.value.runId));
  if (parsed.value.open) conditions.push(isNull(financeImportCandidates.decision));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = deps.db.select().from(financeImportCandidates).where(where).all();
  return ok({ candidates: rows.map((r) => candidateViewInternal(deps.db, r)) });
}

const decideCandidateSchema = z.object({ id: z.string().min(1), decision: z.enum(['same', 'own']) });

/**
 * `finance.entriesWrite`: „dieselbe Zahlung — nicht übernehmen“ lässt den
 * Kandidaten stehen; „eigene Zahlung — übernehmen“ macht daraus einen
 * Kontoumsatz (Spec 6.1). Erst die Übernahme erzeugt den Kontoumsatz — so
 * bleibt E8 lückenlos: Ein Kandidat, der „same“ entschieden wird, verschwindet
 * nicht, er bleibt als entschiedener Kandidat stehen.
 */
export async function decideCandidate(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<CandidateView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, decideCandidateSchema, input);
  if (!parsed.ok) return parsed;

  const before = deps.db.select().from(financeImportCandidates).where(eq(financeImportCandidates.id, parsed.value.id)).get();
  if (!before) return notFound('financeImportCandidate', parsed.value.id);
  if (before.decision !== null) return financeConflict('candidateAlreadyDecided');

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    let rawTransactionId: string | null = null;
    if (parsed.value.decision === 'own') {
      const line = JSON.parse(before.line) as CamtLine;
      rawTransactionId = newId();
      tx.insert(financeRawTransactions)
        .values({
          id: rawTransactionId, runId: before.runId, accountId: before.accountId,
          bookingDate: line.bookingDate, valueDate: line.valueDate, amountCents: line.amountCents,
          counterpartyName: line.counterpartyName, counterpartyIban: line.counterpartyIban, purpose: line.purpose,
          bankReference: line.bankReference, endToEndId: line.endToEndId, returnCode: line.returnCode,
          // Ein eigener Schlüssel, nicht der des Kandidaten: der bezog sich auf den vorhandenen Umsatz, nicht auf diesen neuen.
          dedupKey: `${before.dedupKey}#own`, lineIndex: line.index, createdAt: now,
        })
        .run();
    }
    tx.update(financeImportCandidates).set({ decision: parsed.value.decision, decidedAt: now, decidedByUserId: ctx.userId, rawTransactionId }).where(eq(financeImportCandidates.id, before.id)).run();

    const after = tx.select().from(financeImportCandidates).where(eq(financeImportCandidates.id, before.id)).get()!;
    financeAudit(tx, deps, ctx, {
      action: 'finance.import.candidateDecide', entity: 'financeImportCandidate', id: before.id,
      after: { runId: before.runId, accountId: before.accountId, decision: parsed.value.decision, matchesRawTransactionId: before.matchesRawTransactionId, rawTransactionId },
      summary: `Kandidat ${before.id} entschieden (${parsed.value.decision})`,
    });
    return ok(candidateViewInternal(tx, after));
  });
}
