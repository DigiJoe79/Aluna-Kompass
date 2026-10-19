import { readSetting, SEED_STORY_LAST_DAY, seedClockAt, seedMoment, todayIn, unwrap, writeSettingInternal, type CallContext, type Deps } from '@kompass/core';
import { createContact } from '@kompass/module-contacts';
import { receiveGeneratedUpload, textPdf } from '@kompass/module-dms';
import { buildCamt053Bytes } from '../import/camt-fixture';
import { importStatement } from '../import/runs';
import { bookFromTransaction } from '../import/book';
import { suggestForTransaction } from '../import/suggestions';
import { finalizeEntry } from '../ledger/finalize';
import { accountBalancesAt } from '../ledger/queries';
import { financeRawTransactions, financeSepaMandates } from '../schema';
import { and, eq } from 'drizzle-orm';
import { sepaAccountInternal } from './settings';
import { MANDATE_SIGNED_DOCUMENT_TYPE, mandateFormPdf } from './forms';
import { activateMandate, amendMandate, endMandate, MANDATE_ENTITY, prepareMandate } from './mandates';
import { pausePledge, savePledge } from './pledges';
import { addCalendarDays, addCalendarMonths, isTargetBusinessDay } from './business-days';
import { issuePrenotification } from './prenotifications';
import { pledgeDueDates } from './rates';
import { buildDirectDebitFile, createDirectDebitRun, markDirectDebitRunSubmitted, type DirectDebitRunView } from './runs';

/** Die Testkennung der Bundesbank — gültige Prüfziffer, nie eine echte Gläubiger-ID. */
export const SEED_CREDITOR_ID = 'DE98ZZZ09999999999';
/** Unterschriebene Rücksendungen kommen als Eingang dieser Art (Plan L1, Seed). */

/** Erfundene Zahler; IBANs mit der erfundenen Bankleitzahl 99999999 und gültiger Prüfziffer. */
const PAYERS = {
  monthly: { salutation: 'Frau', firstName: 'Lena', lastName: 'Sonnleitner', iban: 'DE78999999990000300001' },
  yearly: { salutation: 'Herr', firstName: 'Tobias', lastName: 'Winterberg', iban: 'DE51999999990000300002' },
  pending: { salutation: 'Frau', firstName: 'Greta', lastName: 'Herbstmann', iban: 'DE24999999990000300003' },
  ended: { salutation: 'Herr', firstName: 'Karl', lastName: 'Frühauf', iban: 'DE94999999990000300004' },
  amended: { salutation: 'Frau', firstName: 'Ida', lastName: 'Morgenstern', iban: 'DE67999999990000300005', newIban: 'DE40999999990000300006' },
  yearlyDebit: { salutation: 'Herr', firstName: 'Jonas', lastName: 'Regenfeld', iban: 'DE13999999990000300007' },
} as const;

/**
 * Lastschrift im Entwicklungs-Seed (Plan L1 Task 7, Spec § 11): eingeschaltet mit der Testkennung; Mandate aktiv,
 * vorbereitet, beendet und mit offener Änderung; drei Zusagen — monatlich mit Projekt und jährlich per Lastschrift,
 * jährlich per Dauerauftrag und ruhend. Der März-Einzug ist eingereicht und über eine Sammelgutschrift gebucht, beide
 * Posten kamen zurück: `MD06` offen, `AM04` ungebucht in der Arbeitsliste (Plan L3, U2). Läuft über die echten Dienste (Formular, unterschriebene Rücksendung, Aktivierung), im
 * Stichjahr und seinem Vorjahr. Idempotent: Gibt es schon ein Mandat, bleibt alles, wie es ist.
 */
export async function seedDirectDebit(deps: Deps, ctx: CallContext, storyYear: number, projectId: string | null): Promise<void> {
  if (deps.db.select({ id: financeSepaMandates.id }).from(financeSepaMandates).limit(1).get()) return;
  const previousYear = storyYear - 1;
  const full: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'contacts.manage', 'dms.view', 'dms.create', 'dms.file', 'finance.directDebit', 'finance.read']) };
  deps.db.transaction((tx) => {
    unwrap(writeSettingInternal(tx, deps, full, 'finance.sepa.enabled', true, 'finance.setup.setting'));
    if (!readSetting<string | null>(deps, 'finance.sepa.creditorId')) unwrap(writeSettingInternal(tx, deps, full, 'finance.sepa.creditorId', SEED_CREDITOR_ID, 'finance.setup.setting'));
  });

  /** Jeder Schritt an seinem Tag der Geschichte, 10:00 — Dokumente liegen so am Tag, den sie tragen. */
  const on = (day: string): Deps => seedClockAt(deps, seedMoment(deps, day, '10:00'));
  const person = async (day: string, p: { salutation: string; firstName: string; lastName: string }, street: string) =>
    unwrap(await createContact(on(day), full, { kind: 'person', salutation: p.salutation, firstName: p.firstName, lastName: p.lastName, street, postalCode: '12345', city: 'Musterstadt' }));
  const nameOf = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
  /** Die unterschriebene Rücksendung als Eingang am Mandat ablegen und das Mandat am Tag der Unterschrift aktiv setzen. */
  const sign = async (mandateId: string, reference: string, signedOn: string) => {
    const signed = unwrap(
      await receiveGeneratedUpload(on(signedOn), full, {
        bytes: textPdf(['SEPA-Lastschriftmandat', `Mandatsreferenz ${reference}`, 'unterschrieben zurück']),
        typeKey: MANDATE_SIGNED_DOCUMENT_TYPE,
        subject: `SEPA-Lastschriftmandat ${reference}, unterschrieben`,
        documentDate: signedOn,
        links: [{ entityType: MANDATE_ENTITY, entityId: mandateId, role: 'about' }],
        recordNumber: reference,
      }),
    );
    unwrap(await activateMandate(on(signedOn), full, { mandateId, signedOn, signedDocumentId: signed.document.id }));
  };
  /** Mandat vorbereiten und das Formular ausstellen, am selben Tag. */
  const prepare = async (day: string, contactId: string, p: { firstName: string; lastName: string; iban: string }) => {
    const mandate = unwrap(await prepareMandate(on(day), full, { contactId, debtorName: nameOf(p), iban: p.iban }));
    unwrap(await mandateFormPdf(on(day), full, { mandateId: mandate.id }));
    return mandate;
  };

  // Monatlich mit Projekt per Lastschrift: Mandat und Ankündigung (Entwurf) entstehen mit der Zusage, unterschrieben im Januar.
  const monthlyDay = `${storyYear}-01-10`;
  const monthly = await person(monthlyDay, PAYERS.monthly, 'Lindenweg 3');
  const pledge = unwrap(
    await savePledge(on(monthlyDay), full, { contactId: monthly.id, amountCents: 1500, interval: 'monthly', firstDueOn: `${storyYear}-02-15`, paymentMethod: 'directDebit', iban: PAYERS.monthly.iban, debtorName: nameOf(PAYERS.monthly), projectId }),
  );
  unwrap(await mandateFormPdf(on(monthlyDay), full, { mandateId: pledge.pledge.mandate!.id }));
  await sign(pledge.pledge.mandate!.id, pledge.pledge.mandate!.reference, `${storyYear}-01-20`);

  // Plan L2: die Raten ab März angekündigt (am Tag der Unterschrift), dann zwei Einzüge — März mit Datei, April angelegt (nie eingereicht, heute verfallen — Plan N1, M41).
  const firstRate = `${storyYear}-03-15`;
  const plan = pledgeDueDates({ amountCents: 1500, interval: 'monthly', firstDueOn: `${storyYear}-02-15`, lastDueOn: null, endedOn: null, pausedFrom: null, pausedUntil: null }, firstRate, addCalendarMonths(firstRate, 11)).map((dueOn) => ({ dueOn, amountCents: 1500 }));
  unwrap(await issuePrenotification(on(`${storyYear}-01-20`), full, { mandateId: pledge.pledge.mandate!.id, plan }));

  // Plan L3: jährlich per Lastschrift, die erste Rate im März — Mandat unterschrieben, Rate angekündigt.
  const yearlyDebitDay = `${storyYear}-01-12`;
  const yearlyDebit = await person(yearlyDebitDay, PAYERS.yearlyDebit, 'Fliederweg 7');
  const yearlyDebitMandate = await prepare(yearlyDebitDay, yearlyDebit.id, PAYERS.yearlyDebit);
  await sign(yearlyDebitMandate.id, yearlyDebitMandate.reference, `${storyYear}-01-25`);
  unwrap(await savePledge(on(`${storyYear}-01-25`), full, { contactId: yearlyDebit.id, amountCents: 5000, interval: 'yearly', firstDueOn: firstRate, paymentMethod: 'directDebit', mandateId: yearlyDebitMandate.id }));
  unwrap(await issuePrenotification(on(`${storyYear}-01-25`), full, { mandateId: yearlyDebitMandate.id, plan: [{ dueOn: firstRate, amountCents: 5000 }] }));

  for (const [month, withFile] of [['03', true], ['04', false]] as const) {
    let collectionDate = `${storyYear}-${month}-15`;
    while (!isTargetBusinessDay(collectionDate)) collectionDate = addCalendarDays(collectionDate, 1);
    // Eine Woche vorher angelegt: im Fenster der Bank (zwei Bankarbeitstage bis 14 Tage).
    const createdOn = addCalendarDays(collectionDate, -7);
    const day = on(createdOn);
    const run = unwrap(await createDirectDebitRun(day, full, { collectionDate }));
    if (!withFile) continue;
    unwrap(await buildDirectDebitFile(day, full, { runId: run.id }));
    const submitted = unwrap(await markDirectDebitRunSubmitted(day, full, { runId: run.id, submittedOn: createdOn }));
    await seedRunCreditAndReturns(deps, full, on, submitted);
  }

  // Jährlich per Dauerauftrag, ruht ab dem Sommer des Stichjahrs bis über das Ende der Geschichte hinaus (31.08. des
  // Folgejahrs): Endete die Pause am 31.12., wäre die Zusage ab Januar wieder aktiv und in der Liste nicht mehr gedämpft.
  const yearlyDay = `${previousYear}-10-15`;
  const yearly = await person(yearlyDay, PAYERS.yearly, 'Ahornallee 12');
  const yearlyPledge = unwrap(await savePledge(on(yearlyDay), full, { contactId: yearly.id, amountCents: 12000, interval: 'yearly', firstDueOn: `${previousYear}-11-01`, paymentMethod: 'standingOrder' }));
  unwrap(await pausePledge(on(`${storyYear}-05-20`), full, { pledgeId: yearlyPledge.pledge.id, from: `${storyYear}-06-01`, until: `${storyYear + 1}-${SEED_STORY_LAST_DAY}` }));

  // Vorbereitet, das Formular ist unterwegs.
  const pendingDay = `${storyYear}-08-20`;
  const pending = await person(pendingDay, PAYERS.pending, 'Birkenstraße 5');
  await prepare(pendingDay, pending.id, PAYERS.pending);

  // Beendet: vom Zahler widerrufen, Ende Juli. Ein beendetes Mandat hält seinen Kontakt 14 Monate (`MANDATE_KEEP_MONTHS`)
  // — bis über das Ende der Geschichte hinaus; zum 30.04. beendet, wäre Karl Frühauf ab Juli des Folgejahrs löschfällig.
  const endedDay = `${previousYear}-03-01`;
  const ended = await person(endedDay, PAYERS.ended, 'Eichenring 8');
  const endedMandate = await prepare(endedDay, ended.id, PAYERS.ended);
  await sign(endedMandate.id, endedMandate.reference, `${previousYear}-03-10`);
  unwrap(await endMandate(on(`${storyYear}-07-31`), full, { mandateId: endedMandate.id, endedOn: `${storyYear}-07-31`, reason: 'debtor' }));

  // Aktiv mit neuer IBAN: der nächste Einzug trägt den Änderungshinweis.
  const amendedDay = `${previousYear}-08-20`;
  const amended = await person(amendedDay, PAYERS.amended, 'Kastanienplatz 1');
  const amendedMandate = await prepare(amendedDay, amended.id, PAYERS.amended);
  await sign(amendedMandate.id, amendedMandate.reference, `${previousYear}-09-01`);
  unwrap(await amendMandate(on(`${storyYear}-07-15`), full, { mandateId: amendedMandate.id, iban: PAYERS.amended.newIban, validFrom: `${storyYear}-08-01` }));

  // Plan N1 E1: Eine Ankündigung deckt nur den Tag, den sie nennt. Damit ein heute angelegter Einzug etwas einzieht
  // (E2E „Neuer Einzug bis zur Einreichung“), ist die jüngste Rate der Monatszusage für den spätesten Bankarbeitstag
  // bis heute + 9 angekündigt — den Tag, der heute schon im Einreichfenster der Bank liegt. Bewusst relativ zu heute,
  // drei Wochen vorher ausgestellt.
  let upcoming = addCalendarDays(todayIn(deps), 9);
  while (!isTargetBusinessDay(upcoming)) upcoming = addCalendarDays(upcoming, -1);
  unwrap(await issuePrenotification(on(addCalendarDays(upcoming, -21)), full, { mandateId: pledge.pledge.mandate!.id, plan: [{ dueOn: upcoming, amountCents: 1500 }] }));
}

/**
 * Plan L3: Gutschrift und Rückgaben eines eingereichten Einzugs. Ein Auszug des Einzugskontos bringt die
 * Sammelgutschrift (ohne Einzelzeilen) am Fälligkeitstag und sechs Tage später beide Posten zurück — die Rate mit
 * `MD06` (Widerspruch), die andere mit `AM04` (Deckung fehlt) samt Rückgabeentgelt. Gutschrift und `MD06` über die Vorschläge
 * der Arbeitsliste festgeschrieben, die `MD06` bleibt „Rückgabe zu klären“; die `AM04` wartet ungebucht in der
 * Arbeitsliste mit ihrem Vorschlag (Plan U2 Task 5).
 */
async function seedRunCreditAndReturns(deps: Deps, ctx: CallContext, on: (day: string) => Deps, run: DirectDebitRunView): Promise<void> {
  const account = sepaAccountInternal(deps);
  if (!account?.iban || run.items.length < 2) return;
  const [first, second] = run.items as [DirectDebitRunView['items'][number], DirectDebitRunView['items'][number]];
  const backOn = addCalendarDays(run.collectionDate, 6);
  const year = run.collectionDate.slice(0, 4);
  const reference = (n: number) => `LS-${year}-${run.collectionDate.slice(5, 7)}-${n}`;
  const openingCents = accountBalancesAt(deps.db, addCalendarDays(run.collectionDate, -1)).find((a) => a.accountId === account.id)?.balanceCents ?? 0;
  const fee = 300;
  unwrap(
    await importStatement(on(backOn), ctx, {
      accountId: account.id,
      fileName: `lastschrift-${run.collectionDate}.xml`,
      bytes: buildCamt053Bytes({
        iban: account.iban,
        from: run.collectionDate,
        to: backOn,
        openingCents,
        lines: [
          { bookingDate: run.collectionDate, amountCents: run.sumCents, purpose: 'SEPA-Sammel-Gutschrift', bankReference: reference(1) },
          { bookingDate: backOn, amountCents: -first.amountCents, counterpartyName: first.debtorName, purpose: 'Ruecklastschrift', bankReference: reference(2), endToEndId: first.endToEndId, returnCode: 'MD06' },
          { bookingDate: backOn, amountCents: -(second.amountCents + fee), counterpartyName: second.debtorName, purpose: 'Ruecklastschrift', bankReference: reference(3), endToEndId: second.endToEndId, returnCode: 'AM04' },
        ],
      }),
    }),
  );
  // Die Gutschrift und die `MD06` gebucht; die `AM04` mit Entgelt bleibt in der Arbeitsliste mit ihrem Vorschlag (Plan U2 Task 5).
  for (const n of [1, 2]) {
    const raw = deps.db.select().from(financeRawTransactions).where(and(eq(financeRawTransactions.accountId, account.id), eq(financeRawTransactions.bankReference, reference(n)))).get()!;
    const at = on(raw.bookingDate);
    const suggestion = unwrap(await suggestForTransaction(at, ctx, { rawTransactionId: raw.id }));
    const draft = suggestion.draft!;
    const entry = unwrap(await bookFromTransaction(at, ctx, { rawTransactionId: raw.id, text: draft.text, allocationLines: draft.allocationLines, settlements: draft.moneyLines[0]!.settlements, reviewed: false }));
    unwrap(await finalizeEntry(at, ctx, { id: entry.id }));
  }
}
