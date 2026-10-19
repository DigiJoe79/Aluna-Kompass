import type { LetterFacts } from './facts';
import { CLOSING, day, memberInfo, memberLetterTemplate, type MemberLetterInput } from './shared';

export const RESIGNATION_TEMPLATE_KEY = 'member-resignation';
export const resignationTemplate = memberLetterTemplate(RESIGNATION_TEMPLATE_KEY, 'member-resignation', 'members.manage');

/** Sprachtabelle der Austrittsbestätigung. */
const W = {
  subject: 'Bestätigung Ihres Austritts',
  notice: (noticeOn: string) => `wir haben Ihre Kündigung vom ${day(noticeOn)} erhalten.`,
  end: (endsOn: string) => `Ihre Mitgliedschaft endet zum ${day(endsOn)}.`,
  /** M3: an die gesetzliche Vertretung. */
  noticeFor: (name: string, noticeOn: string) => `wir haben die Kündigung der Mitgliedschaft von ${name} vom ${day(noticeOn)} erhalten.`,
  endFor: (name: string, endsOn: string) => `Die Mitgliedschaft von ${name} endet zum ${day(endsOn)}.`,
  thanks: 'Wir danken Ihnen für Ihre Unterstützung.',
};

/** Nach der Anrede klein weiter (M24) — nur, wo der Satz nicht mit „Ihre“ (Sie-Form) beginnt. */
const lowerFirst = (s: string) => (s.startsWith('Ihre') ? s : s.charAt(0).toLowerCase() + s.slice(1));

export function resignationLetter(f: LetterFacts, r: { noticeOn: string | null; endsOn: string }): MemberLetterInput {
  return {
    recipient: f.recipient,
    subject: W.subject,
    info: memberInfo(f),
    intro: [f.greeting, lowerFirst([...(r.noticeOn ? [f.memberName ? W.noticeFor(f.memberName, r.noticeOn) : W.notice(r.noticeOn)] : []), f.memberName ? W.endFor(f.memberName, r.endsOn) : W.end(r.endsOn)].join(' ')), W.thanks],
    table: null,
    deadline: null,
    transfer: null,
    outro: [],
    closing: [CLOSING, f.organizationName],
  };
}
