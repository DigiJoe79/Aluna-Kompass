import { notFound, ok, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { z } from 'zod';
import { countMembersAtInternal } from '@kompass/module-members';
import { eq } from 'drizzle-orm';
import { presentAtInternal } from './attendance';
import { organMembersOnInternal } from './invitation/board';
import { invitationRecipientsInternal } from './invitation/runs';
import { meetingRowInternal } from './meetings';
import { resolveRule } from './rules/resolve';
import { fractionNeeded } from './rules/schema';
import { governanceOrgans } from './schema';
import { statuteRulesOnInternal } from './statutes';

/**
 * Beschlussfähigkeit zur Uhrzeit `at` nach dem Regelwerk am Sitzungstag (Spec § 4.2). `required`/`met` sind `null`,
 * wo es kein Quorum gibt (BGB, „ohne Quorum“, Wiederholung, Gründung). Vom Stimmrecht Ausgeschlossene zählen mit.
 */
export type QuorumResult = {
  required: number | null;
  present: number;
  met: boolean | null;
  source: 'statute' | 'law';
  norm?: string;
  reference?: string;
  /** Bezugsgröße in Nenner und Anwesenden: `allMembers` auch ohne Stimmrecht (Fördermitglieder), `votingMembers` nur mit (G-28). */
  basis: 'allMembers' | 'votingMembers' | 'organMembers' | 'absolute' | 'none';
};

export function quorumInternal(db: DbOrTx, deps: Deps, meetingId: string, at: string): QuorumResult {
  const meeting = meetingRowInternal(db, meetingId)!;
  const present = presentAtInternal(db, meetingId, at);
  const assembly = db.select().from(governanceOrgans).where(eq(governanceOrgans.id, meeting.organId)).get()?.kind === 'assembly';
  const presentDefault = assembly ? present.voting : present.organMembers;
  // Gründung: Es gibt noch keine Mitglieder, die Erschienenen beschließen (Spec § 5.7).
  if (meeting.kind === 'founding') return { required: null, present: present.persons, met: null, source: 'law', norm: '§ 32 Abs. 1 S. 3 BGB', basis: 'none' };
  const { rules } = statuteRulesOnInternal(db, meeting.heldOn);
  const origin = (r: { source: 'statute' | 'law'; norm?: string; reference?: string }) => ({ source: r.source, ...(r.norm ? { norm: r.norm } : {}), ...(r.reference ? { reference: r.reference } : {}) });
  if (meeting.kind === 'repeat') {
    const repeat = resolveRule(rules, meeting.organId, 'repeatMeeting');
    if (repeat.value?.noQuorum) return { required: null, present: presentDefault, met: null, ...origin(repeat), basis: 'none' };
  }
  const rule = resolveRule(rules, meeting.organId, 'quorum');
  const quorum = rule.value ?? { kind: 'none' as const };
  if (quorum.kind === 'none') return { required: null, present: presentDefault, met: null, ...origin(rule), basis: 'none' };
  if (quorum.kind === 'absolute') return { required: quorum.count, present: presentDefault, met: presentDefault >= quorum.count, ...origin(rule), basis: 'absolute' };
  const day = meeting.heldOn;
  const [total, here] =
    quorum.base === 'allMembers'
      ? [countMembersAtInternal(deps, day).total, present.members]
      : quorum.base === 'votingMembers'
        ? [allVotingOnInternal(db, deps, meeting.organId, day), present.voting]
        : [organMembersOnInternal(db, meeting.organId, day).length, present.organMembers];
  const required = fractionNeeded(quorum.fraction, total, quorum.comparison);
  return { required, present: here, met: here >= required, ...origin(rule), basis: quorum.base };
}

/** Alle Stimmberechtigten des Organs am Tag: Versammlung → Mitglieder mit Stimmrecht, sonst die Amtsinhaber. */
export function allVotingOnInternal(db: DbOrTx, deps: Deps, organId: string, day: string): number {
  const assembly = db.select().from(governanceOrgans).where(eq(governanceOrgans.id, organId)).get()?.kind === 'assembly';
  return assembly ? invitationRecipientsInternal(db, deps, day).filter((m) => m.hasVotingRight).length : organMembersOnInternal(db, organId, day).length;
}

export const quorumSchema = z.object({ meetingId: z.string().min(1), /** `HH:MM` */ at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) });

/** Beschlussfähigkeit einer Sitzung zur Uhrzeit, vorgerechnet nach dem Regelwerk am Sitzungstag. */
export async function getQuorum(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<QuorumResult>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, quorumSchema, input);
  if (!parsed.ok) return parsed;
  if (!meetingRowInternal(deps.db, parsed.value.meetingId)) return notFound('governanceMeeting', parsed.value.meetingId);
  return ok(quorumInternal(deps.db, deps, parsed.value.meetingId, parsed.value.at));
}
