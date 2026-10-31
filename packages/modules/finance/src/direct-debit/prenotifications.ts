import { forbidden, hasPermission, isoDayIn, isoNow, newId, notFound, ok, readSetting, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts } from '@kompass/module-contacts';
import { createDraft, documents, fileDocument, linkDocumentInternal } from '@kompass/module-dms';
import { and, eq, lte, ne } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { maskIban } from '../format/iban';
import { financeSepaPrenotifications, type PrenotificationPlanEntry } from '../schema';
import { addBusinessDays, addCalendarDays, isTargetBusinessDay } from './business-days';
import { creditorNameInternal } from './forms';
import { DIRECT_DEBIT_PERMISSION, MANDATE_ENTITY, mandateRowInternal, mandateState } from './mandates';
import { greetingFor, PRENOTIFICATION_DOCUMENT_TYPE, prenotificationPlanBody, prenotificationSubject } from './templates/prenotification';

const day = z.iso.date();
export const prenotificationPlanSchema = z
  // R11: der Verwendungszweck je Einzug (etwa „Beitrag 2027 Mitglied 0002“), damit der Zahler die Belastungen zuordnen kann.
  .array(z.object({ dueOn: day, amountCents: z.number().int().positive().max(100_000_000), remittance: z.string().trim().min(1).max(140).optional() }))
  .min(1)
  .max(60);
export const prenotificationIssueSchema = z.object({ mandateId: z.string().min(1), plan: prenotificationPlanSchema });

/** Der Tag, an dem die Bank einen für `day` angekündigten Einzug bucht: der Tag selbst oder der nächste Bankarbeitstag. */
export function bankDayOnOrAfter(day: string): string {
  return isTargetBusinessDay(day) ? day : addBusinessDays(day, 1);
}

/**
 * Deckt eine Ankündigung den Einzug (Spec § 7.5, Entscheidung E1 im Plan N1)? Eine Ankündigung nennt je Einzug Betrag
 * und Tag der Belastung. Sie deckt einen Einzug zum Fälligkeitstag `collectionDate`, wenn ihr Brief festgeschrieben und
 * nicht storniert ist, er spätestens `days` Tage vor diesem Tag ausgestellt wurde und ihr Plan einen Tag A mit diesem
 * Betrag nennt, für den A ≤ Einzugstag ≤ nächster Bankarbeitstag ab A gilt. Ein Einzug Wochen nach dem angekündigten
 * Tag ist also nicht gedeckt — er braucht eine neue Ankündigung (M6). Ausgestellt ist der Brief am späteren von
 * Dokumentdatum und Tag des Festschreibens (`filedAt` der Akte, als Vereinstag) — ein alter Entwurf, spät
 * festgeschrieben, erfüllt so keine Frist, die er nicht erfüllt hat. Berechnet, nie gespeichert. Ein Entwurf deckt
 * nichts, ein gelöschter Entwurf ebenso nicht (die Zeile findet ihr Dokument nicht mehr).
 */
export function prenotificationCovers(deps: Pick<Deps, 'db' | 'registry'>, mandateId: string, amountCents: number, collectionDate: string, days: number): boolean {
  return coveringEntriesInternal(deps, mandateId, collectionDate, days).some((e) => e.amountCents === amountCents);
}

/**
 * Die einzelnen angekündigten Einzüge (Planzeilen) aller Ankündigungen des Mandats, die einen Einzug zum Tag decken
 * (Regel bei `prenotificationCovers`). Je Zeile ein Eintrag: Eine Zeile deckt einen Posten, nicht zwei mit gleichem
 * Betrag — die Vorschau des Einzugs verbraucht sie (E1 b).
 */
export function coveringEntriesInternal(deps: Pick<Deps, 'db' | 'registry'>, mandateId: string, collectionDate: string, days: number): { amountCents: number }[] {
  const latestIssue = addCalendarDays(collectionDate, -days);
  const rows = deps.db
    .select({ plan: financeSepaPrenotifications.plan, documentDate: documents.documentDate, filedAt: documents.filedAt })
    .from(financeSepaPrenotifications)
    .innerJoin(documents, eq(documents.id, financeSepaPrenotifications.documentId))
    .where(and(eq(financeSepaPrenotifications.mandateId, mandateId), lte(documents.documentDate, latestIssue), eq(documents.phase, 'issued'), ne(documents.status, 'voided')))
    .all();
  return rows.flatMap((r) => {
    const filedOn = r.filedAt ? isoDayIn(deps, new Date(r.filedAt)) : r.documentDate;
    const issuedOn = filedOn > r.documentDate ? filedOn : r.documentDate;
    if (issuedOn > latestIssue) return [];
    return r.plan.filter((e) => e.dueOn <= collectionDate && collectionDate <= bankDayOnOrAfter(e.dueOn)).map((e) => ({ amountCents: e.amountCents }));
  });
}

/**
 * Eine Lastschriftankündigung ausstellen (`finance.directDebit`, Plan L2 Task 1): der Brief an den Zahler mit Tag und
 * Betrag je Einzug, über die Akte festgeschrieben (Entwurf, dann festschreiben — dafür braucht es `dms.create` und
 * `dms.file`), verknüpft mit Mandat und Kontakt; dazu die Zeile, die festhält, welche Einzüge er abdeckt. Protokoll:
 * Referenz und Zahl der Einzüge. Ein Tag am Wochenende oder Feiertag wird zum nächsten Bankarbeitstag, und der Brief
 * nennt diesen; ein Tag vor heute plus Frist der Vorabankündigung ist zu spät (`prenotificationTooLate`, E1). Gibt es
 * zum Mandat schon eine festgeschriebene, nicht stornierte Ankündigung mit genau diesem Plan, kommt sie zurück (App-B1) —
 * außer die IBAN hat sich seit ihr geändert: Der Brief nennt das Konto, also braucht es dann einen neuen.
 */
export async function issuePrenotification(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string; documentId: string; number: string }>> {
  const denied = requirePermission(ctx, DIRECT_DEBIT_PERMISSION);
  if (denied) return denied;
  for (const permission of ['dms.create', 'dms.file']) if (!hasPermission(ctx, permission)) return forbidden(permission);
  const parsed = validate(deps, prenotificationIssueSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const mandate = mandateRowInternal(deps.db, v.mandateId);
  if (!mandate) return notFound('financeMandate', v.mandateId);
  const today = todayIn(deps);
  const earliest = bankDayOnOrAfter(addCalendarDays(today, readSetting<number>(deps, 'finance.sepa.preNotificationDays')));
  const plan: PrenotificationPlanEntry[] = v.plan.map((e) => ({ dueOn: bankDayOnOrAfter(e.dueOn), amountCents: e.amountCents, ...(e.remittance ? { remittance: e.remittance } : {}) })).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const tooLate = v.plan.find((e) => bankDayOnOrAfter(e.dueOn) < earliest);
  if (tooLate) return financeConflict('prenotificationTooLate', { date: tooLate.dueOn, earliest });
  const state = mandateState(mandate, today);
  if (state === 'ended') return financeConflict('mandateEnded', { reference: mandate.reference, date: mandate.endedOn! });
  if (state === 'expired') return financeConflict('mandateNotUsable', { reference: mandate.reference });
  const creditorId = readSetting<string | null>(deps, 'finance.sepa.creditorId');
  if (!creditorId) return financeConflict('sepaCreditorIdMissing');
  // App-B1: Ein zweiter Klick mit demselben Plan bekommt den schon ausgestellten Brief, kein zweites Dokument mit Nummer.
  const same = issuedSamePlanInternal(deps.db, mandate, plan);
  if (same) return ok(same);
  const contact = deps.db.select().from(contacts).where(eq(contacts.id, mandate.contactId)).get();
  const body = prenotificationPlanBody({ greeting: contact ? greetingFor(contact) : 'Guten Tag,', creditorName: creditorNameInternal(deps), plan, iban: mandate.iban, reference: mandate.reference, creditorId });
  const draft = await createDraft(deps, ctx, { typeKey: PRENOTIFICATION_DOCUMENT_TYPE, subject: prenotificationSubject(mandate.reference), body, links: [{ entityType: 'contact', entityId: mandate.contactId, role: 'recipient' }] });
  if (!draft.ok) return draft;
  deps.db.transaction((tx: DbOrTx) => linkDocumentInternal(tx, deps, { documentId: draft.value.id, entityType: MANDATE_ENTITY, entityId: mandate.id }));
  const filed = await fileDocument(deps, ctx, { id: draft.value.id });
  if (!filed.ok) return filed;
  const id = deps.db.transaction((tx: DbOrTx) => {
    const rowId = recordPrenotificationInternal(tx, deps, ctx, { mandateId: mandate.id, documentId: filed.value.id, plan });
    financeAudit(tx, deps, ctx, { action: 'finance.prenotification.issue', entity: 'financePrenotification', id: rowId, after: { mandateId: mandate.id, documentId: filed.value.id, count: plan.length }, params: { reference: mandate.reference, count: plan.length } });
    return rowId;
  });
  return ok({ id, documentId: filed.value.id, number: filed.value.number ?? '' });
}

const planKey = (plan: readonly PrenotificationPlanEntry[]) => JSON.stringify(plan.map((e) => [e.dueOn, e.amountCents, e.remittance ?? null]));

/** Nennt der festgeschriebene Brief dieses Konto? Ein Brief ohne lesbaren Text gilt als veraltet: Lieber ein Brief mehr als einer mit dem alten Konto. */
function namesIban(inputSnapshot: string | null, iban: string): boolean {
  const body = inputSnapshot ? (JSON.parse(inputSnapshot) as { input?: { body?: string } }).input?.body : undefined;
  return body?.includes(maskIban(iban)) ?? false;
}

/**
 * Die festgeschriebene, nicht stornierte Ankündigung zum Mandat mit genau diesem Plan (Tage, Beträge, Zwecke), die noch
 * die geltende IBAN nennt, sonst `null`. Gelesen wird der Brief selbst: Eine Korrektur vor der Unterschrift schreibt
 * keine Zeile in `financeSepaMandateChanges`.
 */
function issuedSamePlanInternal(db: DbOrTx, mandate: { id: string; iban: string }, plan: readonly PrenotificationPlanEntry[]): { id: string; documentId: string; number: string } | null {
  const key = planKey(plan);
  const row = db
    .select({ id: financeSepaPrenotifications.id, documentId: financeSepaPrenotifications.documentId, plan: financeSepaPrenotifications.plan, number: documents.number, inputSnapshot: documents.inputSnapshot })
    .from(financeSepaPrenotifications)
    .innerJoin(documents, eq(documents.id, financeSepaPrenotifications.documentId))
    .where(and(eq(financeSepaPrenotifications.mandateId, mandate.id), eq(documents.phase, 'issued'), ne(documents.status, 'voided')))
    .all()
    .find((r) => planKey(r.plan) === key && namesIban(r.inputSnapshot, mandate.iban));
  return row ? { id: row.id, documentId: row.documentId, number: row.number ?? '' } : null;
}

/**
 * Hält fest, welche Einzüge ein Brief der Akte ankündigt — auch zu einem Entwurf (`savePledge`), der erst mit dem
 * Festschreiben deckt. In der Transaktion des Aufrufers; das Protokoll schreibt der Aufrufer (der Entwurf steht in
 * dem der Akte, die Zusage in ihrem eigenen).
 */
export function recordPrenotificationInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, input: { mandateId: string; documentId: string; plan: PrenotificationPlanEntry[] }): string {
  const id = newId();
  tx.insert(financeSepaPrenotifications).values({ id, mandateId: input.mandateId, documentId: input.documentId, plan: input.plan, createdByUserId: ctx.userId ?? 'system', createdAt: isoNow(deps.clock) }).run();
  return id;
}
