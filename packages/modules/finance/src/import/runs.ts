import { isoNow, newId, notFound, ok, readSetting, requirePermission, schema, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { checksumOf } from '@kompass/module-dms';
import { and, desc, eq, isNotNull, isNull, ne, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { setImportFormatInternal } from '../ledger/accounts';
import { requireFinanceRead } from '../ledger/access';
import { financeAccounts, financeImportCandidates, financeImportRuns, financeRawTransactions, type FinanceAccountRow, type FinanceImportProfileRow, type FinanceImportRunRow } from '../schema';
import { parseCamt053, type CamtLine } from './camt';
import { readCsv } from './csv';
import { activeProfileInternal, profileFormatInternal } from './profiles';
import { dedupKey, normalizePurpose } from './dedup';
import { rawTransactionsForRunInternal, type RawTransactionView } from './queries';

/** Ein Lauf, wie ihn die Läufe-Tabelle und der Lauf-Dienst zeigen (Spec 6.1, F4 Task 3; CSV seit F4b). */
export interface ImportRunView {
  id: string;
  accountId: string;
  format: 'camt053' | 'csv';
  /** Name des CSV-Formats beim Lesen — Verlauf (F4b); `null` bei CAMT. */
  formatName: string | null;
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
  /** Befund 5: `futureDates`, wenn ein Umsatz nach dem Tag des Ladens buchte — angenommen, nur ein Hinweis. */
  warnings: ('futureDates')[];
  startedAt: string;
  finishedAt: string | null;
  createdByUserName: string | null;
}

/** `financeImportRuns.warnings` ist `NULL` oder ein JSON-Array bekannter Codes — nie eine Ablehnung. */
function parseWarnings(raw: string | null): ImportRunView['warnings'] {
  return raw ? (JSON.parse(raw) as ImportRunView['warnings']) : [];
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
    format: row.format,
    formatName: row.profileName,
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
    warnings: parseWarnings(row.warnings),
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
  /** F4b: „Kontostand laut Bank am …?“ — nur für CSV ohne Saldospalte (Spec 6.1). */
  closingBalanceCents: z.number().int().optional(),
});

/** Die Zeilen eines Auszugs, gleich ob CAMT oder CSV — so bleibt `importLines` eins. */
interface StatementForRun {
  from: string;
  to: string;
  openingCents: number | null;
  closingCents: number | null;
  lines: CamtLine[];
}

/** CAMT beginnt (nach BOM und Leerraum) mit `<`, alles andere liest Kompass als CSV (F4b, Regel 1). */
export function looksLikeXml(bytes: Uint8Array): boolean {
  let i = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i += 1;
  return bytes[i] === 0x3c;
}

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

  if (!looksLikeXml(v.bytes)) return importCsv(deps, ctx, account, v);

  const parsedStatement = parseCamt053(v.bytes, { maxBytes });
  if (!parsedStatement.ok) {
    recordFailedRun(deps, ctx, { account, format: 'camt053', profile: null, fileName: v.fileName, bytes: v.bytes, failureCode: parsedStatement.error.code, failureLine: parsedStatement.error.line ?? null });
    const location = parsedStatement.error.line !== undefined ? ` (Zeile ${parsedStatement.error.line})` : '';
    return financeConflict('statementUnreadable', { location });
  }

  const statements = parsedStatement.statements;
  if (!account.iban || statements.some((s) => s.iban !== account.iban)) return financeConflict('statementIbanMismatch', { account: account.name });
  if (account.importFormat === 'csv' && !v.confirmFormatChange) return financeConflict('statementFormatChange', { account: account.name });

  const sha256 = checksumOf(v.bytes);
  if (alreadyImported(deps.db, account.id, sha256)) return financeConflict('statementAlreadyImported', { account: account.name });

  const fileKey = `import-${sha256}.xml`;
  await deps.files('finance').write(fileKey, v.bytes);
  try {
    return deps.db.transaction((tx: DbOrTx) => {
      // NULL -> erste Wahl; 'csv' -> die Bestätigung liegt schon vor (sonst kämen wir nicht hierher) — E1: ein aktives Format je Konto.
      const workingAccount: FinanceAccountRow = account.importFormat !== 'camt053' ? setImportFormatInternal(tx, deps, ctx, account, 'camt053', null) : account;
      const ordered = [...statements].sort((a, b) => a.from.localeCompare(b.from));
      const runs = ordered.map((stmt) => writeRun(tx, deps, ctx, { accountId: workingAccount.id, format: 'camt053', profile: null, fileName: v.fileName, sha256, fileKey, stmt }));
      return ok({ runs });
    });
  } catch (error) {
    await deps.files('finance').delete(fileKey);
    throw error;
  }
}

function alreadyImported(db: DbOrTx, accountId: string, sha256: string): boolean {
  return !!db
    .select({ id: financeImportRuns.id })
    .from(financeImportRuns)
    .where(and(eq(financeImportRuns.accountId, accountId), eq(financeImportRuns.fileSha256, sha256), isNotNull(financeImportRuns.finishedAt), isNull(financeImportRuns.discardedAt)))
    .get();
}

/** Ein nicht lesbarer Auszug bleibt als fehlgeschlagener Lauf stehen — eine Tatsache, keine Leerstelle (Spec 6.1). */
function recordFailedRun(
  deps: Deps,
  ctx: CallContext,
  args: { account: FinanceAccountRow; format: 'camt053' | 'csv'; profile: FinanceImportProfileRow | null; fileName: string; bytes: Uint8Array; failureCode: string; failureLine: number | null },
): void {
  const sha256 = checksumOf(args.bytes);
  deps.db.transaction((tx: DbOrTx) => {
    const id = newId();
    const now = isoNow(deps.clock);
    tx.insert(financeImportRuns)
      .values({
        id, accountId: args.account.id, format: args.format, profileId: args.profile?.id ?? null, profileName: args.profile?.name ?? null, fileName: args.fileName, fileSha256: sha256, fileKey: null,
        startedAt: now, failedAt: now, failureCode: args.failureCode, failureLine: args.failureLine,
        createdByUserId: ctx.userId ?? 'system', createdChannel: ctx.channel,
      })
      .run();
    financeAudit(tx, deps, ctx, {
      action: 'finance.import.fail', entity: 'financeImportRun', id,
      after: { accountId: args.account.id, format: args.format, profileId: args.profile?.id ?? null, failureCode: args.failureCode, failureLine: args.failureLine },
      summary: `Auszug für Konto ${args.account.id} nicht lesbar (${args.failureCode})`,
    });
  });
}

/** Ein Lauf samt Zeilen, Zählern und Lückenprüfung — gemeinsam für CAMT und CSV. */
function writeRun(
  tx: DbOrTx,
  deps: Deps,
  ctx: CallContext,
  args: { accountId: string; format: 'camt053' | 'csv'; profile: FinanceImportProfileRow | null; fileName: string; sha256: string; fileKey: string; stmt: StatementForRun },
): ImportRunView {
  const { accountId, stmt } = args;
  const runId = newId();
  tx.insert(financeImportRuns)
    .values({
      id: runId, accountId, format: args.format, profileId: args.profile?.id ?? null, profileName: args.profile?.name ?? null, fileName: args.fileName, fileSha256: args.sha256, fileKey: args.fileKey,
      startedAt: isoNow(deps.clock), createdByUserId: ctx.userId ?? 'system', createdChannel: ctx.channel,
    })
    .run();

  const counters = importLines(tx, deps, { runId, accountId, stmt });

  const prevRun = tx
    .select({ periodTo: financeImportRuns.periodTo, closingCents: financeImportRuns.closingCents })
    .from(financeImportRuns)
    .where(and(eq(financeImportRuns.accountId, accountId), isNotNull(financeImportRuns.finishedAt), isNull(financeImportRuns.discardedAt), ne(financeImportRuns.id, runId)))
    .orderBy(desc(financeImportRuns.periodTo))
    .limit(1)
    .get();
  // Ohne eigenen Anfangssaldo (CSV ohne Saldo und ohne Antwort) lässt sich keine Lücke behaupten.
  const gap = prevRun && prevRun.closingCents !== null && prevRun.periodTo !== null && stmt.openingCents !== null && stmt.openingCents !== prevRun.closingCents ? { from: prevRun.periodTo, to: stmt.from } : null;

  // Befund 5: ein Umsatztag nach heute ist angenommen, nur ein Hinweis — nie eine Ablehnung.
  const today = isoNow(deps.clock).slice(0, 10);
  const warnings: ImportRunView['warnings'] = stmt.lines.some((l) => l.bookingDate > today) ? ['futureDates'] : [];

  tx.update(financeImportRuns)
    .set({
      periodFrom: stmt.from, periodTo: stmt.to, openingCents: stmt.openingCents, closingCents: stmt.closingCents,
      countNew: counters.countNew, countKnown: counters.countKnown, countHeld: counters.countHeld, countPendingSkipped: counters.countPendingSkipped,
      gapFrom: gap?.from ?? null, gapTo: gap?.to ?? null, warnings: warnings.length > 0 ? JSON.stringify(warnings) : null, finishedAt: isoNow(deps.clock),
    })
    .where(eq(financeImportRuns.id, runId))
    .run();

  financeAudit(tx, deps, ctx, {
    action: 'finance.import.run', entity: 'financeImportRun', id: runId,
    after: {
      accountId, format: args.format, profileId: args.profile?.id ?? null, periodFrom: stmt.from, periodTo: stmt.to, openingCents: stmt.openingCents, closingCents: stmt.closingCents,
      countNew: counters.countNew, countKnown: counters.countKnown, countHeld: counters.countHeld, countPendingSkipped: counters.countPendingSkipped,
      gapFrom: gap?.from ?? null, gapTo: gap?.to ?? null,
    },
    summary: `Kontoauszug für Konto ${accountId} importiert`,
  });

  return toRunView(tx, importRunRowInternal(tx, runId)!);
}

/**
 * F4b: eine CSV-Datei mit dem **einen** Format des Kontos lesen. Eine fremde
 * Kopfzeile ist die falsche Datei, kein kaputter Lauf — abgewiesen, ohne Lauf.
 */
async function importCsv(
  deps: Deps,
  ctx: CallContext,
  account: FinanceAccountRow,
  v: { fileName: string; bytes: Uint8Array; closingBalanceCents?: number | undefined },
): Promise<Result<{ runs: ImportRunView[] }>> {
  const profile = account.importFormat === 'csv' ? activeProfileInternal(deps.db, account) : null;
  if (!profile) return financeConflict('statementNeedsCsvFormat', { account: account.name });

  const read = readCsv(v.bytes, profileFormatInternal(profile));
  if (!read.ok && read.error.code === 'csvHeaderMismatch') return financeConflict('statementCsvFormatMismatch', { account: account.name, format: profile.name });
  if (!read.ok) {
    recordFailedRun(deps, ctx, { account, format: 'csv', profile, fileName: v.fileName, bytes: v.bytes, failureCode: read.error.code, failureLine: read.error.line ?? null });
    const location = read.error.line !== undefined ? ` (Zeile ${read.error.line})` : '';
    return financeConflict('statementUnreadable', { location });
  }

  const sha256 = checksumOf(v.bytes);
  if (alreadyImported(deps.db, account.id, sha256)) return financeConflict('statementAlreadyImported', { account: account.name });

  const statement = read.statement;
  let { openingCents, closingCents } = statement;
  if (closingCents === null && v.closingBalanceCents !== undefined) {
    closingCents = v.closingBalanceCents;
    openingCents = closingCents - statement.lines.filter((l) => !l.pending).reduce((sum, l) => sum + l.amountCents, 0);
  }

  const fileKey = `import-${sha256}.csv`;
  await deps.files('finance').write(fileKey, v.bytes);
  try {
    return deps.db.transaction((tx: DbOrTx) => {
      const run = writeRun(tx, deps, ctx, { accountId: account.id, format: 'csv', profile, fileName: v.fileName, sha256, fileKey, stmt: { ...statement, openingCents, closingCents } });
      return ok({ runs: [run] });
    });
  } catch (error) {
    await deps.files('finance').delete(fileKey);
    throw error;
  }
}

interface ImportCounters { countNew: number; countKnown: number; countHeld: number; countPendingSkipped: number }

/** Je Zeile eines `Stmt`: sicher bekannt, wahrscheinlich (Kandidat) oder neu (Spec 6.1, 6.3). Prüft Dubletten vor jedem Insert — ein Verstoß gegen den eindeutigen Index würfe sonst die ganze Transaktion. */
function importLines(tx: DbOrTx, deps: Deps, args: { runId: string; accountId: string; stmt: StatementForRun }): ImportCounters {
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

/** Summe der Beträge aller Rohumsätze eines Laufs — vorgemerkte Zeilen wurden nie als Rohumsatz angelegt (Spec 6.1). */
function sumOfRawTransactionsInternal(db: DbOrTx, runId: string): number {
  return db
    .select({ amountCents: financeRawTransactions.amountCents })
    .from(financeRawTransactions)
    .where(eq(financeRawTransactions.runId, runId))
    .all()
    .reduce((sum, r) => sum + r.amountCents, 0);
}

const setRunClosingBalanceSchema = z.object({ runId: z.string().min(1), closingBalanceCents: z.number().int() });

/**
 * „Kontostand nachtragen“ (Plan finanzen-n2-kleinkram Task 2, Spec 6.1: „sonst
 * fragt der Lauf optional ‚Kontostand laut Bank am …?‘“): ein fertig
 * geladener, nicht verworfener Lauf ohne Kontostand bekommt einen — genau
 * einmal (Trigger `finance_import_runs_balance_once`, Migration 0021). Der
 * Anfangssaldo entsteht wie beim Import selbst: Endsaldo minus Summe der
 * Rohumsätze des Laufs. Eine Lücke zum Vorlauf wird dabei **nicht**
 * nachträglich geprüft — das bleibt Sache des Imports (Annahme 1 des Plans);
 * die Kontenabstimmung nutzt den neuen Saldo ab sofort.
 *
 * `finance.entriesWrite` wie das Laden selbst, **nicht** `humanOnly` (Annahme
 * 2 des Plans) — ein Agent darf den Kontostand nachtragen, nie festschreiben.
 */
export async function setRunClosingBalance(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ImportRunView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, setRunClosingBalanceSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const before = importRunRowInternal(deps.db, v.runId);
  if (!before) return notFound('financeImportRun', v.runId);
  if (before.finishedAt === null || before.discardedAt !== null) return financeConflict('runNotAmendable');
  if (before.closingCents !== null) return financeConflict('runHasBalance');

  const openingCents = v.closingBalanceCents - sumOfRawTransactionsInternal(deps.db, before.id);

  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(financeImportRuns).set({ openingCents, closingCents: v.closingBalanceCents }).where(eq(financeImportRuns.id, before.id)).run();
    financeAudit(tx, deps, ctx, {
      action: 'finance.import.runBalance',
      entity: 'financeImportRun',
      id: before.id,
      after: { openingCents, closingCents: v.closingBalanceCents },
      summary: `Kontostand für Kontoauszug ${before.id} nachgetragen`,
    });
    return ok(toRunView(tx, importRunRowInternal(tx, before.id)!));
  });
}
