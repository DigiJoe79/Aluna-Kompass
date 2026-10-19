import { newId, readSetting, SEED_STORY_LAST_DAY, seedClockAt, seedMoment, seedStoryYear, todayIn, unwrap, type CallContext, type Deps } from '@kompass/core';
import { contacts, createContact, setContactChannels } from '@kompass/module-contacts';
import { documentSnippets } from '@kompass/module-dms';
import { bookEntry, categoryIdByKeyInternal, financeAccounts, financeFiscalYears } from '@kompass/module-finance';
import { and, eq, lte, gte } from 'drizzle-orm';
import { continueDunningRun, startDunningRun } from './dunning';
import { setFeeAgreement } from './fee-agreement';
import { issueMemberLetterInternal } from './letters/issue';
import { markRunPostDispatched, moveRunLetters, runDispatchState } from './run-dispatch';
import type { DunningLevel } from './settings';
import { continueFeeRun, startFeeRun } from './fee-run';
import { saveFeeSchedule } from './fee-schedule';
import { deferCharge, waiveCharge } from './fees';
import { admitMember, endMembership, recordApplication, recordResignation, rejectApplication } from './memberships';
import { memberDunningNotices, memberFeeCharges, memberFeeRuns, memberFeeSchedules, memberMemberships, memberTypes, type FeeChargeRow } from './schema';

/** Anschrift erfunden: Briefe brauchen Anschrift oder E-Mail (Plan M4). */
type Address = { street: string; postalCode: string; city: string };
type Person = ({ kind: 'person'; firstName: string; lastName: string } | { kind: 'organization'; name: string }) & Partial<Address>;
const at = (street: string): Address => ({ street, postalCode: '12345', city: 'Beispielstadt' });

interface ExampleMembership {
  contact: Person;
  type: 'regular' | 'supporting' | 'honorary';
  /** Antrag, Aufnahme (ohne Antrag: Gründungsmitglied), Ablehnung, Austritt, Ende — relativ zum Stichjahr `y`. */
  /** Eine E-Mail-Adresse: Briefe an sie stehen im Versand der Läufe in der Mail-Gruppe (Plan U4 Task 2). */
  email?: string;
  appliedOn?: string;
  admittedOn?: string;
  joinedOn?: string;
  rejectedOn?: string;
  resignNoticeOn?: string;
  end?: { endsOn: string; reason: 'death' | 'exclusion' | 'struckOff' | 'other' };
}

/**
 * Beispiel-Mitgliedschaften — frei erfunden, das Repo ist öffentlich. Alle Tage im Stichjahr `y` und seinem Vorjahr,
 * nie auf einer festen Jahreszahl (AGENTS.md: kalenderfest). Die Zustände (Spec § 11): aktiv ordentlich (3, einer
 * davon Gründungsmitglied ohne Antrag), Fördermitglied Person (2) und Organisation (1), Ehrenmitglied, offener
 * Antrag, abgelehnt, Austritt zum 31.12. des Stichjahres, im Januar des Stichjahres durch Tod beendet (der Beitrag
 * erlassen). Die Aufbewahrung endet erst mit dem Folgejahr des Endes: Im Vorjahr beendet, wäre Ida ab dem 1. Januar
 * löschfällig geworden — der Seed zeigte im Frühjahr mehr als im Herbst.
 */
function examples(y: number): ExampleMembership[] {
  const p = y - 1;
  return [
    { contact: { kind: 'person', firstName: 'Tilda', lastName: 'Wegener', ...at('Lindenweg 4') }, email: 'tilda.wegener@example.org', type: 'regular', admittedOn: `${p}-01-15`, joinedOn: `${p}-01-01` },
    { contact: { kind: 'person', firstName: 'Jonas', lastName: 'Kranich', ...at('Am Mühlbach 12') }, type: 'regular', appliedOn: `${p}-02-10`, admittedOn: `${p}-03-01` },
    { contact: { kind: 'person', firstName: 'Paula', lastName: 'Brenner', ...at('Gartenstraße 7') }, type: 'regular', appliedOn: `${y}-02-01`, admittedOn: `${y}-02-15` },
    { contact: { kind: 'person', firstName: 'Ole', lastName: 'Lindholm', ...at('Kiefernring 3') }, type: 'supporting', appliedOn: `${p}-05-20`, admittedOn: `${p}-06-01` },
    { contact: { kind: 'person', firstName: 'Greta', lastName: 'Falkner', ...at('Hafenweg 21') }, type: 'supporting', appliedOn: `${y}-03-18`, admittedOn: `${y}-04-01` },
    { contact: { kind: 'organization', name: 'Bäckerei Morgenrot GmbH', ...at('Marktplatz 1') }, type: 'supporting', appliedOn: `${p}-08-25`, admittedOn: `${p}-09-01` },
    { contact: { kind: 'person', firstName: 'Henrike', lastName: 'Sommerfeld', ...at('Birkenallee 9') }, type: 'honorary', admittedOn: `${p}-01-15`, joinedOn: `${p}-01-01` },
    { contact: { kind: 'person', firstName: 'Emil', lastName: 'Rautenberg', ...at('Schlehenpfad 2') }, type: 'regular', appliedOn: `${y}-08-20` },
    { contact: { kind: 'person', firstName: 'Nora', lastName: 'Quandt', ...at('Wiesengrund 15') }, type: 'regular', appliedOn: `${y}-05-02`, rejectedOn: `${y}-05-20` },
    { contact: { kind: 'person', firstName: 'Karl', lastName: 'Ehrlinger', ...at('Talstraße 30') }, type: 'regular', appliedOn: `${p}-01-20`, admittedOn: `${p}-02-01`, resignNoticeOn: `${y}-08-15` },
    { contact: { kind: 'person', firstName: 'Ida', lastName: 'Wolkenstein', ...at('Ulmenweg 6') }, type: 'regular', admittedOn: `${p}-01-15`, joinedOn: `${p}-01-01`, end: { endsOn: `${y}-01-09`, reason: 'death' } },
  ];
}

/** Legt die Beispiel-Mitgliedschaften über die Dienste an, sofern noch keine existieren. */
export async function seedMembers(deps: Deps, ctx: CallContext): Promise<void> {
  await seedMemberships(deps, ctx);
  await seedFees(deps, ctx);
  await seedDunning(deps, ctx);
}

/**
 * Mahnungen (Plan M4): ein Mahnlauf zum Ende der Geschichte des Stichjahres, heute als per Post versandt vermerkt (Erinnerungen), dazu für das erste
 * gemahnte Mitglied eine Mahnung der zweiten Stufe ohne Versand. Die Mahnung entsteht außer der Reihe über denselben
 * Briefweg wie im Lauf: Ein zweiter Lauf wäre erst 28 Tage nach dem Versand reif, und Briefe entstehen heute — der Seed
 * schreibt nichts in die Zukunft. Aufnahmebestätigungen und Beitragsmitteilungen entstehen schon mit Aufnahme und
 * Beitragslauf.
 */
async function seedDunning(deps: Deps, ctx: CallContext): Promise<void> {
  if (deps.db.select({ id: memberDunningNotices.id }).from(memberDunningNotices).get()) return;
  if (!deps.db.select({ id: memberFeeRuns.id }).from(memberFeeRuns).get()) return;
  const today = todayIn(deps);
  // Stichtag: der letzte Geschichtstag des Stichjahres — so mahnt der Seed an jedem Kalendertag dieselben Mitglieder.
  const asOf = `${seedStoryYear(today)}-${SEED_STORY_LAST_DAY}`;
  const run = await startDunningRun(deps, ctx, { asOf });
  if (!run.ok) return;
  for (let view = run.value; view.status === 'running'; ) {
    const next = await continueDunningRun(deps, ctx, { runId: run.value.id, max: 50 });
    if (!next.ok) return;
    view = next.value;
  }
  await markRunPostDispatched(deps, ctx, { runRef: `membersDunningRun:${run.value.id}`, sentAt: today });
  const first = deps.db.select().from(memberDunningNotices).where(eq(memberDunningNotices.runId, run.value.id)).get();
  const level = readSetting<DunningLevel[]>(deps, 'members.dunningLevels')[1];
  if (!first || !level) return;
  const snippet = level.snippetId ? deps.db.select().from(documentSnippets).where(eq(documentSnippets.id, level.snippetId)).get() : undefined;
  await issueMemberLetterInternal(
    deps,
    ctx,
    { kind: 'reminder', membershipId: first.membershipId, data: { levelName: level.name[deps.locales()[0]!] ?? level.key, levelText: snippet?.body ?? null, chargeIds: first.chargeIds, returnedOn: null } },
    { afterIssue: (tx, doc) => tx.insert(memberDunningNotices).values({ id: newId(), membershipId: first.membershipId, levelKey: level.key, documentId: doc.id, chargeIds: first.chargeIds, runId: null, issuedOn: asOf }).run() },
  );
}

async function seedMemberships(deps: Deps, ctx: CallContext): Promise<void> {
  if (deps.db.select({ id: memberMemberships.id }).from(memberMemberships).get()) return;
  const typeId = (key: string) => deps.db.select({ id: memberTypes.id }).from(memberTypes).where(eq(memberTypes.key, key)).get()?.id;
  if (!typeId('regular') || !typeId('supporting') || !typeId('honorary')) return; // Grundausstattung umbenannt oder gelöscht
  const y = seedStoryYear(todayIn(deps));
  for (const m of examples(y)) {
    const contactId = unwrap(await createContact(deps, ctx, m.contact)).id;
    if (m.email) unwrap(await setContactChannels(deps, ctx, { id: contactId, channels: [{ kind: 'email', value: m.email, isPrimary: true }] }));
    const type = typeId(m.type)!;
    let membershipId: string;
    if (m.appliedOn) {
      membershipId = unwrap(await recordApplication(deps, ctx, { contactId, typeId: type, appliedOn: m.appliedOn })).id;
      if (m.rejectedOn) unwrap(await rejectApplication(deps, ctx, { membershipId, rejectedOn: m.rejectedOn }));
      if (m.admittedOn) unwrap(await admitMember(deps, ctx, { membershipId, admittedOn: m.admittedOn, ...(m.joinedOn ? { joinedOn: m.joinedOn } : {}) }));
    } else {
      membershipId = unwrap(await admitMember(deps, ctx, { contactId, typeId: type, admittedOn: m.admittedOn!, joinedOn: m.joinedOn ?? m.admittedOn!, appliedOn: null })).id;
    }
    // Austritt mit der Vorgabe-Frist (drei Monate zum Jahresende): eine Kündigung im August endet am 31.12. des Stichjahres.
    if (m.resignNoticeOn) unwrap(await recordResignation(deps, ctx, { membershipId, noticeOn: m.resignNoticeOn, endsOn: `${y}-12-31` }));
    if (m.end) unwrap(await endMembership(deps, ctx, { membershipId, endsOn: m.end.endsOn, reason: m.end.reason }));
  }
}

/** Die Mitgliedschaft eines Beispiel-Kontakts (Nachname bzw. Name der Organisation). */
function membershipOf(deps: Deps, name: string) {
  const contact = deps.db.select().from(contacts).all().find((c) => c.lastName === name || c.name === name);
  return contact ? deps.db.select().from(memberMemberships).where(eq(memberMemberships.contactId, contact.id)).get() : undefined;
}

/**
 * Beiträge (Plan M3, Spec § 11): eine Beitragsordnung mit zwei Ständen (Vorjahr, Stichjahr), eine Vereinbarung über dem
 * Mindestbetrag, eine ermäßigte, eine Organisation mit jährlicher Zahlung; der Beitragslauf des Stichjahres; Zahlungen
 * über festgeschriebene Buchungen der Finanzen (bezahlt, teilweise), ein gestundeter, ein erlassener Beitrag, der Rest
 * überfällig. Beträge frei erfunden — nicht die eines echten Vereins. Zahlungen nur, wenn der Finanz-Seed das
 * Geschäftsjahr und das Hauptkonto angelegt hat.
 */
async function seedFees(deps: Deps, ctx: CallContext): Promise<void> {
  if (deps.db.select({ id: memberFeeSchedules.id }).from(memberFeeSchedules).get()) return;
  const typeId = (key: string) => deps.db.select({ id: memberTypes.id }).from(memberTypes).where(eq(memberTypes.key, key)).get()?.id;
  const regular = typeId('regular');
  const supporting = typeId('supporting');
  if (!regular || !supporting || !categoryIdByKeyInternal(deps.db, 'membership-fees')) return;
  const y = seedStoryYear(todayIn(deps));
  const p = y - 1;

  unwrap(await saveFeeSchedule(deps, ctx, { validFrom: `${p}-01-01`, note: 'Erste Beitragsordnung', rules: [
    { typeId: regular, amountCents: 3000, interval: 'yearly', minimum: false, allowedIntervals: ['yearly'] },
    { typeId: supporting, amountCents: 500, interval: 'monthly', minimum: true, allowedIntervals: ['monthly', 'yearly'] },
  ] }));
  unwrap(await saveFeeSchedule(deps, ctx, { validFrom: `${y}-01-01`, resolvedOn: `${p}-11-20`, note: 'Beschluss der Mitgliederversammlung', rules: [
    { typeId: regular, amountCents: 3600, interval: 'yearly', minimum: false, allowedIntervals: ['yearly', 'halfYearly'] },
    { typeId: supporting, amountCents: 500, interval: 'monthly', minimum: true, allowedIntervals: ['monthly', 'yearly'] },
  ] }));

  // Plan L1: zwei Mitglieder zahlen per Lastschrift — das Mandat entsteht aus IBAN und Kontoinhaber (vorbereitet).
  // Erfundene IBANs mit der Bankleitzahl 99999999 und gültiger Prüfziffer.
  const agreements: [string, Record<string, unknown>][] = [
    ['Lindholm', { amountCents: 1500, interval: 'monthly', reduction: 'none', paymentMethod: 'directDebit', iban: 'DE13999999990000300007', debtorName: 'Ole Lindholm' }], // über dem Mindestbetrag
    ['Bäckerei Morgenrot GmbH', { amountCents: 12000, interval: 'yearly', reduction: 'none' }],
    ['Kranich', { amountCents: 1200, reduction: 'reduced' }], // Härtefall, ohne Grund im Datensatz
    ['Wegener', { reduction: 'none', paymentMethod: 'directDebit', iban: 'DE83999999990000300008', debtorName: 'Tilda Wegener' }],
  ];
  for (const [name, values] of agreements) {
    const m = membershipOf(deps, name);
    if (m) unwrap(await setFeeAgreement(deps, ctx, { membershipId: m.id, validFrom: `${y}-01-01`, paymentMethod: 'transfer', ...values }));
  }

  // Der Beitragslauf des Stichjahres läuft wie im Verein im Dezember davor: Die Posten tragen diesen Anlagetag, und der
  // Mahnlauf zählt ab der Fälligkeit — heute angelegt, wären alle Beiträge nachträglich erfasst und noch nicht reif.
  const runDeps = seedClockAt(deps, seedMoment(deps, `${p}-12-01`));
  const run = unwrap(await startFeeRun(runDeps, ctx, { year: y }));
  for (let view = run; view.status === 'running'; ) view = unwrap(await continueFeeRun(runDeps, ctx, { runId: run.id, max: 50 }));
  // Plan U4 Task 2: Eine Beitragsmitteilung, die per E-Mail ginge, liegt von Hand in der Post-Gruppe („von Hand
  // verschoben“). Ohne Mailversand gibt es keine Mail-Gruppe — dann bleibt es dabei.
  const runRef = `membersFeeRun:${run.id}`;
  const dispatch = await runDispatchState(deps, ctx, { runRef });
  const toPost = dispatch.ok ? dispatch.value.mail.find((m) => m.state === 'notQueued' && m.sentAt === null) : undefined;
  if (toPost) unwrap(await moveRunLetters(deps, ctx, { runRef, documentIds: [toPost.documentId], to: 'post' }));

  const charge = (name: string, periodStart: string): FeeChargeRow | undefined => {
    const m = membershipOf(deps, name);
    return m ? deps.db.select().from(memberFeeCharges).where(and(eq(memberFeeCharges.membershipId, m.id), eq(memberFeeCharges.periodStart, periodStart), eq(memberFeeCharges.state, 'created'))).get() : undefined;
  };

  // Gestundet über das Ende der Geschichte hinaus (bis zum 31.08. des Folgejahres): bis zum 30.11. gestundet, wäre
  // Jonas ab Dezember überfällig und trüge in der Liste eine Marke — an jedem Tag, an dem das Stichjahr gilt, ist er es nicht.
  const jonas = charge('Kranich', `${y}-01-01`);
  if (jonas) unwrap(await deferCharge(deps, ctx, { chargeId: jonas.id, dueOn: `${y + 1}-${SEED_STORY_LAST_DAY}` }));
  const greta = charge('Falkner', `${y}-04-01`);
  if (greta) unwrap(await waiveCharge(deps, ctx, { chargeId: greta.id }));
  // Ida starb im Januar; der Beitrag ihres letzten Jahres ist erlassen.
  const ida = charge('Wolkenstein', `${y}-01-01`);
  if (ida) unwrap(await waiveCharge(deps, ctx, { chargeId: ida.id }));

  // Zahlungen über das Hauptkonto im Stichjahr (bis Ende August liegt die Geschichte in der Vergangenheit).
  const bank = deps.db.select().from(financeAccounts).where(eq(financeAccounts.isMain, true)).get();
  const hasYear = deps.db.select({ id: financeFiscalYears.id }).from(financeFiscalYears).where(and(lte(financeFiscalYears.startsOn, `${y}-01-01`), gte(financeFiscalYears.endsOn, `${y}-12-31`))).get();
  if (!bank || !hasYear) return;
  const categoryId = categoryIdByKeyInternal(deps.db, 'membership-fees')!;
  const pay = async (entryDate: string, parts: { charge: FeeChargeRow | undefined; amountCents?: number }[]) => {
    const settlements = parts.flatMap((part) => (part.charge?.openItemId ? [{ openItemId: part.charge.openItemId, amountCents: part.amountCents ?? part.charge.amountCents }] : []));
    if (settlements.length === 0) return;
    const amountCents = settlements.reduce((sum, x) => sum + x.amountCents, 0);
    unwrap(await bookEntry(deps, ctx, { entryDate, text: 'Mitgliedsbeitrag', moneyLines: [{ accountId: bank.id, amountCents, settlements }], allocationLines: [{ categoryId, amountCents }] }));
  };
  await pay(`${y}-01-20`, [{ charge: charge('Wegener', `${y}-01-01`) }]);
  await pay(`${y}-02-10`, [{ charge: charge('Bäckerei Morgenrot GmbH', `${y}-01-01`) }]);
  await pay(`${y}-03-02`, [{ charge: charge('Brenner', `${y}-01-01`) }]);
  await pay(`${y}-02-05`, [{ charge: charge('Ehrlinger', `${y}-01-01`), amountCents: 1800 }]); // teilweise
  await pay(`${y}-06-30`, ['01', '02', '03', '04', '05', '06'].map((month) => ({ charge: charge('Lindholm', `${y}-${month}-01`) })));
}
