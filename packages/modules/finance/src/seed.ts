import { assignRole, createRole, createUser, getDashboardLayout, getEffectivePermissions, readSetting, schema, setDashboardLayout, setRolePermissions, unwrap, type CallContext, type Deps } from '@kompass/core';
import { addContactRole, contactRoles, contacts, createContact, hasLinkHistoryInternal, linkUserToContact, updateContact } from '@kompass/module-contacts';
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
import { checkConfirmable } from './donations/check';
import { attachSignedConfirmation, issueConfirmation, recordConfirmationDispatch, voidConfirmation } from './donations/confirmations';
import { saveInKindDetails } from './donations/in-kind';
import { saveSigner, uploadFacsimile } from './donations/machine';
import { saveNotice, supersedeNotice } from './donations/notices';
import { continueConfirmationRun, dispatchRunConfirmations, startConfirmationRun } from './donations/runs';
import { setExpenseWaiverBasisText, setFinanceSwitch } from './ledger/setup';
import { saveExpenseDraft, submitExpenseClaim, uploadExpenseReceipt } from './allocation/expenses';
import { approveExpenseClaim, rejectExpenseClaim } from './allocation/approvals';
import { attachSignedWaiver, createWaiverDeclaration } from './allocation/waiver';
import { buildCamt053Bytes } from './import/camt-fixture';
import { buildOfficeInvoicePdf, buildVetInvoicePdf } from './import/zugferd-fixture';
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
  financeConfirmationLines,
  financeConfirmationRuns,
  financeConfirmations,
  financeExpensePositions,
  financeNotices,
  financePurposes,
  financeRawTransactions,
  financeSigners,
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

  // F6a Task 9: eine Spende im Vorjahr, bestätigt auf dem später ersetzten § 60a-Bescheid — gebucht und
  // belegt, solange das Jahr noch offen ist.
  await seedProvisionalNoticeDonation(deps, ctx);

  // F6b Task 9: die Buchungen für den Serienlauf des Vorjahrs — vor dem Abschluss, solange das Jahr
  // noch offen ist. Der Lauf selbst startet erst später (`seedConfirmationRun`), wenn Bescheid,
  // Unterzeichner und Aufwandsspenden-Schalter stehen (aus `seedDonations`).
  await seedRunDonationEntries(deps, ctx, previousYear);

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
      // F6b Task 9: „Spende Jan Moser Vorjahr“ bleibt ohne Anschrift und ohne Beleg — genau die Zeile, die
      // der Serienlauf später als „Anschrift fehlt“ überspringt.
      const janMoserForJustify = entryByText(deps, 'Spende Jan Moser Vorjahr');
      unwrap(await justifyUndocumentedEntry(deps, ctx, { entryId: janMoserForJustify.id, note: 'Anschrift fehlt noch, Nachweis liegt bei den Unterlagen' }));
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

  // F6a (aus Task 9 vorgezogen): Bescheid, maschinelles Verfahren, Bestätigungen in ihren Zuständen.
  await seedDonations(deps, ctx, currentYear);

  // F6b Task 9: der abgeschlossene Serienlauf des Vorjahrs mit Versandvermerk, dazu die Rücklastschrift
  // einer Spende, die in einer Sammelbestätigung stand (Prüfstein 6).
  await seedConfirmationRun(deps, ctx, previousYear, currentYear);

  // F8a Task 7: Anträge in jedem Zustand — nach `seedDonations`, weil der Verzicht den eingeschalteten
  // Aufwandsspenden-Schalter braucht, den `seedDonations` setzt.
  await seedExpenseClaims(deps, ctx, currentYear);
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
  await seedZugferdInvoices(deps, ctx);
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
 * F5b: zwei Eingangsrechnungen mit eingebetteter ZUGFeRD-XML, beide als
 * Finanzbeleg ohne Buchung — die Tierarzt-Rechnung über 119,00 € ist
 * unbezahlt (Karte „Aus der Rechnung“: „Offene Zahlung anlegen“), die über
 * 35,00 € von Bürobedarf Muster GmbH bezahlt: Ihre IBAN trägt die offene
 * Büromaterial-Zeile vom 10.01.2026 auf „Importkonto“ (Lauf A). Je Rechnung
 * idempotent über den Betreff.
 */
async function seedZugferdInvoices(deps: Deps, ctx: CallContext): Promise<void> {
  const dmsCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'dms.view', 'dms.create']) };
  const invoices = [
    { subject: 'Rechnung TM-2026-0042 Tierarztpraxis Muster', filename: '2026-04-01 Rechnung Tierarztpraxis.pdf', documentDate: '2026-04-01', bytes: buildVetInvoicePdf },
    { subject: 'Rechnung BM-7781 Bürobedarf Muster GmbH', filename: '2026-01-08 Rechnung BM-7781.pdf', documentDate: '2026-01-08', bytes: buildOfficeInvoicePdf },
  ];
  for (const invoice of invoices) {
    const exists = deps.db.select({ id: dmsDocuments.id }).from(dmsDocuments).where(eq(dmsDocuments.subject, invoice.subject)).get();
    if (exists) continue;
    unwrap(
      await receiveDocument(deps, dmsCtx, {
        filename: invoice.filename,
        bytes: invoice.bytes(),
        typeKey: 'voucher-invoice',
        subject: invoice.subject,
        documentDate: invoice.documentDate,
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

/**
 * Ein erfundenes Faksimile: eine Wellenlinie, 96 × 32 Pixel, Graustufen-PNG.
 * Die Bytes stehen im Code, damit der Seed ohne Datei auskommt; die Vorlage
 * bindet es wie jedes hochgeladene Faksimile ein.
 */
const SEED_FACSIMILE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAGAAAAAgCAAAAADIqyKIAAAAoUlEQVR42u2WUQ6AIAxD3/0vrSYashgoK8KX7BO7tsxtyrE42AJbICCvWCdACZcfj95USOIDzJLIGnqB0go3Oy5/WuGBMfCWrHtj2s/2RklkhL+vENtihL+nEBJVPWWt9TMyo0DPZcoYTR76dc4Yo8WE0SlyLhvAkRmvnlEHetOqthu1c8x9o3wxY2MqX0zZ+SKR718tnUfrvr7G/m35rcAJzhP2lpJRxHQAAAAASUVORK5CYII=';

type SeedContact = { kind: 'person'; firstName: string; lastName: string } | { kind: 'organization'; name: string };

/** Einen erfundenen Kontakt finden oder anlegen; die Anschrift nur, wo sie gegeben ist — sonst bleibt er „ohne Anschrift“. */
async function ensureDonationContact(deps: Deps, ctx: CallContext, who: SeedContact, address?: { street: string; postalCode: string; city: string }): Promise<string> {
  const contactCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'contacts.manage']) };
  const existing =
    who.kind === 'person'
      ? deps.db.select().from(contacts).where(and(eq(contacts.firstName, who.firstName), eq(contacts.lastName, who.lastName))).get()
      : deps.db.select().from(contacts).where(eq(contacts.name, who.name)).get();
  if (!existing) return unwrap(await createContact(deps, contactCtx, { ...who, ...(address ?? {}) })).id;
  if (address && !existing.street) unwrap(await updateContact(deps, contactCtx, { id: existing.id, ...address }));
  return existing.id;
}

/** Die Zeile mit dem positiven Betrag (Einnahme) einer Buchung — bei Sach- und Aufwandsspende steht daneben der Aufwand. */
function incomeLineOf(deps: Deps, entryText: string) {
  const line = allocationLinesOf(deps, entryByText(deps, entryText).id).find((l) => l.amountCents > 0);
  if (!line) throw new Error(`Einnahmezeile fehlt: ${entryText}`);
  return line;
}

/** Eine Bestätigung nur, wenn auf der Zeile noch keine liegt und die Prüfliste nichts sperrt — idempotent. */
async function ensureConfirmation(deps: Deps, ctx: CallContext, lineId: string, issuedOn?: string): Promise<void> {
  if (deps.db.select({ id: financeConfirmationLines.id }).from(financeConfirmationLines).where(eq(financeConfirmationLines.lineId, lineId)).get()) return;
  const check = unwrap(await checkConfirmable(deps, ctx, { lineIds: [lineId], ...(issuedOn ? { issuedOn } : {}) }));
  if (!check.ok) return;
  unwrap(await issueConfirmation(deps, ctx, { lineIds: [lineId], ...(issuedOn ? { issuedOn } : {}) }));
}

/** Die Bestätigung, die auf einer Zeile liegt (auch eine zurückgenommene). */
function confirmationOfLine(deps: Deps, lineId: string) {
  return deps.db
    .select()
    .from(financeConfirmationLines)
    .innerJoin(financeConfirmations, eq(financeConfirmationLines.confirmationId, financeConfirmations.id))
    .where(eq(financeConfirmationLines.lineId, lineId))
    .get()?.finance_confirmations;
}

const organizationAddressComplete = (deps: Deps) => (['street', 'postalCode', 'city'] as const).every((field) => String(readSetting(deps, `organization.${field}`) ?? '').trim());

// N8 (Befundliste 0.2.0): Genitiv ohne „Förderung“ — die Sätze setzen das Wort selbst davor; § 60a braucht zusätzlich den Akkusativ.
const NOTICE_TAX_OFFICE = {
  taxOffice: 'Finanzamt Musterstadt',
  taxNumber: '99/999/99999',
  purposesText: 'des Sports (§ 52 Abs. 2 Satz 1 Nr. 21 AO) und der Jugendhilfe (§ 52 Abs. 2 Satz 1 Nr. 4 AO)',
  purposesTextAccusative: 'den Sport (§ 52 Abs. 2 Satz 1 Nr. 21 AO) und die Jugendhilfe (§ 52 Abs. 2 Satz 1 Nr. 4 AO)',
} as const;
/** Die Spende, die auf dem § 60a-Bescheid bestätigt wird — die Daten hängen an den festen Bescheiddaten, nicht am Kalender. */
const PROVISIONAL_DONATION = { text: 'Spende Greta Sommer März', entryDate: '2025-03-14', issuedOn: '2025-04-15', amountCents: 12000 } as const;

/**
 * F6a Task 9: Greta Sommer spendet im März 2025 — das Jahr, in dem der
 * Freistellungsbescheid den § 60a-Bescheid ablöst. Die Buchung entsteht nur,
 * solange das Geschäftsjahr 2025 besteht und offen ist (bei einem Seed nach
 * dem Abschluss oder in einem späteren Kalenderjahr bleibt sie aus).
 */
async function seedProvisionalNoticeDonation(deps: Deps, ctx: CallContext): Promise<void> {
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.designation, PROVISIONAL_DONATION.entryDate.slice(0, 4))).get();
  if (!year || fiscalYearStatusInternal(deps.db, year.id) === 'closed') return;
  const greta = await ensureDonationContact(deps, ctx, { kind: 'person', firstName: 'Greta', lastName: 'Sommer' }, { street: 'Lindenallee 23', postalCode: '12343', city: 'Musterstadt' });
  const { text, entryDate, amountCents } = PROVISIONAL_DONATION;
  await ensureEntry(deps, text, () =>
    bookEntry(deps, ctx, { entryDate, text, moneyLines: [{ accountId: accountByName(deps, 'Vereinskonto').id, amountCents }], allocationLines: [{ categoryId: categoryByKey(deps, 'donations').id, amountCents, contactId: greta }] }).then(unwrap),
  );
  await ensureVoucher(deps, ctx, entryByText(deps, text), 'voucher-own', entryDate, `Spendeneingang ${text}`);
}

/**
 * Die Bescheide in ihrer Geschichte: erst der § 60a-Bescheid vom 01.03.2024,
 * darauf die Bestätigung für Greta Sommer (15.04.2025), dann der
 * Freistellungsbescheid vom 02.05.2025, der den § 60a-Bescheid am selben Tag
 * ersetzt — Gretas Bestätigung ist damit „zu korrigieren“. Nur beim ersten
 * Lauf; die Reihenfolge ist Pflicht, weil ein § 60a-Bescheid nach einem
 * Freistellungsbescheid abgelehnt wird.
 */
async function seedNotices(deps: Deps, ctx: CallContext): Promise<void> {
  if (deps.db.select({ id: financeNotices.id }).from(financeNotices).get()) return;
  const provisional = unwrap(await saveNotice(deps, ctx, { kind: 'section60a', ...NOTICE_TAX_OFFICE, noticeDate: '2024-03-01', exemptFrom: '2024-01-01' }));
  await ensureSigner(deps, ctx);
  const greta = deps.db.select({ id: financeEntries.id }).from(financeEntries).where(eq(financeEntries.text, PROVISIONAL_DONATION.text)).get();
  if (greta && organizationAddressComplete(deps)) await ensureConfirmation(deps, ctx, incomeLineOf(deps, PROVISIONAL_DONATION.text).id, PROVISIONAL_DONATION.issuedOn);
  unwrap(await saveNotice(deps, ctx, { kind: 'exemptionNotice', ...NOTICE_TAX_OFFICE, noticeDate: '2025-05-02', exemptFrom: '2023-01-01', assessmentPeriod: '2023' }));
  unwrap(await supersedeNotice(deps, ctx, { id: provisional.id, supersededOn: '2025-05-02' }));
}

/** Jonas Feld als Unterzeichner mit Faksimile und Anzeige — nur, wenn noch keiner besteht. */
async function ensureSigner(deps: Deps, ctx: CallContext): Promise<void> {
  if (deps.db.select({ id: financeSigners.id }).from(financeSigners).get()) return;
  const signer = unwrap(await saveSigner(deps, ctx, { validFrom: '2025-01-01', signerName: 'Jonas Feld', notifiedOn: '2025-06-02' }));
  unwrap(await uploadFacsimile(deps, ctx, { signerId: signer.id, bytes: new Uint8Array(Buffer.from(SEED_FACSIMILE_PNG, 'base64')), mimeType: 'image/png' }));
}

/**
 * F6a (Spec 11.3, aus Task 9 vorgezogen für die E2E von Task 7): der
 * Freistellungsbescheid eines erfundenen Finanzamts, Jonas Feld als
 * Unterzeichner mit Faksimile und Anzeige, und Zuwendungen in jedem Zustand:
 * gültig und maschinell (Erika Beispiel), „Unterschrift fehlt“ (eine
 * Aufwandsspende), eine Sachspende mit Angaben und Bestätigung (Prüfstein 5);
 * unbestätigt eine Spende ohne Anschrift (sperrt), eine einer Organisation
 * (warnt), eine zweite Aufwandsspende und eine Sachspende ohne Angaben. Die
 * Bestätigungen entstehen nur, wenn die Vereinsanschrift steht (sie kommt aus
 * dem Kern-Seed) — ein Modultest ohne sie bekommt Bescheid und Buchungen,
 * aber keine Bestätigung. Task 9 ergänzt „zu korrigieren“ (Greta Sommer, auf
 * dem ersetzten § 60a-Bescheid, `seedNotices`) und „zurückgenommen“ mit
 * Rückholspur (Henrik Brandt).
 */
async function seedDonations(deps: Deps, ctx: CallContext, currentYear: number): Promise<void> {
  await seedNotices(deps, ctx);
  await ensureSigner(deps, ctx);
  if (!readSetting<boolean>(deps, 'finance.expenseWaiversEnabled')) unwrap(await setFinanceSwitch(deps, ctx, { key: 'finance.expenseWaiversEnabled', value: true }));

  const erika = await ensureDonationContact(deps, ctx, { kind: 'person', firstName: 'Erika', lastName: 'Beispiel' }, { street: 'Beispielstraße 7', postalCode: '54321', city: 'Beispielstadt' });
  const lukas = await ensureDonationContact(deps, ctx, { kind: 'person', firstName: 'Lukas', lastName: 'Hofmann' }, { street: 'Ulmenweg 12', postalCode: '12345', city: 'Musterstadt' });
  const clara = await ensureDonationContact(deps, ctx, { kind: 'person', firstName: 'Clara', lastName: 'Neumann' }, { street: 'Rosengasse 5', postalCode: '12347', city: 'Musterstadt' });
  const tobias = await ensureDonationContact(deps, ctx, { kind: 'person', firstName: 'Tobias', lastName: 'Adler' });
  const club = await ensureDonationContact(deps, ctx, { kind: 'organization', name: 'Sportfreunde Beispieltal e. V.' }, { street: 'Am Sportplatz 1', postalCode: '12349', city: 'Beispieltal' });

  const bank = accountByName(deps, 'Vereinskonto');
  const donations = categoryByKey(deps, 'donations');
  const waivers = categoryByKey(deps, 'expense-waivers');
  const travel = categoryByKey(deps, 'travel');
  const inKind = categoryByKey(deps, 'in-kind-donations');
  const inKindExpense = categoryByKey(deps, 'program-in-kind');

  const money = async (text: string, date: string, cents: number, contactId: string) => {
    await ensureEntry(deps, text, () => bookEntry(deps, ctx, { entryDate: date, text, moneyLines: [{ accountId: bank.id, amountCents: cents }], allocationLines: [{ categoryId: donations.id, amountCents: cents, contactId }] }).then(unwrap));
    await ensureVoucher(deps, ctx, entryByText(deps, text), 'voucher-own', date, `Spendeneingang ${text}`);
  };
  const withoutMoney = async (text: string, date: string, cents: number, contactId: string, income: { id: string }, expense: { id: string }) => {
    await ensureEntry(deps, text, () =>
      bookEntry(deps, ctx, { entryDate: date, text, moneyLines: [], allocationLines: [{ categoryId: income.id, amountCents: cents, contactId }, { categoryId: expense.id, amountCents: -cents }] }).then(unwrap),
    );
  };

  await money('Spende Erika Beispiel Juni', `${currentYear}-06-12`, 25000, erika);
  await money('Spende Tobias Adler', `${currentYear}-06-20`, 5000, tobias);
  await money('Spende Sportfreunde Beispieltal', `${currentYear}-07-05`, 10000, club);

  await withoutMoney('Aufwandsspende Fahrtkosten Mai', `${currentYear}-05-20`, 4800, lukas, waivers, travel);
  await ensureVoucher(deps, ctx, entryByText(deps, 'Aufwandsspende Fahrtkosten Mai'), 'voucher-own', `${currentYear}-05-20`, 'Verzichtserklärung Fahrtkosten Mai');
  await withoutMoney('Aufwandsspende Fahrtkosten Juli', `${currentYear}-07-15`, 3600, lukas, waivers, travel);
  await ensureVoucher(deps, ctx, entryByText(deps, 'Aufwandsspende Fahrtkosten Juli'), 'voucher-own', `${currentYear}-07-15`, 'Verzichtserklärung Fahrtkosten Juli');

  // Prüfstein 5: Sachspenden ohne Geldfluss. Die Wertunterlage liegt als Dokument in der Akte; die des Beamers wird
  // über die Angaben zum Beleg der Buchung, die des Laptops wartet — die E2E beschreibt ihn selbst.
  const dmsCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'dms.view', 'dms.create']) };
  const proof = async (subject: string, date: string) => {
    const found = deps.db.select({ id: dmsDocuments.id }).from(dmsDocuments).where(eq(dmsDocuments.subject, subject)).get();
    if (found) return found.id;
    return unwrap(await receiveDocument(deps, dmsCtx, { filename: `${date} ${subject}.pdf`, bytes: textPdf([subject, '', 'Erfundenes Beispiel für die Entwicklung.']), typeKey: 'voucher-own', subject, documentDate: date, folder: null })).id;
  };
  await withoutMoney('Sachspende Beamer', `${currentYear}-04-18`, 35000, clara, inKind, inKindExpense);
  const beamerProof = await proof('Wertnachweis Beamer', `${currentYear}-08-20`);
  await withoutMoney('Sachspende Laptop', `${currentYear}-08-03`, 20000, clara, inKind, inKindExpense);
  await proof('Wertnachweis Laptop', `${currentYear}-08-21`);

  const henrik = await ensureDonationContact(deps, ctx, { kind: 'person', firstName: 'Henrik', lastName: 'Brandt' }, { street: 'Birkenstraße 9', postalCode: '12344', city: 'Musterstadt' });
  await money('Spende Henrik Brandt März', `${currentYear}-03-20`, 7500, henrik);

  if (!organizationAddressComplete(deps)) return;

  const beamer = incomeLineOf(deps, 'Sachspende Beamer');
  if (!deps.db.select({ id: financeConfirmationLines.id }).from(financeConfirmationLines).where(eq(financeConfirmationLines.lineId, beamer.id)).get()) {
    unwrap(await saveInKindDetails(deps, ctx, { lineId: beamer.id, item: 'Beamer mit Tasche und Fernbedienung', condition: 'gebraucht, zwei Jahre alt, voll funktionsfähig', valuation: 'Preis vergleichbarer gebrauchter Geräte laut Wertnachweis', origin: 'private', proofDocumentId: beamerProof }));
  }
  await ensureConfirmation(deps, ctx, incomeLineOf(deps, 'Spende Erika Beispiel Juni').id);
  await ensureConfirmation(deps, ctx, incomeLineOf(deps, 'Aufwandsspende Fahrtkosten Mai').id);
  await ensureConfirmation(deps, ctx, beamer.id);
  // Die Sachspende ist unterschrieben zurück — so steht unter „Unterschrift fehlt“ nur die Aufwandsspende.
  const beamerConfirmation = deps.db
    .select({ id: financeConfirmations.id, signedDocumentId: financeConfirmations.signedDocumentId })
    .from(financeConfirmationLines)
    .innerJoin(financeConfirmations, eq(financeConfirmationLines.confirmationId, financeConfirmations.id))
    .where(eq(financeConfirmationLines.lineId, beamer.id))
    .get();
  if (beamerConfirmation && !beamerConfirmation.signedDocumentId) {
    unwrap(await attachSignedConfirmation(deps, ctx, { id: beamerConfirmation.id, bytes: textPdf(['Zuwendungsbestätigung, unterschrieben', '', 'Erfundenes Beispiel für die Entwicklung.']), fileName: 'unterschrieben.pdf' }));
  }

  // Zurückgenommen mit Rückholspur: per Post versandt, das Original kam zurück. Die Zeile ist danach wieder
  // bestätigbar und steht unter „Noch nicht bestätigt“.
  const henrikLine = incomeLineOf(deps, 'Spende Henrik Brandt März');
  await ensureConfirmation(deps, ctx, henrikLine.id);
  const henrikConfirmation = confirmationOfLine(deps, henrikLine.id);
  if (henrikConfirmation && !henrikConfirmation.voidedAt) {
    if (!henrikConfirmation.sentAt) unwrap(await recordConfirmationDispatch(deps, ctx, { id: henrikConfirmation.id, sentAt: `${currentYear}-03-27`, sentVia: 'post' }));
    unwrap(await voidConfirmation(deps, ctx, { id: henrikConfirmation.id, note: 'Betrag doppelt bestätigt', alreadySent: true, originalReturnedOn: `${currentYear}-04-09` }));
  }
}

/**
 * F6b Task 9: die Buchungen für den Serienlauf des Vorjahrs — zwei
 * maschinelle Geldspenden (Nora Lehmann, Paul Winter), eine Aufwandsspende
 * mit Unterschriftsfeld (Sina Krüger) und eine Spende ohne Anschrift (Jan
 * Moser, bleibt „Anschrift fehlt“). Läuft vor dem Abschluss des Vorjahrs
 * (`seedFinance`), solange darin noch gebucht werden darf; der Lauf selbst
 * startet erst in `seedConfirmationRun`, wenn Bescheid, Unterzeichner und
 * Aufwandsspenden-Schalter stehen.
 */
async function seedRunDonationEntries(deps: Deps, ctx: CallContext, previousYear: number): Promise<void> {
  const bank = accountByName(deps, 'Vereinskonto');
  const donations = categoryByKey(deps, 'donations');
  const waivers = categoryByKey(deps, 'expense-waivers');
  const travel = categoryByKey(deps, 'travel');

  const nora = await ensureDonationContact(deps, ctx, { kind: 'person', firstName: 'Nora', lastName: 'Lehmann' }, { street: 'Kastanienweg 4', postalCode: '12341', city: 'Musterstadt' });
  const paul = await ensureDonationContact(deps, ctx, { kind: 'person', firstName: 'Paul', lastName: 'Winter' }, { street: 'Ahornstraße 11', postalCode: '12342', city: 'Musterstadt' });
  const sina = await ensureDonationContact(deps, ctx, { kind: 'person', firstName: 'Sina', lastName: 'Krüger' }, { street: 'Fliederweg 6', postalCode: '12346', city: 'Musterstadt' });
  // Bewusst ohne Anschrift — der Serienlauf überspringt diese Zeile mit „Anschrift fehlt“.
  const jan = await ensureDonationContact(deps, ctx, { kind: 'person', firstName: 'Jan', lastName: 'Moser' });

  await ensureEntry(deps, 'Spende Nora Lehmann Vorjahr', () =>
    bookEntry(deps, ctx, {
      entryDate: `${previousYear}-09-10`,
      text: 'Spende Nora Lehmann Vorjahr',
      moneyLines: [{ accountId: bank.id, amountCents: 6000 }],
      allocationLines: [{ categoryId: donations.id, amountCents: 6000, contactId: nora }],
    }).then(unwrap),
  );
  await ensureVoucher(deps, ctx, entryByText(deps, 'Spende Nora Lehmann Vorjahr'), 'voucher-own', `${previousYear}-09-10`, 'Spendeneingang Nora Lehmann Vorjahr');

  await ensureEntry(deps, 'Spende Paul Winter Vorjahr', () =>
    bookEntry(deps, ctx, {
      entryDate: `${previousYear}-10-02`,
      text: 'Spende Paul Winter Vorjahr',
      moneyLines: [{ accountId: bank.id, amountCents: 9000 }],
      allocationLines: [{ categoryId: donations.id, amountCents: 9000, contactId: paul }],
    }).then(unwrap),
  );
  await ensureVoucher(deps, ctx, entryByText(deps, 'Spende Paul Winter Vorjahr'), 'voucher-own', `${previousYear}-10-02`, 'Spendeneingang Paul Winter Vorjahr');

  await ensureEntry(deps, 'Aufwandsspende Fahrtkosten Vorjahr', () =>
    bookEntry(deps, ctx, {
      entryDate: `${previousYear}-11-05`,
      text: 'Aufwandsspende Fahrtkosten Vorjahr',
      moneyLines: [],
      allocationLines: [{ categoryId: waivers.id, amountCents: 3200, contactId: sina }, { categoryId: travel.id, amountCents: -3200 }],
    }).then(unwrap),
  );
  await ensureVoucher(deps, ctx, entryByText(deps, 'Aufwandsspende Fahrtkosten Vorjahr'), 'voucher-own', `${previousYear}-11-05`, 'Verzichtserklärung Fahrtkosten Vorjahr');

  // Ohne Anschrift, bewusst ohne Beleg — der Abschluss des Vorjahrs verlangt dafür eine Begründung (siehe `seedFinance`).
  await ensureEntry(deps, 'Spende Jan Moser Vorjahr', () =>
    bookEntry(deps, ctx, {
      entryDate: `${previousYear}-11-20`,
      text: 'Spende Jan Moser Vorjahr',
      moneyLines: [{ accountId: bank.id, amountCents: 4500 }],
      allocationLines: [{ categoryId: donations.id, amountCents: 4500, contactId: jan }],
    }).then(unwrap),
  );
}

/**
 * F6b Task 9: der abgeschlossene Serienlauf des Vorjahrs — zwei maschinelle
 * Bestätigungen, eine mit Unterschriftsfeld, eine übersprungen (Anschrift
 * fehlt), mit Versandvermerk für die maschinellen Posten (Annahme 8). Läuft
 * nach `seedDonations`, wenn Bescheid, Unterzeichner, Vereinsanschrift und
 * Aufwandsspenden-Schalter stehen; die Buchungen dafür liefert
 * `seedRunDonationEntries`, vor dem Abschluss des Vorjahrs. Dazu (Prüfstein
 * 6, Annahme 11): eine Rücklastschrift auf Nora Lehmanns maschinell
 * bestätigte Spende — ihre Sammelbestätigung steht danach „zu korrigieren“.
 */
async function seedConfirmationRun(deps: Deps, ctx: CallContext, previousYear: number, currentYear: number): Promise<void> {
  if (!organizationAddressComplete(deps)) return;

  let run = deps.db.select().from(financeConfirmationRuns).where(eq(financeConfirmationRuns.year, previousYear)).get();
  if (!run) {
    const started = unwrap(await startConfirmationRun(deps, ctx, { year: previousYear }));
    run = deps.db.select().from(financeConfirmationRuns).where(eq(financeConfirmationRuns.id, started.id)).get()!;
  }
  if (!run.finishedAt) {
    unwrap(await continueConfirmationRun(deps, ctx, { runId: run.id, max: 50 }));
    run = deps.db.select().from(financeConfirmationRuns).where(eq(financeConfirmationRuns.id, run.id)).get()!;
  }
  if (!run.dispatchedAt) {
    const sentAt = deps.clock.now().toISOString().slice(0, 10);
    unwrap(await dispatchRunConfirmations(deps, ctx, { runId: run.id, sentAt, sentVia: 'post' }));
  }

  // Prüfstein 6: die Rücklastschrift auf Nora Lehmanns maschinell bestätigte Spende.
  const noraLine = incomeLineOf(deps, 'Spende Nora Lehmann Vorjahr');
  await ensureEntry(deps, 'Rücklastschrift Nora Lehmann Vorjahr', () =>
    bookEntry(deps, ctx, {
      entryDate: `${currentYear}-02-18`,
      text: 'Rücklastschrift Nora Lehmann Vorjahr',
      moneyLines: [{ accountId: accountByName(deps, 'Vereinskonto').id, amountCents: -6000 }],
      allocationLines: [{ categoryId: categoryByKey(deps, 'donations').id, amountCents: -6000, contactId: noraLine.contactId!, originLineId: noraLine.id }],
    }).then(unwrap),
  );
}

/**
 * F8a Task 7: „Nadja Vogt“ — eigens erfunden fürs Einreichen von Auslagen,
 * mit der mitgelieferten Rolle „Auslagen einreichen“ und einem eigenen,
 * gleich verknüpften Kontakt. Bewusst **keine** der drei Kernseed-Personen:
 * Peter Lang bleibt in `home.spec.ts` als „ohne jede Kachel“ geprüft, Jonas
 * Feld trägt schon die Freigabe. Idempotent über die E-Mail-Adresse.
 */
async function ensureExpenseClerkPerson(deps: Deps, ctx: CallContext): Promise<string | null> {
  const usersCtx: CallContext = { ...ctx, permissions: new Set(deps.registry.permissionKeys) };
  const clerkRole = deps.db.select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.name, 'Auslagen einreichen')).get();
  if (!clerkRole) return null;
  let person = deps.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, 'nadja@kompass.local')).get();
  if (!person) {
    const created = unwrap(await createUser(deps, usersCtx, { name: 'Nadja Vogt', email: 'nadja@kompass.local', roleIds: [clerkRole.id] }));
    person = { id: created.user.id };
  } else {
    const already = deps.db
      .select({ userId: schema.userRoles.userId })
      .from(schema.userRoles)
      .where(and(eq(schema.userRoles.userId, person.id), eq(schema.userRoles.roleId, clerkRole.id)))
      .get();
    if (!already) unwrap(await assignRole(deps, usersCtx, { userId: person.id, roleId: clerkRole.id }));
  }
  if (!hasLinkHistoryInternal(deps.db, person.id)) {
    const contactCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'contacts.manage']) };
    const existingContact = deps.db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.firstName, 'Nadja'), eq(contacts.lastName, 'Vogt'))).get();
    const contactId = existingContact?.id ?? unwrap(await createContact(deps, contactCtx, { kind: 'person', salutation: 'Frau', firstName: 'Nadja', lastName: 'Vogt', street: 'Ahornstraße 3', postalCode: '12348', city: 'Musterstadt' })).id;
    unwrap(await linkUserToContact(deps, { ...usersCtx, userId: person.id }, { userId: person.id, contactId }));
  }
  return person.id;
}

/**
 * F8a Task 7: Jonas Felds gespeicherte Startseiten-Anordnung (`seedDashboardLayout`
 * im Kern, vor jedem Modul-Seed geschrieben) kennt die neue Kachel „Wartet auf
 * Ihre Freigabe“ noch nicht — ohne diesen Nachtrag sieht er sie erst nach
 * „Vorgabe wiederherstellen“. Ergänzt seine bestehenden Kacheln, ersetzt sie
 * nicht; idempotent, ob die Kachel schon dabei ist.
 */
async function addApprovalsPendingTileForJonas(deps: Deps, ctx: CallContext, jonasUserId: string): Promise<void> {
  const jonasCtx: CallContext = { ...ctx, userId: jonasUserId, permissions: getEffectivePermissions(deps.db, deps.registry, jonasUserId) };
  const layout = unwrap(await getDashboardLayout(deps, jonasCtx));
  if (layout.tiles.some((t) => t.module === 'finance' && t.key === 'approvalsPending')) return;
  unwrap(await setDashboardLayout(deps, jonasCtx, { tiles: [...layout.tiles, { module: 'finance', key: 'approvalsPending', options: {} }] }));
}

/** Ob schon eine Auslage mit dieser (erfundenen, eindeutigen) Positions-Beschreibung besteht — Idempotenz ohne eigene Zähltabelle. */
function expenseClaimSeeded(deps: Deps, marker: string): boolean {
  return !!deps.db.select({ id: financeExpensePositions.id }).from(financeExpensePositions).where(eq(financeExpensePositions.purpose, marker)).get();
}

/**
 * F8a Task 7 (Spec 11.3): Anträge in jedem Zustand — Entwurf ohne Beleg,
 * eingereicht mit Beleg und Fahrt (die Büromaterial-Position trifft später
 * den Kategorievorschlag über „Büromaterial Altjahr“, Annahme 8), freigegeben
 * mit offener Zahlung, ausgezahlt, abgelehnt mit Grund, und ein Verzicht
 * (Aufwandsspende) mit Verzichtserklärung und unterschriebener Fassung.
 * „Nadja Vogt“ reicht ein, „Jonas Feld“ (schon `finance.approve`, Task 2)
 * gibt frei oder lehnt ab — nie sich selbst, weil sein eigener Kontakt
 * fehlt. Ohne Jonas Feld (ein isolierter Modultest) bleibt der Schritt aus;
 * jeder Antrag ist über seine erfundene, eindeutige erste Position für sich
 * idempotent.
 */
async function seedExpenseClaims(deps: Deps, ctx: CallContext, currentYear: number): Promise<void> {
  const jonas = deps.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, 'jonas@kompass.local')).get();
  if (!jonas) return;
  const clerkUserId = await ensureExpenseClerkPerson(deps, ctx);
  if (!clerkUserId) return;
  await addApprovalsPendingTileForJonas(deps, ctx, jonas.id);

  // Anspruchsgrundlage des Vereins für Aufwandsspenden — sonst scheitert das Erzeugen der
  // Verzichtserklärung an `waiverBasisMissing` (BMF 25.11.2014: Vertrag oder Satzung).
  if (!readSetting<string>(deps, 'finance.expenseWaiverBasisText')) {
    const setupCtx: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'finance.setup']) };
    unwrap(await setExpenseWaiverBasisText(deps, setupCtx, { text: 'Vereinbarung vom 02.01.2026 nach § 14 der Satzung' }));
  }

  const submitCtx: CallContext = { ...ctx, userId: clerkUserId, permissions: new Set([...ctx.permissions, 'finance.expensesSubmit']) };
  const approveCtx: CallContext = { ...ctx, userId: jonas.id, permissions: new Set([...ctx.permissions, 'finance.approve']) };
  const officeCat = categoryByKey(deps, 'office');
  const travelCat = categoryByKey(deps, 'travel');
  const bank = accountByName(deps, 'Vereinskonto');
  const receiptBytes = () => textPdf(['Beleg', '', 'Erfundenes Beispiel für die Entwicklung.']);
  const IBAN = 'DE93999999990000000001';

  // 1) Entwurf ohne Beleg — unvollständig, wie ihn die laufende Sicherung zulässt.
  if (!expenseClaimSeeded(deps, 'Deko für den Infoabend')) {
    unwrap(await saveExpenseDraft(deps, submitCtx, { waiver: false, positions: [{ kind: 'receipt', purpose: 'Deko für den Infoabend' }] }));
  }

  // 2) Eingereicht, mit Beleg und Fahrt — bleibt in der Warteschlange (Kategorievorschlag, Annahme 8).
  if (!expenseClaimSeeded(deps, 'Büromaterial für die Infotheke')) {
    const draft = unwrap(
      await saveExpenseDraft(deps, submitCtx, {
        waiver: false,
        iban: IBAN,
        positions: [
          { kind: 'receipt', positionDate: `${currentYear}-06-05`, amountCents: 1890, purpose: 'Büromaterial für die Infotheke' },
          { kind: 'trip', positionDate: `${currentYear}-06-05`, tripFrom: 'Musterstadt', tripTo: 'Beispielstadt', tripReason: 'Infomaterial abgeholt', tripKm: 18 },
        ],
      }),
    );
    unwrap(await uploadExpenseReceipt(deps, submitCtx, { claimId: draft.id, positionId: draft.positions[0]!.id, bytes: receiptBytes(), fileName: 'beleg-bueromaterial.pdf' }));
    unwrap(await submitExpenseClaim(deps, submitCtx, { id: draft.id }));
  }

  // 3) Freigegeben, noch nicht ausgezahlt — offener Posten, Herkunft `financeExpenseClaim`.
  if (!expenseClaimSeeded(deps, 'Getränke für die Versammlung')) {
    const draft = unwrap(
      await saveExpenseDraft(deps, submitCtx, { waiver: false, iban: IBAN, positions: [{ kind: 'receipt', positionDate: `${currentYear}-06-12`, amountCents: 4200, purpose: 'Getränke für die Versammlung' }] }),
    );
    unwrap(await uploadExpenseReceipt(deps, submitCtx, { claimId: draft.id, positionId: draft.positions[0]!.id, bytes: receiptBytes(), fileName: 'beleg-getraenke.pdf' }));
    const submitted = unwrap(await submitExpenseClaim(deps, submitCtx, { id: draft.id }));
    unwrap(await approveExpenseClaim(deps, approveCtx, { claimId: submitted.id, positions: [{ positionId: submitted.positions[0]!.id, categoryId: officeCat.id }] }));
  }

  // 4) Freigegeben und ausgezahlt — die Überweisung begleicht den offenen Posten voll.
  if (!expenseClaimSeeded(deps, 'Portokosten Mitgliederbrief')) {
    const draft = unwrap(
      await saveExpenseDraft(deps, submitCtx, { waiver: false, iban: IBAN, positions: [{ kind: 'receipt', positionDate: `${currentYear}-06-18`, amountCents: 2350, purpose: 'Portokosten Mitgliederbrief' }] }),
    );
    unwrap(await uploadExpenseReceipt(deps, submitCtx, { claimId: draft.id, positionId: draft.positions[0]!.id, bytes: receiptBytes(), fileName: 'beleg-porto.pdf' }));
    const submitted = unwrap(await submitExpenseClaim(deps, submitCtx, { id: draft.id }));
    const approved = unwrap(await approveExpenseClaim(deps, approveCtx, { claimId: submitted.id, positions: [{ positionId: submitted.positions[0]!.id, categoryId: officeCat.id }] }));
    unwrap(
      await bookEntry(deps, ctx, {
        entryDate: `${currentYear}-07-02`,
        text: `Überweisung Auslage ${approved.number}`,
        moneyLines: [{ accountId: bank.id, amountCents: -2350, settlements: [{ openItemId: approved.openItemId!, amountCents: 2350 }] }],
        allocationLines: [{ categoryId: officeCat.id, amountCents: -2350 }],
      }),
    );
  }

  // 5) Abgelehnt, mit Grund — der Grund steht nur am Antrag, nie im Protokoll.
  if (!expenseClaimSeeded(deps, 'Blumenstrauß zum Jubiläum')) {
    const draft = unwrap(
      await saveExpenseDraft(deps, submitCtx, { waiver: false, iban: IBAN, positions: [{ kind: 'receipt', positionDate: `${currentYear}-06-20`, amountCents: 3500, purpose: 'Blumenstrauß zum Jubiläum' }] }),
    );
    unwrap(await uploadExpenseReceipt(deps, submitCtx, { claimId: draft.id, positionId: draft.positions[0]!.id, bytes: receiptBytes(), fileName: 'beleg-blumen.pdf' }));
    const submitted = unwrap(await submitExpenseClaim(deps, submitCtx, { id: draft.id }));
    unwrap(await rejectExpenseClaim(deps, approveCtx, { claimId: submitted.id, note: 'Kein Vereinszweck, bitte privat tragen' }));
  }

  // 6) Verzicht (Aufwandsspende) freigegeben — Verzichtserklärung erzeugt und unterschrieben zurück.
  if (!expenseClaimSeeded(deps, 'Fahrtkosten Pflegestelle Juli')) {
    const draft = unwrap(
      await saveExpenseDraft(deps, submitCtx, { waiver: true, positions: [{ kind: 'receipt', positionDate: `${currentYear}-07-01`, amountCents: 1600, purpose: 'Fahrtkosten Pflegestelle Juli' }] }),
    );
    unwrap(await uploadExpenseReceipt(deps, submitCtx, { claimId: draft.id, positionId: draft.positions[0]!.id, bytes: receiptBytes(), fileName: 'beleg-fahrtkosten.pdf' }));
    const submitted = unwrap(await submitExpenseClaim(deps, submitCtx, { id: draft.id }));
    unwrap(await createWaiverDeclaration(deps, approveCtx, { claimId: submitted.id, declaredOn: `${currentYear}-07-10` }));
    unwrap(await attachSignedWaiver(deps, approveCtx, { claimId: submitted.id, bytes: textPdf(['Verzichtserklärung, unterschrieben', '', 'Erfundenes Beispiel für die Entwicklung.']) }));
    unwrap(
      await approveExpenseClaim(deps, approveCtx, {
        claimId: submitted.id,
        positions: [{ positionId: submitted.positions[0]!.id, categoryId: travelCat.id }],
        waiver: { claimAgreedConfirmed: true, declaredOn: `${currentYear}-07-10` },
      }),
    );
  }
}
