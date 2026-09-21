import { isoNow, newId, notFound, ok, requireHumanChannel, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts, displayName, type ContactRow } from '@kompass/module-contacts';
import { abortIssue, issueGeneratedDocument } from '@kompass/module-dms';
import { asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { financeAccounts, financeCashCounts, financeCategories, financeEntries, type FinanceCashCountRow } from '../schema';
import { cashCountTemplate, type CashCountTemplateInput } from './cash-count-template';
import { formatEuro } from './cash-check';
import { entryViewInternal, writeLinesInternal, type EntryView } from './entries';
import { bookEntry, finalizeInternal } from './finalize';
import { accountBalancesAt } from './queries';
import { requireFinanceRead } from './access';
import { writeVoucherLink } from './vouchers';

export type CashCountKind = 'equal' | 'surplus' | 'shortage';
export type CashCountView = FinanceCashCountRow & { kind: CashCountKind };

function kindOf(differenceCents: number): CashCountKind {
  return differenceCents === 0 ? 'equal' : differenceCents > 0 ? 'surplus' : 'shortage';
}

function bookCentsFor(db: DbOrTx, accountId: string, date: string): number {
  return accountBalancesAt(db, date).find((a) => a.accountId === accountId)?.balanceCents ?? 0;
}

function cashCountView(row: FinanceCashCountRow): CashCountView {
  return { ...row, kind: kindOf(row.differenceCents) };
}

/** Zwei verschiedene, existierende Kontakte der Art Person — die Zählenden (Entschieden 1). */
function resolveCounters(db: DbOrTx, oneId: string, twoId: string): Result<{ one: ContactRow; two: ContactRow }> {
  if (oneId === twoId) return financeConflict('cashCountSameCounter');
  const one = db.select().from(contacts).where(eq(contacts.id, oneId)).get();
  if (!one) return notFound('contact', oneId);
  if (one.kind !== 'person') return financeConflict('cashCountCounterNotPerson');
  const two = db.select().from(contacts).where(eq(contacts.id, twoId)).get();
  if (!two) return notFound('contact', twoId);
  if (two.kind !== 'person') return financeConflict('cashCountCounterNotPerson');
  return ok({ one, two });
}

function denominationEntries(denominations: Record<string, number> | undefined): CashCountTemplateInput['denominations'] {
  if (!denominations) return null;
  const entries = Object.entries(denominations)
    .map(([cents, count]) => ({ cents: Number(cents), count }))
    .filter((d) => d.count > 0)
    .sort((a, b) => b.cents - a.cents);
  return entries.length > 0 ? entries : null;
}

const countCashSchema = z.object({
  accountId: z.string().min(1),
  countedOn: z.string().date(),
  countedCents: z.number().int().min(0),
  counterOneContactId: z.string().min(1),
  counterTwoContactId: z.string().min(1),
  note: z.string().trim().min(1).max(500).optional(),
  denominations: z.record(z.string(), z.number().int().min(0)).optional(),
});

export interface CountCashResult {
  count: CashCountView;
  entry: EntryView | null;
  documentNumber: string;
}

/**
 * Eine Kassenzählung: gespeicherte Tatsache, Zählprotokoll, Buchung der
 * Abweichung — in einer Transaktion (Spec 5.5). `finance.entriesFinalize`,
 * **`humanOnly`**.
 */
export async function countCash(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<CountCashResult>> {
  const denied = requirePermission(ctx, 'finance.entriesFinalize');
  if (denied) return denied;
  const humanOnly = requireHumanChannel(deps, ctx, 'finance.mcpHumanOnlyAllowed');
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, countCashSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const account = deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, v.accountId)).get();
  if (!account) return notFound('financeAccount', v.accountId);
  if (account.kind !== 'cash') return financeConflict('cashCountNotCash', { account: account.name });
  const today = isoNow(deps.clock).slice(0, 10);
  if (v.countedOn > today) return financeConflict('cashCountInFuture');

  const counters = resolveCounters(deps.db, v.counterOneContactId, v.counterTwoContactId);
  if (!counters.ok) return counters;

  const bookCents = bookCentsFor(deps.db, v.accountId, v.countedOn);
  const differenceCents = v.countedCents - bookCents;
  const kind = kindOf(differenceCents);
  if (kind === 'shortage' && !v.note) return financeConflict('cashCountNeedsNote');

  const counterOneName = displayName(counters.value.one);
  const counterTwoName = displayName(counters.value.two);
  const countId = newId();
  const entryId = kind === 'equal' ? null : newId();

  const result = await issueGeneratedDocument<CountCashResult>(deps, ctx, {
    templateKey: cashCountTemplate.key,
    input: {
      accountName: account.name,
      countedOn: v.countedOn,
      bookAmount: formatEuro(bookCents),
      countedAmount: formatEuro(v.countedCents),
      differenceAmount: formatEuro(differenceCents),
      kind,
      note: v.note ?? null,
      denominations: denominationEntries(v.denominations),
      counterOneName,
      counterTwoName,
    } satisfies CashCountTemplateInput,
    subject: `Kassenzählung ${account.name} ${v.countedOn}`,
    documentDate: v.countedOn,
    links: entryId ? [{ entityType: 'financeCashCount', entityId: countId }, { entityType: 'financeEntry', entityId: entryId }] : [{ entityType: 'financeCashCount', entityId: countId }],
    afterIssue: (tx, doc) => {
      // Zwischen Rendern und Transaktion vergeht Zeit — Konto und Buchbestand erneut prüfen (Muster issue.ts).
      const freshAccount = tx.select().from(financeAccounts).where(eq(financeAccounts.id, v.accountId)).get();
      if (!freshAccount || freshAccount.kind !== 'cash') return abortIssue(notFound('financeAccount', v.accountId));
      const freshBookCents = bookCentsFor(tx, v.accountId, v.countedOn);
      const freshDifference = v.countedCents - freshBookCents;
      const freshKind = kindOf(freshDifference);

      let finalEntry: EntryView | null = null;
      if (freshKind !== 'equal' && entryId) {
        const categoryKey = freshKind === 'surplus' ? 'cash-surplus' : 'cash-shortage';
        const category = tx.select().from(financeCategories).where(eq(financeCategories.key, categoryKey)).get();
        if (!category) return abortIssue(notFound('financeCategory', categoryKey));
        const now = isoNow(deps.clock);
        tx.insert(financeEntries)
          .values({
            id: entryId, number: null, entryDate: v.countedOn,
            text: freshKind === 'surplus' ? `Kassenzählung ${v.countedOn}: Differenz` : `Kassenzählung ${v.countedOn}: Fehlbetrag`,
            status: 'draft', createdByUserId: ctx.userId ?? 'system', createdChannel: ctx.channel, createdAt: now, updatedAt: now,
          })
          .run();
        writeLinesInternal(tx, entryId, {
          moneyLines: [{ accountId: v.accountId, amountCents: freshDifference }],
          allocationLines: [{ categoryId: category.id, amountCents: freshDifference, taxCode: 'none', rateKind: 'standard', projectId: null, purposeId: null, contactId: null, abroad: false, originLineId: null, addsToAssets: false }],
        });
        const finalized = finalizeInternal(tx, deps, ctx, entryId);
        if (!finalized.ok) return abortIssue(finalized);
        writeVoucherLink(tx, deps, ctx, { entryId, documentId: doc.id, documentNumber: doc.number, documentChecksum: doc.fileChecksum, viaUpload: false });
        finalEntry = entryViewInternal(tx, entryId)!; // neu lesen: trägt jetzt den Beleg
      }

      const row: FinanceCashCountRow = {
        id: countId, accountId: v.accountId, countedOn: v.countedOn, countedCents: v.countedCents, bookCents: freshBookCents, differenceCents: freshDifference,
        counterOneContactId: v.counterOneContactId, counterTwoContactId: v.counterTwoContactId, counterOneName, counterTwoName,
        note: v.note ?? null, denominations: v.denominations ? JSON.stringify(v.denominations) : null,
        documentId: doc.id, documentNumber: doc.number, entryId: finalEntry?.id ?? null, createdByUserId: ctx.userId ?? 'system', createdAt: isoNow(deps.clock),
      };
      tx.insert(financeCashCounts).values(row).run();
      financeAudit(tx, deps, ctx, {
        action: 'finance.cashCount.record', entity: 'financeCashCount', id: countId,
        after: { accountId: row.accountId, countedOn: row.countedOn, kind: freshKind, differenceCents: row.differenceCents, documentNumber: row.documentNumber, entryId: row.entryId },
        summary: `Kassenzählung ${doc.number} erfasst`,
      });
      return { count: cashCountView(row), entry: finalEntry, documentNumber: doc.number };
    },
  });
  if (!result.ok) return result;
  return ok(result.value.after!);
}

const emptyDonationBoxSchema = z.object({
  accountId: z.string().min(1),
  date: z.string().date(),
  amountCents: z.number().int().positive(),
  counterOneContactId: z.string().min(1),
  counterTwoContactId: z.string().min(1),
  categoryId: z.string().min(1).optional(),
  boxLabel: z.string().trim().min(1).max(120),
});

export interface EmptyDonationBoxResult {
  entry: EntryView;
  documentNumber: string;
}

/**
 * Eine geleerte Spendendose ist kein Konto — eine Einnahme ohne Kontakt in
 * eine Kasse, mit demselben Zählprotokoll (Spec 5.5). `finance.entriesFinalize`,
 * **`humanOnly`**.
 */
export async function emptyDonationBox(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<EmptyDonationBoxResult>> {
  const denied = requirePermission(ctx, 'finance.entriesFinalize');
  if (denied) return denied;
  const humanOnly = requireHumanChannel(deps, ctx, 'finance.mcpHumanOnlyAllowed');
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, emptyDonationBoxSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const account = deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, v.accountId)).get();
  if (!account) return notFound('financeAccount', v.accountId);
  if (account.kind !== 'cash') return financeConflict('cashCountNotCash', { account: account.name });
  const today = isoNow(deps.clock).slice(0, 10);
  if (v.date > today) return financeConflict('cashCountInFuture');

  const counters = resolveCounters(deps.db, v.counterOneContactId, v.counterTwoContactId);
  if (!counters.ok) return counters;

  let category = v.categoryId ? deps.db.select().from(financeCategories).where(eq(financeCategories.id, v.categoryId)).get() : undefined;
  if (v.categoryId && !category) return notFound('financeCategory', v.categoryId);
  if (!category) {
    category = deps.db
      .select()
      .from(financeCategories)
      .where(eq(financeCategories.incomeKind, 'donation'))
      .orderBy(asc(financeCategories.key))
      .all()
      .find((c) => c.sphere === 'ideal' && c.isActive);
  }
  if (!category) return notFound('financeCategory', 'donations');
  const categoryId = category.id;

  const counterOneName = displayName(counters.value.one);
  const counterTwoName = displayName(counters.value.two);
  const countId = newId();
  const entryId = newId();

  const result = await issueGeneratedDocument<EmptyDonationBoxResult>(deps, ctx, {
    templateKey: cashCountTemplate.key,
    input: {
      accountName: `${account.name} — ${v.boxLabel}`,
      countedOn: v.date,
      bookAmount: formatEuro(0),
      countedAmount: formatEuro(v.amountCents),
      differenceAmount: formatEuro(v.amountCents),
      kind: 'surplus',
      note: null,
      denominations: null,
      counterOneName,
      counterTwoName,
    } satisfies CashCountTemplateInput,
    subject: `Spendendose ${v.boxLabel} geleert ${v.date}`,
    documentDate: v.date,
    links: [{ entityType: 'financeCashCount', entityId: countId }, { entityType: 'financeEntry', entityId: entryId }],
    afterIssue: (tx, doc) => {
      const freshAccount = tx.select().from(financeAccounts).where(eq(financeAccounts.id, v.accountId)).get();
      if (!freshAccount || freshAccount.kind !== 'cash') return abortIssue(notFound('financeAccount', v.accountId));
      const now = isoNow(deps.clock);
      tx.insert(financeEntries)
        .values({ id: entryId, number: null, entryDate: v.date, text: `Spendendose ${v.boxLabel} geleert`, status: 'draft', createdByUserId: ctx.userId ?? 'system', createdChannel: ctx.channel, createdAt: now, updatedAt: now })
        .run();
      writeLinesInternal(tx, entryId, {
        moneyLines: [{ accountId: v.accountId, amountCents: v.amountCents }],
        allocationLines: [{ categoryId, amountCents: v.amountCents, taxCode: 'none', rateKind: 'standard', projectId: null, purposeId: null, contactId: null, abroad: false, originLineId: null, addsToAssets: false }],
      });
      const finalized = finalizeInternal(tx, deps, ctx, entryId);
      if (!finalized.ok) return abortIssue(finalized);
      writeVoucherLink(tx, deps, ctx, { entryId, documentId: doc.id, documentNumber: doc.number, documentChecksum: doc.fileChecksum, viaUpload: false });
      return { entry: entryViewInternal(tx, entryId)!, documentNumber: doc.number };
    },
  });
  if (!result.ok) return result;
  return ok(result.value.after!);
}

const moveCashSchema = z.object({
  fromAccountId: z.string().min(1),
  toAccountId: z.string().min(1),
  date: z.string().date(),
  amountCents: z.number().int().positive(),
  text: z.string().trim().min(1).max(300).optional(),
});

/** Bargeld zwischen Bank und Kasse bewegen — sofort festgeschrieben, genau ein Konto ist eine Kasse (Spec 5.5). `finance.entriesFinalize`, **`humanOnly`**. */
export async function moveCash(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<EntryView>> {
  const deniedWrite = requirePermission(ctx, 'finance.entriesWrite');
  if (deniedWrite) return deniedWrite;
  const deniedFinalize = requirePermission(ctx, 'finance.entriesFinalize');
  if (deniedFinalize) return deniedFinalize;
  const humanOnly = requireHumanChannel(deps, ctx, 'finance.mcpHumanOnlyAllowed');
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, moveCashSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const from = deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, v.fromAccountId)).get();
  if (!from) return notFound('financeAccount', v.fromAccountId);
  const to = deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, v.toAccountId)).get();
  if (!to) return notFound('financeAccount', v.toAccountId);
  const cashCount = [from.kind, to.kind].filter((k) => k === 'cash').length;
  if (cashCount !== 1) return financeConflict('cashMoveNeedsOneCash');

  return bookEntry(deps, ctx, {
    entryDate: v.date,
    text: v.text ?? `Bargeldbewegung ${v.date}`,
    moneyLines: [
      { accountId: v.fromAccountId, amountCents: -v.amountCents },
      { accountId: v.toAccountId, amountCents: v.amountCents },
    ],
    allocationLines: [],
  });
}

const listCashCountsSchema = z.object({ accountId: z.string().min(1).optional(), limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).default(0) });

/** `finance.read`: die gespeicherten Zählungen, neueste zuerst. */
export async function listCashCounts(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ counts: CashCountView[]; total: number }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listCashCountsSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const f = parsed.value;

  let rows = deps.db.select().from(financeCashCounts).orderBy(desc(financeCashCounts.countedOn), desc(financeCashCounts.createdAt)).all();
  if (f.accountId) rows = rows.filter((r) => r.accountId === f.accountId);
  const total = rows.length;
  const counts = rows.slice(f.offset, f.offset + f.limit).map(cashCountView);
  return ok({ counts, total });
}

/** Für `getBalances` (F3b Task 3): die jüngste Zählung eines Kontos, reine Abfrage ohne Rechteprüfung. */
export function lastCountInternal(db: DbOrTx, accountId: string): { countedOn: string; countedCents: number } | null {
  const row = db.select().from(financeCashCounts).where(eq(financeCashCounts.accountId, accountId)).orderBy(desc(financeCashCounts.countedOn), desc(financeCashCounts.createdAt)).limit(1).get();
  return row ? { countedOn: row.countedOn, countedCents: row.countedCents } : null;
}
