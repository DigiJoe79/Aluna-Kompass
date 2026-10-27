import { invalid, isoNow, newId, notFound, ok, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { documents, getDocument, getDocumentRecord, linkDocumentInternal, receiveGeneratedUpload } from '@kompass/module-dms';
import { and, desc, eq, gte, isNotNull, isNull, lte, ne } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { financeAccounts, financeAccountStatementDocuments, financeAccountYearConfirmations, financeEntries, financeFiscalYears, financeImportRuns, financeMoneyLines, type FinanceAccountRow, type FinanceFiscalYearRow } from '../schema';
import { requireFinanceRead } from './access';
import { cashAtYearEndInternal } from './cash-year-end';
import { fiscalYearForInternal } from './fiscal-years';
import { accountBalancesAt, accountIdsOfPeriodInternal } from './queries';
import { statementCoversYearEnd, suggestPeriodFromText } from './statement-rules';

/** Tage auf einen Kalendertag, ohne Zeitzone. */
function addDaysInternal(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Rechenschaft C Schritt 1 (Spec § C): je Bankkonto der Kontoauszug der Bank als PDF in der Akte, der den Stichtag
 * abdeckt (Art `bank-statement`, Bezug `financeAccount`, dazu das Geschäftsjahr). Zahlungsdienste brauchen kein PDF;
 * ihnen genügt der Saldo aus dem Import oder die Bestätigung „nicht abstimmbar“. Fehlt das PDF, sperrt das nicht den
 * Abschluss, wohl aber das Festschreiben der Berichte (`reporting/stage.ts`), bis es nachgereicht oder begründet ist.
 */

export const STATEMENT_TYPE_KEY = 'bank-statement';
/** Höchstgröße eines Auszugs, wie beim Scan des Prüfberichts. */
export const STATEMENT_MAX_BYTES = 10 * 1024 * 1024;

/** `cashRecomputed`: eine Kasse ohne Zählung am Stichtag, rückgerechnet aus einer späteren Zählung ohne Differenz (Schritt 2, Board 14a). */
export type AccountYearConfirmationKind = 'balanceConfirmed' | 'notReconcilable' | 'missingJustified' | 'cashRecomputed';
export const ACCOUNT_YEAR_CONFIRMATION_KINDS = ['balanceConfirmed', 'notReconcilable', 'missingJustified', 'cashRecomputed'] as const satisfies readonly AccountYearConfirmationKind[];

export interface AccountYearStatementRow {
  accountId: string;
  name: string;
  kind: 'bank' | 'paymentService';
  /** Bankkonto ohne Auszug, der den Stichtag abdeckt — eine Begründung nimmt es aus `missingStatementPdfsInternal`, nicht hier. */
  needsPdf: boolean;
  /** Der Auszug im Jahr: der deckende, sonst der jüngste; `null`, wenn im Jahr keiner liegt. */
  statement: { documentId: string; documentNumber: string; periodFrom: string | null; periodTo: string; covers: boolean } | null;
  lastStatementTo: string | null;
  lastMovementOn: string | null;
  balanceAtYearEndCents: number;
  importedBalance: { cents: number; on: string } | null;
  confirmation: { kind: AccountYearConfirmationKind; note: string | null; at: string; byUserId: string } | null;
}

/** Wie `accountsWithoutStatementOf` (`period.ts`): ohne Kasse; mit Geldzeilen im Jahr, oder aktiv und bis Jahresende eröffnet. */
/** Die Konten des Jahres ohne Kassen — aus derselben Liste wie Berichte und Kontenabstimmung (Designer Runde 7, 295). */
function accountsOfYear(db: DbOrTx, year: FinanceFiscalYearRow): FinanceAccountRow[] {
  const rows = new Map(db.select().from(financeAccounts).all().map((a) => [a.id, a]));
  return accountIdsOfPeriodInternal(db, { from: year.startsOn, to: year.endsOn })
    .map((id) => rows.get(id)!)
    .filter((account) => account.kind !== 'cash');
}

/** Die jüngste festgeschriebene Geldzeile des Kontos im Jahr. */
function lastMovementOf(db: DbOrTx, accountId: string, year: FinanceFiscalYearRow): string | null {
  return (
    db
      .select({ day: financeEntries.entryDate })
      .from(financeMoneyLines)
      .innerJoin(financeEntries, eq(financeEntries.id, financeMoneyLines.entryId))
      .where(and(eq(financeMoneyLines.accountId, accountId), eq(financeEntries.status, 'final'), gte(financeEntries.entryDate, year.startsOn), lte(financeEntries.entryDate, year.endsOn)))
      .orderBy(desc(financeEntries.entryDate))
      .get()?.day ?? null
  );
}

/** Die Auszüge eines Kontos, deren Dokument nicht storniert ist, jüngstes Ende zuerst. */
function statementsOf(db: DbOrTx, accountId: string) {
  return db
    .select({ documentId: financeAccountStatementDocuments.documentId, documentNumber: documents.number, periodFrom: financeAccountStatementDocuments.periodFrom, periodTo: financeAccountStatementDocuments.periodTo })
    .from(financeAccountStatementDocuments)
    .innerJoin(documents, eq(documents.id, financeAccountStatementDocuments.documentId))
    .where(and(eq(financeAccountStatementDocuments.accountId, accountId), ne(documents.status, 'voided')))
    .orderBy(desc(financeAccountStatementDocuments.periodTo))
    .all();
}

/** Die jüngste Bestätigung „rückgerechnet“ einer Kasse im Jahr (Schritt 2). */
export function cashRecomputedConfirmationInternal(db: DbOrTx, fiscalYearId: string, accountId: string): { note: string | null; at: string; byUserId: string } | null {
  const row = latestConfirmation(db, fiscalYearId, accountId);
  return row && row.kind === 'cashRecomputed' ? { note: row.note, at: row.at, byUserId: row.byUserId } : null;
}

function latestConfirmation(db: DbOrTx, fiscalYearId: string, accountId: string) {
  const row = db
    .select()
    .from(financeAccountYearConfirmations)
    .where(and(eq(financeAccountYearConfirmations.fiscalYearId, fiscalYearId), eq(financeAccountYearConfirmations.accountId, accountId)))
    .orderBy(desc(financeAccountYearConfirmations.at), desc(financeAccountYearConfirmations.id))
    .get();
  return row ? { kind: row.kind, note: row.note, at: row.at, byUserId: row.byUserId } : null;
}

function rowOf(db: DbOrTx, year: FinanceFiscalYearRow, account: FinanceAccountRow, balances: Map<string, number>): AccountYearStatementRow {
  const lastMovementOn = lastMovementOf(db, account.id, year);
  const all = statementsOf(db, account.id);
  // Im Jahr: endet darin, oder beginnt darin und reicht darüber hinaus (Auszug vom 20.12. bis 10.01.).
  // Ohne Beginn zählt ein Auszug, der im Monat nach dem Stichtag endet, für das Jahr, das er schließt (Schlussdurchsicht M2).
  const inYear = all.filter((s) => (s.periodTo >= year.startsOn && s.periodTo <= year.endsOn) || (s.periodFrom !== null && s.periodFrom <= year.endsOn && s.periodTo > year.endsOn) || (s.periodFrom === null && s.periodTo > year.endsOn && s.periodTo <= addDaysInternal(year.endsOn, 31)));
  const withCover = inYear.map((s) => ({ ...s, documentNumber: s.documentNumber ?? '', covers: statementCoversYearEnd(s.periodTo, year.endsOn, lastMovementOn) }));
  const statement = withCover.find((s) => s.covers) ?? withCover[0] ?? null;
  const imported = db
    .select({ closingCents: financeImportRuns.closingCents, periodTo: financeImportRuns.periodTo })
    .from(financeImportRuns)
    .where(and(eq(financeImportRuns.accountId, account.id), isNotNull(financeImportRuns.finishedAt), isNull(financeImportRuns.discardedAt), isNotNull(financeImportRuns.closingCents), gte(financeImportRuns.periodTo, year.startsOn), lte(financeImportRuns.periodTo, year.endsOn)))
    // Mehrere Exporte bis zum selben Tag (vormittags, nachmittags): der jüngste trägt den Saldo — wie `latestStatementInternal`.
    .orderBy(desc(financeImportRuns.periodTo), desc(financeImportRuns.startedAt))
    .get();
  const kind = account.kind === 'bank' ? 'bank' : 'paymentService';
  return {
    accountId: account.id,
    name: account.name,
    kind,
    needsPdf: kind === 'bank' && !statement?.covers,
    statement,
    lastStatementTo: all.find((s) => s.periodTo <= year.endsOn)?.periodTo ?? statement?.periodTo ?? null,
    lastMovementOn,
    balanceAtYearEndCents: balances.get(account.id) ?? 0,
    importedBalance: imported && imported.closingCents !== null && imported.periodTo ? { cents: imported.closingCents, on: imported.periodTo } : null,
    confirmation: latestConfirmation(db, year.id, account.id),
  };
}

/** Die Konten des Jahres mit Auszug, Saldo und Bestätigung — ohne Rechteprüfung. */
export function accountStatementsForYearInternal(db: DbOrTx, fiscalYearId: string): AccountYearStatementRow[] {
  const year = db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, fiscalYearId)).get();
  if (!year) return [];
  const balances = new Map(accountBalancesAt(db, year.endsOn).map((b) => [b.accountId, b.balanceCents]));
  return accountsOfYear(db, year).map((account) => rowOf(db, year, account, balances));
}

/** Bankkonten ohne deckenden Auszug und ohne Begründung — sie halten das Festschreiben der Berichte auf. */
export function missingStatementPdfsInternal(db: DbOrTx, fiscalYearId: string): { accountId: string; name: string }[] {
  return accountStatementsForYearInternal(db, fiscalYearId)
    .filter((r) => r.kind === 'bank' && r.needsPdf && r.confirmation?.kind !== 'missingJustified')
    .map((r) => ({ accountId: r.accountId, name: r.name }));
}

function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';
}

const period = { periodFrom: z.string().date().nullable().optional(), periodTo: z.string().date() };
const beforeFrom = (v: { periodFrom?: string | null; periodTo: string }) => !v.periodFrom || v.periodFrom <= v.periodTo;
const fileSchema = z
  .object({ accountId: z.string().min(1), ...period, bytes: z.custom<Uint8Array>((val) => val instanceof Uint8Array, { message: 'invalidBytes' }), fileName: z.string().trim().max(300).optional() })
  .refine(beforeFrom, { path: ['periodTo'], message: 'beforePeriodFrom' });
const linkSchema = z.object({ accountId: z.string().min(1), documentId: z.string().min(1), ...period }).refine(beforeFrom, { path: ['periodTo'], message: 'beforePeriodFrom' });

function loadAccount(db: DbOrTx, id: string): FinanceAccountRow | null {
  return db.select().from(financeAccounts).where(eq(financeAccounts.id, id)).get() ?? null;
}

/** In der Transaktion: Zeile, Bezüge auf Konto und Geschäftsjahr, Protokoll. */
function recordStatementInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, account: FinanceAccountRow, input: { documentId: string; documentNumber: string; periodFrom: string | null; periodTo: string }, action: 'finance.account.statementFile' | 'finance.account.statementLink'): { id: string; documentId: string; documentNumber: string } {
  // Dasselbe Dokument am selben Konto nur einmal — die Tabelle ist unveränderlich (Schlussdurchsicht M6).
  const known = tx.select().from(financeAccountStatementDocuments).where(and(eq(financeAccountStatementDocuments.accountId, account.id), eq(financeAccountStatementDocuments.documentId, input.documentId))).get();
  if (known) return { id: known.id, documentId: input.documentId, documentNumber: input.documentNumber };
  const id = newId();
  tx.insert(financeAccountStatementDocuments).values({ id, accountId: account.id, documentId: input.documentId, periodFrom: input.periodFrom, periodTo: input.periodTo, createdAt: isoNow(deps.clock), createdByUserId: ctx.userId ?? 'system' }).run();
  linkDocumentInternal(tx, deps, { documentId: input.documentId, entityType: 'financeAccount', entityId: account.id });
  // Jedes Jahr, das der Zeitraum berührt; ohne Beginn auch das Jahr vor einem Ende im Januar (Schlussdurchsicht M2).
  const year = fiscalYearForInternal(tx, input.periodTo);
  const touched = [year, input.periodFrom ? fiscalYearForInternal(tx, input.periodFrom) : fiscalYearForInternal(tx, addDaysInternal(input.periodTo, -31))];
  for (const y of new Set(touched.filter((t) => t !== null).map((t) => t!.id))) linkDocumentInternal(tx, deps, { documentId: input.documentId, entityType: 'financeFiscalYear', entityId: y });
  financeAudit(tx, deps, ctx, { action, entity: 'financeAccountStatementDocument', id, after: { accountId: account.id, documentId: input.documentId, periodFrom: input.periodFrom, periodTo: input.periodTo }, params: { designation: year?.designation ?? null, documentNumber: input.documentNumber } });
  return { id, documentId: input.documentId, documentNumber: input.documentNumber };
}

/** `finance.entriesWrite`: einen Kontoauszug (PDF bis 10 MB) im Namen des Kontos ablegen, mit dem Zeitraum, den er abdeckt. */
export async function fileAccountStatementDocument(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string; documentId: string; documentNumber: string }>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, fileSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (v.bytes.length > STATEMENT_MAX_BYTES) return invalid([{ path: 'bytes', message: 'tooLarge' }]);
  if (!isPdf(v.bytes)) return invalid([{ path: 'bytes', message: 'notPdf' }]);
  const account = loadAccount(deps.db, v.accountId);
  if (!account) return notFound('financeAccount', v.accountId);
  if (account.kind === 'cash') return financeConflict('statementNotForCash');
  const result = await receiveGeneratedUpload(deps, ctx, {
    bytes: v.bytes,
    typeKey: STATEMENT_TYPE_KEY,
    subject: `Kontoauszug ${account.name}`,
    documentDate: v.periodTo,
    // Das Geschäftsjahr hängt der Dienst selbst an: es verlangte sonst `finance.periodClose` (Bezug des Jahres).
    links: [{ entityType: 'financeAccount', entityId: account.id }],
    afterReceive: (tx, doc) => recordStatementInternal(tx, deps, ctx, account, { documentId: doc.id, documentNumber: doc.number ?? '', periodFrom: v.periodFrom ?? null, periodTo: v.periodTo }, 'finance.account.statementFile'),
  });
  if (!result.ok) return result;
  return ok(result.value.after!);
}

/** `finance.entriesWrite`: einen Kontoauszug aus der Akte (Art `bank-statement`, festgeschrieben, nicht storniert) dem Konto zuordnen. */
export async function linkAccountStatementDocument(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string; documentId: string; documentNumber: string }>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, linkSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const account = loadAccount(deps.db, v.accountId);
  if (!account) return notFound('financeAccount', v.accountId);
  if (account.kind === 'cash') return financeConflict('statementNotForCash');
  const doc = await getDocumentRecord(deps, ctx, v.documentId);
  if (!doc.ok) return doc;
  if (doc.value.typeKey !== STATEMENT_TYPE_KEY || doc.value.phase !== 'issued' || doc.value.status === 'voided') return invalid([{ path: 'documentId', message: 'notABankStatement' }]);
  return deps.db.transaction((tx: DbOrTx) => ok(recordStatementInternal(tx, deps, ctx, account, { documentId: doc.value.id, documentNumber: doc.value.number ?? '', periodFrom: v.periodFrom ?? null, periodTo: v.periodTo }, 'finance.account.statementLink')));
}

const suggestSchema = z
  .object({ fiscalYearId: z.string().min(1), accountId: z.string().min(1), documentId: z.string().min(1).optional(), bytes: z.custom<Uint8Array>((val) => val instanceof Uint8Array, { message: 'invalidBytes' }).optional() })
  .refine((v) => Boolean(v.documentId) !== Boolean(v.bytes), { path: ['documentId'], message: 'documentOrBytes' });

/**
 * `finance.read`: der Zeitraum eines Auszugs aus dem Text des PDFs (hochgeladen oder aus der Akte), ob er den Stichtag
 * abdeckt und der Saldo laut Kompass am Jahresende — ein Vorschlag für den Dialog. Ohne Texterkennung oder ohne
 * erkennbares Datum `null`.
 */
export async function suggestStatementPeriod(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ periodFrom: string | null; periodTo: string; covers: boolean; balanceAtYearEndCents: number } | null>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, suggestSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, v.fiscalYearId)).get();
  if (!year) return notFound('financeFiscalYear', v.fiscalYearId);
  const account = loadAccount(deps.db, v.accountId);
  if (!account) return notFound('financeAccount', v.accountId);
  let bytes = v.bytes;
  if (!bytes) {
    const doc = await getDocument(deps, ctx, v.documentId!);
    if (!doc.ok) return doc;
    bytes = doc.value.bytes;
  }
  const probe = await deps.textExtraction.probe().catch(() => ({ ok: false as const }));
  if (!probe.ok) return ok(null);
  const pages = await deps.textExtraction.extract({ bytes, languages: probe.languages.includes('deu') ? ['deu'] : probe.languages.slice(0, 1) }).catch(() => null);
  if (!pages) return ok(null);
  const found = suggestPeriodFromText(pages.map((p) => p.text).join('\n'));
  if (!found) return ok(null);
  const balance = accountBalancesAt(deps.db, year.endsOn).find((b) => b.accountId === account.id)?.balanceCents ?? 0;
  return ok({ ...found, covers: statementCoversYearEnd(found.periodTo, year.endsOn, lastMovementOf(deps.db, account.id, year)), balanceAtYearEndCents: balance });
}

const confirmSchema = z
  .object({ fiscalYearId: z.string().min(1), accountId: z.string().min(1), kind: z.enum(ACCOUNT_YEAR_CONFIRMATION_KINDS), note: z.string().trim().min(1).max(500).nullable().optional() })
  .refine((v) => (v.kind !== 'missingJustified' && v.kind !== 'cashRecomputed') || Boolean(v.note), { path: ['note'], message: 'required' });

const KIND_FITS: Record<AccountYearConfirmationKind, FinanceAccountRow['kind']> = { balanceConfirmed: 'paymentService', notReconcilable: 'paymentService', missingJustified: 'bank', cashRecomputed: 'cash' };

/**
 * `finance.periodClose`, **`humanOnly`** (persönliche Erklärung): für einen Zahlungsdienst den Saldo bestätigen oder
 * „nicht abstimmbar“ erklären, für ein Bankkonto das Fehlen des Auszugs begründen, für eine Kasse ohne Zählung am
 * Stichtag den rückgerechneten Bestand bestätigen (`cashRecomputed`, mit Begründung) — nur, wenn Schritt 2 für sie eine
 * spätere Zählung ohne Differenz kennt, sonst `cashNotRecomputable` (Board 14a). Nur anhängen; es gilt die jüngste.
 */
export async function confirmAccountForYear(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string }>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, confirmSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, v.fiscalYearId)).get();
  if (!year) return notFound('financeFiscalYear', v.fiscalYearId);
  const account = loadAccount(deps.db, v.accountId);
  if (!account) return notFound('financeAccount', v.accountId);
  if (KIND_FITS[v.kind] !== account.kind) return financeConflict('accountKindMismatch');
  if (v.kind === 'cashRecomputed') {
    const row = cashAtYearEndInternal(deps.db, year).find((a) => a.accountId === account.id);
    if (!row || row.count !== null || row.later === null || row.later.differenceCents !== 0) return financeConflict('cashNotRecomputable', { account: account.name });
  }
  return deps.db.transaction((tx: DbOrTx) => {
    const id = newId();
    tx.insert(financeAccountYearConfirmations).values({ id, fiscalYearId: year.id, accountId: account.id, kind: v.kind, note: v.note ?? null, at: isoNow(deps.clock), byUserId: ctx.userId ?? 'system' }).run();
    financeAudit(tx, deps, ctx, { action: 'finance.account.yearConfirm', entity: 'financeAccountYearConfirmation', id, after: { fiscalYearId: year.id, accountId: account.id, kind: v.kind }, params: { designation: year.designation, kind: v.kind } });
    return ok({ id });
  });
}
