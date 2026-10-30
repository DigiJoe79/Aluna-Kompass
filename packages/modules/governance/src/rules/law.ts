import type { Majority, OrganRuleKey, OrganRules, ResolutionKind } from './schema';

/**
 * Rückfallwerte nach BGB (Spec Gremien § 4.3, Fassung 2026; Rechtsprüfung 2026-10-28) — gelten, wo die Satzung
 * schweigt. Die Oberfläche nennt die Norm neben dem Wert.
 */
type Fallback<K extends OrganRuleKey> = { value: OrganRules[K] | undefined; norm: string };

/** § 32 Abs. 1 S. 3 BGB: „Bei der Beschlussfassung entscheidet die Mehrheit der abgegebenen Stimmen.“ Enthaltungen zählen nicht (BGHZ 83, 35). */
export const LAW_SIMPLE_MAJORITY: Majority = { fraction: 'simple', base: 'cast', abstentions: 'ignored' };

/**
 * Keine gesetzliche Einladungsfrist; die Rechtsprechung verlangt eine „angemessene“. Kompass weist unter 14 Tagen
 * darauf hin.
 */
export const LAW_NOTICE_HINT_DAYS = 14;

export const LAW_FALLBACK: { [K in OrganRuleKey]: Fallback<K> } = {
  convenedBy: { value: undefined, norm: '§ 58 Nr. 4 BGB' },
  // Keine Frist im Gesetz — nur der Hinweis LAW_NOTICE_HINT_DAYS.
  noticeDays: { value: undefined, norm: 'Rechtsprechung (angemessene Frist)' },
  noticeStrictness: { value: 'must', norm: 'Rechtsprechung (angemessene Frist)' },
  // Rechtsprüfung S1: Schweigt die Satzung, rechnet die Praxis ab Zugang; Beweislast beim Verein.
  noticeFrom: { value: 'received', norm: '§ 130 BGB' },
  transitDays: { value: { email: 1, post: 3 }, norm: '§ 130 BGB' },
  form: { value: undefined, norm: '§ 58 Nr. 4 BGB' },
  // § 32 Abs. 1 S. 2 BGB: „Zur Gültigkeit des Beschlusses ist erforderlich, dass der Gegenstand bei der Berufung bezeichnet wird.“
  agendaWithInvitation: { value: true, norm: '§ 32 Abs. 1 S. 2 BGB' },
  motionDeadlineDays: { value: undefined, norm: '§ 32 Abs. 1 S. 2 BGB' },
  lateMotionMajority: { value: undefined, norm: '§ 32 Abs. 1 S. 2 BGB' },
  announceRequired: { value: 'all', norm: '§ 32 Abs. 1 S. 2 BGB' },
  // Das Gesetz kennt keine Beschlussfähigkeit: Die erschienenen Mitglieder beschließen.
  quorum: { value: { kind: 'none' }, norm: '§ 32 Abs. 1 S. 3 BGB' },
  repeatMeeting: { value: null, norm: '§ 32 BGB' },
  majorities: { value: undefined, norm: '§ 32 Abs. 1 S. 3 BGB' },
  tie: { value: 'rejected', norm: '§ 32 Abs. 1 S. 3 BGB' },
  election: { value: { mode: 'single', rounds: [LAW_SIMPLE_MAJORITY], runoff: false }, norm: '§ 32 Abs. 1 S. 3 BGB' },
  chairOrder: { value: undefined, norm: '§ 32 BGB' },
  minutesSignedBy: { value: undefined, norm: '§ 58 Nr. 4 BGB' },
  // § 32 Abs. 2 BGB: hybrid sieht das einberufende Organ vor (S. 1); virtuell nur nach Beschluss der Mitglieder (S. 2).
  formsAllowed: { value: ['inPerson', 'hybrid'], norm: '§ 32 Abs. 2 BGB' },
  // § 32 Abs. 3 BGB: „Auch ohne Versammlung der Mitglieder ist ein Beschluss gültig, wenn alle Mitglieder ihre Zustimmung zu dem Beschluss in Textform erklären.“
  circular: { value: { allowed: true, consent: 'all', form: 'textForm' }, norm: '§ 32 Abs. 3 BGB' },
  // § 37 Abs. 1 BGB: einzuberufen, wenn der durch die Satzung bestimmte Teil oder ein Zehntel der Mitglieder es verlangt.
  minorityRequest: { value: { num: 1, den: 10 }, norm: '§ 37 Abs. 1 BGB' },
  // §§ 27, 40 BGB: Die Bestellung des Vorstands erfolgt durch Beschluss der Mitgliederversammlung; Kooptation nur mit Satzungsgrundlage.
  substitutionAllowed: { value: false, norm: '§§ 27, 40 BGB' },
  // Fremdorganschaft ist zulässig.
  officeRequiresMembership: { value: false, norm: '§ 27 BGB' },
  // § 27 Abs. 3 S. 2 BGB: Die Mitglieder des Vorstands sind unentgeltlich tätig (abdingbar nach § 40).
  remuneration: { value: null, norm: '§ 27 Abs. 3 S. 2 BGB' },
  exclusionNoticeDays: { value: undefined, norm: '§ 25 BGB' },
  // § 36 BGB: Die Versammlung ist in den durch die Satzung bestimmten Fällen zu berufen — eine jährliche Pflicht kennt das Gesetz nicht.
  ordinaryMeetingYearly: { value: false, norm: '§ 36 BGB' },
  // § 26 Abs. 2 S. 1 BGB: „Besteht der Vorstand aus mehreren Personen, so wird der Verein durch die Mehrheit der Vorstandsmitglieder vertreten.“
  representation: { value: { mode: 'majority' }, norm: '§ 26 Abs. 2 S. 1 BGB' },
};

/** Mehrheit je Beschlussart nach BGB; was hier fehlt, braucht die einfache Mehrheit (§ 32 Abs. 1 S. 3). */
export const LAW_MAJORITIES: Partial<Record<ResolutionKind, { value: Majority; norm: string }>> = {
  // § 33 Abs. 1 S. 1 BGB: „Zu einem Beschluss, der eine Änderung der Satzung enthält, ist eine Mehrheit von drei Vierteln der abgegebenen Stimmen erforderlich.“
  statute: { value: { fraction: { num: 3, den: 4 }, base: 'cast', abstentions: 'ignored' }, norm: '§ 33 Abs. 1 S. 1 BGB' },
  // § 33 Abs. 1 S. 2 BGB: „Zur Änderung des Zweckes des Vereins ist die Zustimmung aller Mitglieder erforderlich.“
  purpose: { value: { fraction: { num: 1, den: 1 }, base: 'all', abstentions: 'asNo' }, norm: '§ 33 Abs. 1 S. 2 BGB' },
  // § 41 S. 2 BGB: Auflösung mit drei Vierteln der abgegebenen Stimmen.
  dissolution: { value: { fraction: { num: 3, den: 4 }, base: 'cast', abstentions: 'ignored' }, norm: '§ 41 S. 2 BGB' },
};
export const LAW_DEFAULT_MAJORITY = { value: LAW_SIMPLE_MAJORITY, norm: '§ 32 Abs. 1 S. 3 BGB' };
