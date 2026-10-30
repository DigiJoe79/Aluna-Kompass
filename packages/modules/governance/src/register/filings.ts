import { addCalendarDays } from '@kompass/module-finance';
import { invalid, isoNow, newId, notFound, ok, readSetting, recordAudit, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { catchAborted, governanceConflict, GovernanceAborted } from '../errors';
import { governanceRegisterFilings, governanceRegisterOccasions, governanceStatutes, type FilingRow, type OccasionRow, type StatuteRow } from '../schema';
import { ancestorsOf, statuteViewInternal } from '../statutes';
import { occasion, recordRegisterOccasionInternal } from '../seal/occasions';
import { openOccasionsInternal, type OpenOccasion } from './occasions-open';
import { dissolutionFactsInternal, type DissolutionFacts } from './dissolution-rules';
import { transparencyChecksOpenInternal, transparencyViewInternal, type TransparencyView } from './transparency-rules';

const DAY = z.iso.date();
const id = z.string().min(1);

export const FILING_STATES = ['due', 'atNotary', 'submitted', 'interimOrder', 'registered'] as const;
/** Zustand der Registeranmeldung, berechnet aus ihren Tagen (Spec § 7.1, Prinzip 5). */
export type FilingState = (typeof FILING_STATES)[number];
/** Warnungen am Vorgang, nie eine Sperre: eingereicht, aber die Prüffragen 2–4 zum Transparenzregister offen. */
/** `notarizationMissing`: eingereicht ohne Tag der Beglaubigung (§ 77 BGB, G-24). */
/** `statuteOmitsUnregistered`: ein Stand der Anmeldung lässt einen älteren beschlossenen, nie eingetragenen aus (W-1). */
/** `overdueByAttached`: überfällig, weil ein mitgenommener älterer Stand (K-3) die Frist bestimmt — er ist seit langem fällig (L-6). */
export type FilingWarning = 'transparencyChecksOpen' | 'notarizationMissing' | 'statuteOmitsUnregistered' | 'overdueByAttached';
/** Antwort von Anlegen, Ergänzen und Abschließen: die Anlässe, die Kompass dabei selbst mitgenommen hat (K-3, L-6). */
export type FilingChangeView = FilingView & { attachedOccasions: OccasionRow[] };
export type FilingView = Omit<FilingRow, 'transparency' | 'dissolution'> & { state: FilingState; occasions: OccasionRow[]; overdue: boolean; dueOn: string | null; transparency: TransparencyView; dissolution: DissolutionFacts | null; warnings: FilingWarning[] };

/** Ein Anlass zum Bündeln: gespeichert über `id`, berechnet über `termId` (abgelaufene Amtszeit) oder `statuteId` (beschlossener Stand). */
const occasionRefBaseSchema = z.object({ id: id.optional(), termId: id.optional(), statuteId: id.optional() });
/** N5: „id oder termId“ prüft der Dienst; die Werkzeuge zeigen die `…BaseSchema` ohne `refine`. */
const occasionRefSchema = occasionRefBaseSchema.refine((v) => [v.id, v.termId, v.statuteId].filter((x) => x !== undefined).length === 1, { message: 'idOrTermId' });
export const registerOccasionsSchema = z.object({});
export const filingCreateBaseSchema = z.object({ occasions: z.array(occasionRefBaseSchema).min(1).max(50), note: z.string().trim().max(2000).optional() });
export const filingCreateSchema = filingCreateBaseSchema.extend({ occasions: z.array(occasionRefSchema).min(1).max(50) });
export const filingAddOccasionsBaseSchema = z.object({ filingId: id, occasions: z.array(occasionRefBaseSchema).min(1).max(50) });
export const filingAddOccasionsSchema = filingAddOccasionsBaseSchema.extend({ occasions: z.array(occasionRefSchema).min(1).max(50) });
export const filingUpdateSchema = z.object({
  id,
  notaryContactId: id.nullable().optional(),
  notarizedOn: DAY.nullable().optional(),
  submittedOn: DAY.nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});
export const filingIdSchema = z.object({ id });
export const filingListSchema = z.object({ states: z.array(z.enum(FILING_STATES)).max(FILING_STATES.length).optional() });

export function filingStateOf(row: Pick<FilingRow, 'registeredOn' | 'interimOrders' | 'submittedOn' | 'notarizedOn'>): FilingState {
  if (row.registeredOn) return 'registered';
  if (row.interimOrders.some((o) => o.resolvedOn === null)) return 'interimOrder';
  if (row.submittedOn) return 'submitted';
  if (row.notarizedOn) return 'atNotary';
  return 'due';
}

/** Tag, bis zu dem ein Anlass vom Tag `occurredOn` angemeldet sein sollte (`governance.registerOverdueDays`, Spec § 7.1). */
export const registerDueOn = (deps: Deps, occurredOn: string): string => addCalendarDays(occurredOn, readSetting<number>(deps, 'governance.registerOverdueDays'));

export const filingOccasionsInternal = (db: DbOrTx, filingId: string): OccasionRow[] =>
  db.select().from(governanceRegisterOccasions).where(eq(governanceRegisterOccasions.filingId, filingId)).orderBy(asc(governanceRegisterOccasions.occurredOn), asc(governanceRegisterOccasions.id)).all();

export const filingRowInternal = (db: DbOrTx, filingId: string): FilingRow | undefined => db.select().from(governanceRegisterFilings).where(eq(governanceRegisterFilings.id, filingId)).get();

/** Die Anmeldung mit Zustand und Anlässen; überfällig, solange sie fällig ist und der früheste Anlass die Frist überschritten hat. */
export function filingViewInternal(db: DbOrTx, deps: Deps, row: FilingRow, today: string = todayIn(deps)): FilingView {
  const occasions = filingOccasionsInternal(db, row.id);
  const state = filingStateOf(row);
  const first = occasions[0]?.occurredOn;
  const dueOn = state === 'due' && first ? registerDueOn(deps, first) : null;
  const transparency = transparencyViewInternal(row, occasions, today, (on) => registerDueOn(deps, on));
  const warnings: FilingWarning[] = transparencyChecksOpenInternal(transparency) ? ['transparencyChecksOpen'] : [];
  if (row.submittedOn && !row.notarizedOn) warnings.push('notarizationMissing');
  const statuteIds = [...new Set(occasions.filter((o) => o.kind === 'statute' && o.statuteId).map((o) => o.statuteId!))];
  const statutes = statuteIds.map((sid) => db.select().from(governanceStatutes).where(eq(governanceStatutes.id, sid)).get()).filter((s): s is StatuteRow => !!s);
  if (statutes.some((s) => statuteViewInternal(db, deps, s, today).warnings.includes('omitsUnregistered'))) warnings.push('statuteOmitsUnregistered');
  const overdue = dueOn !== null && today > dueOn;
  // L-6: Die Frist bleibt die des ältesten Anlasses — der mitgenommene Stand ist tatsächlich überfällig —, aber die
  // Anmeldung sagt, dass er es ist, der sie überfällig macht.
  if (overdue && occasions[0] && basesOfFilingInternal(statutes, occasions).has(occasions[0].id)) warnings.push('overdueByAttached');
  return { ...row, state, occasions, dueOn, overdue, transparency, dissolution: dissolutionFactsInternal(db, row, occasions), warnings };
}

/** Anlässe der Anmeldung zu einem Stand, auf dem ein anderer Stand der Anmeldung aufbaut (mitgenommen, K-3). */
function basesOfFilingInternal(statutes: StatuteRow[], occasions: OccasionRow[]): Set<string> {
  const byId = new Map(statutes.map((s) => [s.id, s]));
  const bases = new Set(statutes.flatMap((s) => [...ancestorsOf(byId, s)]));
  return new Set(occasions.filter((o) => o.kind === 'statute' && o.statuteId && bases.has(o.statuteId)).map((o) => o.id));
}

/** Nimmt die Anlässe in die Anmeldung auf; berechnete werden dabei als Zeile angelegt. Wirft `GovernanceAborted`. */
function attachOccasionsInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, filingId: string, refs: { id?: string | undefined; termId?: string | undefined; statuteId?: string | undefined }[]): { count: number; attached: OccasionRow[] } {
  const today = todayIn(deps);
  for (const ref of refs) {
    let occasionId: string;
    if (ref.id) {
      const row = tx.select().from(governanceRegisterOccasions).where(eq(governanceRegisterOccasions.id, ref.id)).get();
      if (!row) throw new GovernanceAborted(notFound('governanceRegisterOccasion', ref.id));
      if (row.filingId !== null) throw new GovernanceAborted(governanceConflict('occasionFiled'));
      occasionId = row.id;
    } else {
      const computed: OpenOccasion | undefined = openOccasionsInternal(tx, today).find((o) => o.id === null && (ref.termId ? o.termId === ref.termId : o.statuteId === ref.statuteId));
      if (!computed) throw new GovernanceAborted(notFound('governanceRegisterOccasion', (ref.termId ?? ref.statuteId)!));
      occasionId = recordRegisterOccasionInternal(tx, deps, ctx, occasion(computed.kind, computed.occurredOn, { termId: computed.termId, officeId: computed.officeId, statuteId: computed.statuteId }));
    }
    tx.update(governanceRegisterOccasions).set({ filingId }).where(eq(governanceRegisterOccasions.id, occasionId)).run();
  }
  return { count: refs.length, attached: attachUnregisteredBasesInternal(tx, deps, ctx, filingId) };
}

/**
 * K-3: Baut ein Stand der Anmeldung auf einem beschlossenen, nie eingetragenen Stand auf, wird dessen Inhalt mit
 * eingetragen — sein offener Anlass kommt deshalb mit in die Anmeldung (sichtbar dort) und ist mit der Eintragung
 * erledigt, statt still zu verschwinden. Eingetragen wird nur der jüngste Stand (`filingStatuteIdsInternal`).
 */
export function attachUnregisteredBasesInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, filingId: string): OccasionRow[] {
  const statutes = tx.select().from(governanceStatutes).all();
  const byId = new Map(statutes.map((s) => [s.id, s]));
  const filed = new Set(filingOccasionsInternal(tx, filingId).filter((o) => o.kind === 'statute' && o.statuteId).map((o) => o.statuteId!));
  const bases = new Set([...filed].flatMap((sid) => (byId.has(sid) ? [...ancestorsOf(byId, byId.get(sid)!)] : [])));
  if (bases.size === 0) return [];
  const attached: string[] = [];
  for (const o of openOccasionsInternal(tx, todayIn(deps))) {
    if (o.kind !== 'statute' || !o.statuteId || !bases.has(o.statuteId) || filed.has(o.statuteId)) continue;
    const occasionId = o.id ?? recordRegisterOccasionInternal(tx, deps, ctx, occasion(o.kind, o.occurredOn, { termId: null, officeId: null, statuteId: o.statuteId }));
    tx.update(governanceRegisterOccasions).set({ filingId }).where(eq(governanceRegisterOccasions.id, occasionId)).run();
    attached.push(occasionId);
  }
  return filingOccasionsInternal(tx, filingId).filter((o) => attached.includes(o.id));
}

/** Die offenen Anlässe zur Registeranmeldung, gespeichert und berechnet. */
export async function listRegisterOccasions(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<OpenOccasion[]>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, registerOccasionsSchema, input ?? {});
  if (!parsed.ok) return parsed;
  return ok(openOccasionsInternal(deps.db, todayIn(deps)));
}

/** Legt eine Registeranmeldung an und bündelt darin Anlässe (Spec § 7.1); ein Anlass gehört höchstens einer Anmeldung. */
export async function createRegisterFiling(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FilingChangeView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, filingCreateSchema, input);
  if (!parsed.ok) return parsed;
  const now = isoNow(deps.clock);
  return catchAborted(() =>
    deps.db.transaction((tx: DbOrTx) => {
      const row: FilingRow = { id: newId(), notaryContactId: null, notarizedOn: null, submittedOn: null, interimOrders: [], registeredOn: null, registerCourt: null, registerNumber: null, extractDocumentId: null, documents: {}, transparency: null, dissolution: null, note: parsed.value.note ?? null, createdAt: now, updatedAt: now };
      tx.insert(governanceRegisterFilings).values(row).run();
      const { count, attached } = attachOccasionsInternal(tx, deps, ctx, row.id, parsed.value.occasions);
      recordAudit(tx, deps, ctx, { action: 'governance.register.create', entityType: 'governanceRegisterFiling', entityId: row.id, after: { occasions: filingOccasionsInternal(tx, row.id).map((o) => o.id) }, params: { occasions: count } });
      return ok({ ...filingViewInternal(tx, deps, row), attachedOccasions: attached });
    }),
  );
}

/** Nimmt weitere Anlässe in eine Anmeldung auf, bis sie eingetragen ist (Alunas Fall: Satzungsänderung nach der Zwischenverfügung). */
export async function addFilingOccasions(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FilingChangeView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, filingAddOccasionsSchema, input);
  if (!parsed.ok) return parsed;
  const before = filingRowInternal(deps.db, parsed.value.filingId);
  if (!before) return notFound('governanceRegisterFiling', parsed.value.filingId);
  if (before.registeredOn) return governanceConflict('filingRegistered');
  return catchAborted(() =>
    deps.db.transaction((tx: DbOrTx) => {
      const { count, attached } = attachOccasionsInternal(tx, deps, ctx, before.id, parsed.value.occasions);
      tx.update(governanceRegisterFilings).set({ updatedAt: isoNow(deps.clock) }).where(eq(governanceRegisterFilings.id, before.id)).run();
      recordAudit(tx, deps, ctx, { action: 'governance.register.addOccasions', entityType: 'governanceRegisterFiling', entityId: before.id, after: { occasions: filingOccasionsInternal(tx, before.id).map((o) => o.id) }, params: { count } });
      return ok({ ...filingViewInternal(tx, deps, filingRowInternal(tx, before.id)!), attachedOccasions: attached });
    }),
  );
}

/** Notar (Kontakt, Tag der Beglaubigung), Einreichung, Notiz. Eingereicht nicht vor der Beglaubigung. */
export async function updateRegisterFiling(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FilingView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, filingUpdateSchema, input);
  if (!parsed.ok) return parsed;
  const { id: filingId, ...changes } = parsed.value;
  const before = filingRowInternal(deps.db, filingId);
  if (!before) return notFound('governanceRegisterFiling', filingId);
  if (before.registeredOn) return governanceConflict('filingRegistered');
  const fields = (Object.keys(changes) as (keyof typeof changes)[]).filter((k) => changes[k] !== undefined);
  if (fields.length === 0) return invalid([{ path: '', message: 'nothingChanged' }]);
  const notarizedOn = changes.notarizedOn !== undefined ? changes.notarizedOn : before.notarizedOn;
  const submittedOn = changes.submittedOn !== undefined ? changes.submittedOn : before.submittedOn;
  if (notarizedOn && submittedOn && submittedOn < notarizedOn) return invalid([{ path: 'submittedOn', message: 'beforeNotarized' }]);
  const set = Object.fromEntries(fields.map((k) => [k, changes[k]])) as Partial<FilingRow>;
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(governanceRegisterFilings).set({ ...set, updatedAt: isoNow(deps.clock) }).where(eq(governanceRegisterFilings.id, filingId)).run();
    const was = Object.fromEntries(fields.map((k) => [k, before[k]]));
    recordAudit(tx, deps, ctx, { action: 'governance.register.update', entityType: 'governanceRegisterFiling', entityId: filingId, before: was, after: set, params: { fields: fields.join(', ') } });
    return ok(filingViewInternal(tx, deps, filingRowInternal(tx, filingId)!));
  });
}

export async function getRegisterFiling(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FilingView>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, filingIdSchema, input);
  if (!parsed.ok) return parsed;
  const row = filingRowInternal(deps.db, parsed.value.id);
  if (!row) return notFound('governanceRegisterFiling', parsed.value.id);
  return ok(filingViewInternal(deps.db, deps, row));
}

/** Alle Anmeldungen, älteste zuerst; `states` filtert nach dem berechneten Zustand. */
export async function listRegisterFilings(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FilingView[]>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, filingListSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const today = todayIn(deps);
  const rows = deps.db.select().from(governanceRegisterFilings).orderBy(asc(governanceRegisterFilings.createdAt), asc(governanceRegisterFilings.id)).all();
  const views = rows.map((r) => filingViewInternal(deps.db, deps, r, today));
  const states = parsed.value.states;
  return ok(states ? views.filter((v) => states.includes(v.state)) : views);
}
