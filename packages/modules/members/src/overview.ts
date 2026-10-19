import { notFound, ok, readLocales, readSetting, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { dispatchMap } from './dunning-levels';
import { feeScheduleAt } from './fee-schedule';
import { mandateRowInternal, mandateState, type MandateState } from '@kompass/module-finance';
import { z } from 'zod';
import { agreementAt, effectiveFee } from './fee-agreement';
import { feeViewsInternal, liveCharges } from './fees';
import { filterMemberships, type MembershipView } from './memberships';
import { memberDunningNotices, memberMemberships, PAYMENT_METHODS, type FeeInterval, type FeeReduction, type PaymentMethod } from './schema';
import type { DunningLevel } from './settings';
import type { MembershipStatus } from './status';

/** Die drei Reiter der Mitgliederliste (Handoff Mitglieder 2.1): laufend, Anträge, beendet. */
export const MEMBER_LIST_VIEWS = ['members', 'applications', 'left'] as const;
export type MemberListView = (typeof MEMBER_LIST_VIEWS)[number];
const VIEW_STATUSES: Record<MemberListView, MembershipStatus[]> = { members: ['active', 'ending'], applications: ['applied'], left: ['ended'] };

const PER_YEAR: Record<FeeInterval, number> = { yearly: 1, halfYearly: 2, quarterly: 4, monthly: 12 };

export const memberOverviewSchema = z.object({
  view: z.enum(MEMBER_LIST_VIEWS).default('members'),
  search: z.string().trim().max(200).optional(),
  typeId: z.string().min(1).optional(),
  /** Nur im Reiter „Mitglieder“: Zahlweg der geltenden Vereinbarung. */
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  /** Nur im Reiter „Mitglieder“: mindestens ein überfälliger Beitrag. */
  onlyArrears: z.boolean().optional(),
  /** Nur im Reiter „Anträge“: auch abgelehnte zeigen (Vorgabe nur offene). */
  includeRejected: z.boolean().optional(),
  orderBy: z.object({ field: z.enum(['name', 'number']), direction: z.enum(['asc', 'desc']) }).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

/** Rückstand einer Mitgliedschaft: die höchste erreichte Mahnstufe, sonst nur „überfällig“ (Handoff D2). */
export interface MemberArrears {
  openCents: number;
  levelKey: string | null;
  levelName: string | null;
  /** Die letzte Stufe der Einstellung — sie trägt `error`, die übrigen `warning`. */
  lastLevel: boolean;
}

/** Eine Zeile der Mitgliederliste: Mitgliedschaft mit Zahlweg, Beitrag je Jahr, Rückstand und Unterlagen. */
export interface MemberOverviewRow extends MembershipView {
  /** `null` bei beitragsfreien Mitgliedern (kein Zahlweg) und ohne Regel. */
  paymentMethod: PaymentMethod | null;
  /** Beitrag je Jahr nach Vereinbarung oder Ordnung; `null` ohne Regel oder beitragsfrei. */
  yearlyCents: number | null;
  exempt: boolean;
  arrears: MemberArrears | null;
  /** Zustand des Mandats der Vereinbarung (Lastschrift), sonst `null`. */
  mandateState: MandateState | null;
}

export interface MemberOverview {
  items: MemberOverviewRow[];
  total: number;
  /** Treffer je Reiter mit den Filtern, die der Reiter kennt — was ein Klick zeigen würde (MUSTER § L). */
  counts: Record<MemberListView, number>;
}

/** Zahlweg, Beitrag und Mandat am Tag `on`, für die Liste und den Export. */
function feeSummary(db: DbOrTx, view: MembershipView, on: string): Pick<MemberOverviewRow, 'paymentMethod' | 'yearlyCents' | 'exempt' | 'mandateState'> {
  const fee = effectiveFee(db, view.id, on);
  const agreement = agreementAt(db, view.id, on);
  const mandate = agreement?.mandateId ? mandateRowInternal(db, agreement.mandateId) : null;
  const mandateStateOn = mandate ? mandateState(mandate, on) : null;
  if ('none' in fee) return { paymentMethod: agreement?.paymentMethod ?? null, yearlyCents: null, exempt: false, mandateState: mandateStateOn };
  if (fee.exempt) return { paymentMethod: null, yearlyCents: null, exempt: true, mandateState: null };
  return { paymentMethod: fee.paymentMethod, yearlyCents: fee.amountCents * PER_YEAR[fee.interval], exempt: false, mandateState: mandateStateOn };
}

/** Der Tag, an dem Zahlweg und Beitrag gelesen werden: heute, bei einem Antrag der gewünschte Beginn. */
const summaryDay = (view: MembershipView, today: string): string => (view.status === 'applied' && view.appliedOn && view.appliedOn > today ? view.appliedOn : today);

/** Rückstände je Mitgliedschaft aus den überfälligen Beiträgen; die Stufe ist die höchste erreichte. */
function arrearsOf(db: DbOrTx, deps: Deps, membershipIds: string[]): Map<string, MemberArrears> {
  const out = new Map<string, MemberArrears>();
  if (membershipIds.length === 0) return out;
  const wanted = new Set(membershipIds);
  const charges = liveCharges(db).filter((c) => wanted.has(c.membershipId));
  const levels = readSetting<DunningLevel[]>(deps, 'members.dunningLevels');
  const order = levels.map((l) => l.key);
  const leading = readLocales(deps)[0]!;
  for (const fee of feeViewsInternal(db, deps, charges)) {
    if (!fee.overdue && fee.dunningLevel === null) continue;
    if (fee.openCents <= 0) continue;
    const current = out.get(fee.membershipId) ?? { openCents: 0, levelKey: null, levelName: null, lastLevel: false };
    current.openCents += fee.openCents;
    const rank = fee.dunningLevel ? order.indexOf(fee.dunningLevel) : -1;
    if (rank >= 0 && (current.levelKey === null || rank > order.indexOf(current.levelKey))) {
      const level = levels[rank]!;
      current.levelKey = level.key;
      current.levelName = level.name[leading] || Object.values(level.name).find((v) => v) || level.key;
      current.lastLevel = rank === order.length - 1;
    }
    out.set(fee.membershipId, current);
  }
  return out;
}

/** Zeilen mit Zahlweg, Beitrag, Rückstand (intern, ohne Rechteprüfung). */
export function memberOverviewRowsInternal(db: DbOrTx, deps: Deps, views: MembershipView[]): MemberOverviewRow[] {
  const today = todayIn(deps);
  const arrears = arrearsOf(db, deps, views.map((v) => v.id));
  return views.map((v) => ({ ...v, ...feeSummary(db, v, summaryDay(v, today)), arrears: arrears.get(v.id) ?? null }));
}

/**
 * Die Mitgliederliste (Handoff Mitglieder 2.1, D8): ein Reiter, Suche über Name und Nummer, Art; im Reiter „Mitglieder“
 * dazu Zahlweg und „Nur mit Rückstand“. Die Zahlen je Reiter folgen den Filtern, die der jeweilige Reiter kennt.
 */
export async function listMemberOverview(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MemberOverview>> {
  const denied = requirePermission(ctx, 'members.read');
  if (denied) return denied;
  const parsed = validate(deps, memberOverviewSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const rowsOf = (view: MemberListView): MemberOverviewRow[] => {
    const status = view === 'applications' && v.includeRejected ? [...VIEW_STATUSES.applications, 'rejected' as const] : VIEW_STATUSES[view];
    const base = filterMemberships(deps, { status, search: v.search, ...(view === 'applications' ? {} : { typeId: v.typeId }) });
    const rows = memberOverviewRowsInternal(deps.db, deps, base);
    if (view !== 'members') return rows;
    return rows.filter((r) => (!v.paymentMethod || r.paymentMethod === v.paymentMethod) && (!v.onlyArrears || r.arrears !== null));
  };
  const all = { members: rowsOf('members'), applications: rowsOf('applications'), left: rowsOf('left') };
  const rows = [...all[v.view]];
  if (v.orderBy) {
    const dir = v.orderBy.direction === 'asc' ? 1 : -1;
    const key = (r: MemberOverviewRow) => (v.orderBy!.field === 'number' ? (r.memberNumber ?? '') : r.contactName);
    rows.sort((a, b) => dir * key(a).localeCompare(key(b), 'de') || a.id.localeCompare(b.id));
  }
  return ok({
    items: rows.slice(v.offset, v.offset + v.limit),
    total: rows.length,
    counts: { members: all.members.length, applications: all.applications.length, left: all.left.length },
  });
}

/** Beitrag am Mitglied (Handoff Mitglieder D1, 3a/3c): was gilt, woher, wie bezahlt; dazu der Rückstand mit Stufen. */
export interface MemberFeeDetail {
  fee:
    | { kind: 'exempt' }
    | { kind: 'none' }
    | { kind: 'fee'; amountCents: number; interval: FeeInterval; source: 'schedule' | 'agreement'; scheduleValidFrom: string | null };
  paymentMethod: PaymentMethod;
  reduction: FeeReduction;
  /** Ab wann die geltende Vereinbarung gilt — `null` ohne Vereinbarung. */
  agreementFrom: string | null;
  mandate: { id: string; reference: string; state: MandateState } | null;
  /** Offene, überfällige Beiträge und die versandten Stufen (3c); `null` ohne Rückstand. */
  arrears: { openCents: number; charges: { period: string; dueOn: string; openCents: number }[]; steps: { levelName: string; sentOn: string }[]; lastLevel: boolean } | null;
}

export async function getMemberFeeDetail(deps: Deps, ctx: CallContext, membershipId: string): Promise<Result<MemberFeeDetail>> {
  const denied = requirePermission(ctx, 'members.read');
  if (denied) return denied;
  const row = deps.db.select().from(memberMemberships).where(eq(memberMemberships.id, membershipId)).get();
  if (!row) return notFound('membership', membershipId);
  const today = todayIn(deps);
  const on = row.joinedOn && row.joinedOn > today ? row.joinedOn : row.appliedOn && !row.joinedOn && row.appliedOn > today ? row.appliedOn : today;
  const effective = effectiveFee(deps.db, row.id, on);
  const agreement = agreementAt(deps.db, row.id, on);
  const mandateRow = agreement?.mandateId ? mandateRowInternal(deps.db, agreement.mandateId) : null;
  const schedule = feeScheduleAt(deps.db, on);
  const fee: MemberFeeDetail['fee'] = 'none' in effective ? { kind: 'none' } : effective.exempt ? { kind: 'exempt' } : { kind: 'fee', amountCents: effective.amountCents, interval: effective.interval, source: effective.source, scheduleValidFrom: schedule?.validFrom ?? null };

  const fees = feeViewsInternal(deps.db, deps, liveCharges(deps.db).filter((c) => c.membershipId === row.id)).filter((f) => f.openCents > 0 && (f.overdue || f.dunningLevel !== null));
  let arrears: MemberFeeDetail['arrears'] = null;
  if (fees.length > 0) {
    const levels = readSetting<DunningLevel[]>(deps, 'members.dunningLevels');
    const leading = readLocales(deps)[0]!;
    const chargeIds = new Set(fees.map((f) => f.chargeId));
    const notices = deps.db.select().from(memberDunningNotices).where(eq(memberDunningNotices.membershipId, row.id)).all().filter((n) => n.chargeIds.some((id) => chargeIds.has(id)));
    const sent = dispatchMap(deps.db, notices.map((n) => n.documentId));
    const steps = notices
      .flatMap((n) => {
        const sentOn = sent.get(n.documentId) ?? null;
        const level = levels.find((l) => l.key === n.levelKey);
        return sentOn && level ? [{ levelName: level.name[leading] || Object.values(level.name).find((v) => v) || level.key, sentOn, rank: levels.indexOf(level) }] : [];
      })
      .sort((a, b) => a.sentOn.localeCompare(b.sentOn));
    const top = Math.max(-1, ...steps.map((s) => s.rank));
    arrears = {
      openCents: fees.reduce((s, f) => s + f.openCents, 0),
      charges: fees.map((f) => ({ period: f.period, dueOn: f.dueOn, openCents: f.openCents })).sort((a, b) => a.dueOn.localeCompare(b.dueOn)),
      steps: steps.map(({ levelName, sentOn }) => ({ levelName, sentOn })),
      lastLevel: top >= 0 && top === levels.length - 1,
    };
  }
  return ok({
    fee,
    paymentMethod: agreement?.paymentMethod ?? 'transfer',
    reduction: agreement?.reduction ?? 'none',
    agreementFrom: agreement?.validFrom ?? null,
    mandate: mandateRow ? { id: mandateRow.id, reference: mandateRow.reference, state: mandateState(mandateRow, today) } : null,
    arrears,
  });
}
