import { invalid, isoNow, newId, notFound, ok, readSetting, recordAudit, requireHumanChannel, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { addCalendarDays } from '@kompass/module-finance';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { catchAborted, governanceConflict, GovernanceAborted } from './errors';
import { rulesChangeAffectedInternal, rulesLockedInternal } from './statute-rules-change';
import { resolveRule } from './rules/resolve';
import { EMPTY_RULES, rulesSchema, type StatuteRules } from './rules/schema';
import { EMPTY_TAX_REVIEW, governanceAgendaItems, governanceMeetings, governanceOrgans, governanceResolutions, governanceStatutes, type StatuteFoundingChecks, type StatuteResolutionRef, type StatuteRow, type StatuteTaxReview } from './schema';

const DAY = z.iso.date();

export type StatuteState = 'draft' | 'resolved' | 'valid' | 'superseded';
/**
 * `basedOnUnregistered`: der Basisstand ist beschlossen, aber nicht eingetragen (W-1). `omitsUnregistered`: ein älterer
 * beschlossener Stand ist nie eingetragen worden und seine Änderungen fehlen in diesem Stand (W-1).
 */
export type StatuteWarning = 'taxReviewOpen' | 'newNoticeMissing' | 'basedOnUnregistered' | 'omitsUnregistered';
export interface StatuteView {
  id: string;
  basedOnId: string | null;
  documentId: string | null;
  resolutions: StatuteResolutionRef[];
  registeredOn: string | null;
  rules: StatuteRules;
  taxReview: StatuteTaxReview;
  foundingChecks: StatuteFoundingChecks | null;
  note: string | null;
  /** Berechnet für heute. */
  state: StatuteState;
  /** Jüngstes Beschlussdatum — „Fassung vom“ für die Anlage Gem (Steuerprüfung S4). */
  lastResolvedOn: string | null;
  /** Steuerprüfung M1: Bewertung durch das Finanzamt offen bzw. neuer Bescheid fehlt. */
  warnings: StatuteWarning[];
}

const taxReviewSchema = z.strictObject({
  affectsCharity: z.boolean().nullable(),
  submittedOn: DAY.nullable(),
  submissionDocumentId: z.string().min(1).nullable(),
  answer: z.enum(['notRelevant', 'newNotice']).nullable(),
  answerDocumentId: z.string().min(1).nullable(),
});
export const statuteIdSchema = z.object({ id: z.string().min(1) });
export const statuteListSchema = z.object({});
/** Ohne `basedOnId` der heute gültige Stand (G-16) — oder ein jüngerer beschlossener, nicht eingetragener (W-1); `null` beginnt leer (erste Satzung, Gründung). */
export const statuteDraftSchema = z.object({ basedOnId: z.string().min(1).nullable().optional().describe('Omitted: the latest resolved, never registered stand resolved after the one valid today (warning basedOnUnregistered), otherwise the stand valid today; null: empty rules.'), note: z.string().trim().max(2000).optional() });
export const statuteUpdateSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1).nullable().optional(),
  /** Von Hand nur für Nachträge; ab G4 schreibt das Festschreiben einer Sitzung die Beschlüsse. */
  resolutions: z.array(z.object({ on: DAY, resolutionId: z.string().min(1).nullable() })).max(20).optional(),
  rules: rulesSchema.optional(),
  taxReview: taxReviewSchema.optional(),
  foundingChecks: z.strictObject({ signatures: z.number().int().min(0).max(1000).nullable(), establishedOn: DAY.nullable() }).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  /** Pflicht, wenn sich das Regelwerk eines eingetragenen oder abgelösten Stands ändert (G-5); steht im Protokoll. */
  reason: z.string().trim().min(1).max(2000).optional(),
});
export const statuteRegisterSchema = z.object({ id: z.string().min(1), registeredOn: DAY });
export const statuteRulesOnSchema = z.object({ on: DAY });

const lastResolved = (row: Pick<StatuteRow, 'resolutions'>): string | null => row.resolutions.map((r) => r.on).sort().at(-1) ?? null;

/**
 * Der am Tag gültige Stand (Spec § 4.1, Rechtsprüfung 2026-10-28): der jüngste mit `registeredOn ≤ day`. Ist bis zu
 * diesem Tag noch keiner eingetragen (Vorverein, § 71 BGB gilt noch nicht), der jüngste mit einem Beschluss **vor**
 * `day` — die Versammlung, die eine Änderung beschließt, wird nach der alten Fassung beurteilt. Gemessen am Tag `day`:
 * Vor der Ersteintragung gilt der beschlossene Stand auch rückblickend.
 */
export function statuteValidOnInternal(db: DbOrTx, day: string, opts: { resolvedBefore?: boolean } = {}): StatuteRow | null {
  const rows = db.select().from(governanceStatutes).all();
  const key = (r: StatuteRow) => `${r.registeredOn ?? ''}|${lastResolved(r) ?? ''}|${r.createdAt}`;
  // K-7: `resolvedBefore` — ein am Beschlusstag selbst eingetragener Stand zählt an diesem Tag nicht; die Sitzung, die ihn beschloss, tagte unter dem alten.
  const registered = rows.filter((r) => r.registeredOn !== null && r.registeredOn <= day && (!opts.resolvedBefore || (lastResolved(r) ?? '') < day)).sort((a, b) => key(a).localeCompare(key(b)));
  if (registered.length > 0) return registered.at(-1)!;
  const resolved = rows.filter((r) => (lastResolved(r) ?? day) < day).sort((a, b) => `${lastResolved(a)}|${a.createdAt}`.localeCompare(`${lastResolved(b)}|${b.createdAt}`));
  return resolved.at(-1) ?? null;
}

/**
 * Das Regelwerk, nach dem Vorgänge des Tages beurteilt werden; ohne Stand leer (dann gilt überall das BGB). K-7: Wird ein
 * Stand am Tag seines (letzten) Beschlusses eingetragen, gilt sein Regelwerk erst ab dem Folgetag — die Beschlüsse der
 * Sitzung, die ihn beschloss, wurden unter dem alten Stand gefasst. Gültig (`statuteValidOnInternal`) ist er ab dem Tag.
 */
export function statuteRulesOnInternal(db: DbOrTx, day: string): { statuteId: string | null; rules: StatuteRules } {
  const row = statuteValidOnInternal(db, day, { resolvedBefore: true });
  return row ? { statuteId: row.id, rules: row.rules } : { statuteId: null, rules: EMPTY_RULES };
}

/**
 * Das Regelwerk eines Vorgangs der Sitzung. Gründung (Spec § 5.7): ab dem TOP nach der angenommenen Satzung gilt der dort
 * beschlossene Stand, davor keiner. `agendaItemId` `null` heißt: am Ende der Sitzung.
 */
export function meetingRulesInternal(db: DbOrTx, meeting: { id: string; heldOn: string; kind: string }, agendaItemId: string | null): { statuteId: string | null; rules: StatuteRules } {
  if (meeting.kind !== 'founding') return statuteRulesOnInternal(db, meeting.heldOn);
  const items = db.select().from(governanceAgendaItems).where(eq(governanceAgendaItems.meetingId, meeting.id)).all();
  const adopted = db.select().from(governanceResolutions).where(and(eq(governanceResolutions.meetingId, meeting.id), eq(governanceResolutions.outcome, 'adopted'))).all();
  const founding = items.find((i) => i.kind === 'statute' && i.statuteId !== null && adopted.some((r) => r.agendaItemId === i.id));
  const row = founding ? db.select().from(governanceStatutes).where(eq(governanceStatutes.id, founding.statuteId!)).get() : undefined;
  const position = agendaItemId === null ? Infinity : (items.find((i) => i.id === agendaItemId)?.position ?? 0);
  if (founding && row && position > founding.position) return { statuteId: row.id, rules: row.rules };
  return statuteRulesOnInternal(db, meeting.heldOn);
}

/** Das Regelwerk, nach dem ein Beschluss beurteilt wird: bei einer Sitzung aus `meetingRulesInternal`, sonst das des Tages. */
export function resolutionRulesInternal(db: DbOrTx, row: { meetingId: string | null; agendaItemId: string | null; decidedOn: string }): { statuteId: string | null; rules: StatuteRules } {
  const meeting = row.meetingId ? db.select().from(governanceMeetings).where(eq(governanceMeetings.id, row.meetingId)).get() : undefined;
  return meeting ? meetingRulesInternal(db, meeting, row.agendaItemId) : statuteRulesOnInternal(db, row.decidedOn);
}

/** Erlaubt der am Tag gültige Stand dem Organ die Ersatzbestellung (§§ 27, 40 BGB)? */
export function substitutionAllowedOn(db: DbOrTx, organId: string, day: string): boolean {
  return resolveRule(statuteRulesOnInternal(db, day).rules, organId, 'substitutionAllowed').value === true;
}

/** Die Stände, auf denen `row` über `basedOnId` aufbaut (ohne `row` selbst). */
export function ancestorsOf(byId: Map<string, StatuteRow>, row: StatuteRow): Set<string> {
  const seen = new Set<string>();
  for (let id = row.basedOnId; id !== null && !seen.has(id); id = byId.get(id)?.basedOnId ?? null) seen.add(id);
  return seen;
}

/**
 * W-1: Ein beschlossener, nicht eingetragener Stand ist erledigt, wenn der gültige oder ein eingetragener Stand auf
 * ihm aufbaut — dann trägt der seine Änderungen. Sonst bleibt er „beschlossen“ und sein Registeranlass offen, auch
 * wenn später ein anderer Stand eingetragen wird.
 */
export function statuteCoveredInternal(rows: StatuteRow[], row: StatuteRow, current: StatuteRow | null, today: string): boolean {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return rows.some((r) => (r.id === current?.id || (r.registeredOn !== null && r.registeredOn <= today)) && ancestorsOf(byId, r).has(row.id));
}

function stateOf(rows: StatuteRow[], row: StatuteRow, current: StatuteRow | null, today: string): StatuteState {
  const last = lastResolved(row);
  if (current?.id === row.id) return 'valid';
  if (last === null) return 'draft';
  if (row.registeredOn !== null && row.registeredOn <= today) return 'superseded';
  return statuteCoveredInternal(rows, row, current, today) ? 'superseded' : 'resolved';
}

/** W-1: offene beschlossene Stände, die `row` weder enthält noch fortschreibt. */
function unregisteredOf(rows: StatuteRow[], row: StatuteRow, current: StatuteRow | null, today: string): StatuteRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const mine = ancestorsOf(byId, row);
  return rows.filter((s) => s.id !== row.id && s.registeredOn === null && lastResolved(s) !== null && s.id !== current?.id && !mine.has(s.id) && !ancestorsOf(byId, s).has(row.id) && !statuteCoveredInternal(rows, s, current, today));
}

/**
 * Bis wann nach der Eintragung eines Stands, der die Gemeinnützigkeit berührt, der neue Bescheid nach § 60a AO angefordert
 * sein sollte: Eintragung + `governance.taxNoticeRequestDays` (Vorgabe 28). Frist und Warnung rechnen beide damit —
 * fällig an diesem Tag, überfällig danach (Joe 2026-10-29, 0.5.0 Nr. 6).
 */
export const taxNoticeDueOn = (deps: Deps, registeredOn: string): string => addCalendarDays(registeredOn, readSetting<number>(deps, 'governance.taxNoticeRequestDays'));

function warningsOf(deps: Deps, rows: StatuteRow[], row: StatuteRow, current: StatuteRow | null, today: string): StatuteWarning[] {
  const warnings: StatuteWarning[] = [];
  // G-31: offen, solange niemand bewertet hat — oder die Gemeinnützigkeit berührt ist und das Finanzamt vor der Eintragung noch nicht geantwortet hat.
  const unanswered = row.taxReview.affectsCharity === true && row.taxReview.answer === null && row.registeredOn === null;
  if ((row.taxReview.affectsCharity === null || unanswered) && row.resolutions.length > 0) warnings.push('taxReviewOpen');
  // Erst wenn die Frist für den neuen Bescheid überschritten ist, nicht ab dem Tag nach der Eintragung (0.5.0 Nr. 6).
  if (row.taxReview.affectsCharity === true && row.registeredOn !== null && today > taxNoticeDueOn(deps, row.registeredOn) && row.taxReview.answer !== 'newNotice') warnings.push('newNoticeMissing');
  const state = stateOf(rows, row, current, today);
  if (state === 'superseded') return warnings;
  const base = row.basedOnId ? rows.find((r) => r.id === row.basedOnId) : undefined;
  if (state === 'draft' && base && base.registeredOn === null && lastResolved(base) !== null && base.id !== current?.id) warnings.push('basedOnUnregistered');
  if (unregisteredOf(rows, row, current, today).length > 0) warnings.push('omitsUnregistered');
  return warnings;
}

export function statuteViewInternal(db: DbOrTx, deps: Deps, row: StatuteRow, today: string, current = statuteValidOnInternal(db, today)): StatuteView {
  const rows = db.select().from(governanceStatutes).all();
  return {
    id: row.id,
    basedOnId: row.basedOnId,
    documentId: row.documentId,
    resolutions: row.resolutions,
    registeredOn: row.registeredOn,
    rules: row.rules,
    taxReview: row.taxReview,
    foundingChecks: row.foundingChecks,
    note: row.note,
    state: stateOf(rows, row, current, today),
    lastResolvedOn: lastResolved(row),
    warnings: warningsOf(deps, rows, row, current, today),
  };
}

const loadStatute = (db: DbOrTx, id: string): StatuteRow | undefined => db.select().from(governanceStatutes).where(eq(governanceStatutes.id, id)).get();

/** Alle Stände, nach Beschluss (Entwürfe zuletzt). */
export async function listStatutes(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<StatuteView[]>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, statuteListSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const today = todayIn(deps);
  const current = statuteValidOnInternal(deps.db, today);
  const rows = deps.db.select().from(governanceStatutes).orderBy(asc(governanceStatutes.createdAt), asc(governanceStatutes.id)).all();
  const order = (r: StatuteRow) => lastResolved(r) ?? '9999-12-31';
  return ok(rows.sort((a, b) => order(a).localeCompare(order(b))).map((r) => statuteViewInternal(deps.db, deps, r, today, current)));
}

export async function getStatute(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<StatuteView>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, statuteIdSchema, input);
  if (!parsed.ok) return parsed;
  const row = loadStatute(deps.db, parsed.value.id);
  if (!row) return notFound('governanceStatute', parsed.value.id);
  return ok(statuteViewInternal(deps.db, deps, row, todayIn(deps)));
}

/**
 * Ohne Angabe die Basis eines neuen Entwurfs (W-1): der jüngste beschlossene, nicht eingetragene und nicht erledigte
 * Stand, der nach dem gültigen beschlossen wurde — sonst fehlten seine Änderungen —, ohne ihn der heute gültige.
 */
function defaultBaseInternal(db: DbOrTx, today: string): StatuteRow | undefined {
  const current = statuteValidOnInternal(db, today);
  const rows = db.select().from(governanceStatutes).all();
  const since = current ? (lastResolved(current) ?? '') : '';
  const open = rows
    .filter((r) => r.id !== current?.id && r.registeredOn === null && (lastResolved(r) ?? '') > since && !statuteCoveredInternal(rows, r, current, today))
    .sort((a, b) => (lastResolved(a) ?? '').localeCompare(lastResolved(b) ?? '') || a.createdAt.localeCompare(b.createdAt));
  return open.at(-1) ?? current ?? undefined;
}

/** Ein neuer Entwurf, mit dem Regelwerk des Basisstands — ohne Angabe s. `defaultBaseInternal`, mit `null` leer. */
export async function createStatuteDraft(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<StatuteView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, statuteDraftSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const requested = parsed.value.basedOnId;
  const base = requested ? loadStatute(deps.db, requested) : requested === undefined ? defaultBaseInternal(deps.db, todayIn(deps)) : undefined;
  if (parsed.value.basedOnId && !base) return notFound('governanceStatute', parsed.value.basedOnId);
  const now = isoNow(deps.clock);
  return deps.db.transaction((tx: DbOrTx) => {
    const row: StatuteRow = {
      id: newId(),
      basedOnId: base?.id ?? null,
      documentId: null,
      resolutions: [],
      registeredOn: null,
      rules: base ? base.rules : EMPTY_RULES,
      taxReview: EMPTY_TAX_REVIEW,
      foundingChecks: null,
      note: parsed.value.note ?? null,
      createdAt: now,
      updatedAt: now,
    };
    tx.insert(governanceStatutes).values(row).run();
    recordAudit(tx, deps, ctx, { action: 'governance.statute.create', entityType: 'governanceStatute', entityId: row.id, after: { basedOnId: row.basedOnId }, params: {} });
    return ok(statuteViewInternal(tx, deps, row, todayIn(deps)));
  });
}

const sameRef = (a: StatuteResolutionRef, b: StatuteResolutionRef) => a.on === b.on && a.resolutionId === b.resolutionId;

/**
 * Beschlüsse von Hand (G-4): Ein eingetragener Stand bleibt, wie er ist; ein verknüpfter Beschluss (Festschreiben oder
 * Nachtrag) bleibt stehen; neu verknüpfen lässt sich nur eine Satzungs- oder Zweckänderung der Mitgliederversammlung,
 * die keinen anderen Stand nennt. Altbestand ohne Beschluss in Kompass trägt `resolutionId: null`.
 */
function handResolutionsRefusal(db: DbOrTx, before: StatuteRow, next: StatuteResolutionRef[]): string | null {
  const unchanged = next.length === before.resolutions.length && next.every((r, i) => sameRef(r, before.resolutions[i]!));
  if (unchanged) return null;
  if (before.registeredOn !== null) return 'statuteRegistered';
  if (before.resolutions.some((r) => r.resolutionId !== null && !next.some((n) => sameRef(n, r)))) return 'linkedResolutionKept';
  for (const ref of next) {
    if (ref.resolutionId === null || before.resolutions.some((r) => sameRef(r, ref))) continue;
    const row = db.select().from(governanceResolutions).where(eq(governanceResolutions.id, ref.resolutionId)).get();
    const organ = row ? db.select().from(governanceOrgans).where(eq(governanceOrgans.id, row.organId)).get() : undefined;
    const statuteId = (row?.details as { statuteId?: string } | null)?.statuteId;
    if (!row || (row.kind !== 'statute' && row.kind !== 'purpose') || organ?.kind !== 'assembly' || (statuteId !== undefined && statuteId !== before.id)) return 'notStatuteResolution';
  }
  return null;
}

/** Ändert Wortlaut-Dokument, Beschlüsse, Regelwerk, Finanzamt-Bewertung, Gründungsprüfliste oder Notiz. */
export async function updateStatute(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<StatuteView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, statuteUpdateSchema, input);
  if (!parsed.ok) return parsed;
  const { id, reason, ...changes } = parsed.value;
  const before = loadStatute(deps.db, id);
  if (!before) return notFound('governanceStatute', id);
  const fields = (Object.keys(changes) as (keyof typeof changes)[]).filter((k) => changes[k] !== undefined);
  if (fields.length === 0) return invalid([{ path: '', message: 'nothingChanged' }]);
  // G-5: Das Regelwerk eines eingetragenen oder abgelösten Stands ändert die Bewertung festgeschriebener Beschlüsse.
  const amendsLockedRules = changes.rules !== undefined && JSON.stringify(changes.rules) !== JSON.stringify(rulesSchema.parse(before.rules)) && rulesLockedInternal(deps.db, deps, before);
  if (amendsLockedRules && !reason) return invalid([{ path: 'reason', message: 'reasonRequired' }]);
  if (changes.resolutions && before.registeredOn !== null && (lastResolved({ resolutions: changes.resolutions }) ?? '') > before.registeredOn) return invalid([{ path: 'resolutions', message: 'afterRegistration' }]);
  if (changes.resolutions) {
    const refused = handResolutionsRefusal(deps.db, before, changes.resolutions);
    if (refused) return invalid([{ path: 'resolutions', message: refused }]);
  }
  const set = Object.fromEntries(fields.map((k) => [k, changes[k]])) as Partial<StatuteRow>;
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(governanceStatutes).set({ ...set, updatedAt: isoNow(deps.clock) }).where(eq(governanceStatutes.id, id)).run();
    const was = Object.fromEntries(fields.map((k) => [k, before[k]]));
    if (amendsLockedRules) {
      const affected = rulesChangeAffectedInternal(tx, deps, before, changes.rules!);
      recordAudit(tx, deps, ctx, { action: 'governance.statute.rulesAmend', entityType: 'governanceStatute', entityId: id, before: was, after: { ...set, reason, affected: affected.map((a) => a.number) }, params: { fields: fields.join(', '), affected: affected.length } });
    } else recordAudit(tx, deps, ctx, { action: 'governance.statute.update', entityType: 'governanceStatute', entityId: id, before: was, after: set, params: { fields: fields.join(', ') } });
    return ok(statuteViewInternal(tx, deps, loadStatute(tx, id)!, todayIn(deps)));
  });
}

/**
 * Trägt einen Beschluss am Stand ein (Festschreiben, Plan G4): Gibt es einen Eintrag am selben Tag ohne Beschluss
 * (von Hand nachgetragen), wird er gefüllt — Abgleich statt Doppelung —, sonst angehängt. `affectsCharity` setzt die
 * Prüffrage Finanzamt (Zweckänderung: immer ja, Spec § 6).
 */
export function addStatuteResolutionInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, input: { statuteId: string; on: string; resolutionId: string; affectsCharity?: boolean }): StatuteRow {
  const before = loadStatute(tx, input.statuteId);
  if (!before) throw new Error(`addStatuteResolutionInternal: unknown statute ${input.statuteId}`);
  const index = before.resolutions.findIndex((r) => r.on === input.on && r.resolutionId === null);
  const already = before.resolutions.some((r) => r.resolutionId === input.resolutionId);
  const resolutions = already ? before.resolutions : index >= 0 ? before.resolutions.map((r, i) => (i === index ? { on: r.on, resolutionId: input.resolutionId } : r)) : [...before.resolutions, { on: input.on, resolutionId: input.resolutionId }];
  const taxReview = input.affectsCharity ? { ...before.taxReview, affectsCharity: true } : before.taxReview;
  tx.update(governanceStatutes).set({ resolutions, taxReview, updatedAt: isoNow(deps.clock) }).where(eq(governanceStatutes.id, before.id)).run();
  recordAudit(tx, deps, ctx, { action: 'governance.statute.resolve', entityType: 'governanceStatute', entityId: before.id, before: { resolutions: before.resolutions }, after: { resolutions }, params: { on: input.on } });
  return loadStatute(tx, before.id)!;
}

/**
 * L-4: Mit dem Stand werden die beschlossenen, nie eingetragenen Stände eingetragen, auf denen er aufbaut (K-3, W-1).
 * Berührte einer davon die Gemeinnützigkeit und steht die Antwort des Finanzamts aus, gilt das für den eingetragenen
 * Stand — sonst entfiele die Frist für den neuen Bescheid nach § 60a Abs. 4 AO. Hat das Finanzamt geantwortet, bleibt
 * die Bewertung des eingetragenen Stands stehen (0.5.0 Nr. 22). Übernommen werden `affectsCharity: true` und, wo leer,
 * die Vorlage beim Finanzamt; protokolliert wie eine Änderung der Bewertung.
 */
function carryTaxReviewOfBasesInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, row: StatuteRow): void {
  if (row.taxReview.affectsCharity === true) return;
  const byId = new Map(tx.select().from(governanceStatutes).all().map((r) => [r.id, r]));
  const bases: StatuteRow[] = [];
  for (let base = row.basedOnId ? byId.get(row.basedOnId) : undefined; base && base.registeredOn === null && !bases.includes(base); base = base.basedOnId ? byId.get(base.basedOnId) : undefined) bases.push(base);
  const charity = bases.filter((b) => b.resolutions.length > 0 && b.taxReview.affectsCharity === true && b.taxReview.answer === null);
  if (charity.length === 0) return;
  const submitted = charity.find((b) => b.taxReview.submittedOn !== null)?.taxReview;
  const taxReview: StatuteTaxReview = {
    ...row.taxReview,
    affectsCharity: true,
    submittedOn: row.taxReview.submittedOn ?? submitted?.submittedOn ?? null,
    submissionDocumentId: row.taxReview.submissionDocumentId ?? submitted?.submissionDocumentId ?? null,
  };
  tx.update(governanceStatutes).set({ taxReview, updatedAt: isoNow(deps.clock) }).where(eq(governanceStatutes.id, row.id)).run();
  recordAudit(tx, deps, ctx, { action: 'governance.statute.update', entityType: 'governanceStatute', entityId: row.id, before: { taxReview: row.taxReview }, after: { taxReview, from: charity.map((b) => b.id) }, params: { fields: 'taxReview' } });
}

/**
 * Kern von `registerStatute` ohne Rechte- und Kanalprüfung, in der Transaktion des Aufrufers (Eintragung einer
 * Registeranmeldung, Plan G5): gleiche Regeln — ohne Beschluss `statuteNotResolved`, vor dem jüngsten Beschluss
 * `validation` —, als `GovernanceAborted` geworfen, damit die ganze Transaktion zurückrollt; gleiches Protokoll.
 */
export function registerStatuteInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, input: { id: string; registeredOn: string }): StatuteView {
  const before = loadStatute(tx, input.id);
  if (!before) throw new GovernanceAborted(notFound('governanceStatute', input.id));
  const last = lastResolved(before);
  if (last === null) throw new GovernanceAborted(governanceConflict('statuteNotResolved'));
  if (input.registeredOn < last) throw new GovernanceAborted(invalid([{ path: 'registeredOn', message: 'beforeResolution' }]));
  tx.update(governanceStatutes).set({ registeredOn: input.registeredOn, updatedAt: isoNow(deps.clock) }).where(eq(governanceStatutes.id, before.id)).run();
  carryTaxReviewOfBasesInternal(tx, deps, ctx, before);
  recordAudit(tx, deps, ctx, { action: 'governance.statute.register', entityType: 'governanceStatute', entityId: before.id, before: { registeredOn: before.registeredOn }, after: { registeredOn: input.registeredOn }, params: { registeredOn: input.registeredOn } });
  return statuteViewInternal(tx, deps, loadStatute(tx, before.id)!, todayIn(deps));
}

/** Trägt den Tag der Eintragung ein (§ 71 BGB); erst damit gilt der Stand. Nur am Bildschirm. */
export async function registerStatute(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<StatuteView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, 'governance.mcpHumanOnlyAllowed');
  if (human) return human;
  const parsed = validate(deps, statuteRegisterSchema, input);
  if (!parsed.ok) return parsed;
  return catchAborted(() => deps.db.transaction((tx: DbOrTx) => ok(registerStatuteInternal(tx, deps, ctx, parsed.value))));
}

/** Löscht einen Entwurf ohne Beschluss — Arbeitsmaterial (`deletionRules`). */
export async function deleteStatuteDraft(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string }>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, statuteIdSchema, input);
  if (!parsed.ok) return parsed;
  const before = loadStatute(deps.db, parsed.value.id);
  if (!before) return notFound('governanceStatute', parsed.value.id);
  if (before.resolutions.length > 0 || before.registeredOn !== null) return governanceConflict('statuteNotDraft');
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(governanceStatutes).set({ basedOnId: null }).where(eq(governanceStatutes.basedOnId, before.id)).run();
    tx.delete(governanceStatutes).where(eq(governanceStatutes.id, before.id)).run();
    recordAudit(tx, deps, ctx, { action: 'governance.statute.delete', entityType: 'governanceStatute', entityId: before.id, before: { basedOnId: before.basedOnId, note: before.note }, params: {} });
    return ok({ id: before.id });
  });
}

/** Das Regelwerk, das an einem Tag gilt, samt dem Stand, aus dem es kommt. */
export async function statuteRulesOn(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ statuteId: string | null; rules: StatuteRules }>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, statuteRulesOnSchema, input);
  if (!parsed.ok) return parsed;
  return ok(statuteRulesOnInternal(deps.db, parsed.value.on));
}
