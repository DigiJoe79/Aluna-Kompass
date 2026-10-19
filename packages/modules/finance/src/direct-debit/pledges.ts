import { forbidden, hasPermission, isoNow, newId, notFound, ok, readSetting, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { canReadDocumentType, createDraft, linkDocumentInternal } from '@kompass/module-dms';
import { projects } from '@kompass/module-projects';
import { asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { PLEDGE_INTERVALS, PLEDGE_PAYMENT_METHODS, financePledgeRateMarks, financePledges, financePurposes, type FinancePledgeRow, type FinanceSepaMandateRow } from '../schema';
import { addCalendarDays, addCalendarMonths } from './business-days';
import { recordPrenotificationInternal } from './prenotifications';
import { creditorNameInternal } from './forms';
import { DIRECT_DEBIT_PERMISSION, MANDATE_ENTITY, debtorNameField, mandateIbanField, mandateRowInternal, mandateState, prepareMandateInternal, type MandateState } from './mandates';
import { pledgeDueDates, pledgePausedOn, pledgeRates, type PledgeRate } from './rates';
import { pledgeBookedLinesInternal } from './booking';
import { expiredRunIdsInternal, openRunItemsInternal, pledgeRateRunsInternal, pledgeRunSourcesInternal } from './run-items';
import { MISSED_RATE_DAYS } from './runs';
import { greetingFor, PRENOTIFICATION_DOCUMENT_TYPE, prenotificationBody, prenotificationSubject } from './templates/prenotification';

export type PledgeState = 'active' | 'paused' | 'ended';
export const PLEDGE_STATES = ['active', 'paused', 'ended'] as const;

const id = z.string().min(1);
const day = z.iso.date();

/** Ohne Prüfung über Felder hinweg — so zeigt es das Werkzeug (N5); `pledgeSaveSchema` prüft im Dienst. */
export const pledgeSaveBaseSchema = z.object({
    id: id.optional(),
    contactId: id,
    amountCents: z.number().int().positive().max(100_000_000),
    interval: z.enum(PLEDGE_INTERVALS),
    firstDueOn: day,
    lastDueOn: day.nullable().optional(),
    paymentMethod: z.enum(PLEDGE_PAYMENT_METHODS),
    mandateId: id.nullable().optional(),
    /** Mit Kontoinhaber: Bei Lastschrift ohne Mandat entsteht eines (vorbereitet). */
    iban: mandateIbanField.optional(),
    debtorName: debtorNameField.optional(),
    purposeId: id.nullable().optional(),
    projectId: id.nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
});
export const pledgeSaveSchema = pledgeSaveBaseSchema.superRefine((v, c) => {
  if (v.lastDueOn && v.lastDueOn < v.firstDueOn) c.addIssue({ code: 'custom', path: ['lastDueOn'], message: 'beforeFirstDue' });
});
export const pledgePauseBaseSchema = z.object({ pledgeId: id, from: day, until: day });
export const pledgePauseSchema = pledgePauseBaseSchema.superRefine((v, c) => {
  if (v.until < v.from) c.addIssue({ code: 'custom', path: ['until'], message: 'untilBeforeFrom' });
});
export const pledgeEndSchema = z.object({ pledgeId: id, endedOn: day });
export const pledgeGetSchema = z.object({ id, from: day.optional(), to: day.optional() });
export const pledgeListSchema = z.object({
  state: z.enum(PLEDGE_STATES).optional(),
  /** Zweckbindung: ein Zweck, ein Projekt oder `general` für Zusagen ohne beides. */
  purposeId: id.optional(),
  projectId: id.optional(),
  general: z.boolean().optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

/** Zustand einer Zusage, berechnet: beendet ab dem Tag des Endes oder nach der letzten Rate; ruhend in der Ruhezeit. */
export function pledgeState(row: Pick<FinancePledgeRow, 'endedOn' | 'lastDueOn' | 'pausedFrom' | 'pausedUntil'>, today: string): PledgeState {
  if ((row.endedOn && row.endedOn <= today) || (row.lastDueOn && row.lastDueOn < today)) return 'ended';
  return pledgePausedOn(row, today) ? 'paused' : 'active';
}

export interface PledgeView {
  id: string;
  contactId: string;
  contactName: string | null;
  amountCents: number;
  interval: FinancePledgeRow['interval'];
  firstDueOn: string;
  lastDueOn: string | null;
  paymentMethod: FinancePledgeRow['paymentMethod'];
  mandate: { id: string; reference: string; state: MandateState } | null;
  purposeId: string | null;
  projectId: string | null;
  pausedFrom: string | null;
  pausedUntil: string | null;
  endedOn: string | null;
  note: string | null;
  state: PledgeState;
  /** Die nächste Rate ab heute, die nicht ausgelassen ist. */
  nextDueOn: string | null;
}

export interface PledgeDetailView extends PledgeView {
  rates: PledgeRate[];
}

function contactName(db: DbOrTx, contactId: string): string | null {
  const contact = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  return contact ? displayName(contact) : null;
}

export function marksOf(db: DbOrTx, pledgeId: string) {
  return db.select({ dueOn: financePledgeRateMarks.dueOn, mark: financePledgeRateMarks.mark }).from(financePledgeRateMarks).where(eq(financePledgeRateMarks.pledgeId, pledgeId)).all();
}

function nextDueOnInternal(db: DbOrTx, row: FinancePledgeRow, today: string): string | null {
  const ahead = pledgeRates(row, { from: today, to: addCalendarDays(today, 3 * 366), marks: marksOf(db, row.id), ...pledgeRunSourcesInternal(db, row.id), bookedLines: pledgeBookedLinesInternal(db, row.id) });
  return ahead.find((r) => r.state === 'expected')?.dueOn ?? null;
}

function viewOf(deps: Deps, row: FinancePledgeRow): PledgeView {
  const today = todayIn(deps);
  const mandate = row.mandateId ? mandateRowInternal(deps.db, row.mandateId) : null;
  return {
    id: row.id,
    contactId: row.contactId,
    contactName: contactName(deps.db, row.contactId),
    amountCents: row.amountCents,
    interval: row.interval,
    firstDueOn: row.firstDueOn,
    lastDueOn: row.lastDueOn,
    paymentMethod: row.paymentMethod,
    mandate: mandate ? { id: mandate.id, reference: mandate.reference, state: mandateState(mandate, today) } : null,
    purposeId: row.purposeId,
    projectId: row.projectId,
    pausedFrom: row.pausedFrom,
    pausedUntil: row.pausedUntil,
    endedOn: row.endedOn,
    note: row.note,
    state: pledgeState(row, today),
    nextDueOn: nextDueOnInternal(deps.db, row, today),
  };
}

const pledgeRow = (db: DbOrTx, pledgeId: string) => db.select().from(financePledges).where(eq(financePledges.id, pledgeId)).get() ?? null;

/** Ist ein Mandat für neue Einzüge nutzbar? Vorbereitet oder aktiv — beendet und verfallen nicht. */
export function mandateUsable(row: FinanceSepaMandateRow, today: string): boolean {
  const state = mandateState(row, today);
  return state === 'pending' || state === 'active';
}

/** Steckt eine Rate der Zusage ab `from` in einem angelegten, noch nicht gebuchten Einzug? Die früheste mit dem Tag des Einzugs. */
export function pledgeRateInRunInternal(db: DbOrTx, pledgeId: string, from: string): { dueOn: string; runOn: string } | null {
  const hit = openRunItemsInternal(db, { source: 'pledge', sourceId: pledgeId, installmentFrom: from })[0];
  return hit?.item.installmentOn ? { dueOn: hit.item.installmentOn, runOn: hit.collectionDate } : null;
}

/**
 * Eine Dauerspenden-Zusage anlegen oder ändern (`finance.directDebit`, Spec § 7.3). Erzeugt **nie** einen offenen
 * Posten: Eine Spende ist keine Forderung. Bei Lastschrift ohne Mandat entsteht mit IBAN und Kontoinhaber ein Mandat
 * (vorbereitet) und danach die Lastschriftankündigung als Entwurf der Akte (Handoff 1.5) — dafür braucht es
 * `dms.create` und die Gläubiger-ID; ohne IBAN `mandateRequired`. Protokoll ohne Werte: Betrag und Spender stehen am
 * Datensatz.
 */
export async function savePledge(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ pledge: PledgeView; prenotificationDraftId: string | null; skippedRates: string[] }>> {
  const denied = requirePermission(ctx, DIRECT_DEBIT_PERMISSION);
  if (denied) return denied;
  const parsed = validate(deps, pledgeSaveSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const today = todayIn(deps);
  const before = v.id ? pledgeRow(deps.db, v.id) : null;
  if (v.id && !before) return notFound('financePledge', v.id);
  const contact = deps.db.select().from(contacts).where(eq(contacts.id, v.contactId)).get();
  if (!contact) return notFound('contact', v.contactId);
  if (v.purposeId && !deps.db.select({ id: financePurposes.id }).from(financePurposes).where(eq(financePurposes.id, v.purposeId)).get()) return notFound('financePurpose', v.purposeId);
  if (v.projectId && !deps.db.select({ id: projects.id }).from(projects).where(eq(projects.id, v.projectId)).get()) return notFound('project', v.projectId);

  const direct = v.paymentMethod === 'directDebit';
  const mandateId = direct ? (v.mandateId ?? (before?.paymentMethod === 'directDebit' ? before.mandateId : null)) : null;
  if (direct && mandateId) {
    const mandate = mandateRowInternal(deps.db, mandateId);
    if (!mandate) return notFound('financeMandate', mandateId);
    if (!mandateUsable(mandate, today)) return financeConflict('mandateNotUsable', { reference: mandate.reference });
  }
  const newMandate = direct && !mandateId;
  if (newMandate) {
    if (!v.iban || !v.debtorName) return financeConflict('mandateRequired');
    if (!hasPermission(ctx, 'dms.create') || !canReadDocumentType(deps, ctx, PRENOTIFICATION_DOCUMENT_TYPE)) return forbidden(hasPermission(ctx, 'dms.create') ? 'finance.read' : 'dms.create');
    if (!readSetting<string | null>(deps, 'finance.sepa.creditorId')) return financeConflict('sepaCreditorIdMissing');
  }

  const saved = deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const mandate = newMandate ? prepareMandateInternal(tx, deps, ctx, { contactId: v.contactId, debtorName: v.debtorName!, iban: v.iban!, bic: null }) : null;
    const fields = {
      contactId: v.contactId,
      amountCents: v.amountCents,
      interval: v.interval,
      firstDueOn: v.firstDueOn,
      lastDueOn: v.lastDueOn ?? null,
      paymentMethod: v.paymentMethod,
      mandateId: mandate?.id ?? mandateId,
      purposeId: v.purposeId ?? null,
      projectId: v.projectId ?? null,
      note: v.note ?? null,
      updatedAt: now,
    };
    const pledgeId = before?.id ?? newId();
    if (before) tx.update(financePledges).set(fields).where(eq(financePledges.id, pledgeId)).run();
    else tx.insert(financePledges).values({ id: pledgeId, ...fields, createdAt: now }).run();
    const audited = { amountCents: fields.amountCents, interval: fields.interval, firstDueOn: fields.firstDueOn, lastDueOn: fields.lastDueOn, paymentMethod: fields.paymentMethod, mandateId: fields.mandateId, purposeId: fields.purposeId, projectId: fields.projectId };
    financeAudit(tx, deps, ctx, { action: 'finance.pledge.save', entity: 'financePledge', id: pledgeId, before: before ? { ...before } : undefined, after: { ...audited, created: !before }, params: {} });
    return { pledgeId, mandate };
  });

  let prenotificationDraftId: string | null = null;
  let skippedRates: string[] = [];
  if (saved.mandate) {
    const row = pledgeRow(deps.db, saved.pledgeId)!;
    // Erster Einzug: die erste Rate, die nach der Frist der Ankündigung liegt — der Entwurf bleibt bis zum Festschreiben änderbar.
    const earliest = addCalendarDays(today, readSetting<number>(deps, 'finance.sepa.preNotificationDays'));
    const first = pledgeDueDates(row, earliest, addCalendarDays(earliest, 3 * 366))[0] ?? row.firstDueOn;
    // M14: Raten davor lassen sich nicht rechtzeitig ankündigen — sie sind ausgelassen, mit Grund, statt still „erwartet“.
    const taken = new Set(marksOf(deps.db, row.id).map((m) => m.dueOn));
    skippedRates = pledgeDueDates(row, row.firstDueOn, addCalendarDays(first, -1)).filter((d) => d < first && !taken.has(d));
    if (skippedRates.length > 0) {
      deps.db.transaction((tx: DbOrTx) => {
        for (const dueOn of skippedRates) tx.insert(financePledgeRateMarks).values({ id: newId(), pledgeId: row.id, dueOn, mark: 'skipped', reason: 'notAnnounced' }).run();
        financeAudit(tx, deps, ctx, { action: 'finance.pledge.skipRates', entity: 'financePledge', id: row.id, after: { skipped: skippedRates, reason: 'notAnnounced' }, params: { count: skippedRates.length } });
      });
    }
    const body = prenotificationBody({
      greeting: greetingFor(contact),
      creditorName: creditorNameInternal(deps),
      amountCents: row.amountCents,
      interval: row.interval,
      firstCollectionOn: first,
      iban: saved.mandate.iban,
      reference: saved.mandate.reference,
      creditorId: readSetting<string>(deps, 'finance.sepa.creditorId'),
    });
    const draft = await createDraft(deps, ctx, { typeKey: PRENOTIFICATION_DOCUMENT_TYPE, subject: prenotificationSubject(saved.mandate.reference), body, links: [{ entityType: 'contact', entityId: v.contactId, role: 'recipient' }] });
    // Die Vorprüfung oben deckt Recht und Bereich; schlägt der Entwurf trotzdem fehl, bleiben Zusage und Mandat — die
    // Ankündigung lässt sich in der Akte von Hand schreiben.
    if (draft.ok) {
      prenotificationDraftId = draft.value.id;
      // Plan L2: Der Entwurf kündigt die ersten zwölf Monate an — er deckt sie, sobald er festgeschrieben ist.
      const plan = pledgeDueDates(row, first, addCalendarDays(addCalendarMonths(first, 12), -1)).map((dueOn) => ({ dueOn, amountCents: row.amountCents }));
      deps.db.transaction((tx: DbOrTx) => {
        linkDocumentInternal(tx, deps, { documentId: draft.value.id, entityType: MANDATE_ENTITY, entityId: saved.mandate!.id });
        recordPrenotificationInternal(tx, deps, ctx, { mandateId: saved.mandate!.id, documentId: draft.value.id, plan });
      });
    }
  }
  return ok({ pledge: viewOf(deps, pledgeRow(deps.db, saved.pledgeId)!), prenotificationDraftId, skippedRates });
}

/** Zusage ruhen lassen von … bis … (Handoff 1.5): Raten in der Ruhezeit sind ausgelassen, nicht erwartet. */
export async function pausePledge(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PledgeView>> {
  const denied = requirePermission(ctx, DIRECT_DEBIT_PERMISSION);
  if (denied) return denied;
  const parsed = validate(deps, pledgePauseSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const row = pledgeRow(deps.db, v.pledgeId);
  if (!row) return notFound('financePledge', v.pledgeId);
  if (row.endedOn) return financeConflict('pledgeEnded');
  const inRun = pledgeRateInRunInternal(deps.db, row.id, v.from);
  if (inRun) return financeConflict('pledgeRateInRun', { dueOn: inRun.dueOn, date: inRun.runOn });
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(financePledges).set({ pausedFrom: v.from, pausedUntil: v.until, updatedAt: isoNow(deps.clock) }).where(eq(financePledges.id, row.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.pledge.pause', entity: 'financePledge', id: row.id, after: { pausedFrom: v.from, pausedUntil: v.until }, params: { fromOn: v.from, untilOn: v.until } });
    return ok(viewOf(deps, pledgeRow(tx, row.id)!));
  });
}

/** Zusage beenden — einmal; eine Rate in einem angelegten Einzug sperrt (`pledgeRateInRun`, ab L2). */
export async function endPledge(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PledgeView>> {
  const denied = requirePermission(ctx, DIRECT_DEBIT_PERMISSION);
  if (denied) return denied;
  const parsed = validate(deps, pledgeEndSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const row = pledgeRow(deps.db, v.pledgeId);
  if (!row) return notFound('financePledge', v.pledgeId);
  if (row.endedOn) return financeConflict('pledgeEnded');
  const inRun = pledgeRateInRunInternal(deps.db, row.id, addCalendarDays(v.endedOn, 1));
  if (inRun) return financeConflict('pledgeRateInRun', { dueOn: inRun.dueOn, date: inRun.runOn });
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(financePledges).set({ endedOn: v.endedOn, updatedAt: isoNow(deps.clock) }).where(eq(financePledges.id, row.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.pledge.end', entity: 'financePledge', id: row.id, after: { endedOn: v.endedOn }, params: { endedOn: v.endedOn } });
    return ok(viewOf(deps, pledgeRow(tx, row.id)!));
  });
}

/** `finance.read`: die Zusage mit ihren Raten — Vorgabe das laufende Jahr. */
export async function getPledge(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PledgeDetailView>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, pledgeGetSchema, input);
  if (!parsed.ok) return parsed;
  const row = pledgeRow(deps.db, parsed.value.id);
  if (!row) return notFound('financePledge', parsed.value.id);
  const year = todayIn(deps).slice(0, 4);
  const runs = pledgeRateRunsInternal(deps.db, row.id);
  // M40: Per Lastschrift erwartete Raten, die mehr als 30 Tage zurückliegen, zieht Kompass nicht mehr ein — verpasst.
  const missedBefore = row.paymentMethod === 'directDebit' && row.mandateId ? addCalendarDays(todayIn(deps), -MISSED_RATE_DAYS) : undefined;
  const rates = pledgeRates(row, { from: parsed.value.from ?? `${year}-01-01`, to: parsed.value.to ?? `${year}-12-31`, marks: marksOf(deps.db, row.id), ...pledgeRunSourcesInternal(deps.db, row.id, expiredRunIdsInternal(deps)), bookedLines: pledgeBookedLinesInternal(deps.db, row.id), missedBefore }).map((rate) => {
    const run = runs.get(rate.dueOn);
    return run ? { ...rate, run: { id: run.runId, collectionDate: run.collectionDate }, ...(run.openReturnId ? { returnId: run.openReturnId } : {}) } : rate;
  });
  return ok({ ...viewOf(deps, row), rates });
}

/** `finance.read`: Zusagen, neueste zuerst; Zustand berechnet, Suche über den Namen der Person. */
export async function listPledges(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ items: PledgeView[]; total: number }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, pledgeListSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const views = deps.db.select().from(financePledges).orderBy(desc(financePledges.createdAt), asc(financePledges.id)).all().map((r) => viewOf(deps, r));
  const needle = v.search?.toLocaleLowerCase('de');
  const bound = (p: PledgeView) => (!v.purposeId || p.purposeId === v.purposeId) && (!v.projectId || p.projectId === v.projectId) && (!v.general || (!p.purposeId && !p.projectId));
  const filtered = views.filter((p) => (!v.state || p.state === v.state) && bound(p) && (!needle || (p.contactName ?? '').toLocaleLowerCase('de').includes(needle)));
  return ok({ items: filtered.slice(v.offset, v.offset + v.limit), total: filtered.length });
}
