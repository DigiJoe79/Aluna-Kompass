import { unwrap, type CallContext, type Deps } from '@kompass/core';
import { addContactRole, contactRoles, createContact } from '@kompass/module-contacts';
import { projects } from '@kompass/module-projects';
import { eq } from 'drizzle-orm';
import { createAccount, setAccountActive } from './ledger/accounts';
import { createCategory } from './ledger/categories';
import { saveDraft, setReviewed } from './ledger/entries';
import { bookEntry } from './ledger/finalize';
import { createFirstFiscalYear, ensureFiscalYearFor } from './ledger/fiscal-years';
import { createPurpose, fulfillPurpose } from './ledger/purposes';
import { reverseEntry } from './ledger/reverse';
import { setDatedValue } from './ledger/dated-values';
import { installFinance } from './install';
import { financeAccounts, financeCategories, financeEntries, financeFiscalYears, financePurposes } from './schema';

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

function categoryByKey(deps: Deps, key: string) {
  const row = deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get();
  if (!row) throw new Error(`Startplan-Kategorie fehlt: ${key}`);
  return row;
}

function accountByName(deps: Deps, name: string) {
  const row = deps.db.select().from(financeAccounts).where(eq(financeAccounts.name, name)).get();
  if (!row) throw new Error(`Geldkonto fehlt: ${name}`);
  return row;
}

function purposeByName(deps: Deps, name: string) {
  const row = deps.db.select().from(financePurposes).where(eq(financePurposes.name, name)).get();
  if (!row) throw new Error(`Zweck fehlt: ${name}`);
  return row;
}

/** Legt eine Buchung nur an, wenn noch keine mit diesem Text besteht — idempotent, ohne eigene Zähltabelle. */
async function ensureEntry(deps: Deps, text: string, create: () => Promise<unknown>): Promise<void> {
  const exists = deps.db.select({ id: financeEntries.id }).from(financeEntries).where(eq(financeEntries.text, text)).get();
  if (exists) return;
  await create();
}

/**
 * Zwei erfundene Spender, sofern der Kontakte-Seed keine passenden
 * Rolleninhaber liefert. Läuft mit `contacts.manage`, unabhängig davon, ob
 * der Aufrufer dieses Recht selbst mitbringt — wie `seedDevelopment`s
 * Systemkontext es täte.
 */
async function ensureDonors(deps: Deps, ctx: CallContext, since: string): Promise<[{ id: string }, { id: string }]> {
  const existing = deps.db.select({ contactId: contactRoles.contactId }).from(contactRoles).where(eq(contactRoles.role, 'donor')).all();
  if (existing.length >= 2) return [{ id: existing[0]!.contactId }, { id: existing[1]!.contactId }];
  const contactCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'contacts.manage']) };
  const invented: [{ id: string }, { id: string }] = [{ id: '' }, { id: '' }];
  for (const [index, lastName] of ['Wagner', 'Kruse'].entries()) {
    const contact = unwrap(await createContact(deps, contactCtx, { kind: 'person', lastName }));
    unwrap(await addContactRole(deps, contactCtx, { id: contact.id, role: 'donor', since }));
    invented[index] = { id: contact.id };
  }
  return invented;
}

/**
 * Ein erfundenes Vereinsjahr mit allen Stammdaten von F1: zwei Geschäftsjahre,
 * vier Geldkonten (eines stillgelegt), vier Zwecke, eine eigene Kategorie
 * neben dem Startplan, eine Überschreibung eines datierten Werts. Frei
 * erfunden (keine Tier- und keine Aluna-Begriffe), idempotent — ein zweiter
 * Lauf verdoppelt nichts.
 */
export async function seedFinance(deps: Deps, ctx: CallContext): Promise<void> {
  // Damit der Startplan sicher steht, auch wenn ein Aufrufer `installFinance` noch nicht selbst gerufen hat.
  deps.db.transaction((tx) => installFinance(tx, deps, ctx));

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

  // Buchungen in jedem Zustand (Spec 11.3) — über die Dienste, damit Trigger, Kassenprüfung und Nummernvergabe mitlaufen.
  const bank = accountByName(deps, 'Vereinskonto');
  const cash = accountByName(deps, 'Barkasse');
  const platform = accountByName(deps, 'Spendenplattform');
  const donationsCat = categoryByKey(deps, 'donations');
  const bankFeesCat = categoryByKey(deps, 'bank-fees');
  const officeCat = categoryByKey(deps, 'office');
  const paymentFeesCat = categoryByKey(deps, 'payment-fees');
  const programCostsCat = categoryByKey(deps, 'program-costs');
  const inKindCat = categoryByKey(deps, 'in-kind-donations');
  const inKindExpenseCat = categoryByKey(deps, 'program-in-kind');
  const dachsanierung = purposeByName(deps, 'Dachsanierung Vereinsheim');
  const partnerAusland = purposeByName(deps, 'Partnerprojekt Ausland');

  const [donorA, donorB] = await ensureDonors(deps, ctx, `${previousYear}-01-01`);

  await ensureEntry(deps, 'Spende Altjahr', () =>
    bookEntry(deps, ctx, { entryDate: `${previousYear}-03-10`, text: 'Spende Altjahr', moneyLines: [{ accountId: bank.id, amountCents: 8000 }], allocationLines: [{ categoryId: donationsCat.id, amountCents: 8000 }] }).then(unwrap),
  );
  await ensureEntry(deps, 'Bankgebühr Altjahr', () =>
    bookEntry(deps, ctx, { entryDate: `${previousYear}-04-15`, text: 'Bankgebühr Altjahr', moneyLines: [{ accountId: bank.id, amountCents: -450 }], allocationLines: [{ categoryId: bankFeesCat.id, amountCents: -450 }] }).then(unwrap),
  );
  await ensureEntry(deps, 'Büromaterial Altjahr', () =>
    bookEntry(deps, ctx, { entryDate: `${previousYear}-05-20`, text: 'Büromaterial Altjahr', moneyLines: [{ accountId: bank.id, amountCents: -3200 }], allocationLines: [{ categoryId: officeCat.id, amountCents: -3200 }] }).then(unwrap),
  );

  await ensureEntry(deps, 'Spende mit Zweck', () =>
    bookEntry(deps, ctx, {
      entryDate: `${currentYear}-02-01`,
      text: 'Spende mit Zweck',
      moneyLines: [{ accountId: bank.id, amountCents: 15000 }],
      allocationLines: [{ categoryId: donationsCat.id, amountCents: 15000, contactId: donorA.id, purposeId: dachsanierung.id }],
    }).then(unwrap),
  );

  // Prüfstein 2: Auszahlung des Zahlungsdiensts als Split über zwei Spender und eine Gebühr.
  await ensureEntry(deps, 'Auszahlung Spendenplattform', () =>
    bookEntry(deps, ctx, {
      entryDate: `${currentYear}-02-10`,
      text: 'Auszahlung Spendenplattform',
      moneyLines: [{ accountId: platform.id, amountCents: 48500 }],
      allocationLines: [
        { categoryId: donationsCat.id, amountCents: 20000, contactId: donorA.id, purposeId: partnerAusland.id },
        { categoryId: donationsCat.id, amountCents: 20000, contactId: donorB.id, purposeId: partnerAusland.id },
        { categoryId: donationsCat.id, amountCents: 10000 },
        { categoryId: paymentFeesCat.id, amountCents: -1500 },
      ],
    }).then(unwrap),
  );

  await ensureEntry(deps, 'Abhebung Barkasse', () =>
    bookEntry(deps, ctx, {
      entryDate: `${currentYear}-02-15`,
      text: 'Abhebung Barkasse',
      moneyLines: [
        { accountId: bank.id, amountCents: -10000 },
        { accountId: cash.id, amountCents: 10000 },
      ],
      allocationLines: [],
    }).then(unwrap),
  );

  await ensureEntry(deps, 'Bar-Ausgabe Fahrtkosten', () =>
    bookEntry(deps, ctx, { entryDate: `${currentYear}-02-20`, text: 'Bar-Ausgabe Fahrtkosten', moneyLines: [{ accountId: cash.id, amountCents: -1500 }], allocationLines: [{ categoryId: programCostsCat.id, amountCents: -1500 }] }).then(unwrap),
  );

  await ensureEntry(deps, 'Sachspende Werkzeug', () =>
    bookEntry(deps, ctx, {
      entryDate: `${currentYear}-02-25`,
      text: 'Sachspende Werkzeug',
      moneyLines: [],
      allocationLines: [
        { categoryId: inKindCat.id, amountCents: 6000 },
        { categoryId: inKindExpenseCat.id, amountCents: -6000 },
      ],
    }).then(unwrap),
  );

  await ensureEntry(deps, 'Fehlerhafte Spendenbuchung', async () => {
    const booked = unwrap(
      await bookEntry(deps, ctx, { entryDate: `${currentYear}-03-01`, text: 'Fehlerhafte Spendenbuchung', moneyLines: [{ accountId: bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: donationsCat.id, amountCents: 5000 }] }),
    );
    unwrap(await reverseEntry(deps, ctx, { id: booked.id }));
  });

  await ensureEntry(deps, 'Entwurf geprüft', async () => {
    const draft = unwrap(
      await saveDraft(deps, ctx, { entryDate: `${currentYear}-03-05`, text: 'Entwurf geprüft', moneyLines: [{ accountId: bank.id, amountCents: 2500 }], allocationLines: [{ categoryId: donationsCat.id, amountCents: 2500 }] }),
    );
    unwrap(await setReviewed(deps, ctx, { id: draft.id, reviewed: true }));
  });

  await ensureEntry(deps, 'Entwurf ungeprüft', () =>
    saveDraft(deps, ctx, { entryDate: `${currentYear}-03-06`, text: 'Entwurf ungeprüft', moneyLines: [{ accountId: bank.id, amountCents: 1800 }], allocationLines: [{ categoryId: donationsCat.id, amountCents: 1800 }] }).then(unwrap),
  );

  // Unausgeglichen: der Agent hat die Zuordnung noch nicht vollständig — ein Mensch prüft und ergänzt sie.
  await ensureEntry(deps, 'Entwurf vom Agenten', () =>
    saveDraft(deps, { ...ctx, channel: 'mcp' as const }, { entryDate: `${currentYear}-03-07`, text: 'Entwurf vom Agenten', moneyLines: [{ accountId: bank.id, amountCents: 4000 }], allocationLines: [{ categoryId: donationsCat.id, amountCents: 3500 }] }).then(unwrap),
  );
}
