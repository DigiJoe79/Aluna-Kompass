import { isoNow, newId, notFound, ok, readSetting, requirePermission, schema, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { checksumOf } from '@kompass/module-dms';
import { and, desc, eq, isNotNull, isNull, ne, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { setImportFormatInternal } from '../ledger/accounts';
import { requireFinanceRead } from '../ledger/access';
import { financeAccounts, financeImportCandidates, financeImportRuns, financeRawTransactions, type FinanceAccountRow, type FinanceImportRunRow } from '../schema';
import { parseCamt053, type CamtLine, type CamtStatement } from './camt';
import { dedupKey, normalizePurpose } from './dedup';
import { rawTransactionsForRunInternal, type RawTransactionView } from './queries';

/** Ein CAMT.053-Lauf, wie ihn die Läufe-Tabelle und der Lauf-Dienst zeigen (Spec 6.1, F4 Task 3). */
export interface ImportRunView {
  id: string;
  accountId: string;
  format: 'camt053';
  fileName: string;
  fileSha256: string;
  periodFrom: string | null;
  periodTo: string | null;
  openingCents: number | null;
  closingCents: number | null;
  counts: { new: number; known: number; held: number; pendingSkipped: number };
  gap: { from: string; to: string } | null;
  state: 'finished' | 'failed' | 'discarded';
  failure: { code: string; line: number | null } | null;
  startedAt: string;
  finishedAt: string | null;
  createdByUserName: string | null;
}

function createdByUserName(db: DbOrTx, userId: string): string | null {
  return db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, userId)).get()?.name ?? null;
}

/** Auch von `import/discard.ts` genutzt (F4 Task 5) — dieselbe Sicht auf einen Lauf. */
export function toRunView(db: DbOrTx, row: FinanceImportRunRow): ImportRunView {
  const state: ImportRunView['state'] = row.discardedAt !== null ? 'discarded' : row.failedAt !== null ? 'failed' : 'finished';
  return {
    id: row.id,
    accountId: row.accountId,
    format: 'camt053',
    fileName: row.fileName,
    fileSha256: row.fileSha256,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    openingCents: row.openingCents,
    closingCents: row.closingCents,
    counts: { new: row.countNew ?? 0, known: row.countKnown ?? 0, held: row.countHeld ?? 0, pendingSkipped: row.countPendingSkipped ?? 0 },
    gap: row.gapFrom !== null && row.gapTo !== null ? { from: row.gapFrom, to: row.gapTo } : null,
    state,
    failure: row.failedAt !== null ? { code: row.failureCode!, line: row.failureLine } : null,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdByUserName: createdByUserName(db, row.createdByUserId),
  };
}

/** Auch von `import/discard.ts` genutzt (F4 Task 5). */
export function importRunRowInternal(db: DbOrTx, id: string): FinanceImportRunRow | null {
  return db.select().from(financeImportRuns).where(eq(financeImportRuns.id, id)).get() ?? null;
}

/** Zwei Zeiträume überlappen inklusive ihrer Grenzen — Grundlage der „sicher bekannt“-Prüfung ohne Bankreferenz (Spec 6.3). */
function periodsOverlap(aFrom: string | null, aTo: string | null, bFrom: string, bTo: string): boolean {
  if (aFrom === null || aTo === null) return false;
  return aFrom <= bTo && bFrom <= aTo;
}

/**
 * Dieselben Kerndaten (Konto, Datum, Betrag, IBAN), aber ein anderer Zweck —
 * „wahrscheinlich dieselbe Zahlung, anders beschriftet“ (Spec 6.1: „gleiche
 * referenzlose Kerndaten mit abweichendem Zweck"). Nur unter nicht
 * verworfenen Läufen.
 */
function findPurposeMismatch(tx: DbOrTx, accountId: string, ownRunId: string, line: CamtLine): { id: string } | null {
  const rows = tx
    .select({ id: financeRawTransactions.id, purpose: financeRawTransactions.purpose, runId: financeRawTransactions.runId })
    .from(financeRawTransactions)
    .where(and(eq(financeRawTransactions.accountId, accountId), eq(financeRawTransactions.bookingDate, line.bookingDate), eq(financeRawTransactions.amountCents, line.amountCents), ne(financeRawTransactions.runId, ownRunId)))
    .all();
  for (const row of rows) {
    if (normalizePurpose(row.purpose) === normalizePurpose(line.purpose)) continue; // exakter Treffer läuft über den Dublettenschlüssel, nicht hier
    const run = tx.select({ discardedAt: financeImportRuns.discardedAt }).from(financeImportRuns).where(eq(financeImportRuns.id, row.runId)).get();
    if (run && run.discardedAt === null) return row;
  }
  return null;
}

const importStatementSchema = z.object({
  accountId: z.string().min(1),
  fileName: z.string().trim().min(1).max(255),
  bytes: z.custom<Uint8Array>((v) => v instanceof Uint8Array, { message: 'invalidBytes' }),
  confirmFormatChange: z.boolean().optional(),
});

/**
 * Der Laufdienst (Spec 6.1, 6.2, 6.3): Bytes hinein, je `Stmt` der Datei ein
 * geschriebener Lauf heraus — ganz oder gar nicht. `finance.entriesWrite`,
 * **nicht** `humanOnly` (Entschieden 3: der Agent darf laden, nie
 * festschreiben).
 */
export async function importStatement(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ runs: ImportRunView[] }>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, importStatementSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const account = deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, v.accountId)).get();
  if (!account) return notFound('financeAccount', v.accountId);
  if (account.kind !== 'bank' && account.kind !== 'paymentService') return financeConflict('statementAccountNotBank', { account: account.name });
  if (!account.isActive) return financeConflict('accountInactive', { account: account.name });

  const uploadLimitMb = readSetting<number>(deps, 'finance.uploadLimitMb');
  const maxBytes = uploadLimitMb * 1024 * 1024;
  if (v.bytes.byteLength > maxBytes) return financeConflict('statementTooLarge', { limit: String(uploadLimitMb) });

  const parsedStatement = parseCamt053(v.bytes, { maxBytes });
  if (!parsedStatement.ok) {
    const sha256 = checksumOf(v.bytes);
    deps.db.transaction((tx: DbOrTx) => {
      const id = newId();
      const now = isoNow(deps.clock);
      tx.insert(financeImportRuns)
        .values({
          id, accountId: account.id, format: 'camt053', fileName: v.fileName, fileSha256: sha256, fileKey: null,
          startedAt: now, failedAt: now, failureCode: parsedStatement.error.code, failureLine: parsedStatement.error.line ?? null,
          createdByUserId: ctx.userId ?? 'system', createdChannel: ctx.channel,
        })
        .run();
      financeAudit(tx, deps, ctx, {
        action: 'finance.import.fail', entity: 'financeImportRun', id,
        after: { accountId: account.id, format: 'camt053', failureCode: parsedStatement.error.code, failureLine: parsedStatement.error.line ?? null },
        summary: `Auszug für Konto ${account.id} nicht lesbar (${parsedStatement.error.code})`,
      });
    });
    const location = parsedStatement.error.line !== undefined ? ` (Zeile ${parsedStatement.error.line})` : '';
    return financeConflict('statementUnreadable', { location });
  }

  const statements = parsedStatement.statements;
  if (!account.iban || statements.some((s) => s.iban !== account.iban)) return financeConflict('statementIbanMismatch', { account: account.name });
  if (account.importFormat === 'csv' && !v.confirmFormatChange) return financeConflict('statementFormatChange', { account: account.name });

  const sha256 = checksumOf(v.bytes);
  const alreadyImported = deps.db
    .select({ id: financeImportRuns.id })
    .from(financeImportRuns)
    .where(and(eq(financeImportRuns.accountId, account.id), eq(financeImportRuns.fileSha256, sha256), isNotNull(financeImportRuns.finishedAt), isNull(financeImportRuns.discardedAt)))
    .get();
  if (alreadyImported) return financeConflict('statementAlreadyImported', { account: account.name });

  const fileKey = `import-${sha256}.xml`;
  await deps.files('finance').write(fileKey, v.bytes);

  try {
    return deps.db.transaction((tx: DbOrTx) => {
      // NULL -> erste Wahl; 'csv' -> die Bestätigung liegt schon vor (sonst kämen wir nicht hierher) — E1: ein aktives Format je Konto.
      const workingAccount: FinanceAccountRow = account.importFormat !== 'camt053' ? setImportFormatInternal(tx, deps, ctx, account, 'camt053') : account;

      const ordered = [...statements].sort((a, b) => a.from.localeCompare(b.from));
      const runs: ImportRunView[] = [];

      for (const stmt of ordered) {
        const runId = newId();
        const startedAt = isoNow(deps.clock);
        tx.insert(financeImportRuns)
          .values({ id: runId, accountId: workingAccount.id, format: 'camt053', fileName: v.fileName, fileSha256: sha256, fileKey, startedAt, createdByUserId: ctx.userId ?? 'system', createdChannel: ctx.channel })
          .run();

        const counters = importLines(tx, deps, { runId, accountId: workingAccount.id, stmt });

        const prevRun = tx
          .select({ periodTo: financeImportRuns.periodTo, closingCents: financeImportRuns.closingCents })
          .from(financeImportRuns)
          .where(and(eq(financeImportRuns.accountId, workingAccount.id), isNotNull(financeImportRuns.finishedAt), isNull(financeImportRuns.discardedAt), ne(financeImportRuns.id, runId)))
          .orderBy(desc(financeImportRuns.periodTo))
          .limit(1)
          .get();
        const gap = prevRun && prevRun.closingCents !== null && prevRun.periodTo !== null && stmt.openingCents !== prevRun.closingCents ? { from: prevRun.periodTo, to: stmt.from } : null;

        const finishedAt = isoNow(deps.clock);
        tx.update(financeImportRuns)
          .set({
            periodFrom: stmt.from, periodTo: stmt.to, openingCents: stmt.openingCents, closingCents: stmt.closingCents,
            countNew: counters.countNew, countKnown: counters.countKnown, countHeld: counters.countHeld, countPendingSkipped: counters.countPendingSkipped,
            gapFrom: gap?.from ?? null, gapTo: gap?.to ?? null, finishedAt,
          })
          .where(eq(financeImportRuns.id, runId))
          .run();

        financeAudit(tx, deps, ctx, {
          action: 'finance.import.run', entity: 'financeImportRun', id: runId,
          after: {
            accountId: workingAccount.id, format: 'camt053', periodFrom: stmt.from, periodTo: stmt.to, openingCents: stmt.openingCents, closingCents: stmt.closingCents,
            countNew: counters.countNew, countKnown: counters.countKnown, countHeld: counters.countHeld, countPendingSkipped: counters.countPendingSkipped,
            gapFrom: gap?.from ?? null, gapTo: gap?.to ?? null,
          },
          summary: `Kontoauszug für Konto ${workingAccount.id} importiert`,
        });

        runs.push(toRunView(tx, importRunRowInternal(tx, runId)!));
      }

      return ok({ runs });
    });
  } catch (error) {
    await deps.files('finance').delete(fileKey);
    throw error;
  }
}

interface ImportCounters { countNew: number; countKnown: number; countHeld: number; countPendingSkipped: number }

/** Je Zeile eines `Stmt`: sicher bekannt, wahrscheinlich (Kandidat) oder neu (Spec 6.1, 6.3). Prüft Dubletten vor jedem Insert — ein Verstoß gegen den eindeutigen Index würfe sonst die ganze Transaktion. */
function importLines(tx: DbOrTx, deps: Deps, args: { runId: string; accountId: string; stmt: CamtStatement }): ImportCounters {
  const { runId, accountId, stmt } = args;
  const counters: ImportCounters = { countNew: 0, countKnown: 0, countHeld: 0, countPendingSkipped: 0 };
  const now = isoNow(deps.clock);
  const ordinals = new Map<string, number>();

  const insertRaw = (line: CamtLine, key: string) => {
    tx.insert(financeRawTransactions)
      .values({
        id: newId(), runId, accountId, bookingDate: line.bookingDate, valueDate: line.valueDate, amountCents: line.amountCents,
        counterpartyName: line.counterpartyName, counterpartyIban: line.counterpartyIban, purpose: line.purpose,
        bankReference: line.bankReference, endToEndId: line.endToEndId, returnCode: line.returnCode,
        dedupKey: key, lineIndex: line.index, createdAt: now,
      })
      .run();
    counters.countNew += 1;
  };

  const insertCandidate = (line: CamtLine, key: string, matchesRawTransactionId: string) => {
    tx.insert(financeImportCandidates).values({ id: newId(), runId, accountId, line: JSON.stringify(line), matchesRawTransactionId, dedupKey: key }).run();
    counters.countHeld += 1;
  };

  for (const line of stmt.lines) {
    if (line.pending) {
      counters.countPendingSkipped += 1;
      continue;
    }

    if (line.bankReference) {
      const known = tx.select({ id: financeRawTransactions.id }).from(financeRawTransactions).where(and(eq(financeRawTransactions.accountId, accountId), eq(financeRawTransactions.bankReference, line.bankReference))).get();
      if (known) {
        counters.countKnown += 1;
        continue;
      }
      insertRaw(line, dedupKey(line, 0));
      continue;
    }

    const coreKey = `${line.bookingDate}|${line.amountCents}|${line.counterpartyIban ?? ''}|${normalizePurpose(line.purpose)}`;
    const ordinal = ordinals.get(coreKey) ?? 0;
    ordinals.set(coreKey, ordinal + 1);
    const key = dedupKey(line, ordinal);

    const exactMatches = tx
      .select({ id: financeRawTransactions.id, runId: financeRawTransactions.runId })
      .from(financeRawTransactions)
      .where(and(eq(financeRawTransactions.accountId, accountId), eq(financeRawTransactions.dedupKey, key)))
      .all();

    let known = false;
    let candidateMatch: { id: string } | null = null;
    for (const match of exactMatches) {
      const matchRun = tx.select({ periodFrom: financeImportRuns.periodFrom, periodTo: financeImportRuns.periodTo, discardedAt: financeImportRuns.discardedAt }).from(financeImportRuns).where(eq(financeImportRuns.id, match.runId)).get();
      if (!matchRun || matchRun.discardedAt !== null) continue;
      if (periodsOverlap(matchRun.periodFrom, matchRun.periodTo, stmt.from, stmt.to)) {
        known = true;
        break;
      }
      candidateMatch = candidateMatch ?? match;
    }

    if (known) {
      counters.countKnown += 1;
      continue;
    }
    if (!candidateMatch) candidateMatch = findPurposeMismatch(tx, accountId, runId, line);
    if (candidateMatch) {
      insertCandidate(line, key, candidateMatch.id);
      continue;
    }
    insertRaw(line, key);
  }

  return counters;
}

const listImportRunsSchema = z.object({ accountId: z.string().min(1).optional(), limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).default(0) });

/** `finance.read`. */
export async function listImportRuns(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ runs: ImportRunView[]; total: number }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listImportRunsSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const where: SQL | undefined = parsed.value.accountId ? eq(financeImportRuns.accountId, parsed.value.accountId) : undefined;
  const rows = deps.db.select().from(financeImportRuns).where(where).orderBy(desc(financeImportRuns.startedAt)).all();
  const total = rows.length;
  const page = rows.slice(parsed.value.offset, parsed.value.offset + parsed.value.limit);
  return ok({ runs: page.map((r) => toRunView(deps.db, r)), total });
}

const getImportRunSchema = z.object({ id: z.string().min(1) });

/** `finance.read`. */
export async function getImportRun(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ImportRunView & { rawTransactions: RawTransactionView[] }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, getImportRunSchema, input);
  if (!parsed.ok) return parsed;
  const row = importRunRowInternal(deps.db, parsed.value.id);
  if (!row) return notFound('financeImportRun', parsed.value.id);
  return ok({ ...toRunView(deps.db, row), rawTransactions: rawTransactionsForRunInternal(deps.db, row.id) });
}
