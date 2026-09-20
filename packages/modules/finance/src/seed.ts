import { unwrap, type CallContext, type Deps } from '@kompass/core';
import { projects } from '@kompass/module-projects';
import { eq } from 'drizzle-orm';
import { createAccount, setAccountActive } from './ledger/accounts';
import { createCategory } from './ledger/categories';
import { createFirstFiscalYear, ensureFiscalYearFor } from './ledger/fiscal-years';
import { createPurpose, fulfillPurpose } from './ledger/purposes';
import { setDatedValue } from './ledger/dated-values';
import { financeAccounts, financeCategories, financeFiscalYears, financePurposes } from './schema';

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

async function ensureAccount(deps: Deps, ctx: CallContext, name: string, input: Record<string, unknown>): Promise<{ id: string } | null> {
  const existing = deps.db.select({ id: financeAccounts.id }).from(financeAccounts).where(eq(financeAccounts.name, name)).get();
  if (existing) return existing;
  return unwrap(await createAccount(deps, ctx, { name, ...input }));
}

async function ensurePurpose(deps: Deps, ctx: CallContext, name: string, input: Record<string, unknown>): Promise<{ id: string } | null> {
  const existing = deps.db.select({ id: financePurposes.id }).from(financePurposes).where(eq(financePurposes.name, name)).get();
  if (existing) return existing;
  return unwrap(await createPurpose(deps, ctx, { name, ...input }));
}

async function ensureCategory(deps: Deps, ctx: CallContext, key: string, input: Record<string, unknown>): Promise<void> {
  const existing = deps.db.select({ id: financeCategories.id }).from(financeCategories).where(eq(financeCategories.key, key)).get();
  if (existing) return;
  unwrap(await createCategory(deps, ctx, { key, ...input }));
}

/**
 * Ein erfundenes Vereinsjahr mit allen Stammdaten von F1: zwei Geschäftsjahre,
 * vier Geldkonten (eines stillgelegt), vier Zwecke, eine eigene Kategorie
 * neben dem Startplan, eine Überschreibung eines datierten Werts. Frei
 * erfunden (keine Tier- und keine Aluna-Begriffe), idempotent — ein zweiter
 * Lauf verdoppelt nichts.
 */
export async function seedFinance(deps: Deps, ctx: CallContext): Promise<void> {
  const now = deps.clock.now();
  const currentYear = now.getUTCFullYear();
  const previousYear = currentYear - 1;

  const hasFiscalYear = deps.db.select({ id: financeFiscalYears.id }).from(financeFiscalYears).limit(1).get();
  if (!hasFiscalYear) {
    unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: `${previousYear}-01-01`, endsOn: `${previousYear}-12-31` }));
    unwrap(deps.db.transaction((tx) => ensureFiscalYearFor(tx, deps, ctx, isoDate(now))));
  }

  await ensureAccount(deps, ctx, 'Vereinskonto', {
    kind: 'bank',
    iban: 'DE02120300000000202051',
    bic: 'BYLADEM1001',
    bankName: 'Beispielbank',
    isMain: true,
    openingBalanceCents: 125000,
    openingDate: `${previousYear}-01-01`,
    importFormat: 'camt053',
  });
  await ensureAccount(deps, ctx, 'Barkasse', { kind: 'cash' });
  await ensureAccount(deps, ctx, 'Spendenplattform', { kind: 'paymentService', importFormat: 'csv' });
  const oldSavings = await ensureAccount(deps, ctx, 'Altes Sparbuch', { kind: 'bank', iban: 'AT611904300234573201', isMain: false });
  if (oldSavings) {
    const row = deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, oldSavings.id)).get();
    if (row?.isActive) unwrap(await setAccountActive(deps, ctx, { id: oldSavings.id, isActive: false, expectedVersion: row.updatedAt }));
  }

  await ensurePurpose(deps, ctx, 'Dachsanierung Vereinsheim', { targetCents: 800000, description: 'Zusage von Frau Erika Beispiel über 2.000 €' });
  const existingProject = deps.db.select({ id: projects.id }).from(projects).limit(1).get();
  await ensurePurpose(deps, ctx, 'Jugendfreizeit', existingProject ? { projectId: existingProject.id } : {});
  await ensurePurpose(deps, ctx, 'Partnerprojekt Ausland', { abroad: true });
  const floodlight = await ensurePurpose(deps, ctx, 'Flutlicht', {});
  if (floodlight) {
    const row = deps.db.select().from(financePurposes).where(eq(financePurposes.id, floodlight.id)).get();
    if (row && !row.fulfilledAt) unwrap(await fulfillPurpose(deps, ctx, { id: floodlight.id }));
  }

  await ensureCategory(deps, ctx, 'room-rental', { name: 'Raumvermietung', direction: 'income', sphere: 'assetManagement', incomeKind: 'fees' });

  unwrap(await setDatedValue(deps, ctx, { key: 'mileageRate', validFrom: `${currentYear}-01-01`, value: 25 }));
}
