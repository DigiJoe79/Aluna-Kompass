import { fail, invalid, isoNow, newId, notFound, ok, recordAudit, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contactRoles, contacts, endRoleRowInternal, setRoleRowRepresentationInternal, startRoleRowInternal } from '@kompass/module-contacts';
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { catchAborted, GovernanceAborted, governanceConflict } from './errors';
import { governanceOffices, governanceTerms, TERM_END_REASONS, TERM_ORIGINS, type OfficeRow, type TermEndReason, type TermOrigin, type TermRow } from './schema';
import { occasion, recordRegisterOccasionInternal } from './seal/occasions';
import { substitutionAllowedOn } from './statutes';
import { roleNote, rolesForFunction } from './term-roles';

const DAY = z.iso.date();

export interface TermView {
  id: string;
  officeId: string;
  contactId: string;
  since: string;
  until: string | null;
  origin: TermOrigin;
  acceptedOn: string | null;
  endReason: TermEndReason | null;
  endReceivedOn: string | null;
  documentId: string | null;
  /** Berechnet am Tag `on` bzw. heute. */
  running: boolean;
}
/** Hinweise, keine Sperren (Spec § 3.2, § 3.3). */
export type TermWarning = 'incompatible' | 'substitutionWithoutStatute';
export type StartedTerm = TermView & { warnings: TermWarning[] };
/** `resignationDocumentMissing`: Rücktritt ohne Dokument — der Zugang der Erklärung ist nicht belegt (G-25). */
export type TermEndWarning = 'resignationDocumentMissing';
export type EndedTerm = TermView & { warnings: TermEndWarning[] };

export const termStartSchema = z.object({
  officeId: z.string().min(1),
  contactId: z.string().min(1),
  since: DAY,
  /** `elected` entsteht nur aus einer Wahl in einer Sitzung (ab G4). */
  origin: z.enum(TERM_ORIGINS).exclude(['elected']),
  documentId: z.string().min(1).optional(),
  note: z.string().trim().max(500).optional(),
});
export const termEndSchema = z.object({
  id: z.string().min(1),
  until: DAY,
  reason: z.enum(TERM_END_REASONS),
  /** Zugang der Niederlegung — Pflicht bei `resigned` (§ 26 Abs. 2 S. 2 BGB). */
  receivedOn: DAY.optional(),
  documentId: z.string().min(1).optional(),
});
export const termListSchema = z.object({ officeId: z.string().min(1).optional(), contactId: z.string().min(1).optional(), on: DAY.optional() });
export const rolesAdoptSchema = z.object({ items: z.array(z.object({ rowId: z.string().min(1), officeId: z.string().min(1) })).min(1).max(50) });

const covers = (t: Pick<TermRow, 'since' | 'until'>, day: string) => t.since <= day && (t.until === null || t.until >= day);
const overlaps = (t: Pick<TermRow, 'since' | 'until'>, since: string, until: string | null) => (until === null || t.since <= until) && (t.until === null || t.until >= since);

export const termView = (row: TermRow, day: string): TermView => ({
  id: row.id,
  officeId: row.officeId,
  contactId: row.contactId,
  since: row.since,
  until: row.until,
  origin: row.origin,
  acceptedOn: row.acceptedOn,
  endReason: row.endReason,
  endReceivedOn: row.endReceivedOn,
  documentId: row.documentId,
  running: covers(row, day),
});

const abort = (failure: ReturnType<typeof fail>): never => {
  throw new GovernanceAborted(failure);
};

function loadOfficeOrAbort(tx: DbOrTx, id: string): OfficeRow {
  return tx.select().from(governanceOffices).where(eq(governanceOffices.id, id)).get() ?? abort(notFound('governanceOffice', id));
}

/** Mehr Inhaber als Plätze an einem Tag des Zeitraums → `officeFull`. Geprüft an jedem Tag, an dem eine Inhaberschaft beginnt. */
function assertSeat(tx: DbOrTx, office: OfficeRow, since: string, until: string | null): void {
  const others = tx.select().from(governanceTerms).where(eq(governanceTerms.officeId, office.id)).all().filter((t) => overlaps(t, since, until));
  const days = [since, ...others.map((t) => t.since).filter((d) => d > since && (until === null || d <= until))];
  if (days.some((day) => others.filter((t) => covers(t, day)).length + 1 > office.seats)) abort(governanceConflict('officeFull', { seats: office.seats }));
}

/** Unvereinbarkeit in beide Richtungen (Kassenprüfung nennt die Vorstandsämter, nicht umgekehrt). */
function incompatible(tx: DbOrTx, office: OfficeRow, contactId: string, since: string, until: string | null): boolean {
  const held = tx.select().from(governanceTerms).where(eq(governanceTerms.contactId, contactId)).all().filter((t) => t.officeId !== office.id && overlaps(t, since, until));
  if (held.length === 0) return false;
  const offices = tx.select().from(governanceOffices).where(inArray(governanceOffices.id, held.map((t) => t.officeId))).all();
  return offices.some((o) => office.incompatibleWith.includes(o.id) || o.incompatibleWith.includes(office.id));
}

function insertTerm(tx: DbOrTx, deps: Deps, row: Omit<TermRow, 'id' | 'createdAt' | 'updatedAt'>): TermRow {
  const now = isoNow(deps.clock);
  const full: TermRow = { id: newId(), ...row, createdAt: now, updatedAt: now };
  tx.insert(governanceTerms).values(full).run();
  return full;
}

const BOARD_ROLE = 'board-member';
/** „Vertritt nach § 26 BGB“ steht nur an der Vorstandsrolle eines vertretenden Amts (G7) — nie an `treasurer`. */
const representsOn = (office: Pick<OfficeRow, 'representative'>, role: string): boolean => office.representative && role === BOARD_ROLE;

/**
 * Beginnt eine Amtsinhaberschaft samt den Kontaktrollen, die aus dem Amt folgen (Spec § 3.4), in der Transaktion des
 * Aufrufers. Fachliche Ablehnungen werfen `GovernanceAborted` — G4 (`sealMeeting`) verlässt sich darauf.
 */
export function startTermInternal(
  tx: DbOrTx,
  deps: Deps,
  ctx: CallContext,
  input: { officeId: string; contactId: string; since: string; origin: TermOrigin; acceptedOn?: string; resolutionId?: string; documentId?: string; note?: string },
): StartedTerm {
  const office = loadOfficeOrAbort(tx, input.officeId);
  if (!tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, input.contactId)).get()) abort(notFound('contact', input.contactId));
  assertSeat(tx, office, input.since, null);
  const warnings: TermWarning[] = [];
  if (incompatible(tx, office, input.contactId, input.since, null)) warnings.push('incompatible');
  if (input.origin === 'substitute' && !substitutionAllowedOn(tx, office.organId, input.since)) warnings.push('substitutionWithoutStatute');
  const roleRowIds = rolesForFunction(office.function).map((role) =>
    startRoleRowInternal(tx, deps, ctx, { contactId: input.contactId, role, since: input.since, note: roleNote(role, office.name), representsAssociation: representsOn(office, role) }),
  );
  const row = insertTerm(tx, deps, {
    officeId: office.id,
    contactId: input.contactId,
    since: input.since,
    until: null,
    origin: input.origin,
    acceptedOn: input.acceptedOn ?? null,
    resolutionId: input.resolutionId ?? null,
    endReason: null,
    endReceivedOn: null,
    documentId: input.documentId ?? null,
    roleRowIds,
    note: input.note ?? null,
  });
  recordAudit(tx, deps, ctx, { action: 'governance.term.start', entityType: 'governanceTerm', entityId: row.id, after: { officeId: office.id, origin: row.origin, since: row.since }, params: { origin: row.origin, since: row.since, contactId: row.contactId } });
  return { ...termView(row, todayIn(deps)), warnings };
}

/** Beginnt eine Amtsinhaberschaft ohne Wahl: Nachtrag, Berufung, Ersatz- oder Notbestellung. */
export async function startTerm(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<StartedTerm>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, termStartSchema, input);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  const res = catchAborted(() =>
    deps.db.transaction((tx: DbOrTx) => {
      const started = startTermInternal(tx, deps, ctx, value);
      // § 67 BGB: Berufung und Ersatzbestellung eines vertretenden Amts sind anzumelden; die gerichtliche Bestellung
      // (§ 29) trägt das Gericht von Amts wegen ein (§ 67 Abs. 2), ein Nachtrag ist schon geschehen.
      if (REGISTERED_ORIGINS.includes(value.origin) && loadOfficeOrAbort(tx, value.officeId).representative) recordRegisterOccasionInternal(tx, deps, ctx, occasion('boardChange', value.since, { termId: started.id, officeId: value.officeId }));
      return started;
    }),
  );
  return 'ok' in res && res.ok === false ? res : ok(res as StartedTerm);
}

/** Beendet eine Amtsinhaberschaft und genau ihre Rollenzeilen, in der Transaktion des Aufrufers. */
export function endTermInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, input: { id: string; until: string; reason: TermEndReason; receivedOn?: string; documentId?: string }): TermView {
  const before = tx.select().from(governanceTerms).where(eq(governanceTerms.id, input.id)).get() ?? abort(notFound('governanceTerm', input.id));
  if (input.until < before.since) abort(invalid([{ path: 'until', message: 'untilBeforeFrom' }]));
  if (input.reason === 'resigned' && !input.receivedOn) abort(invalid([{ path: 'receivedOn', message: 'required' }]));
  tx.update(governanceTerms)
    .set({ until: input.until, endReason: input.reason, endReceivedOn: input.receivedOn ?? null, documentId: input.documentId ?? before.documentId, updatedAt: isoNow(deps.clock) })
    .where(eq(governanceTerms.id, before.id))
    .run();
  for (const rowId of before.roleRowIds) endRoleRowInternal(tx, deps, ctx, { rowId, until: input.until });
  recordAudit(tx, deps, ctx, {
    action: 'governance.term.end',
    entityType: 'governanceTerm',
    entityId: before.id,
    before: { until: before.until, endReason: before.endReason },
    after: { until: input.until, endReason: input.reason, endReceivedOn: input.receivedOn ?? null },
    params: { until: input.until, reason: input.reason, contactId: before.contactId },
  });
  return termView(tx.select().from(governanceTerms).where(eq(governanceTerms.id, before.id)).get()!, todayIn(deps));
}

/** Rücktritt, Abberufung, Tod, Ablauf: setzt das Ende der Inhaberschaft und ihrer Kontaktrollen. */
export async function endTerm(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<EndedTerm>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, termEndSchema, input);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  const res = catchAborted(() =>
    deps.db.transaction((tx: DbOrTx) => {
      const ended = endTermInternal(tx, deps, ctx, value);
      // Rücktritt, Tod, Abberufung eines vertretenden Amts: anzumelden (§ 67 BGB); ein Ablauf rechnet G5.
      if (REGISTERED_END_REASONS.includes(value.reason) && loadOfficeOrAbort(tx, ended.officeId).representative) recordRegisterOccasionInternal(tx, deps, ctx, occasion('boardChange', value.until, { termId: ended.id, officeId: ended.officeId }));
      return ended;
    }),
  );
  if ('ok' in res && res.ok === false) return res;
  const ended = res as TermView;
  const warnings: TermEndWarning[] = ended.endReason === 'resigned' && !ended.documentId ? ['resignationDocumentMissing'] : [];
  return ok({ ...ended, warnings });
}

/** Herkünfte und Endgründe ohne Beschluss, die bei einem vertretenden Amt einen Registeranlass auslösen (Spec § 6). */
const REGISTERED_ORIGINS: readonly TermOrigin[] = ['substitute', 'appointed'];
const REGISTERED_END_REASONS: readonly TermEndReason[] = ['resigned', 'died', 'dismissed'];

/**
 * Hängt einen Beschluss an eine bestehende Inhaberschaft (Abgleich beim Nachtragen, Plan G4 Review Focus 1): Herkunft
 * wird „gewählt“, der Beleg ist jetzt der Beschluss; Beginn und Rollenzeilen bleiben.
 */
export function linkTermToResolutionInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, input: { termId: string; resolutionId: string; acceptedOn: string }): TermView {
  const before = tx.select().from(governanceTerms).where(eq(governanceTerms.id, input.termId)).get() ?? abort(notFound('governanceTerm', input.termId));
  tx.update(governanceTerms).set({ resolutionId: input.resolutionId, acceptedOn: input.acceptedOn, origin: 'elected', updatedAt: isoNow(deps.clock) }).where(eq(governanceTerms.id, before.id)).run();
  recordAudit(tx, deps, ctx, {
    action: 'governance.term.link',
    entityType: 'governanceTerm',
    entityId: before.id,
    before: { origin: before.origin, resolutionId: before.resolutionId, acceptedOn: before.acceptedOn },
    after: { origin: 'elected', resolutionId: input.resolutionId, acceptedOn: input.acceptedOn },
    params: { acceptedOn: input.acceptedOn, contactId: before.contactId },
  });
  return termView(tx.select().from(governanceTerms).where(eq(governanceTerms.id, before.id)).get()!, todayIn(deps));
}

/** Die Amtsinhaberschaften, nach Beginn; `running` am Tag `on` (Vorgabe heute). */
export async function listTerms(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<TermView[]>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, termListSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const { officeId, contactId, on } = parsed.value;
  const where: SQL[] = [];
  if (officeId) where.push(eq(governanceTerms.officeId, officeId));
  if (contactId) where.push(eq(governanceTerms.contactId, contactId));
  const rows = deps.db.select().from(governanceTerms).where(and(...where)).orderBy(asc(governanceTerms.since), asc(governanceTerms.id)).all();
  const day = on ?? todayIn(deps);
  return ok(rows.map((r) => termView(r, day)));
}

/**
 * Übernahme (Spec § 3.4): ordnet vorhandene Rollenzeilen Ämtern zu, ohne sie doppelt anzulegen. Je Kontakt und Amt
 * entsteht **eine** Inhaberschaft `backfilled` — die Kasse hat zwei Zeilen (`board-member`, `treasurer`). Beginn ist
 * der früheste der Zeilen, das Ende muss bei allen gleich sein. Fehlt eine Rolle des Amts, wird sie ergänzt.
 */
export async function adoptRoleRows(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<TermView[]>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, rolesAdoptSchema, input);
  if (!parsed.ok) return parsed;
  const items = parsed.value.items;
  if (new Set(items.map((i) => i.rowId)).size !== items.length) return invalid([{ path: 'items', message: 'duplicateRows' }]);
  const res = catchAborted(() =>
    deps.db.transaction((tx: DbOrTx) => {
      const adopted = new Set(tx.select({ ids: governanceTerms.roleRowIds }).from(governanceTerms).all().flatMap((t) => t.ids));
      const groups = new Map<string, { office: OfficeRow; contactId: string; rows: (typeof contactRoles.$inferSelect)[] }>();
      items.forEach((item, index) => {
        const row = tx.select().from(contactRoles).where(eq(contactRoles.id, item.rowId)).get() ?? abort(notFound('contactRole', item.rowId));
        if (adopted.has(row.id)) abort(governanceConflict('roleRowAdopted'));
        const office = loadOfficeOrAbort(tx, item.officeId);
        if (!rolesForFunction(office.function).includes(row.role)) abort(invalid([{ path: `items.${index}.officeId`, message: 'roleMismatch' }]));
        const key = `${row.contactId}:${office.id}`;
        const group = groups.get(key) ?? { office, contactId: row.contactId, rows: [] };
        group.rows.push(row);
        groups.set(key, group);
      });
      const today = todayIn(deps);
      return [...groups.values()].map(({ office, contactId, rows }) => {
        const untils = new Set(rows.map((r) => r.until));
        if (untils.size > 1) abort(invalid([{ path: 'items', message: 'rowsDiffer' }]));
        const until = [...untils][0] ?? null;
        const since = rows.map((r) => r.since).sort()[0]!;
        assertSeat(tx, office, since, until);
        const present = new Set(rows.map((r) => r.role));
        const added = rolesForFunction(office.function)
          .filter((role) => !present.has(role))
          .map((role) => {
            const id = startRoleRowInternal(tx, deps, ctx, { contactId, role, since, note: roleNote(role, office.name), representsAssociation: representsOn(office, role) });
            if (until !== null) endRoleRowInternal(tx, deps, ctx, { rowId: id, until });
            return id;
          });
        // Übernommene Zeilen folgen der Vertretungsregel des Amts, soweit sie noch laufen; beendete bleiben Geschichte.
        for (const r of rows) if (r.role === BOARD_ROLE && (r.until === null || r.until >= today)) setRoleRowRepresentationInternal(tx, deps, ctx, { rowId: r.id, representsAssociation: office.representative });
        const row = insertTerm(tx, deps, {
          officeId: office.id,
          contactId,
          since,
          until,
          origin: 'backfilled',
          acceptedOn: null,
          resolutionId: null,
          endReason: null,
          endReceivedOn: null,
          documentId: null,
          roleRowIds: [...rows.map((r) => r.id), ...added],
          note: null,
        });
        recordAudit(tx, deps, ctx, { action: 'governance.term.adopt', entityType: 'governanceTerm', entityId: row.id, after: { officeId: office.id, since, until, roleRowIds: row.roleRowIds }, params: { count: rows.length } });
        return termView(row, today);
      });
    }),
  );
  return Array.isArray(res) ? ok(res) : res;
}
