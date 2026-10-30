import type { AgendaKind } from './agenda-kinds';
import type { MeetingKind, OfficeFunction, OrganKind } from './schema';

type Names = Readonly<Record<string, string>>;

/**
 * Grundausstattung der Organe und Ämter (Spec Gremien § 3.1, § 3.2) — Nutzdaten aus einer Sprachtabelle (Prinzip 7).
 * Ein Verein benennt um, deaktiviert, ergänzt; was er geändert hat, kommt nie zurück (`provisionOnce`). Die
 * Kassenprüfung ist ein Amt an der Mitgliederversammlung, kein Organ.
 */
export const START_ORGANS: readonly {
  kind: Exclude<OrganKind, 'other'>;
  name: Names;
  offices: readonly { function: OfficeFunction; name: Names; seats: number; representative: boolean; termMonths: number | null; untilSuccessor: boolean }[];
}[] = [
  {
    kind: 'assembly',
    name: { de: 'Mitgliederversammlung', en: 'General meeting' },
    offices: [{ function: 'auditor', name: { de: 'Kassenprüfung', en: 'Auditor' }, seats: 2, representative: false, termMonths: 24, untilSuccessor: true }],
  },
  {
    kind: 'board',
    name: { de: 'Vorstand', en: 'Board' },
    offices: [
      { function: 'chair', name: { de: 'Vorsitz', en: 'Chair' }, seats: 1, representative: true, termMonths: 24, untilSuccessor: true },
      { function: 'board', name: { de: 'Stellvertretender Vorsitz', en: 'Deputy chair' }, seats: 1, representative: true, termMonths: 24, untilSuccessor: true },
      { function: 'treasurer', name: { de: 'Kasse', en: 'Treasurer' }, seats: 1, representative: true, termMonths: 24, untilSuccessor: true },
    ],
  },
];

/** Rollenvorschläge beim Einschalten (Spec § 10); Namen sind Nutzdaten, wiedergefunden über `originKey`. */
export const START_ROLES: Readonly<Record<'board' | 'minutes', { name: Names; description: Names }>> = {
  board: { name: { de: 'Vorstand', en: 'Board' }, description: { de: 'Führt Organe, Ämter, Satzung und Sitzungen.', en: 'Manages organs, offices, statutes and meetings.' } },
  minutes: { name: { de: 'Protokollführung', en: 'Minute taker' }, description: { de: 'Liest die Gremien und führt das Protokoll.', en: 'Reads the governing bodies and takes the minutes.' } },
};

/** Der Name in der Leitsprache; eine Sprache ohne Eintrag bekommt den deutschen. */
export const startName = (name: Names, locale: string): string => name[locale] ?? name.de ?? '';

/** Platz eines Vorschlagspunkts, den Kompass füllt: Kassenbericht, Prüfbericht, Wahlen (nur wenn ein Amt fällig ist). */
export type StartAgendaRole = 'cashReport' | 'auditReport' | 'election';
export interface StartAgendaItem {
  kind: AgendaKind;
  title: Names;
  role?: StartAgendaRole;
}

const welcome: StartAgendaItem = { kind: 'other', title: { de: 'Begrüßung und Feststellung der Beschlussfähigkeit', en: 'Welcome and quorum' } };
const agendaApproval: StartAgendaItem = { kind: 'agenda', title: { de: 'Genehmigung der Tagesordnung', en: 'Approval of the agenda' } };
const elections: StartAgendaItem = { kind: 'election', title: { de: 'Wahlen', en: 'Elections' }, role: 'election' };
const misc: StartAgendaItem = { kind: 'other', title: { de: 'Verschiedenes', en: 'Any other business' } };

/**
 * Vorschlag einer Tagesordnung je Art (Spec § 5.2) — Nutzdaten aus einer Sprachtabelle, frei änderbar. „Wahlen“
 * erscheint nur, wenn ein Amt ausläuft oder frei ist.
 */
export const START_AGENDA: Readonly<Record<MeetingKind, readonly StartAgendaItem[]>> = {
  ordinary: [
    welcome,
    agendaApproval,
    { kind: 'minutesApproval', title: { de: 'Genehmigung des letzten Protokolls', en: 'Approval of the last minutes' } },
    { kind: 'report', title: { de: 'Bericht des Vorstands', en: 'Report of the board' } },
    { kind: 'accounts', title: { de: 'Kassenbericht', en: 'Financial report' }, role: 'cashReport' },
    { kind: 'report', title: { de: 'Bericht der Kassenprüfung', en: 'Report of the auditors' }, role: 'auditReport' },
    { kind: 'discharge', title: { de: 'Entlastung des Vorstands', en: 'Discharge of the board' } },
    elections,
    { kind: 'other', title: { de: 'Anträge', en: 'Motions' } },
    misc,
  ],
  extraordinary: [welcome, agendaApproval, misc],
  repeat: [welcome, agendaApproval, misc],
  board: [{ kind: 'other', title: { de: 'Begrüßung', en: 'Welcome' } }, misc],
  founding: [
    { kind: 'other', title: { de: 'Begrüßung', en: 'Welcome' } },
    { kind: 'other', title: { de: 'Wahl von Versammlungsleitung und Protokollführung', en: 'Chair and minute taker of the meeting' } },
    { kind: 'statute', title: { de: 'Beratung und Feststellung der Satzung', en: 'Statute' } },
    elections,
    misc,
  ],
};
