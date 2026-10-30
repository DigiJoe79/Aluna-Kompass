import type { DbOrTx } from '@kompass/core';
import { memberMemberships } from '@kompass/module-members';
import { and, eq, inArray } from 'drizzle-orm';
import type { ResolutionKind } from './rules/schema';
import { governanceOffices, governanceResolutions, governanceTerms, type ExclusionReason } from './schema';
import { termRunsOn } from './term-schedule';

export type ProposedExclusion = { contactId: string; reason: ExclusionReason };

/**
 * Wer vom Stimmrecht ausgeschlossen ist, nach Art (§ 34 BGB, Spec § 4.2) — ein Vorschlag, von Hand änderbar:
 * Entlastung einzeln die Person, gesamt **alle** Betroffenen (§ 34 analog, h. M.); Vergütung die Inhaber der Ämter am
 * Beschlusstag und wer sie in derselben Sitzung vorher gewählt angenommen hat (W-5); Ausschluss das Mitglied (h. M.
 * analog); Wahlen nie.
 */
export function proposedExclusionsInternal(db: DbOrTx, resolution: { kind: ResolutionKind; details: unknown; decidedOn: string; organId: string; meetingId?: string; votedAt?: string | null }): ProposedExclusion[] {
  const d = resolution.details as Record<string, unknown> | null;
  if (!d) return [];
  const unique = (ids: string[], reason: ExclusionReason) => [...new Set(ids)].map((contactId) => ({ contactId, reason }));
  switch (resolution.kind) {
    case 'discharge': {
      const ids = (d.contactIds as string[] | undefined) ?? [];
      return unique(d.mode === 'individual' ? ids.slice(0, 1) : ids, 'discharge');
    }
    case 'remuneration': {
      const officeIds = (d.officeIds as string[] | undefined) ?? [];
      if (officeIds.length === 0) return [];
      const offices = new Map(db.select().from(governanceOffices).where(inArray(governanceOffices.id, officeIds)).all().map((o) => [o.id, o]));
      const terms = db.select().from(governanceTerms).where(inArray(governanceTerms.officeId, officeIds)).all();
      const holders = terms.filter((t) => termRunsOn(t, offices.get(t.officeId)!, resolution.decidedOn)).map((t) => t.contactId);
      // W-5: Die Amtszeit beginnt erst mit dem Festschreiben — wer in dieser Sitzung vorher gewählt wurde und annahm, ist betroffen.
      const elected = resolution.meetingId
        ? db
            .select()
            .from(governanceResolutions)
            .where(and(eq(governanceResolutions.meetingId, resolution.meetingId), eq(governanceResolutions.kind, 'election')))
            .all()
            .filter((r) => officeIds.includes((r.details as { officeId?: string } | null)?.officeId ?? '') && (!resolution.votedAt || !r.votedAt || r.votedAt <= resolution.votedAt))
            .flatMap((r) => ((r.details as { elected?: { contactId: string; acceptedOn: string | null; declinedOn: string | null }[] }).elected ?? []).filter((e) => e.acceptedOn !== null && e.declinedOn === null).map((e) => e.contactId))
        : [];
      return unique([...holders, ...elected], 'remuneration');
    }
    case 'exclusion': {
      const membership = typeof d.membershipId === 'string' ? db.select().from(memberMemberships).where(eq(memberMemberships.id, d.membershipId)).get() : undefined;
      return membership ? [{ contactId: membership.contactId, reason: 'exclusion' }] : [];
    }
    default:
      return [];
  }
}
