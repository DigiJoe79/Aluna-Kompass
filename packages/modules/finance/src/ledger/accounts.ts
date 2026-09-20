import { expectedVersionField, isoNow, newId, notFound, ok, requirePermission, staleVersion, validate, writeSettingInternal, hasPermission, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { financeAccounts, financeMoneyLines, type FinanceAccountRow } from '../schema';
import { requireFinanceRead } from './access';
import { isValidIban, normalizeIban } from './iban';

const base = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['bank', 'cash', 'paymentService']),
  iban: z.string().trim().max(42).nullable().optional(),
  bic: z.string().trim().max(11).nullable().optional(),
  bankName: z.string().trim().max(120).nullable().optional(),
  openingBalanceCents: z.number().int().nullable().optional(),
  openingDate: z.string().date().nullable().optional(),
  importFormat: z.enum(['camt053', 'csv']).nullable().optional(),
  isMain: z.boolean().default(false),
});
type Fields = z.infer<typeof base>;

function check(v: Pick<Fields, 'kind' | 'iban' | 'openingBalanceCents' | 'openingDate'>, c: z.RefinementCtx): void {
  const iban = v.iban ? normalizeIban(v.iban) : '';
  if (v.kind === 'bank' && !iban) c.addIssue({ code: 'custom', path: ['iban'], message: 'ibanRequiredForBank' });
  if (v.kind === 'cash' && iban) c.addIssue({ code: 'custom', path: ['iban'], message: 'cashHasNoIban' });
  if (iban && !isValidIban(iban)) c.addIssue({ code: 'custom', path: ['iban'], message: 'invalidIban' });
  if ((v.openingBalanceCents ?? null) !== null && !v.openingDate) c.addIssue({ code: 'custom', path: ['openingDate'], message: 'openingDateRequired' });
  if (v.openingDate && (v.openingBalanceCents ?? null) === null) c.addIssue({ code: 'custom', path: ['openingBalanceCents'], message: 'openingBalanceRequired' });
}

export const accountCreateSchema = base.superRefine(check);
export const accountUpdateSchema = base.partial().extend({ id: z.string().min(1), expectedVersion: expectedVersionField });

export type AccountView = FinanceAccountRow;

/** Auch der Entwurf einer Geldzeile belegt das Konto — die eine Stelle, die „benutzt“ entscheidet. */
export function accountInUseInternal(db: DbOrTx, accountId: string): boolean {
  return !!db.select({ id: financeMoneyLines.id }).from(financeMoneyLines).where(eq(financeMoneyLines.accountId, accountId)).get();
}

/** E22 — eine Quelle: Das Hauptkonto schreibt die Bankdaten des Vereins nach; in den Vereinsdaten sind sie dann nur lesbar. */
function publishMainAccount(tx: DbOrTx, deps: Deps, ctx: CallContext, row: Pick<FinanceAccountRow, 'iban' | 'bic' | 'bankName'>): void {
  writeSettingInternal(tx, deps, ctx, 'organization.iban', row.iban ?? '', 'settings.financeMainAccount');
  writeSettingInternal(tx, deps, ctx, 'organization.bic', row.bic ?? '', 'settings.financeMainAccount');
  writeSettingInternal(tx, deps, ctx, 'organization.bankName', row.bankName ?? '', 'settings.financeMainAccount');
}

export async function createAccount(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AccountView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, accountCreateSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (v.isMain && v.kind !== 'bank') return financeConflict('mainAccountMustBeBank');

  return deps.db.transaction((tx: DbOrTx) => {
    const id = newId();
    const now = isoNow(deps.clock);
    if (v.isMain) tx.update(financeAccounts).set({ isMain: false, updatedAt: now }).where(eq(financeAccounts.isMain, true)).run();
    const row = { id, name: v.name, kind: v.kind, iban: v.iban ? normalizeIban(v.iban) : null, bic: v.bic || null, bankName: v.bankName || null, openingBalanceCents: v.openingBalanceCents ?? null, openingDate: v.openingDate ?? null, importFormat: v.importFormat ?? null, isMain: v.isMain, isActive: true, createdAt: now, updatedAt: now };
    tx.insert(financeAccounts).values(row).run();
    if (row.isMain) publishMainAccount(tx, deps, ctx, row);
    financeAudit(tx, deps, ctx, { action: 'finance.account.create', entity: 'financeAccount', id, after: row, summary: `Geldkonto ${id} angelegt` });
    return ok(row);
  });
}

export async function updateAccount(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AccountView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, accountUpdateSchema, input);
  if (!parsed.ok) return parsed;
  const { id, expectedVersion, ...changes } = parsed.value;
  const before = deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, id)).get();
  if (!before) return notFound('financeAccount', id);
  const stale = staleVersion(expectedVersion, before.updatedAt);
  if (stale) return stale;

  // Die Regeln gelten für das Ergebnis, nicht für die Änderung: erst mischen, dann prüfen.
  const merged = { ...before, ...Object.fromEntries(Object.entries(changes).filter(([, val]) => val !== undefined)) };
  const rechecked = validate(deps, accountCreateSchema, { name: merged.name, kind: merged.kind, iban: merged.iban, bic: merged.bic, bankName: merged.bankName, openingBalanceCents: merged.openingBalanceCents, openingDate: merged.openingDate, importFormat: merged.importFormat, isMain: merged.isMain });
  if (!rechecked.ok) return rechecked;
  if (merged.isMain && merged.kind !== 'bank') return financeConflict('mainAccountMustBeBank');
  if (merged.isMain && !before.isActive) return financeConflict('mainAccountMustStayActive');

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    if (merged.isMain && !before.isMain) tx.update(financeAccounts).set({ isMain: false, updatedAt: now }).where(eq(financeAccounts.isMain, true)).run();
    const after = { ...merged, iban: merged.iban ? normalizeIban(merged.iban) : null, updatedAt: now };
    tx.update(financeAccounts).set(after).where(eq(financeAccounts.id, id)).run();
    if (after.isMain) publishMainAccount(tx, deps, ctx, after);
    // `bankDetailsChanged` statt `ibanChanged`: der Verbotstest von audit.ts greift auf jede Zeichenfolge mit „iban“.
    financeAudit(tx, deps, ctx, { action: 'finance.account.update', entity: 'financeAccount', id, before, after: { ...after, bankDetailsChanged: after.iban !== before.iban }, summary: `Geldkonto ${id} geändert` });
    return ok(after);
  });
}

export const accountActiveSchema = z.object({ id: z.string().min(1), isActive: z.boolean(), expectedVersion: expectedVersionField });

export async function setAccountActive(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AccountView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, accountActiveSchema, input);
  if (!parsed.ok) return parsed;
  const before = deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, parsed.value.id)).get();
  if (!before) return notFound('financeAccount', parsed.value.id);
  const stale = staleVersion(parsed.value.expectedVersion, before.updatedAt);
  if (stale) return stale;
  if (before.isMain && !parsed.value.isActive) return financeConflict('mainAccountMustStayActive');
  return deps.db.transaction((tx: DbOrTx) => {
    const after = { ...before, isActive: parsed.value.isActive, updatedAt: isoNow(deps.clock) };
    tx.update(financeAccounts).set({ isActive: after.isActive, updatedAt: after.updatedAt }).where(eq(financeAccounts.id, before.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.account.setActive', entity: 'financeAccount', id: before.id, before, after, summary: `Geldkonto ${before.id} ${after.isActive ? 'aktiviert' : 'stillgelegt'}` });
    return ok(after);
  });
}

export const accountDeleteSchema = z.object({ id: z.string().min(1) });

export async function deleteAccount(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string }>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, accountDeleteSchema, input);
  if (!parsed.ok) return parsed;
  const before = deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, parsed.value.id)).get();
  if (!before) return notFound('financeAccount', parsed.value.id);
  if (before.isMain) return financeConflict('mainAccountMustStayActive');
  if (accountInUseInternal(deps.db, before.id)) return financeConflict('accountInUse');
  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(financeAccounts).where(eq(financeAccounts.id, before.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.account.delete', entity: 'financeAccount', id: before.id, before, summary: `Geldkonto ${before.id} gelöscht` });
    return ok({ id: before.id });
  });
}

export const accountListSchema = z.object({ includeInactive: z.boolean().default(false) });

export async function listAccounts(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AccountView[]>> {
  const denied = requireFinanceRead(ctx, 'overview');
  if (denied) return denied;
  const parsed = validate(deps, accountListSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const rows = deps.db.select().from(financeAccounts).orderBy(asc(financeAccounts.name)).all().filter((r) => parsed.value.includeInactive || r.isActive);
  // Bankdaten sind personennah (ein Vereinskonto bei einer Privatperson, ein PayPal-Konto auf einen Namen): nur mit `finance.read`.
  const full = hasPermission(ctx, 'finance.read');
  return ok(full ? rows : rows.map((r) => ({ ...r, iban: null, bic: null, bankName: null })));
}
