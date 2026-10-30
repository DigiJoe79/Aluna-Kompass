import { isoDayIn, notFound, ok, requirePermission, schema, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { documents } from '@kompass/module-dms';
import { financePartnerPayments, financeReserves } from '@kompass/module-finance';
import { memberFeeSchedules } from '@kompass/module-members';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { electionViewInternal } from './elections';
import { minutesVersionsInternal } from './minutes/signed';
import { contactNameInternal } from './minutes/compose';
import { filingStateOf, type FilingState } from './register/filings';
import { againstCount, listResolutions, resolutionIdSchema, resolutionViewInternal, TAX_RELEVANT_KINDS, type ResolutionView } from './resolutions';
import type { ElectionDetails } from './resolution-details';
import type { ResolutionKind } from './rules/schema';
import {
  governanceAgendaItems,
  governanceCirculars,
  governanceMeetings,
  governanceOffices,
  governanceOrgans,
  governanceRegisterFilings,
  governanceRegisterOccasions,
  governanceResolutions,
  governanceStatutes,
  type OrganKind,
  type ResolutionOutcome,
  type ResolutionRow,
} from './schema';
import { statuteViewInternal, type StatuteState } from './statutes';

export interface ResolutionRowView {
  id: string;
  number: string | null;
  decidedOn: string;
  organId: string;
  organName: string;
  organKind: OrganKind;
  kind: ResolutionKind;
  /** Titel des TOP, sonst erste Zeile des Antragstexts (höchstens 120 Zeichen). */
  subject: string;
  outcome: ResolutionOutcome | null;
  againstCount: boolean;
  taxRelevant: boolean;
  source: { kind: 'meeting'; meetingId: string; itemPosition: number | null } | { kind: 'circular'; circularId: string };
  /** Wahl: Amt, Gewählte mit Annahme, Stichwahl ja/nein. */
  election: { office: string; elected: string[]; runoff: boolean } | null;
}

const firstLine = (text: string) => (text.split('\n').find((l) => l.trim() !== '') ?? '').trim().slice(0, 120);

export function resolutionRowViewInternal(db: DbOrTx, view: ResolutionView): ResolutionRowView {
  const organ = db.select().from(governanceOrgans).where(eq(governanceOrgans.id, view.organId)).get();
  const item = view.agendaItemId ? db.select().from(governanceAgendaItems).where(eq(governanceAgendaItems.id, view.agendaItemId)).get() : undefined;
  let election: ResolutionRowView['election'] = null;
  if (view.kind === 'election' && view.details) {
    const d = view.details as ElectionDetails;
    const office = db.select().from(governanceOffices).where(eq(governanceOffices.id, d.officeId)).get();
    election = { office: office?.name ?? '', elected: d.elected.filter((e) => e.acceptedOn !== null).map((e) => contactNameInternal(db, e.contactId) ?? ''), runoff: d.rounds.some((r) => r.runoff) };
  }
  return {
    id: view.id,
    number: view.number,
    decidedOn: view.decidedOn,
    organId: view.organId,
    organName: organ?.name ?? '',
    organKind: organ?.kind ?? 'other',
    kind: view.kind,
    subject: item?.title ?? firstLine(view.text),
    outcome: view.outcome,
    againstCount: againstCount(view.outcome, view.evaluation),
    taxRelevant: TAX_RELEVANT_KINDS.includes(view.kind),
    source: view.circularId ? { kind: 'circular', circularId: view.circularId } : { kind: 'meeting', meetingId: view.meetingId ?? '', itemPosition: item?.position ?? null },
    election,
  };
}

/** Die Beschlussliste der Oberfläche (Plan U2): nur festgestellte, neueste zuerst, Filter wie `listResolutions`. */
export async function listResolutionRows(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ResolutionRowView[]>> {
  const res = await listResolutions(deps, ctx, input);
  if (!res.ok) return res;
  // Eine Wahl stellt kein `outcome` fest, ihr Ergebnis kommt aus den Wahlgängen (0.5.0 Nr. 28).
  const rows = res.value.filter((r) => r.outcome !== null || r.kind === 'election').map((r) => resolutionRowViewInternal(deps.db, r));
  return ok(rows.sort((a, b) => b.decidedOn.localeCompare(a.decidedOn) || (b.number ?? '').localeCompare(a.number ?? '')));
}

export interface ResolutionContext {
  resolution: ResolutionView;
  row: ResolutionRowView;
  /** Leitung aus den Feststellungen der Sitzung bzw. wer den Umlauf feststellte. */
  decidedBy: string | null;
  minutes: { documentId: string; number: string | null; signedOn: string | null } | null;
  statute: { id: string; state: StatuteState } | null;
  filings: { id: string; state: FilingState; createdOn: string }[];
  followUps: { id: string; dueAt: string; doneAt: string | null; title: string }[];
  /**
   * W-13: wo der Beschluss verwendet wird — Rücklage (Name), Stand der Beitragsordnung (gilt ab) und Partnerzahlung
   * (Nummer, leer vor der Freigabe), berechnet.
   */
  usedBy: { kind: 'reserve' | 'feeSchedule' | 'partnerPayment'; id: string; label: string }[];
  /** Ausgeschlossene und Personen der Angaben. */
  names: Record<string, string>;
  /** Bei einer Wahl das Ergebnis: je Wahlgang die Stimmen und die nötige Zahl (0 bei „einstimmig“), die Gewählten mit ihrer Erklärung. */
  election: ElectionResult | null;
}

export interface ElectionResult {
  rounds: { number: number; runoff: boolean; candidates: { name: string; votes: number }[]; no: number; abstain: number; invalid: number; unanimous: string | null; needed: number }[];
  elected: { name: string; acceptedOn: string | null; declinedOn: string | null }[];
}

function electionResultInternal(db: DbOrTx, deps: Deps, row: ResolutionRow): ElectionResult | null {
  if (row.kind !== 'election' || !row.details) return null;
  const details = row.details as ElectionDetails;
  const view = electionViewInternal(db, deps, row);
  const name = (id: string): string => contactNameInternal(db, id) ?? '';
  return {
    rounds: details.rounds.map((r, i) => ({
      number: r.number,
      runoff: r.runoff,
      candidates: r.candidates.map((c) => ({ name: name(c.contactId), votes: c.votes })),
      no: r.no,
      abstain: r.abstain,
      invalid: r.invalid,
      unanimous: r.unanimousContactId ? name(r.unanimousContactId) : null,
      needed: view.rounds[i]?.needed ?? 0,
    })),
    elected: details.elected.map((e) => ({ name: name(e.contactId), acceptedOn: e.acceptedOn, declinedOn: e.declinedOn })),
  };
}

const contactIdsIn = (value: unknown): string[] => {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => {
    if (typeof v === 'string' && (k === 'contactId' || k.endsWith('ContactId'))) return [v];
    if (Array.isArray(v)) return k === 'contactIds' || k.endsWith('ContactIds') ? v.filter((x): x is string => typeof x === 'string') : v.flatMap(contactIdsIn);
    return typeof v === 'object' ? contactIdsIn(v) : [];
  });
};

/** Ein Beschluss mit allen Verweisen für die Lesesicht (Plan U2). */
export async function getResolutionContext(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ResolutionContext>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, resolutionIdSchema, input);
  if (!parsed.ok) return parsed;
  const db = deps.db;
  const row: ResolutionRow | undefined = db.select().from(governanceResolutions).where(eq(governanceResolutions.id, parsed.value.id)).get();
  if (!row) return notFound('governanceResolution', parsed.value.id);
  const resolution = resolutionViewInternal(db, deps, row);
  const meeting = row.meetingId ? db.select().from(governanceMeetings).where(eq(governanceMeetings.id, row.meetingId)).get() : undefined;
  const circular = row.circularId ? db.select().from(governanceCirculars).where(eq(governanceCirculars.id, row.circularId)).get() : undefined;
  const deciderId = meeting?.findings.chairContactId ?? circular?.decidedByContactId ?? null;
  const version = meeting ? minutesVersionsInternal(db, meeting.id).at(-1) : undefined;
  const minutesDoc = version ? db.select({ number: documents.number, documentDate: documents.documentDate }).from(documents).where(eq(documents.id, version.documentId)).get() : undefined;
  const statuteId = (row.details as { statuteId?: string } | null)?.statuteId;
  const statuteRow = statuteId ? db.select().from(governanceStatutes).where(eq(governanceStatutes.id, statuteId)).get() : undefined;
  const filingIds = [...new Set(db.select().from(governanceRegisterOccasions).where(eq(governanceRegisterOccasions.resolutionId, row.id)).all().flatMap((o) => (o.filingId ? [o.filingId] : [])))];
  const filings = filingIds.flatMap((id) => {
    const f = db.select().from(governanceRegisterFilings).where(eq(governanceRegisterFilings.id, id)).get();
    return f ? [{ id: f.id, state: filingStateOf(f), createdOn: isoDayIn(deps, Date.parse(f.createdAt)) }] : [];
  });
  const followUps = db
    .select({ id: schema.followUps.id, dueAt: schema.followUps.dueAt, doneAt: schema.followUps.doneAt, title: schema.followUps.title })
    .from(schema.followUps)
    .where(and(eq(schema.followUps.entityType, 'governanceResolution'), eq(schema.followUps.entityId, row.id)))
    .all();
  const usedBy: ResolutionContext['usedBy'] = [
    ...db.select({ id: financeReserves.id, name: financeReserves.name }).from(financeReserves).where(eq(financeReserves.resolutionId, row.id)).all().map((r) => ({ kind: 'reserve' as const, id: r.id, label: r.name })),
    ...db.select({ id: memberFeeSchedules.id, validFrom: memberFeeSchedules.validFrom }).from(memberFeeSchedules).where(eq(memberFeeSchedules.resolutionId, row.id)).all().map((f) => ({ kind: 'feeSchedule' as const, id: f.id, label: f.validFrom })),
    ...db.select({ id: financePartnerPayments.id, number: financePartnerPayments.number }).from(financePartnerPayments).where(eq(financePartnerPayments.resolutionId, row.id)).all().map((p) => ({ kind: 'partnerPayment' as const, id: p.id, label: p.number ?? '' })),
  ];
  const names: Record<string, string> = {};
  for (const id of [...row.excluded.map((e) => e.contactId), ...contactIdsIn(row.details)]) names[id] = contactNameInternal(db, id) ?? '';
  return ok({
    resolution,
    row: resolutionRowViewInternal(db, resolution),
    decidedBy: contactNameInternal(db, deciderId),
    minutes: version ? { documentId: version.documentId, number: minutesDoc?.number ?? null, signedOn: minutesDoc?.documentDate ?? null } : null,
    statute: statuteRow ? { id: statuteRow.id, state: statuteViewInternal(db, deps, statuteRow, todayIn(deps)).state } : null,
    filings,
    followUps,
    usedBy,
    names,
    election: electionResultInternal(db, deps, row),
  });
}
