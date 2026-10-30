import { ok, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { memberMemberships, memberTypePeriods } from '@kompass/module-members';
import { and, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { governanceAttendance, governanceMeetings, type ResolutionRow } from '../schema';
import { founderHasMembershipInternal } from './consequences';
import { meetingResolutionsInOrderInternal } from './preview';

/**
 * Ein Vorschlag an die Mitglieder (Spec § 6, § 8.3): Gremien ändert keine Mitgliedschaft, ausgeführt wird von Hand über
 * die Dienste der Mitglieder (Tag und Brief gehören dazu). `done` wird berechnet (Prinzip 5).
 */
export type MemberProposal = {
  kind: 'endMembership' | 'changeType' | 'createMembership';
  resolutionId: string | null;
  meetingId: string;
  contactId: string;
  membershipId: string | null;
  on: string;
  done: boolean;
};

export const memberProposalsSchema = z.object({});

function endedByExclusion(db: DbOrTx, membershipId: string): boolean {
  const m = db.select().from(memberMemberships).where(eq(memberMemberships.id, membershipId)).get();
  return !!m && m.endReason === 'exclusion' && m.endsOn !== null;
}

/** Gilt die Art ab dem Beschlusstag (oder später)? */
function typeChanged(db: DbOrTx, membershipId: string, typeId: string, on: string): boolean {
  const periods = db.select().from(memberTypePeriods).where(eq(memberTypePeriods.membershipId, membershipId)).all().sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  const inForce = periods.filter((p) => p.validFrom <= on).at(-1);
  return inForce?.typeId === typeId || periods.some((p) => p.typeId === typeId && p.validFrom >= on);
}

function fromResolution(db: DbOrTx, row: ResolutionRow): MemberProposal | null {
  if (row.outcome !== 'adopted' || !row.meetingId) return null;
  const d = (row.details ?? {}) as { membershipId?: string; typeId?: string };
  const membership = d.membershipId ? db.select().from(memberMemberships).where(eq(memberMemberships.id, d.membershipId)).get() : undefined;
  if (!membership) return null;
  if (row.kind === 'exclusion') return { kind: 'endMembership', resolutionId: row.id, meetingId: row.meetingId, contactId: membership.contactId, membershipId: membership.id, on: row.decidedOn, done: endedByExclusion(db, membership.id) };
  if (row.kind === 'honoraryMember' && d.typeId) return { kind: 'changeType', resolutionId: row.id, meetingId: row.meetingId, contactId: membership.contactId, membershipId: membership.id, on: row.decidedOn, done: typeChanged(db, membership.id, d.typeId, row.decidedOn) };
  return null;
}

/** Die Vorschläge aus festgeschriebenen Sitzungen, nach Sitzungstag: Ausschluss, Ehrenmitgliedschaft, Gründer (Umläufe ohne Sitzung führen keine). */
export function memberProposalsInternal(db: DbOrTx, _deps: Deps): MemberProposal[] {
  const meetings = db.select().from(governanceMeetings).where(isNotNull(governanceMeetings.sealedAt)).all().sort((a, b) => `${a.heldOn}|${a.startsAt}`.localeCompare(`${b.heldOn}|${b.startsAt}`));
  const out: MemberProposal[] = [];
  for (const meeting of meetings) {
    if (meeting.kind === 'founding') {
      const founders = db.select().from(governanceAttendance).where(and(eq(governanceAttendance.meetingId, meeting.id), eq(governanceAttendance.role, 'founder'))).all().filter((r) => r.contactId);
      for (const f of founders.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
        out.push({ kind: 'createMembership', resolutionId: null, meetingId: meeting.id, contactId: f.contactId!, membershipId: null, on: meeting.heldOn, done: founderHasMembershipInternal(db, f.contactId!, meeting.heldOn) });
      }
    }
    for (const row of meetingResolutionsInOrderInternal(db, meeting.id)) {
      const proposal = fromResolution(db, row);
      if (proposal) out.push(proposal);
    }
  }
  return out;
}

/** `governance.read`: was an den Mitgliedern noch von Hand zu tun ist (und was schon getan ist). */
export async function listMemberProposals(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MemberProposal[]>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, memberProposalsSchema, input ?? {});
  if (!parsed.ok) return parsed;
  return ok(memberProposalsInternal(deps.db, deps));
}
