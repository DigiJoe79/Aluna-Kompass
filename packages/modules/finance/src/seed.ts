import { assignRole, createRole, createUser, schema, setRolePermissions, unwrap, type CallContext, type Deps } from '@kompass/core';
import { addContactRole, contactRoles, contacts, createContact } from '@kompass/module-contacts';
import { documents as dmsDocuments, receiveDocument, textPdf } from '@kompass/module-dms';
import { projects } from '@kompass/module-projects';
import { and, asc, eq } from 'drizzle-orm';
import { completeFormat, guessCsvFormat, type CsvFormat } from './import/csv';
import { buildPaymentServiceCsv, buildSecondBankCsv } from './import/csv-fixture';
import { saveImportProfile } from './import/profiles';
import { linkContactIban } from './import/contact-ibans';
import { saveImportRule } from './import/rules';
import { markTransactionForeign } from './import/transit';
import { createAccount, setAccountActive } from './ledger/accounts';
import { createCategory, setCategoryActive } from './ledger/categories';
import { requestAllocationCorrection } from './ledger/corrections';
import { saveDraft, setReviewed } from './ledger/entries';
import { bookEntry } from './ledger/finalize';
import { createFirstFiscalYear, ensureFiscalYearFor, fiscalYearStatusInternal, updateFiscalYear } from './ledger/fiscal-years';
import { cancelOpenItem, createOpenItem } from './ledger/open-items';
import { closeFiscalYear, justifyUndocumentedEntry } from './ledger/period';
import { setProjectFinance } from './ledger/project-settings';
import { createPurpose, fulfillPurpose } from './ledger/purposes';
import { reverseEntry } from './ledger/reverse';
import { uploadVoucher, revokeVoucher } from './ledger/vouchers';
import { setDatedValue } from './ledger/dated-values';
import { installFinance } from './install';
import { buildCamt053Bytes } from './import/camt-fixture';
import { discardRun } from './import/discard';
import { importStatement } from './import/runs';
import {
  financeAccounts,
  financeAllocationCorrections,
  financeAllocationLines,
  financeCategories,
  financeEntries,
  financeEntryDocuments,
  financeFiscalYears,
  financeImportRules,
  financeImportRuns,
  financeMoneyLines,
  financeOpenItems,
  financePurposes,
  financeRawTransactions,
} from './schema';

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

async function ensureAccount(deps: Deps, ctx: CallContext, name: string, input: Record<string, unknown>): Promise<{ id: string } | null> {
  const existing = deps.db.select({ id: financeAccounts.id }).from(financeAccounts).where(eq(financeAccounts.name, name)).get();
  if (existing) return existing;
  return unwrap(await createAccount(deps, ctx, { name, ...input }));
}

/** Gibt einem Konto einmal ein CSV-Format — erraten wie im Assistenten, gespeichert über `saveImportProfile` — und lädt einmal einen Auszug (F4b). */
async function ensureCsvAccountWithRun(deps: Deps, ctx: CallContext, accountName: string, formatName: string, fileName: string, bytes: Uint8Array): Promise<void> {
  let account = accountByName(deps, accountName);
  if (!account.importProfileId) {
    const guess = guessCsvFormat(bytes);
    const none: CsvFormat['columns'] = { bookingDate: '', valueDate: null, amount: null, debit: null, credit: null, debitCreditIndicator: null, counterpartyName: null, counterpartyIban: null, purpose: null, reference: null, fee: null, balance: null, currency: null, pending: null };
    const format = completeFormat(guess, { columns: { ...none, ...guess.columns } as CsvFormat['columns'], invertSign: false, dateFormat: guess.dateFormat!, decimalSeparator: guess.decimalSeparator! });
    unwrap(await saveImportProfile(deps, ctx, { accountId: account.id, name: formatName, format, confirmFormatChange: true }));
    account = accountByName(deps, accountName);
  }
  const hasRun = deps.db.select({ id: financeImportRuns.id }).from(financeImportRuns).where(eq(financeImportRuns.accountId, account.id)).limit(1).get();
  if (!hasRun) unwrap(await importStatement(deps, ctx, { accountId: account.id, fileName, bytes }));
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

function entryByText(deps: Deps, text: string) {
  const row = deps.db.select().from(financeEntries).where(eq(financeEntries.text, text)).get();
  if (!row) throw new Error(`Buchung fehlt: ${text}`);
  return row;
}

function firstAllocationLineOf(deps: Deps, entryId: string) {
  const row = deps.db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entryId)).orderBy(asc(financeAllocationLines.position)).get();
  if (!row) throw new Error(`Zuordnungszeile fehlt: ${entryId}`);
  return row;
}

/** Alle Aufteilungszeilen einer Buchung, in ihrer Reihenfolge — für F3a-N: „Korrigieren“ erreicht jede Zeile. */
function allocationLinesOf(deps: Deps, entryId: string) {
  return deps.db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entryId)).orderBy(asc(financeAllocationLines.position)).all();
}

/** Belegt eine Buchung nur, wenn sie noch keinen Beleg trägt — idempotent über `uploadVoucher` hinweg. */
async function ensureVoucher(deps: Deps, ctx: CallContext, entry: { id: string }, typeKey: string, documentDate: string, title?: string): Promise<{ linkId: string; documentId: string } | null> {
  const existing = deps.db.select().from(financeEntryDocuments).where(eq(financeEntryDocuments.entryId, entry.id)).all();
  if (existing.length > 0) return { linkId: existing[0]!.id, documentId: existing[0]!.documentId ?? '' };
  const res = unwrap(await uploadVoucher(deps, ctx, { entryId: entry.id, bytes: textPdf(['Beleg', '', 'Erfundenes Beispiel für die Entwicklung.']), typeKey, documentDate, title }));
  return { linkId: res.linkId, documentId: res.documentId };
}

/** Ein offener Posten je Zahlungsreferenz — idempotent, `paymentReference` dient als Fundstelle. */
async function ensureOpenItem(deps: Deps, ctx: CallContext, paymentReference: string, input: Record<string, unknown>): Promise<{ id: string } | null> {
  const existing = deps.db.select({ id: financeOpenItems.id }).from(financeOpenItems).where(eq(financeOpenItems.paymentReference, paymentReference)).get();
  if (existing) return existing;
  return unwrap(await createOpenItem(deps, ctx, { paymentReference, ...input }));
}

/** Eine Zuordnungskorrektur je Zeile — idempotent, egal ob sie wartet oder schon entschieden ist. */
async function ensureCorrection(deps: Deps, lineId: string, request: () => Promise<unknown>): Promise<void> {
  const existing = deps.db.select({ id: financeAllocationCorrections.id }).from(financeAllocationCorrections).where(eq(financeAllocationCorrections.lineId, lineId)).get();
  if (existing) return;
  await request();
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
    iban: 'DE23999999990000202051',
    bic: 'BEISDEX0XXX',
    bankName: 'Beispielbank',
    isMain: true,
    openingBalanceCents: 125000,
    openingDate: `${previousYear}-01-01`,
    importFormat: 'camt053',
  });
  await ensureAccount(deps, ctx, 'Barkasse', { kind: 'cash' });
  // Eigens für die Barkassen-E2E (F3b Task 2): Zählungen und Bargeldbewegungen laufen hier, nie auf „Barkasse“ —
  // sonst kippen die Bestände, die `finance.spec.ts` schon auf „Barkasse“ voraussetzt.
  await ensureAccount(deps, ctx, 'Zählkasse', { kind: 'cash', openingBalanceCents: 20000, openingDate: `${previousYear}-01-01` });
  // IBAN erfunden (BLZ 99999999) — F4 Task 7: nur mit IBAN lässt sich der Formatwechsel csv -> camt053 überhaupt zeigen.
  await ensureAccount(deps, ctx, 'Spendenplattform', { kind: 'paymentService', iban: 'DE32999999990301059999', importFormat: null });
  // F4b: CSV entsteht nur über ein gespeichertes Format — auch im Seed derselbe Weg wie im Assistenten:
  // Kompass errät das Format, der Mensch beantwortet nur das Vorzeichen, dann ein Auszug.
  await ensureCsvAccountWithRun(deps, ctx, 'Spendenplattform', 'Spendenplattform CSV', 'aktivitaeten-2026-03.csv', buildPaymentServiceCsv());
  await ensureAccount(deps, ctx, 'Zweitbank CSV', { kind: 'bank', iban: 'DE48999999990000404040', isMain: false });
  await ensureCsvAccountWithRun(deps, ctx, 'Zweitbank CSV', 'Zweitbank CSV', 'umsaetze-2026-03.csv', buildSecondBankCsv());
  // IBAN erfunden (BLZ 99999) — N2: die frühere Beispielnummer trug die echte österreichische BLZ 19043.
  const oldSavings = await ensureAccount(deps, ctx, 'Altes Sparbuch', { kind: 'bank', iban: 'AT939999900001234567', isMain: false });
  if (oldSavings) {
    const row = deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, oldSavings.id)).get();
    if (row?.isActive) unwrap(await setAccountActive(deps, ctx, { id: oldSavings.id, isActive: false, expectedVersion: row.updatedAt }));
  }

  await ensurePurpose(deps, ctx, 'Dachsanierung Vereinsheim', { targetCents: 800000, description: 'Zusage von Frau Erika Beispiel über 2.000 €' });
  const existingProject = deps.db.select({ id: projects.id }).from(projects).limit(1).get();
  await ensurePurpose(deps, ctx, 'Jugendfreizeit', existingProject ? { projectId: existingProject.id } : {});
  await ensurePurpose(deps, ctx, 'Partnerprojekt Ausland', { abroad: true });
  await ensurePurpose(deps, ctx, 'Flutlicht', {});
  // F2c: ein Zweck im Minus — mehr Ausgaben, als je eingegangen ist (Spec 5.6, Warnung, keine Sperre).
  await ensurePurpose(deps, ctx, 'Sommerfest', {});

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

  // F3a-N Task 1: eine festgeschriebene, geteilte Buchung im Vorjahr — nach dessen Abschluss wartet die
  // Korrektur einer ihrer beiden Zeilen auf Freigabe, die andere bleibt wählbar.
  await ensureEntry(deps, 'Sponsoring Altjahr', () =>
    bookEntry(deps, ctx, {
      entryDate: `${previousYear}-06-01`,
      text: 'Sponsoring Altjahr',
      moneyLines: [{ accountId: bank.id, amountCents: 9000 }],
      allocationLines: [
        { categoryId: donationsCat.id, amountCents: 6000 },
        { categoryId: donationsCat.id, amountCents: 3000 },
      ],
    }).then(unwrap),
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

  // F2c: ein erfüllter Zweck, der noch Restmittel hält (Spec 5.6, Warnung „erfüllt mit Restmitteln“).
  const floodlight = purposeByName(deps, 'Flutlicht');
  await ensureEntry(deps, 'Spende Flutlicht', () =>
    bookEntry(deps, ctx, { entryDate: `${currentYear}-02-12`, text: 'Spende Flutlicht', moneyLines: [{ accountId: bank.id, amountCents: 12000 }], allocationLines: [{ categoryId: donationsCat.id, amountCents: 12000, purposeId: floodlight.id }] }).then(unwrap),
  );
  {
    const row = deps.db.select().from(financePurposes).where(eq(financePurposes.id, floodlight.id)).get();
    if (row && !row.fulfilledAt) unwrap(await fulfillPurpose(deps, ctx, { id: floodlight.id }));
  }

  // F2c: ein Zweck im Minus — die Ausgabe übersteigt, was je für ihn einging.
  const sommerfest = purposeByName(deps, 'Sommerfest');
  await ensureEntry(deps, 'Ausgabe Sommerfest', () =>
    bookEntry(deps, ctx, { entryDate: `${currentYear}-02-14`, text: 'Ausgabe Sommerfest', moneyLines: [{ accountId: bank.id, amountCents: -8000 }], allocationLines: [{ categoryId: programCostsCat.id, amountCents: -8000, purposeId: sommerfest.id }] }).then(unwrap),
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

  // F3a: ein zweiter ausgeglichener, ungeprüfter Entwurf — das Journal braucht zwei für die Mehrfachauswahl.
  await ensureEntry(deps, 'Entwurf ungeprüft zwei', () =>
    saveDraft(deps, ctx, { entryDate: `${currentYear}-03-09`, text: 'Entwurf ungeprüft zwei', moneyLines: [{ accountId: bank.id, amountCents: 2200 }], allocationLines: [{ categoryId: donationsCat.id, amountCents: 2200 }] }).then(unwrap),
  );

  // Unausgeglichen: der Agent hat die Zuordnung noch nicht vollständig — ein Mensch prüft und ergänzt sie.
  await ensureEntry(deps, 'Entwurf vom Agenten', () =>
    saveDraft(deps, { ...ctx, channel: 'mcp' as const }, { entryDate: `${currentYear}-03-07`, text: 'Entwurf vom Agenten', moneyLines: [{ accountId: bank.id, amountCents: 4000 }], allocationLines: [{ categoryId: donationsCat.id, amountCents: 3500 }] }).then(unwrap),
  );

  // --- Kontoauszüge (F4 Task 8, Spec 6.1): eigenes Konto „Importkonto“ mit erfundener IBAN
  // (BLZ 99999999), damit kein anderer Test dieselben Kontoauszüge sieht. Zwei fertige Läufe
  // (der zweite mit Lücke), ein offener Kandidat, ein verworfener und ein fehlgeschlagener Lauf;
  // ein Kontoumsatz gebucht, mehrere offen. Über die Dienste, nicht per Insert — ein Lauf ist eine
  // Tatsache, die nur `importStatement`/`discardRun` selbst herstellen dürfen.
  const IMPORTKONTO_IBAN = 'DE60999999990201051234';
  const importkonto = await ensureAccount(deps, ctx, 'Importkonto', { kind: 'bank', iban: IMPORTKONTO_IBAN, isMain: false, openingBalanceCents: 100000, openingDate: '2026-01-01' });
  if (importkonto) {
    const hasImportRuns = deps.db.select({ id: financeImportRuns.id }).from(financeImportRuns).where(eq(financeImportRuns.accountId, importkonto.id)).limit(1).get();
    if (!hasImportRuns) {
      // Lauf A: der erste Import, ohne Vorgänger — keine Lücke.
      const runA = unwrap(
        await importStatement(deps, ctx, {
          accountId: importkonto.id,
          fileName: 'kontoauszug-2026-01.xml',
          bytes: buildCamt053Bytes({
            iban: IMPORTKONTO_IBAN,
            from: '2026-01-01',
            to: '2026-01-31',
            openingCents: 100000,
            lines: [
              { bookingDate: '2026-01-05', amountCents: 20000, counterpartyName: 'Erika Beispiel', counterpartyIban: 'DE66999999991234567890', purpose: 'Spende', bankReference: 'IMP-0001' },
              { bookingDate: '2026-01-10', amountCents: -3500, counterpartyName: 'Buerobedarf Muster GmbH', counterpartyIban: 'DE12999999990000112233', purpose: 'Bueromaterial', bankReference: 'IMP-0002' },
            ],
          }),
        }),
      ).runs[0]!;

      // Lauf B: ein zweiter Auszug, dessen Anfangsbestand nicht zum Ende von Lauf A passt — die Lücke.
      unwrap(
        await importStatement(deps, ctx, {
          accountId: importkonto.id,
          fileName: 'kontoauszug-2026-02.xml',
          bytes: buildCamt053Bytes({
            iban: IMPORTKONTO_IBAN,
            from: '2026-02-10',
            to: '2026-02-28',
            openingCents: 130000,
            lines: [{ bookingDate: '2026-02-15', amountCents: 5000, counterpartyName: 'Foerderverein Musterstadt e. V.', counterpartyIban: 'DE22999999995566778899', purpose: 'Zuschuss', bankReference: 'IMP-0003' }],
          }),
        }),
      );

      // Lauf C: ein neuer Umsatz und, ohne Bankreferenz, dieselben Kerndaten wie die Büromaterial-Zeile
      // aus Lauf A in einem nicht überlappenden Zeitraum — ein Kandidat, kein sicherer Treffer (Spec 6.1/6.3).
      unwrap(
        await importStatement(deps, ctx, {
          accountId: importkonto.id,
          fileName: 'kontoauszug-2026-04.xml',
          bytes: buildCamt053Bytes({
            iban: IMPORTKONTO_IBAN,
            from: '2026-04-01',
            to: '2026-04-30',
            openingCents: 135000,
            lines: [
              { bookingDate: '2026-04-05', amountCents: 7500, counterpartyName: 'Erika Beispiel', counterpartyIban: 'DE66999999991234567890', purpose: 'Spende April', bankReference: 'IMP-0004' },
              { bookingDate: '2026-01-10', amountCents: -3500, counterpartyName: 'Buerobedarf Muster GmbH', counterpartyIban: 'DE12999999990000112233', purpose: 'Bueromaterial' },
            ],
          }),
        }),
      );

      // Lauf D: ein Auszug, der versehentlich geladen und gleich wieder verworfen wird — bleibt als Tatsache stehen.
      const runD = unwrap(
        await importStatement(deps, ctx, {
          accountId: importkonto.id,
          fileName: 'kontoauszug-2026-05-versehentlich.xml',
          bytes: buildCamt053Bytes({
            iban: IMPORTKONTO_IBAN,
            from: '2026-05-01',
            to: '2026-05-31',
            openingCents: 139000,
            lines: [{ bookingDate: '2026-05-10', amountCents: 2000, counterpartyName: 'Erika Beispiel', counterpartyIban: 'DE66999999991234567890', purpose: 'Testbuchung falsch', bankReference: 'IMP-0005' }],
          }),
        }),
      ).runs[0]!;
      unwrap(await discardRun(deps, ctx, { id: runD.id, note: 'Versehentlich den falschen Auszug hochgeladen' }));

      // Lauf E: eine Datei, deren Summenprobe nicht aufgeht — schreibt nur einen fehlgeschlagenen Lauf, keine Zeilen.
      const failedResult = await importStatement(deps, ctx, {
        accountId: importkonto.id,
        fileName: 'kontoauszug-2026-06-kaputt.xml',
        bytes: buildCamt053Bytes({ iban: IMPORTKONTO_IBAN, from: '2026-06-01', to: '2026-06-30', openingCents: 141000, closingCents: 999999, lines: [{ bookingDate: '2026-06-05', amountCents: 1000 }] }),
      });
      if (failedResult.ok) throw new Error('Seed: kontoauszug-2026-06-kaputt.xml haette als fehlgeschlagener Lauf enden muessen');

      // Ein Kontoumsatz gebucht (die Spende aus Lauf A), die übrigen bleiben offen (E8).
      const donationRaw = deps.db
        .select()
        .from(financeRawTransactions)
        .where(and(eq(financeRawTransactions.runId, runA.id), eq(financeRawTransactions.amountCents, 20000)))
        .get()!;
      unwrap(
        await bookEntry(deps, ctx, {
          entryDate: '2026-01-06',
          text: 'Spende aus Kontoauszug',
          moneyLines: [{ accountId: importkonto.id, amountCents: 20000, rawTransactionId: donationRaw.id }],
          allocationLines: [{ categoryId: donationsCat.id, amountCents: 20000 }],
        }),
      );
    }
  }

  // --- Arbeitsliste (F5, aus Task 9 vorgezogen für die E2E von Task 7): alles auf „Importkonto“.
  if (importkonto) await seedWorkList(deps, ctx, importkonto.id);

  // --- Belege (F2b, Spec 5.2): drei festgeschriebene Buchungen mit hochgeladenem PDF; eine davon
  // widerrufen und ersetzt; „Spende Altjahr“ bleibt bewusst ohne Beleg (der Rohumsatz allein reicht
  // für Spenden erst mit F4/F5).
  const bueromaterial = entryByText(deps, 'Büromaterial Altjahr');
  const fahrtkosten = entryByText(deps, 'Bar-Ausgabe Fahrtkosten');
  const bankgebuehr = entryByText(deps, 'Bankgebühr Altjahr');

  await ensureVoucher(deps, ctx, bueromaterial, 'voucher-invoice', `${previousYear}-05-20`, 'Rechnung Büromaterial');
  const fahrtkostenVoucher = await ensureVoucher(deps, ctx, fahrtkosten, 'voucher-receipt', `${currentYear}-02-20`);
  const bankgebuehrVoucher = await ensureVoucher(deps, ctx, bankgebuehr, 'voucher-own', `${previousYear}-04-15`);

  if (bankgebuehrVoucher && fahrtkostenVoucher) {
    // Erst nach dem zweiten Beleg kann es zwei Zeilen geben; ohne Sortiergarantie der Datenbank
    // zählt für die Wiederholbarkeit nur, ob überhaupt schon einmal widerrufen wurde — nicht, welche
    // der Zeilen `ensureVoucher` zufällig zuerst zurückgab.
    const bankgebuehrLinks = deps.db.select().from(financeEntryDocuments).where(eq(financeEntryDocuments.entryId, bankgebuehr.id)).all();
    if (!bankgebuehrLinks.some((l) => l.revokedAt !== null)) {
      unwrap(
        await revokeVoucher(deps, ctx, {
          linkId: bankgebuehrVoucher.linkId,
          note: 'Falscher Anhang hochgeladen, richtige Quittung liegt vor',
          replacementDocumentId: fahrtkostenVoucher.documentId,
        }),
      );
    }
  }

  // --- Offene Posten (F2b, Spec 5.3): außerhalb des Journals — eine Verbindlichkeit offen, eine
  // teilbezahlt, eine Forderung erledigt, ein Posten ohne Zahlung erledigt.
  const payableOpen = await ensureOpenItem(deps, ctx, 'RE-2026-041', { kind: 'payable', itemDate: `${currentYear}-01-10`, amountCents: 12000, dueOn: `${currentYear}-02-10` });
  const payablePartial = await ensureOpenItem(deps, ctx, 'RE-2026-055', { kind: 'payable', itemDate: `${currentYear}-01-15`, amountCents: 20000, dueOn: `${currentYear}-02-15` });
  const receivableSettled = await ensureOpenItem(deps, ctx, 'SP-2026-003', { kind: 'receivable', itemDate: `${currentYear}-01-20`, amountCents: 5000, dueOn: `${currentYear}-02-20` });
  const payableCancelled = await ensureOpenItem(deps, ctx, 'RE-2026-060', { kind: 'payable', itemDate: `${currentYear}-01-25`, amountCents: 3000 });
  // F3b Task 3 (A6): ein Posten mit Herkunft — „Erledigt ohne Zahlung“ bietet er nicht an, er verweist auf
  // seinen Vorgang. `originType` ist erfunden (kein Fachmodul liefert vor F8a/F7 echte Vorgänge).
  await ensureOpenItem(deps, ctx, 'ANT-2026-014', { kind: 'payable', itemDate: `${currentYear}-02-01`, amountCents: 4500, dueOn: `${currentYear}-03-01`, originType: 'demoProcess', originId: 'demo-1' });
  void payableOpen; // bleibt bewusst unbeglichen — nichts weiter zu tun.

  if (payablePartial) {
    await ensureEntry(deps, 'Teilzahlung Lieferant', () =>
      bookEntry(deps, ctx, {
        entryDate: `${currentYear}-02-01`,
        text: 'Teilzahlung Lieferant',
        moneyLines: [{ accountId: bank.id, amountCents: -8000, settlements: [{ openItemId: payablePartial.id, amountCents: 8000 }] }],
        allocationLines: [{ categoryId: programCostsCat.id, amountCents: -8000 }],
      }).then(unwrap),
    );
  }
  if (receivableSettled) {
    await ensureEntry(deps, 'Ausgleich Forderung', () =>
      bookEntry(deps, ctx, {
        entryDate: `${currentYear}-02-05`,
        text: 'Ausgleich Forderung',
        moneyLines: [{ accountId: bank.id, amountCents: 5000, settlements: [{ openItemId: receivableSettled.id, amountCents: 5000 }] }],
        allocationLines: [{ categoryId: donationsCat.id, amountCents: 5000 }],
      }).then(unwrap),
    );
  }
  if (payableCancelled) {
    const row = deps.db.select().from(financeOpenItems).where(eq(financeOpenItems.id, payableCancelled.id)).get();
    if (row && row.cancelledAt === null) {
      unwrap(await cancelOpenItem(deps, ctx, { id: payableCancelled.id, note: 'Doppelt erfasst, storniert vor Zahlung' }));
    }
  }

  // --- Zuordnungskorrektur (F2b, Spec 5.4, E18): eine angewandte im laufenden Jahr, eine wartende
  // im abgeschlossenen Vorjahr.
  const spendeMitZweck = entryByText(deps, 'Spende mit Zweck');
  const spendeMitZweckLine = firstAllocationLineOf(deps, spendeMitZweck.id);
  await ensureCorrection(deps, spendeMitZweckLine.id, () =>
    requestAllocationCorrection(deps, ctx, { lineId: spendeMitZweckLine.id, changes: { abroad: true }, note: 'Auslandsbezug bei der Erfassung übersehen' }).then(unwrap),
  );

  // F2c: Finanzfelder eines vorhandenen Projekts aus dem Projekte-Seed.
  if (existingProject) {
    unwrap(await setProjectFinance(deps, ctx, { projectId: existingProject.id, targetCents: 250000, defaultPurposeId: dachsanierung.id }));
  }

  const previousFiscalYear = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.designation, String(previousYear))).get();
  if (previousFiscalYear) {
    const alreadyClosed = fiscalYearStatusInternal(deps.db, previousFiscalYear.id) === 'closed';
    if (!alreadyClosed) {
      // „Spende Altjahr“ bleibt bewusst ohne Beleg (siehe oben) — der Abschluss verlangt dafür eine Begründung.
      const spendeAltjahrForJustify = entryByText(deps, 'Spende Altjahr');
      unwrap(await justifyUndocumentedEntry(deps, ctx, { entryId: spendeAltjahrForJustify.id, note: 'Kleinbetrag bar erhalten, kein Beleg ausgestellt' }));
      // F3a-N Task 1: „Sponsoring Altjahr“ bleibt ebenfalls ohne Beleg — nur ihre geteilte Zuordnung zählt hier.
      const sponsoringAltjahrForJustify = entryByText(deps, 'Sponsoring Altjahr');
      unwrap(await justifyUndocumentedEntry(deps, ctx, { entryId: sponsoringAltjahrForJustify.id, note: 'Sponsoringzusage ohne Rechnung erhalten' }));
      unwrap(await closeFiscalYear(deps, ctx, { id: previousFiscalYear.id }));
    }

    const spendeAltjahr = entryByText(deps, 'Spende Altjahr');
    const spendeAltjahrLine = firstAllocationLineOf(deps, spendeAltjahr.id);
    await ensureCorrection(deps, spendeAltjahrLine.id, () =>
      requestAllocationCorrection(deps, ctx, { lineId: spendeAltjahrLine.id, changes: { contactId: donorA.id }, note: 'Spenderin nachträglich zugeordnet' }).then(unwrap),
    );

    // F3a-N Task 1: von den zwei Zeilen der „Sponsoring Altjahr“ wartet nur die erste auf Freigabe — die
    // zweite bleibt im Korrigieren-Dialog wählbar. Nur ein Projektwechsel: er löst nie § 153 aus, egal ob
    // eine Steuererklärung schon als abgegeben gilt (F3a-N Task 2 setzt das am selben Vorjahr).
    if (existingProject) {
      const sponsoringAltjahr = entryByText(deps, 'Sponsoring Altjahr');
      const sponsoringLines = allocationLinesOf(deps, sponsoringAltjahr.id);
      const sponsoringFirstLine = sponsoringLines[0];
      if (sponsoringFirstLine) {
        await ensureCorrection(deps, sponsoringFirstLine.id, () =>
          requestAllocationCorrection(deps, ctx, {
            lineId: sponsoringFirstLine.id,
            changes: { projectId: existingProject.id },
            note: 'Projektzuordnung nachträglich korrigieren',
          }).then(unwrap),
        );
      }
    }

    // F3a-N Task 2: die Steuererklärung des Vorjahrs gilt als abgegeben — erst danach, damit die zwei
    // wartenden Korrekturen oben ohne § 153 entstehen. Von hier an löst jede Partei-, Auslands- oder
    // Zweckänderung in diesem Jahr die Kenntnisnahme nach § 153 AO aus.
    const currentPreviousFiscalYear = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, previousFiscalYear.id)).get()!;
    if (!currentPreviousFiscalYear.taxReturnFiledOn) {
      unwrap(
        await updateFiscalYear(deps, ctx, {
          id: previousFiscalYear.id,
          taxReturnFiledOn: `${currentYear}-05-31`,
          expectedVersion: currentPreviousFiscalYear.updatedAt,
        }),
      );
    }
  }

  // F3a: „Mira Klein“ aus dem Kernseed (Rolle „Interne Revision“, kein Finanzrecht) bekommt zusätzlich
  // die Rolle „Kassenprüfer“ (finance.read, finance.overview — nie entriesFinalize): eine Person, an der
  // sich zeigt, dass „Korrigieren“ ohne das Recht fehlt. Existiert die Person nicht (isolierte
  // Modul-Tests, andere Installation), bleibt der Schritt aus — der Kern erfindet keine Nutzer.
  await grantAuditorRoleToMiraKlein(deps, ctx);

  // F3a-N Task 2: „Jonas Feld“ (Kernseed-Rolle „Schatzmeisterin“, ohne Finanzrechte) bekommt zusätzlich
  // die Finanzrolle „Freigeber Finanzen“ — sonst gibt es außer der geschützten Verwaltung niemanden mit
  // `finance.approve`, und der Korrigieren-Dialog könnte nie zeigen, wer eine wartende Änderung freigeben
  // kann.
  await grantApproverRoleToJonasFeld(deps, ctx);

  // F3b Schritt 0: eine erfundene Person mit `finance.entriesFinalize`, aber ohne `contacts.view` — an ihr
  // zeigt sich, dass die Barkasse statt des Zähl-Dialogs den Sperrzustand mit dem fehlenden Recht und
  // seinen Vergebern nennt. Keiner der drei Kernseed-Nutzer eignet sich: Jede/r trägt in einem anderen
  // Modultest schon die Rolle „ohne X“ oder „mit contacts.view“ — eine eigene, ad-hoc angelegte Rolle
  // (nicht Grundausstattung, `installFinance` liefert genau fünf) hält das getrennt.
  await ensureCashOnlyPerson(deps, ctx);
}

async function grantAuditorRoleToMiraKlein(deps: Deps, ctx: CallContext): Promise<void> {
  const mira = deps.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, 'mira@kompass.local')).get();
  if (!mira) return;
  const auditorRole = deps.db.select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.name, 'Kassenprüfer')).get();
  if (!auditorRole) return;
  const already = deps.db
    .select({ userId: schema.userRoles.userId })
    .from(schema.userRoles)
    .where(and(eq(schema.userRoles.userId, mira.id), eq(schema.userRoles.roleId, auditorRole.id)))
    .get();
  if (already) return;
  // Wie `ensureDonors`: die nötigen Rechte lokal dazugeben, unabhängig davon, was der Aufrufer selbst
  // mitbringt — `users.manage` fürs Vergeben, alle Rechte der Rolle selbst (`requireGrantableRole`).
  const usersCtx: CallContext = { ...ctx, permissions: new Set(deps.registry.permissionKeys) };
  unwrap(await assignRole(deps, usersCtx, { userId: mira.id, roleId: auditorRole.id }));
}

async function grantApproverRoleToJonasFeld(deps: Deps, ctx: CallContext): Promise<void> {
  const jonas = deps.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, 'jonas@kompass.local')).get();
  if (!jonas) return;
  const approverRole = deps.db.select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.name, 'Freigeber Finanzen')).get();
  if (!approverRole) return;
  const already = deps.db
    .select({ userId: schema.userRoles.userId })
    .from(schema.userRoles)
    .where(and(eq(schema.userRoles.userId, jonas.id), eq(schema.userRoles.roleId, approverRole.id)))
    .get();
  if (already) return;
  const usersCtx: CallContext = { ...ctx, permissions: new Set(deps.registry.permissionKeys) };
  unwrap(await assignRole(deps, usersCtx, { userId: jonas.id, roleId: approverRole.id }));
}

/**
 * F3b Schritt 0: „Ines Brandt“ mit einer eigens angelegten, generischen Rolle
 * „Kassenassistenz“ (`finance.read`, `finance.entriesFinalize` — bewusst
 * ohne `contacts.view`). Idempotent über Name der Rolle und E-Mail der
 * Person, wie `grantAuditorRoleToMiraKlein`.
 */
async function ensureCashOnlyPerson(deps: Deps, ctx: CallContext): Promise<void> {
  const usersCtx: CallContext = { ...ctx, permissions: new Set(deps.registry.permissionKeys) };
  let role = deps.db.select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.name, 'Kassenassistenz')).get();
  if (!role) {
    const created = unwrap(await createRole(deps, usersCtx, { name: 'Kassenassistenz', description: 'Zählt und bewegt Bargeld, ohne Kontakte einzusehen.' }));
    unwrap(await setRolePermissions(deps, usersCtx, { roleId: created.id, permissionKeys: ['finance.read', 'finance.entriesFinalize'] }));
    role = { id: created.id };
  }
  let person = deps.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, 'ines@kompass.local')).get();
  if (!person) {
    const created = unwrap(await createUser(deps, usersCtx, { name: 'Ines Brandt', email: 'ines@kompass.local', roleIds: [role.id] }));
    person = { id: created.user.id };
    return;
  }
  const already = deps.db.select({ userId: schema.userRoles.userId }).from(schema.userRoles).where(and(eq(schema.userRoles.userId, person.id), eq(schema.userRoles.roleId, role.id))).get();
  if (already) return;
  unwrap(await assignRole(deps, usersCtx, { userId: person.id, roleId: role.id }));
}

/**
 * Die Arbeitsliste (F5) auf „Importkonto“: eine Regel für die Büromaterial-Zeile
 * aus Lauf A, die IBAN von „Erika Beispiel“ an einem Kontakt, eine Handbuchung
 * ohne Kontoumsatz (Entwurf „Zuschuss“, einen Tag vor dem Zuschuss aus Lauf B —
 * Vorschlag 0 „passt zu Ihrer Buchung“) und ein Entwurf, den ein Agent über MCP
 * vorbereitet hat und der „Spende April“ bindet. Über die Dienste, jeder
 * Schritt für sich idempotent.
 */
async function seedWorkList(deps: Deps, ctx: CallContext, importkontoId: string): Promise<void> {
  const contactCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'contacts.manage']) };
  let erika = deps.db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.firstName, 'Erika'), eq(contacts.lastName, 'Beispiel'))).get();
  if (!erika) erika = { id: unwrap(await createContact(deps, contactCtx, { kind: 'person', firstName: 'Erika', lastName: 'Beispiel' })).id };
  unwrap(await linkContactIban(deps, ctx, { contactId: erika.id, iban: 'DE66999999991234567890' }));

  const ruleExists = (name: string) => !!deps.db.select({ id: financeImportRules.id }).from(financeImportRules).where(eq(financeImportRules.name, name)).get();
  if (!ruleExists('Büromaterial')) {
    unwrap(await saveImportRule(deps, ctx, { name: 'Büromaterial', sortOrder: 2, accountId: importkontoId, direction: 'out', textContains: 'bueromaterial', categoryId: categoryByKey(deps, 'office').id, entryText: 'Büromaterial' }));
  }
  // Review Focus 2: eine Regel, deren Kategorie inzwischen stillgelegt ist. Sie greift vor „Büromaterial“,
  // trifft aber keinen Umsatz des Seeds — nur den Dezember-Auszug, den die E2E selbst lädt.
  await ensureCategory(deps, ctx, 'postage-old', { name: 'Porto (alt)', direction: 'expense', sphere: 'ideal', costFunction: 'administration' });
  if (!ruleExists('Bürobedarf Dezember')) {
    unwrap(await saveImportRule(deps, ctx, { name: 'Bürobedarf Dezember', sortOrder: 1, accountId: importkontoId, direction: 'out', textContains: 'dezember', categoryId: categoryByKey(deps, 'postage-old').id }));
  }
  const postageOld = categoryByKey(deps, 'postage-old');
  if (postageOld.isActive) unwrap(await setCategoryActive(deps, ctx, { id: postageOld.id, isActive: false, expectedVersion: postageOld.updatedAt }));

  await ensureEntry(deps, 'Zuschuss', async () =>
    unwrap(
      await saveDraft(deps, ctx, {
        entryDate: '2026-02-14',
        text: 'Zuschuss',
        moneyLines: [{ accountId: importkontoId, amountCents: 5000 }],
        allocationLines: [{ categoryId: categoryByKey(deps, 'public-grants').id, amountCents: 5000 }],
      }),
    ),
  );

  await seedForeignMoneyAndVoucher(deps, ctx, importkontoId);
  await seedCashDepositAndReturn(deps, ctx, importkontoId);

  const april = deps.db.select().from(financeRawTransactions).where(and(eq(financeRawTransactions.accountId, importkontoId), eq(financeRawTransactions.bankReference, 'IMP-0004'))).get();
  const aprilBound = april ? deps.db.select({ id: financeMoneyLines.id }).from(financeMoneyLines).where(eq(financeMoneyLines.rawTransactionId, april.id)).get() : undefined;
  if (april && !aprilBound) {
    await ensureEntry(deps, 'Spende April', async () =>
      unwrap(
        await saveDraft(deps, { ...ctx, channel: 'mcp' as const }, {
          entryDate: april.bookingDate,
          text: 'Spende April',
          moneyLines: [{ accountId: importkontoId, amountCents: april.amountCents, rawTransactionId: april.id }],
          allocationLines: [{ categoryId: categoryByKey(deps, 'donations').id, amountCents: april.amountCents, contactId: erika.id }],
        }),
      ),
    );
  }
}

/**
 * F5 Task 8 (aus Task 9 vorgezogen): ein Juli-Auszug auf „Importkonto“ mit
 * einem Eingang, der dem Verein nicht gehört — eine Sammelbestellung Futter,
 * die für den Nachbarverein bezahlt wurde und noch weitergegeben werden muss —,
 * und eine Eingangsrechnung über 35,00 € in der Akte, noch ohne Buchung
 * („Beleg suchen“ findet sie über den Betrag der Büromaterial-Zeile). Jeder
 * Schritt über seinen Dienst und für sich idempotent.
 */
async function seedForeignMoneyAndVoucher(deps: Deps, ctx: CallContext, importkontoId: string): Promise<void> {
  const JULY_FILE = 'kontoauszug-2026-07.xml';
  const hasJuly = deps.db.select({ id: financeImportRuns.id }).from(financeImportRuns).where(and(eq(financeImportRuns.accountId, importkontoId), eq(financeImportRuns.fileName, JULY_FILE))).get();
  if (!hasJuly) {
    unwrap(
      await importStatement(deps, ctx, {
        accountId: importkontoId,
        fileName: JULY_FILE,
        bytes: buildCamt053Bytes({
          iban: 'DE60999999990201051234',
          from: '2026-07-01',
          to: '2026-07-31',
          openingCents: 139000,
          lines: [{ bookingDate: '2026-07-06', amountCents: 12000, counterpartyName: 'Max Muster', counterpartyIban: 'DE12999999990000112233', purpose: 'Sammelbestellung Futter, für Nachbarverein', bankReference: 'IMP-0007' }],
        }),
      }),
    );
  }
  const foreignRaw = deps.db.select().from(financeRawTransactions).where(and(eq(financeRawTransactions.accountId, importkontoId), eq(financeRawTransactions.bankReference, 'IMP-0007'))).get();
  const foreignBound = foreignRaw ? deps.db.select({ id: financeMoneyLines.id }).from(financeMoneyLines).where(eq(financeMoneyLines.rawTransactionId, foreignRaw.id)).get() : undefined;
  if (foreignRaw && !foreignBound) unwrap(await markTransactionForeign(deps, ctx, { rawTransactionId: foreignRaw.id, holder: 'Nachbarverein Beispielstadt', reviewed: false }));

  const INVOICE_SUBJECT = 'Rechnung Büromaterial über 35,00 €';
  const hasInvoice = deps.db.select({ id: dmsDocuments.id }).from(dmsDocuments).where(eq(dmsDocuments.subject, INVOICE_SUBJECT)).get();
  if (!hasInvoice) {
    const dmsCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'dms.view', 'dms.create']) };
    unwrap(
      await receiveDocument(deps, dmsCtx, {
        filename: '2026-01-08 Rechnung Buerobedarf.pdf',
        bytes: textPdf(['Buerobedarf Muster GmbH', 'Rechnung Nr. 2026-0042', '', 'Bueromaterial (Ordner, Papier, Stifte)', 'Rechnungsbetrag: 35,00 EUR']),
        typeKey: 'voucher-invoice',
        subject: INVOICE_SUBJECT,
        documentDate: '2026-01-08',
        folder: null,
      }),
    );
  }
}

/**
 * F5 Task 9: ein August-Auszug auf „Importkonto“, der an den Juli anschließt.
 * Darin eine Bareinzahlung aus der Spendendose (die Bar-Kennung schlägt die
 * Umbuchung gegen die Barkasse vor — Prüfstein „Bareinzahlung bei der Bank“),
 * ein Mitgliedsbeitrag per Lastschrift, der gleich festgeschrieben wird, und
 * dessen Rückgabe mit Rückgabe-Code `AC04` (Vorschlag: zurückgegebene Zahlung
 * mit `originLineId`). Der Lauf und die Buchung sind je für sich idempotent.
 */
async function seedCashDepositAndReturn(deps: Deps, ctx: CallContext, importkontoId: string): Promise<void> {
  const AUGUST_FILE = 'kontoauszug-2026-08.xml';
  const PAYER_IBAN = 'DE30999999990000505050';
  const hasAugust = deps.db.select({ id: financeImportRuns.id }).from(financeImportRuns).where(and(eq(financeImportRuns.accountId, importkontoId), eq(financeImportRuns.fileName, AUGUST_FILE))).get();
  if (!hasAugust) {
    unwrap(
      await importStatement(deps, ctx, {
        accountId: importkontoId,
        fileName: AUGUST_FILE,
        bytes: buildCamt053Bytes({
          iban: 'DE60999999990201051234',
          from: '2026-08-01',
          to: '2026-08-31',
          // Endsaldo des Juli-Auszugs: 1.390,00 € + 120,00 € fremdes Geld.
          openingCents: 151000,
          lines: [
            { bookingDate: '2026-08-04', amountCents: 2500, counterpartyName: 'Paula Probe', counterpartyIban: PAYER_IBAN, purpose: 'Mitgliedsbeitrag August', bankReference: 'IMP-0008' },
            { bookingDate: '2026-08-10', amountCents: 20000, purpose: 'Bareinzahlung Spendendose', bankReference: 'IMP-0009' },
            { bookingDate: '2026-08-20', amountCents: -2500, counterpartyName: 'Paula Probe', counterpartyIban: PAYER_IBAN, purpose: 'Mitgliedsbeitrag August, Lastschrift zurueckgegeben', bankReference: 'IMP-0010', returnCode: 'AC04' },
          ],
        }),
      }),
    );
  }
  const fee = deps.db.select().from(financeRawTransactions).where(and(eq(financeRawTransactions.accountId, importkontoId), eq(financeRawTransactions.bankReference, 'IMP-0008'))).get();
  const feeBound = fee ? deps.db.select({ id: financeMoneyLines.id }).from(financeMoneyLines).where(eq(financeMoneyLines.rawTransactionId, fee.id)).get() : undefined;
  if (fee && !feeBound) {
    unwrap(
      await bookEntry(deps, ctx, {
        entryDate: fee.bookingDate,
        text: 'Mitgliedsbeitrag August',
        moneyLines: [{ accountId: importkontoId, amountCents: fee.amountCents, rawTransactionId: fee.id }],
        allocationLines: [{ categoryId: categoryByKey(deps, 'membership-fees').id, amountCents: fee.amountCents }],
      }),
    );
  }
}
