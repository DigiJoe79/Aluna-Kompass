import { day } from '../invitation/words';

/**
 * Wortlaut des Protokolls (Spec § 5.5, Plan G4 Task 2) — fest deutsch im Modul wie die Einladung und das
 * Übergabeprotokoll der Finanzen (Prinzip 7, Ausnahme Vorlage). Es soll sich lesen wie ein Protokoll des Vereins:
 * Fließtext je TOP, Ergebnisse in Sätzen, keine Tabelle.
 */
export type MinutesDefectKind = 'noticeShort' | 'noticeShortFoundProper' | 'notInvited' | 'formNotAllowed' | 'quorumNotMet' | 'findingAgainstCount' | 'findingAgainstNotice' | 'outcomeAgainstCount' | 'notAnnounced' | 'unsentInvitations' | 'remunerationWithoutStatute' | 'remunerationWrongOrgan' | 'incompatible';
type Votes = { yes: number; no: number; abstain: number; invalid: number };
type OrganKind = 'assembly' | 'board' | 'other';

/** Eine Zahl mit Einzahl oder Mehrzahl (G-22): „1 Enthaltung“, „2 Enthaltungen“. */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** „7 Ja-Stimmen, 0 Nein-Stimmen und 0 Enthaltungen“; ungültige vor „und“; errechnetes Ja nennt das Verfahren (Joe 2026-10-28). */
function votesPhrase(v: Votes, yesComputed: boolean): string {
  const parts = [`${count(v.yes, 'Ja-Stimme', 'Ja-Stimmen')}${yesComputed ? ' (im Subtraktionsverfahren ermittelt)' : ''}`, count(v.no, 'Nein-Stimme', 'Nein-Stimmen')];
  if (v.invalid > 0) parts.push(count(v.invalid, 'ungültigen Stimme', 'ungültigen Stimmen'));
  return `${parts.join(', ')} und ${count(v.abstain, 'Enthaltung', 'Enthaltungen')}`;
}

/** Wer leitet: bei der Versammlung die Versammlungsleitung, sonst die Sitzungsleitung (G-22). */
const lead = (organKind: OrganKind) => (organKind === 'assembly' ? 'Versammlungsleitung' : 'Sitzungsleitung');

/** Ein Satz endet mit einem Punkt — auch wenn die Begründung schon einen hat. */
const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

const DEFECT_LABELS: Record<MinutesDefectKind, string> = {
  noticeShort: 'Die Einladungsfrist wurde nach der Zählung unterschritten',
  noticeShortFoundProper: 'Die Einladungsfrist wurde nach der Zählung unterschritten; die Leitung stellte dennoch eine ordnungsgemäße Einladung fest',
  quorumNotMet: 'Die Beschlussfähigkeit war nach der Zählung nicht gegeben',
  findingAgainstCount: 'Die Feststellung der Leitung weicht von der Zählung ab',
  findingAgainstNotice: 'Die Feststellung der Leitung zur Einladung weicht von der Fristberechnung ab',
  outcomeAgainstCount: 'Das festgestellte Ergebnis weicht von der Zählung ab',
  notAnnounced: 'Der Gegenstand war in der Einladung nicht angekündigt',
  unsentInvitations: 'Nicht alle Einladungen sind als versandt vermerkt',
  notInvited: 'Eine Einladung zu dieser Sitzung ist nicht vermerkt',
  formNotAllowed: 'Diese Form der Sitzung sieht die Satzung nicht vor (§ 32 Abs. 2 BGB)',
  remunerationWithoutStatute: 'Für die Vergütung fehlt eine Grundlage in der Satzung (§ 27 Abs. 3 S. 2, § 40 BGB; § 55 AO)',
  remunerationWrongOrgan: 'Über die Vergütung beschließt nach der Satzung ein anderes Organ (§ 27 Abs. 3 S. 2, § 40 BGB)',
  incompatible: 'Die gewählte Person hat ein Amt inne, das mit diesem nicht zusammengehen soll',
};

export const MINUTES_WORDS = {
  title: (meetingTitle: string) => `Protokoll: ${meetingTitle}`,
  headDate: 'Datum',
  headTime: 'Zeit',
  headForm: 'Form',
  headPlace: 'Ort',
  headChair: 'Leitung',
  headMinuteTaker: 'Protokollführung',
  time: (from: string, to: string | null) => (to ? `${from} bis ${to} Uhr` : `ab ${from} Uhr`),
  date: (on: string) => day(on),
  headAttendance: 'Anwesend',
  /** Kopfzeile „Anwesend“ (Plan U2): stimmberechtigte von allen, Gäste, Verweis auf die Liste. */
  attendanceHead: (voting: number, allVoting: number, nonVoting: number, guests: number, organKind: OrganKind) =>
    `${voting} von ${allVoting} ${organKind === 'assembly' ? 'stimmberechtigten Mitgliedern' : 'Mitgliedern des Organs'}${nonVoting > 0 ? `, ${nonVoting} ohne Stimmrecht` : ''}${guests > 0 ? `, ${guests} ${guests === 1 ? 'Gast' : 'Gäste'}` : ''} (Anlage 1)`,
  /** Nach dem Ergebnis eines gezählten Beschlusses: was nötig war (Plan U2). */
  required: (majority: string, needed: number, reference: string) => `Erforderlich ${majority.startsWith('die ') ? 'war' : 'waren'} ${majority}, das ${needed === 1 ? 'ist' : 'sind'} ${needed} (${reference}).`,
  /** Stimmengleichheit, die nach der Satzung die Leitung entscheidet (G-8). */
  tieDecided: (organKind: OrganKind, outcome: 'adopted' | 'rejected') => `Bei Stimmengleichheit entschied nach der Satzung die ${lead(organKind)}; der Antrag ist damit ${outcome === 'adopted' ? 'angenommen' : 'abgelehnt'}.`,
  /** Wen eine Entlastung betrifft und für welches Geschäftsjahr (G-7). */
  dischargeOf: (names: string[], fiscalYear: string, mode: 'individual' | 'collective') =>
    `${mode === 'individual' ? 'Entlastung' : 'Gesamtentlastung'} von ${names.join(', ')} für das Geschäftsjahr ${fiscalYear}:`,
  signaturesNote: (reference: string) => `Unterschriften nach ${reference}.`,
  footer: (shortTitle: string, on: string, at: string) => `Protokoll ${shortTitle} · Entwurf vom ${day(on)}, ${at}`,
  invitationProper: (proper: boolean, organKind: OrganKind = 'assembly') => `Die ${lead(organKind)} stellte fest, dass ${proper ? '' : 'nicht '}ordnungsgemäß eingeladen wurde.`,
  quorate: (quorate: boolean, organKind: OrganKind = 'assembly') => (quorate ? `Die ${lead(organKind)} stellte die Beschlussfähigkeit fest.` : `Die ${lead(organKind)} stellte fest, dass ${organKind === 'assembly' ? 'die Versammlung' : 'die Sitzung'} nicht beschlussfähig war.`),
  chairBy: { statute: 'Die Leitung lag nach der Satzung bei der genannten Person.', elected: 'Die Anwesenden wählten die Leitung.', consent: 'Leitung und Protokollführung wurden mit Einverständnis aller bestimmt.' },
  agendaApproved: (approved: boolean) => (approved ? 'Die Tagesordnung wurde genehmigt.' : 'Die Tagesordnung wurde nicht genehmigt.'),
  heading: (position: number, title: string) => `TOP ${position}: ${title}`,
  /** Subjekt des Beschlusses: „Die Versammlung“ (MV), „Der Vorstand“, sonst der Name des Organs. */
  subject: (organKind: 'assembly' | 'board' | 'other', organName: string) => (organKind === 'assembly' ? 'Die Versammlung' : organKind === 'board' ? 'Der Vorstand' : organName),
  adopted: (subject: string, v: Votes, yesComputed: boolean, text: string) => `${subject} beschloss mit ${votesPhrase(v, yesComputed)}: ${text}`,
  unanimous: (subject: string, text: string) => `${subject} beschloss einstimmig: ${text}`,
  rejected: (v: Votes, yesComputed: boolean, text: string) => `Der Antrag wurde mit ${votesPhrase(v, yesComputed)} abgelehnt: ${text}`,
  rejectedPlain: (text: string) => `Der Antrag wurde abgelehnt: ${text}`,
  /** Abstimmung über die Aufnahme eines späten Antrags (G-6): Gegenstand ist die Aufnahme, nicht der Antrag selbst. */
  admissionAdopted: (subject: string, v: Votes, yesComputed: boolean, text: string) => `${subject} beschloss mit ${votesPhrase(v, yesComputed)}, folgenden Antrag in die Tagesordnung aufzunehmen: ${text}`,
  admissionUnanimous: (subject: string, text: string) => `${subject} beschloss einstimmig, folgenden Antrag in die Tagesordnung aufzunehmen: ${text}`,
  admissionRejected: (v: Votes, yesComputed: boolean, text: string) => `Die Aufnahme folgenden Antrags in die Tagesordnung wurde mit ${votesPhrase(v, yesComputed)} abgelehnt: ${text}`,
  adoptedPlain: (subject: string, text: string) => `${subject} beschloss: ${text}`,
  postponed: 'Der Punkt wurde vertagt.',
  /** Vertagt nach einer Abstimmung (W-8): die abgegebenen Stimmen bleiben im Protokoll. */
  postponedVotes: (v: Votes, yesComputed: boolean) => `Abgestimmt wurde mit ${votesPhrase(v, yesComputed)}; der Punkt wurde vertagt.`,
  chairReason: (reason: string) => `Begründung der Leitung: ${sentence(reason)}`,
  withdrawn: 'Der Antrag wurde zurückgezogen.',
  /** Ohne Namen: Ein Stimmverbot ist kein Vorwurf; die Personen stehen im Datensatz des Beschlusses. */
  excluded: (n: number) => (n === 1 ? '1 stimmberechtigte Person war nach § 34 BGB vom Stimmrecht ausgeschlossen.' : `${n} Stimmberechtigte waren nach § 34 BGB vom Stimmrecht ausgeschlossen.`),
  /** K-6: Vor den Gängen je Amt, wenn ein TOP mehrere Ämter wählt. */
  electionOf: (office: string) => `Wahl: ${office}`,
  round: (n: number, runoff: boolean) => (runoff ? `Stichwahl:` : `Wahlgang ${n}:`),
  candidateVotes: (name: string, votes: number) => `${name} erhielt ${count(votes, 'Stimme', 'Stimmen')}.`,
  roundRest: (no: number, abstain: number, invalid: number) => `Dazu ${count(no, 'Nein-Stimme', 'Nein-Stimmen')}, ${count(abstain, 'Enthaltung', 'Enthaltungen')}${invalid > 0 ? ` und ${count(invalid, 'ungültige Stimme', 'ungültige Stimmen')}` : ''}.`,
  electedUnanimously: (name: string) => `${name} wurde einstimmig gewählt.`,
  accepted: (name: string, office: string, on: string) => `${name} wurde in das Amt „${office}“ gewählt und nahm die Wahl am ${day(on)} an.`,
  declined: (name: string, office: string, on: string) => `${name} wurde in das Amt „${office}“ gewählt und lehnte die Wahl am ${day(on)} ab.`,
  notYetAccepted: (name: string, office: string) => `${name} wurde in das Amt „${office}“ gewählt und hat die Annahme noch nicht erklärt.`,
  againstCountNote: 'Eine Feststellung entgegen der Zählung macht den Beschluss nicht wirksam.',
  /** Ein Mangel: Hinweis, Begründung der Leitung, bei einer Feststellung gegen die Zählung immer der Satz zur Wirkung (Anti-Ziel 1). */
  defect: (d: { kind: MinutesDefectKind; reason: string | null }): string[] => {
    const lines = [`Hinweis: ${DEFECT_LABELS[d.kind]}.`];
    if (d.reason) lines.push(MINUTES_WORDS.chairReason(d.reason));
    if (d.kind === 'findingAgainstCount' || d.kind === 'outcomeAgainstCount') lines.push(MINUTES_WORDS.againstCountNote);
    return lines;
  },
  end: (at: string) => `Ende der Sitzung: ${at} Uhr.`,
  placeDate: (place: string, on: string) => (place ? `${place}, den ${day(on)}` : day(on)),
  signatureChair: (organKind: OrganKind = 'assembly') => lead(organKind),
  signatureMinuteTaker: 'Protokollführung',
  signature: (label: string, name: string | null) => (name ? `${label}: ${name}` : label),
  attachmentAttendance: 'Anwesenheitsliste',
  attachmentDocument: (number: string) => `Dokument ${number}`,
  attachmentInvitation: (number: string) => `Einladung ${number}`,
  deletedContact: 'gelöschter Kontakt',
};
