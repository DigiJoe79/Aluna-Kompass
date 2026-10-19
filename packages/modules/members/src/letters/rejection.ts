import type { LetterFacts } from './facts';
import { CLOSING, day, MEMBER_LABEL, memberLetterTemplate, type MemberLetterInput } from './shared';

export const REJECTION_TEMPLATE_KEY = 'member-rejection';
export const rejectionTemplate = memberLetterTemplate(REJECTION_TEMPLATE_KEY, 'member-rejection', 'members.manage');

/** Sprachtabelle der Ablehnung — ohne Begründung (Spec § 3.3). */
const W = {
  subject: 'Ihr Antrag auf Mitgliedschaft',
  received: (appliedOn: string | null) => (appliedOn ? `vielen Dank für Ihren Antrag vom ${day(appliedOn)}.` : 'vielen Dank für Ihren Antrag.'),
  decision: 'Leider können wir Sie nicht als Mitglied aufnehmen.',
  /** M3: an die gesetzliche Vertretung. */
  decisionFor: (name: string) => `Leider können wir ${name} nicht als Mitglied aufnehmen.`,
};

export function rejectionLetter(f: LetterFacts, r: { appliedOn: string | null }): MemberLetterInput {
  return {
    recipient: f.recipient,
    subject: W.subject,
    info: f.memberName ? [{ label: MEMBER_LABEL, value: f.memberName }] : [],
    intro: [f.greeting, `${W.received(r.appliedOn)} ${f.memberName ? W.decisionFor(f.memberName) : W.decision}`],
    table: null,
    deadline: null,
    transfer: null,
    outro: [],
    closing: [CLOSING, f.organizationName],
  };
}
