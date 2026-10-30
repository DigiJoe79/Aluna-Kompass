import { invalid, isoNow, newId, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result, type ValidationIssue } from '@kompass/core';
import { and, desc, eq, gte, inArray, lt, lte } from 'drizzle-orm';
import { resolutionFactsOf, resolutionIdProblem, resolutionReferenceInternal, type ResolutionReference } from '@kompass/module-finance';
import { z } from 'zod';
import { membersConflict } from './errors';
import { FEE_INTERVALS, FEE_MAX_CENTS, memberFeeCharges, memberFeeRules, memberFeeSchedules, memberTypes, type FeeInterval, type FeeRuleRow, type FeeScheduleRow } from './schema';

const day = z.iso.date();
const id = z.string().min(1);

export const feeRuleSchema = z.object({
  typeId: id,
  amountCents: z.number().int().min(0).max(FEE_MAX_CENTS),
  interval: z.enum(FEE_INTERVALS),
  /** Betrag ist Mindestbetrag; das Mitglied darf mehr vereinbaren. */
  minimum: z.boolean().default(false),
  /** Rhythmen, die das Mitglied statt `interval` wählen darf; Vorgabe nur `interval`. */
  allowedIntervals: z.array(z.enum(FEE_INTERVALS)).min(1).optional(),
  admissionFeeCents: z.number().int().min(0).max(FEE_MAX_CENTS).nullable().optional(),
});

export const feeScheduleSaveSchema = z.object({
  /** Ohne `id` ein neuer Stand, mit `id` ändern (nur, solange nach ihm keine Beiträge angelegt sind). */
  id: id.optional(),
  validFrom: day,
  resolvedOn: day.nullable().optional(),
  resolutionDocumentId: id.nullable().optional(),
  /** G7: der Beschluss in Gremien (`governanceResolution`); unbekannt oder ohne Gremien `resolutionUnknown`. */
  resolutionId: id.nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  rules: z.array(feeRuleSchema).max(50),
});
export const feeScheduleListSchema = z.object({});
export const feeScheduleDeleteSchema = z.object({ id });

export type FeeRuleView = Omit<FeeRuleRow, 'allowedIntervals'> & { allowedIntervals: FeeInterval[] };
/** Hinweis am Stand: `resolvedOn` weicht vom Tag des verknüpften Beschlusses ab (V-3). */
export type FeeScheduleWarning = { code: 'resolvedOnDiffers'; params: { resolvedOn: string; decidedOn: string } };
/** `resolution`: Beschriftung und Link des Beschlusses in Gremien — `null` ohne `resolutionId` oder ohne Gremien. */
export type FeeScheduleView = FeeScheduleRow & { rules: FeeRuleView[]; locked: boolean; lockedCount: number; resolution: ResolutionReference | null; warnings: FeeScheduleWarning[] };

export const ruleView = (row: FeeRuleRow): FeeRuleView => ({ ...row, allowedIntervals: JSON.parse(row.allowedIntervals) as FeeInterval[] });

/**
 * Angelegte Beiträge, die dieser Stand bestimmt hat — ab dem ersten ist er fest (Spec § 4.1, Handoff D3). Gezählt über
 * den Stand am Beitrag (M4), nicht über den Beginn des Zeitraums: Ein Jahresbeitrag beginnt am 01.01., auch wenn ihn
 * ein Stand vom Sommer berechnet hat.
 */
function chargesCreatedFrom(db: DbOrTx, scheduleId: string): number {
  return db
    .select({ id: memberFeeCharges.id })
    .from(memberFeeCharges)
    .where(and(eq(memberFeeCharges.state, 'created'), eq(memberFeeCharges.scheduleId, scheduleId)))
    .all().length;
}

function scheduleView(deps: Deps, ctx: CallContext, db: DbOrTx, row: FeeScheduleRow): FeeScheduleView {
  const rules = db.select().from(memberFeeRules).where(eq(memberFeeRules.scheduleId, row.id)).all().map(ruleView);
  const lockedCount = chargesCreatedFrom(db, row.id);
  const decidedOn = row.resolutionId ? resolutionFactsOf(deps, db, row.resolutionId)?.decidedOn : undefined;
  const warnings: FeeScheduleWarning[] = decidedOn && row.resolvedOn && row.resolvedOn !== decidedOn ? [{ code: 'resolvedOnDiffers', params: { resolvedOn: row.resolvedOn, decidedOn } }] : [];
  return { ...row, rules, locked: lockedCount > 0, lockedCount, resolution: resolutionReferenceInternal(deps, ctx, row.resolutionId), warnings };
}

/** Die Stände der Beitragsordnung, neuester zuerst, mit ihren Regeln und ob sie fest sind. */
export async function listFeeSchedules(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FeeScheduleView[]>> {
  const denied = requirePermission(ctx, 'members.read');
  if (denied) return denied;
  const parsed = validate(deps, feeScheduleListSchema, input ?? {});
  if (!parsed.ok) return parsed;
  return ok(deps.db.select().from(memberFeeSchedules).orderBy(desc(memberFeeSchedules.validFrom)).all().map((row) => scheduleView(deps, ctx, deps.db, row)));
}

type FeeRuleInput = z.infer<typeof feeRuleSchema>;

/** Eine Regel in vergleichbarer Form: alle Felder von `ruleView`, erlaubte Rhythmen ohne Reihenfolge. */
const ruleKey = (r: { typeId: string; amountCents: number; interval: FeeInterval; minimum: boolean; allowedIntervals?: FeeInterval[] | null; admissionFeeCents?: number | null }) =>
  JSON.stringify([r.typeId, r.amountCents, r.interval, r.minimum, [...(r.allowedIntervals ?? [r.interval])].sort(), r.admissionFeeCents ?? null]);

/** Gleiche Regeln je Mitgliedsart, unabhängig von der Reihenfolge. */
function sameRules(stored: FeeRuleView[], input: FeeRuleInput[]): boolean {
  if (stored.length !== input.length) return false;
  const keys = new Set(stored.map(ruleKey));
  return input.every((r) => keys.has(ruleKey(r)));
}

/** Trägt an einem festen Stand nur Beschluss, Beschlusstag und Notiz nach — die Regeln bleiben, wie sie sind. */
function updateResolution(deps: Deps, ctx: CallContext, before: FeeScheduleRow, v: z.infer<typeof feeScheduleSaveSchema>): Result<FeeScheduleView> {
  return deps.db.transaction((tx: DbOrTx) => {
    const fields = { resolvedOn: v.resolvedOn ?? null, resolutionDocumentId: v.resolutionDocumentId ?? null, resolutionId: v.resolutionId === undefined ? before.resolutionId : v.resolutionId, note: v.note ?? null };
    tx.update(memberFeeSchedules).set({ ...fields, updatedAt: isoNow(deps.clock) }).where(eq(memberFeeSchedules.id, before.id)).run();
    recordAudit(tx, deps, ctx, {
      action: 'members.feeSchedule.update',
      entityType: 'memberFeeSchedule',
      entityId: before.id,
      before: { resolvedOn: before.resolvedOn, resolutionDocumentId: before.resolutionDocumentId, resolutionId: before.resolutionId, note: before.note },
      after: fields,
      params: { validFrom: before.validFrom },
    });
    return ok(scheduleView(deps, ctx, tx, tx.select().from(memberFeeSchedules).where(eq(memberFeeSchedules.id, before.id)).get()!));
  });
}

/** Legt einen Stand an oder ändert ihn samt Regeln. Für eine beitragsfreie Art gibt es keine Regel. */
export async function saveFeeSchedule(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FeeScheduleView>> {
  const denied = requirePermission(ctx, 'members.fees');
  if (denied) return denied;
  const parsed = validate(deps, feeScheduleSaveSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const typeIds = v.rules.map((r) => r.typeId);
  const types = new Map(typeIds.length ? deps.db.select().from(memberTypes).where(inArray(memberTypes.id, typeIds)).all().map((t) => [t.id, t]) : []);
  const issues: ValidationIssue[] = [];
  v.rules.forEach((r, i) => {
    const type = types.get(r.typeId);
    const typePath = `rules.${i}.typeId`;
    if (!type) issues.push({ path: typePath, message: 'unknownMemberType' });
    else if (type.feeExempt) issues.push({ path: typePath, message: 'feeExemptType' });
    if (typeIds.indexOf(r.typeId) !== i) issues.push({ path: typePath, message: 'duplicateMemberType' });
    // Der Rhythmus der Regel gehört zu den erlaubten — eine Prüfung über zwei Felder macht der Dienst, nicht das Werkzeugschema.
    if (r.allowedIntervals && !r.allowedIntervals.includes(r.interval)) issues.push({ path: `rules.${i}.allowedIntervals`, message: 'intervalNotAllowed' });
  });
  if (issues.length > 0) return invalid(issues);
  const unknownResolution = resolutionIdProblem(deps, ctx, v.resolutionId, 'feeSchedule');
  if (unknownResolution) return unknownResolution;

  const before = v.id ? deps.db.select().from(memberFeeSchedules).where(eq(memberFeeSchedules.id, v.id)).get() : undefined;
  if (v.id && !before) return notFound('memberFeeSchedule', v.id);
  if (before) {
    const count = chargesCreatedFrom(deps.db, before.id);
    if (count > 0) {
      // Fest ist, was gerechnet hat: Tag und Regeln. Beschluss, Beschlusstag und Notiz lassen sich nachtragen (Backlog 97).
      const beforeRules = deps.db.select().from(memberFeeRules).where(eq(memberFeeRules.scheduleId, before.id)).all().map(ruleView);
      if (v.validFrom !== before.validFrom || !sameRules(beforeRules, v.rules)) return membersConflict('feeScheduleLocked', { count });
      return updateResolution(deps, ctx, before, v);
    }
  }
  const taken = deps.db.select({ id: memberFeeSchedules.id }).from(memberFeeSchedules).where(eq(memberFeeSchedules.validFrom, v.validFrom)).get();
  if (taken && taken.id !== v.id) return membersConflict('feeScheduleDateTaken', { validFrom: v.validFrom });
  // Ein geänderter Tag darf nicht hinter angelegte Beiträge rutschen.
  if (before && v.validFrom < before.validFrom) {
    const count = deps.db.select({ id: memberFeeCharges.id }).from(memberFeeCharges).where(and(eq(memberFeeCharges.state, 'created'), gte(memberFeeCharges.dueOn, v.validFrom), lt(memberFeeCharges.dueOn, before.validFrom))).all().length;
    if (count > 0) return membersConflict('feeScheduleLocked', { count });
  }

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const fields = { validFrom: v.validFrom, resolvedOn: v.resolvedOn ?? null, resolutionDocumentId: v.resolutionDocumentId ?? null, resolutionId: v.resolutionId === undefined ? (before?.resolutionId ?? null) : v.resolutionId, note: v.note ?? null, updatedAt: now };
    const scheduleId = before?.id ?? newId();
    const beforeRules = before ? tx.select().from(memberFeeRules).where(eq(memberFeeRules.scheduleId, before.id)).all().map(ruleView) : [];
    if (before) {
      tx.update(memberFeeSchedules).set(fields).where(eq(memberFeeSchedules.id, scheduleId)).run();
      tx.delete(memberFeeRules).where(eq(memberFeeRules.scheduleId, scheduleId)).run();
    } else {
      tx.insert(memberFeeSchedules).values({ id: scheduleId, ...fields, createdAt: now }).run();
    }
    for (const r of v.rules) {
      tx.insert(memberFeeRules)
        .values({ id: newId(), scheduleId, typeId: r.typeId, amountCents: r.amountCents, interval: r.interval, minimum: r.minimum, allowedIntervals: JSON.stringify(r.allowedIntervals ?? [r.interval]), admissionFeeCents: r.admissionFeeCents ?? null })
        .run();
    }
    const after = { ...fields, rules: v.rules };
    if (before) recordAudit(tx, deps, ctx, { action: 'members.feeSchedule.update', entityType: 'memberFeeSchedule', entityId: scheduleId, before: { ...before, rules: beforeRules }, after, params: { validFrom: v.validFrom } });
    else recordAudit(tx, deps, ctx, { action: 'members.feeSchedule.create', entityType: 'memberFeeSchedule', entityId: scheduleId, after, params: { validFrom: v.validFrom } });
    return ok(scheduleView(deps, ctx, tx, tx.select().from(memberFeeSchedules).where(eq(memberFeeSchedules.id, scheduleId)).get()!));
  });
}

/** Löscht einen Stand, nach dem noch nichts angelegt ist — nie den einzigen. */
export async function deleteFeeSchedule(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string }>> {
  const denied = requirePermission(ctx, 'members.fees');
  if (denied) return denied;
  const parsed = validate(deps, feeScheduleDeleteSchema, input);
  if (!parsed.ok) return parsed;
  const row = deps.db.select().from(memberFeeSchedules).where(eq(memberFeeSchedules.id, parsed.value.id)).get();
  if (!row) return notFound('memberFeeSchedule', parsed.value.id);
  const count = chargesCreatedFrom(deps.db, row.id);
  if (count > 0) return membersConflict('feeScheduleLocked', { count });
  if (deps.db.select({ id: memberFeeSchedules.id }).from(memberFeeSchedules).all().length === 1) return membersConflict('feeScheduleLast');
  return deps.db.transaction((tx: DbOrTx) => {
    const rules = tx.select().from(memberFeeRules).where(eq(memberFeeRules.scheduleId, row.id)).all().map(ruleView);
    tx.delete(memberFeeRules).where(eq(memberFeeRules.scheduleId, row.id)).run();
    tx.delete(memberFeeSchedules).where(eq(memberFeeSchedules.id, row.id)).run();
    recordAudit(tx, deps, ctx, { action: 'members.feeSchedule.delete', entityType: 'memberFeeSchedule', entityId: row.id, before: { ...row, rules }, params: { validFrom: row.validFrom } });
    return ok({ id: row.id });
  });
}

/** Der Stand, der am Tag gilt, oder `null` vor dem ersten. */
export function feeScheduleAt(db: DbOrTx, on: string): FeeScheduleRow | null {
  return db.select().from(memberFeeSchedules).where(lte(memberFeeSchedules.validFrom, on)).orderBy(desc(memberFeeSchedules.validFrom)).get() ?? null;
}

/** Die Regel einer Art im Stand, der am Tag gilt — `null` ohne Stand oder ohne Regel für die Art. */
export function feeRuleAt(db: DbOrTx, typeId: string, on: string): FeeRuleView | null {
  const schedule = feeScheduleAt(db, on);
  if (!schedule) return null;
  const rule = db.select().from(memberFeeRules).where(and(eq(memberFeeRules.scheduleId, schedule.id), eq(memberFeeRules.typeId, typeId))).get();
  return rule ? ruleView(rule) : null;
}
