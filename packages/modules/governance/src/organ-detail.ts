import { notFound, ok, requirePermission, todayIn, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { documents } from '@kompass/module-dms';
import { asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { contactNameInternal } from './minutes/compose';
import { officeView, type OrganView } from './organs';
import { resolveRule, type ResolvedRule } from './rules/resolve';
import type { OrganRules } from './rules/schema';
import { governanceAgendaItems, governanceMeetings, governanceOffices, governanceOrgans, governanceResolutions, governanceTerms, type MeetingKind, type TermOrigin } from './schema';
import { statuteRulesOnInternal } from './statutes';
import { termRunsOn } from './term-schedule';
import { termView, type TermView } from './terms';

export interface TermOriginDetail {
  kind: TermOrigin;
  meetingId: string | null;
  meetingKind: MeetingKind | null;
  heldOn: string | null;
  itemPosition: number | null;
  resolutionId: string | null;
  resolutionNumber: string | null;
  documentId: string | null;
  documentNumber: string | null;
}
export type OrganTermRow = Omit<TermView, 'origin'> & { name: string; officeName: string; origin: TermOriginDetail };
export interface OrganDetail {
  /** Mit archivierten Ämtern. */
  organ: OrganView;
  /** Vorstand: Vertretung aus dem Regelwerk heute; sonst `null`. */
  representation: ResolvedRule<OrganRules['representation']> | null;
  /** Gültiger Stand heute (Ziel der Lesezeile „Vertretung“). */
  statuteId: string | null;
  /** Alle Inhaberschaften der Ämter des Organs: laufende zuerst, dann nach Beginn absteigend. */
  terms: OrganTermRow[];
}

export const organDetailSchema = z.object({ organId: z.string().min(1) });

/** Ein Organ mit Ämtern und allen Inhaberschaften samt Herkunft (Beschluss, Sitzung, TOP bzw. Nachweis der Akte). */
export async function getOrganDetail(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<OrganDetail>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, organDetailSchema, input);
  if (!parsed.ok) return parsed;
  const db = deps.db;
  const row = db.select().from(governanceOrgans).where(eq(governanceOrgans.id, parsed.value.organId)).get();
  if (!row) return notFound('governanceOrgan', parsed.value.organId);
  const today = todayIn(deps);
  const offices = db.select().from(governanceOffices).where(eq(governanceOffices.organId, row.id)).orderBy(asc(governanceOffices.sortOrder), asc(governanceOffices.id)).all();
  const byId = new Map(offices.map((o) => [o.id, o]));
  const terms = offices.length ? db.select().from(governanceTerms).where(inArray(governanceTerms.officeId, offices.map((o) => o.id))).all() : [];
  const resolutionIds = terms.map((t) => t.resolutionId).filter((id): id is string => id !== null);
  const resolutions = new Map((resolutionIds.length ? db.select().from(governanceResolutions).where(inArray(governanceResolutions.id, resolutionIds)).all() : []).map((r) => [r.id, r]));
  const docIds = terms.map((t) => t.documentId).filter((id): id is string => id !== null);
  const docs = new Map((docIds.length ? db.select({ id: documents.id, number: documents.number }).from(documents).where(inArray(documents.id, docIds)).all() : []).map((d) => [d.id, d.number]));
  const origin = (t: (typeof terms)[number]): TermOriginDetail => {
    const resolution = t.resolutionId ? resolutions.get(t.resolutionId) : undefined;
    const meeting = resolution?.meetingId ? db.select().from(governanceMeetings).where(eq(governanceMeetings.id, resolution.meetingId)).get() : undefined;
    const item = resolution?.agendaItemId ? db.select().from(governanceAgendaItems).where(eq(governanceAgendaItems.id, resolution.agendaItemId)).get() : undefined;
    return {
      kind: t.origin,
      meetingId: meeting?.id ?? null,
      meetingKind: meeting?.kind ?? null,
      heldOn: meeting?.heldOn ?? null,
      itemPosition: item?.position ?? null,
      resolutionId: resolution?.id ?? null,
      resolutionNumber: resolution?.number ?? null,
      documentId: t.documentId,
      documentNumber: t.documentId ? (docs.get(t.documentId) ?? null) : null,
    };
  };
  const rows: OrganTermRow[] = terms.map((t) => {
    const office = byId.get(t.officeId)!;
    return { ...termView(t, today), running: termRunsOn(t, office, today), name: contactNameInternal(db, t.contactId) ?? '', officeName: office.name, origin: origin(t) };
  });
  rows.sort((a, b) => Number(b.running) - Number(a.running) || b.since.localeCompare(a.since) || a.id.localeCompare(b.id));
  const { statuteId, rules } = statuteRulesOnInternal(db, today);
  return ok({
    organ: { id: row.id, kind: row.kind, name: row.name, active: row.active, offices: offices.map(officeView) },
    representation: row.kind === 'board' ? resolveRule(rules, row.id, 'representation') : null,
    statuteId,
    terms: rows,
  });
}
