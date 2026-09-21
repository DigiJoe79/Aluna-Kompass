import { assignRole, createRole, createUser, schema, setRolePermissions, unwrap, type CallContext, type Deps } from '@kompass/core';
import { addContactRole, contactRoles, createContact } from '@kompass/module-contacts';
import { textPdf } from '@kompass/module-dms';
import { projects } from '@kompass/module-projects';
import { and, asc, eq } from 'drizzle-orm';
import { createAccount, setAccountActive } from './ledger/accounts';
import { createCategory } from './ledger/categories';
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
import {
  financeAccounts,
  financeAllocationCorrections,
  financeAllocationLines,
  financeCategories,
  financeEntries,
  financeEntryDocuments,
  financeFiscalYears,
  financeOpenItems,
  financePurposes,
} from './schema';

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
    iban: 'DE02120300000000202051',
    bic: 'BYLADEM1001',
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
