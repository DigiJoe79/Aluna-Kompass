import { notFound, ok, requirePermission, todayIn, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { documents } from '@kompass/module-dms';
import { countMembersAtInternal } from '@kompass/module-members';
import { asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { presentAtInternal } from './attendance';
import { organMembersOnInternal } from './invitation/board';
import { meetingStateOf } from './meetings';
import { allVotingOnInternal } from './quorum';
import { filingStateOf, type FilingState } from './register/filings';
import { LAW_DEFAULT_MAJORITY, LAW_FALLBACK, LAW_MAJORITIES } from './rules/law';
import { governanceAgendaItems, governanceMeetings, governanceOffices, governanceOrgans, governanceRegisterFilings, governanceRegisterOccasions, governanceResolutions, governanceStatutes, type MeetingKind, type OrganKind } from './schema';
import { statuteViewInternal, type StatuteView } from './statutes';

export interface StatuteContextResolution { on: string; resolutionId: string | null; number: string | null; meetingId: string | null; meetingKind: MeetingKind | null; itemPosition: number | null }
export interface StatuteContextOrgan {
  id: string;
  kind: OrganKind;
  name: string;
  offices: { id: string; name: string }[];
  /** Zahlen für das Beispiel des Bruchfelds. */
  figures: { allMembers: number; voting: number; organMembers: number; lastPresentVoting: number | null };
}
export interface StatuteContext {
  statute: StatuteView;
  document: { id: string; number: string | null; subject: string } | null;
  resolutions: StatuteContextResolution[];
  /** Anmeldung mit Anlass `statute` für diesen Stand. */
  filing: { id: string; state: FilingState; submittedOn: string | null } | null;
  taxDocuments: { submission: { id: string; number: string | null } | null; answer: { id: string; number: string | null } | null };
  organs: StatuteContextOrgan[];
  /** Rückfallwerte samt Norm, damit die Seite „laut Gesetz: …“ ohne eigene Tabelle zeigt. */
  law: { fallback: typeof LAW_FALLBACK; majorities: typeof LAW_MAJORITIES; defaultMajority: typeof LAW_DEFAULT_MAJORITY };
}

export const statuteContextSchema = z.object({ statuteId: z.string().min(1) });

/** Ein Satzungsstand mit allem, was Lesesicht und Regelwerk zeigen (Plan U2) — berechnet, nie gespeichert. */
export async function getStatuteContext(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<StatuteContext>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, statuteContextSchema, input);
  if (!parsed.ok) return parsed;
  const db = deps.db;
  const row = db.select().from(governanceStatutes).where(eq(governanceStatutes.id, parsed.value.statuteId)).get();
  if (!row) return notFound('governanceStatute', parsed.value.statuteId);
  const today = todayIn(deps);
  const docIds = [row.documentId, row.taxReview.submissionDocumentId, row.taxReview.answerDocumentId].filter((x): x is string => x !== null);
  const docs = new Map((docIds.length ? db.select({ id: documents.id, number: documents.number, subject: documents.subject }).from(documents).where(inArray(documents.id, docIds)).all() : []).map((d) => [d.id, d]));
  const doc = (id: string | null) => (id ? { id, number: docs.get(id)?.number ?? null } : null);
  const resolutions = row.resolutions.map((ref): StatuteContextResolution => {
    const r = ref.resolutionId ? db.select().from(governanceResolutions).where(eq(governanceResolutions.id, ref.resolutionId)).get() : undefined;
    const meeting = r?.meetingId ? db.select().from(governanceMeetings).where(eq(governanceMeetings.id, r.meetingId)).get() : undefined;
    const item = r?.agendaItemId ? db.select().from(governanceAgendaItems).where(eq(governanceAgendaItems.id, r.agendaItemId)).get() : undefined;
    return { on: ref.on, resolutionId: ref.resolutionId, number: r?.number ?? null, meetingId: meeting?.id ?? null, meetingKind: meeting?.kind ?? null, itemPosition: item?.position ?? null };
  });
  const occasion = db.select().from(governanceRegisterOccasions).where(eq(governanceRegisterOccasions.statuteId, row.id)).all().find((o) => o.filingId !== null);
  const filingRow = occasion?.filingId ? db.select().from(governanceRegisterFilings).where(eq(governanceRegisterFilings.id, occasion.filingId)).get() : undefined;
  const allMembers = countMembersAtInternal(deps, today).total;
  const meetings = db.select().from(governanceMeetings).all();
  const organs = db
    .select()
    .from(governanceOrgans)
    .orderBy(asc(governanceOrgans.sortOrder), asc(governanceOrgans.id))
    .all()
    .filter((o) => o.active)
    .map((organ): StatuteContextOrgan => {
      const offices = db.select().from(governanceOffices).where(eq(governanceOffices.organId, organ.id)).orderBy(asc(governanceOffices.sortOrder), asc(governanceOffices.id)).all().filter((o) => o.active);
      const last = meetings
        .filter((m) => m.organId === organ.id && ['recorded', 'signed'].includes(meetingStateOf(m)))
        .sort((a, b) => a.heldOn.localeCompare(b.heldOn) || a.startsAt.localeCompare(b.startsAt))
        .at(-1);
      return {
        id: organ.id,
        kind: organ.kind,
        name: organ.name,
        offices: offices.map((o) => ({ id: o.id, name: o.name })),
        figures: { allMembers, voting: allVotingOnInternal(db, deps, organ.id, today), organMembers: organMembersOnInternal(db, organ.id, today).length, lastPresentVoting: last ? presentAtInternal(db, last.id, last.startsAt).voting : null },
      };
    });
  return ok({
    statute: statuteViewInternal(db, deps, row, today),
    document: row.documentId ? { id: row.documentId, number: docs.get(row.documentId)?.number ?? null, subject: docs.get(row.documentId)?.subject ?? '' } : null,
    resolutions,
    filing: filingRow ? { id: filingRow.id, state: filingStateOf(filingRow), submittedOn: filingRow.submittedOn } : null,
    taxDocuments: { submission: doc(row.taxReview.submissionDocumentId), answer: doc(row.taxReview.answerDocumentId) },
    organs,
    law: { fallback: LAW_FALLBACK, majorities: LAW_MAJORITIES, defaultMajority: LAW_DEFAULT_MAJORITY },
  });
}
