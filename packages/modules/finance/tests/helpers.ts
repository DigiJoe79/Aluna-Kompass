import { newId, unwrap, writeSettingInternal, coreModule, type CallContext } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser, systemContext } from '@kompass/core/testing';
import { contactsModule, createContact } from '@kompass/module-contacts';
import { dmsModule } from '@kompass/module-dms';
import { projectsModule } from '@kompass/module-projects';
import { eq } from 'drizzle-orm';
import { createAccount } from '../src/ledger/accounts';
import { bookEntry } from '../src/ledger/finalize';
import { createFirstFiscalYear, ensureFiscalYearFor, type FiscalYearView } from '../src/ledger/fiscal-years';
import { createPurpose } from '../src/ledger/purposes';
import { installFinance } from '../src/install';
import { FINANCE_PERMISSIONS, financeModule } from '../src/manifest';
import { financeCategories, financeFiscalYears, financePeriodEvents, type FinanceCategoryRow, type FinanceFiscalYearRow } from '../src/schema';

/** Ein minimales, gültiges PDF — wie in den Tests der Akte (`packages/modules/dms/tests/helpers.ts`). */
export function pdfBytes(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
}

/** Das Modul ist **eingeschaltet** — sonst kennt der Kern weder seine Rollen noch seine Haken. */
export function setupFinance(permissions: readonly string[] = FINANCE_PERMISSIONS) {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule, projectsModule, financeModule] });
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['contacts', 'dms', 'projects', 'finance'], 'test.enable'));
  const userId = insertUser(deps, { name: 'Test', email: 'test@kompass.local' });
  return { deps, ctx: ctxWith(permissions, userId), userId };
}

/** Für den Kanal `mcp`: `finance.mcpHumanOnlyAllowed` über die Oberfläche freigeben (E10). */
export function allowHumanOnlyOverMcp(deps: ReturnType<typeof setupFinance>['deps']): void {
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'finance.mcpHumanOnlyAllowed', true, 'test.allowHumanOnlyOverMcp'));
}

/**
 * Stammdaten für die Buchungsdienste: Startplan (`installFinance`), ein
 * Bankkonto, ein Barkonto, ein Auslandszweck und ein erfundener
 * Spender-Kontakt. `f.ctx` trägt alle Finanzrechte (Vorgabe von
 * `setupFinance`), aber kein `contacts.manage` — nur die Fixture selbst legt
 * den Kontakt intern über einen Systemkontext an.
 *
 * `years`: die Geschäftsjahre, älteste zuerst (Vorgabe `['2026']`). Das erste
 * entsteht über `createFirstFiscalYear`, jedes weitere über
 * `ensureFiscalYearFor` (nur der unmittelbare Nachfolger entsteht von
 * selbst) — abrufbar über `years['2026']` usw.
 */
export async function ledgerFixture(opts: { years?: readonly string[] } = {}) {
  const { deps, ctx, userId } = setupFinance();
  deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));

  const categoryByKey = (key: string): FinanceCategoryRow => {
    const row = deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get();
    if (!row) throw new Error(`Startplan-Kategorie fehlt: ${key}`);
    return row;
  };

  const bank = unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: 'DE02120300000000202051', isMain: true }));
  const cash = unwrap(await createAccount(deps, ctx, { name: 'Barkasse', kind: 'cash' }));

  const yearList = opts.years && opts.years.length > 0 ? opts.years : ['2026'];
  const first = yearList[0]!;
  const firstYear = unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: `${first}-01-01`, endsOn: `${first}-12-31` }));
  const years: Record<string, FiscalYearView | FinanceFiscalYearRow> = { [first]: firstYear };
  for (const y of yearList.slice(1)) {
    const created = deps.db.transaction((tx) => ensureFiscalYearFor(tx, deps, ctx, `${y}-06-15`));
    if (!created.ok) throw new Error(`ledgerFixture: Geschäftsjahr ${y} konnte nicht angelegt werden`);
    years[y] = created.value;
  }
  const year = firstYear;

  const donations = categoryByKey('donations');
  const fees = categoryByKey('payment-fees');
  const programCosts = categoryByKey('program-costs');
  const purposeIncome = categoryByKey('purpose-income');
  const abroadPurpose = unwrap(await createPurpose(deps, ctx, { name: 'Partnerprojekt Ausland', abroad: true }));
  const donorCtx: CallContext = { ...systemContext(), permissions: new Set(['contacts.manage']) };
  const donor = unwrap(await createContact(deps, donorCtx, { kind: 'person', lastName: 'Musterspenderin' }));
  const wrongDonor = unwrap(await createContact(deps, donorCtx, { kind: 'person', lastName: 'Fehlspenderin' }));
  const rightDonor = unwrap(await createContact(deps, donorCtx, { kind: 'person', lastName: 'Richtigspenderin' }));

  /** Zweite Person mit allen Finanzrechten (u. a. `finance.approve`) — für die Freigabe im abgeschlossenen Jahr, nie der Anleger. */
  const secondPersonId = insertUser(deps, { name: 'Zweite Person', email: 'zweite-person@kompass.local' });
  const secondPerson = ctxWith(FINANCE_PERMISSIONS, secondPersonId);

  /** Eine ausgeglichene, festgeschriebene Spende — Ausgangslage für Beleg- und Postentests. */
  const finalEntry = async () => bookEntry(deps, ctx, { entryDate: '2026-03-01', text: 'Spende', moneyLines: [{ accountId: bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: donations.id, amountCents: 5000 }] }).then(unwrap);

  /** Eine festgeschriebene Spende mit Kontakt — Ausgangslage für die Zuordnungskorrektur. */
  const finalDonation = async (opts: { date: string; cents: number; contactId: string }) =>
    bookEntry(deps, ctx, { entryDate: opts.date, text: 'Spende', moneyLines: [{ accountId: bank.id, amountCents: opts.cents }], allocationLines: [{ categoryId: donations.id, amountCents: opts.cents, contactId: opts.contactId }] }).then(unwrap);

  /** Schließt ein Geschäftsjahr — wie in `reverse.test.ts`, hier als Fixture-Helfer für die Korrektur-Tests. */
  const closeYear = (yearId: string) => {
    const row = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, yearId)).get()!;
    deps.db.insert(financePeriodEvents).values({ id: newId(), fiscalYearId: yearId, kind: 'closed', at: `${row.endsOn}T23:59:59.000Z`, byUserId: userId, reason: null }).run();
  };

  return { deps, ctx, userId, bank, cash, year, years, donations, fees, programCosts, purposeIncome, abroadPurpose, donor, wrongDonor, rightDonor, secondPerson, secondPersonId, finalEntry, finalDonation, closeYear };
}
