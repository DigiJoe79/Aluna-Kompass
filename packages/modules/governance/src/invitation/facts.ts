import { readSetting, type DbOrTx, type Deps } from '@kompass/core';
import { documents } from '@kompass/module-dms';
import { eq, inArray } from 'drizzle-orm';
import { agendaViewsInternal } from '../agenda';
import { noticeDeadlineInternal } from '../deadlines/notice';
import { meetingRowInternal } from '../meetings';
import { resolveMajority, resolveRule } from '../rules/resolve';
import { majorityPhrase, referenceOf } from '../rules/words';
import { governanceOrgans } from '../schema';
import { statuteRulesOnInternal } from '../statutes';
import type { InvitationInput } from './template';
import { day, FORM_WORDS, meetingPhrase, meetingTitle, WORDS } from './words';

export type InvitationKind = 'invitation' | 'supplement' | 'cancellation';
export const INVITATION_KINDS = ['invitation', 'supplement', 'cancellation'] as const;

/**
 * Die Einladung einer Sitzung als fertige Texte (Spec § 5.3): Kopf, Tagesordnung (beim Nachtrag nur die ergänzten
 * Punkte, bei der Absage keine), Hinweise aus dem Regelwerk am Sitzungstag. Anschrift und Anrede setzt der Brief je
 * Mitglied; hier stehen die des Hauptdokuments. Alter und neuer Wortlaut einer Satzungsänderung stehen im Text des
 * Punkts — Kompass vergleicht keine Wortlaute.
 */
export function invitationFactsInternal(db: DbOrTx, deps: Deps, meetingId: string, kind: InvitationKind): InvitationInput {
  const meeting = meetingRowInternal(db, meetingId)!;
  const organ = db.select().from(governanceOrgans).where(eq(governanceOrgans.id, meeting.organId)).get()!;
  const title = meetingTitle(meeting.kind, organ.name);
  const phrase = meetingPhrase(meeting.kind, organ.name);
  const items = kind === 'cancellation' ? [] : agendaViewsInternal(deps, db, meeting).filter((i) => kind === 'invitation' || i.addedDuring === 'supplement');
  const docIds = [...new Set(items.flatMap((i) => i.attachmentDocumentIds))];
  const numbers = new Map(docIds.length ? db.select({ id: documents.id, number: documents.number }).from(documents).where(inArray(documents.id, docIds)).all().map((d) => [d.id, d.number ?? '']) : []);
  const remote = meeting.form !== 'inPerson';
  const head =
    kind === 'cancellation' ? []
    : [
        { label: WORDS.headDate, value: day(meeting.heldOn) },
        { label: WORDS.headStart, value: WORDS.startsAt(meeting.startsAt) },
        { label: WORDS.headForm, value: FORM_WORDS[meeting.form] },
        ...(meeting.place ? [{ label: WORDS.headPlace, value: meeting.place }] : []),
        ...(remote && meeting.access ? [{ label: WORDS.headAccess, value: meeting.access }] : []),
      ];
  const hints: string[] = [];
  if (kind === 'cancellation') {
    if (meeting.cancelReason) hints.push(WORDS.cancelReason(meeting.cancelReason));
  } else {
    const rules = statuteRulesOnInternal(db, meeting.heldOn).rules;
    const motionsBy = noticeDeadlineInternal(db, meeting.organId, meeting.heldOn).motionsBy;
    if (motionsBy) hints.push(WORDS.motionsBy(motionsBy, resolveRule(rules, meeting.organId, 'motionDeadlineDays').reference ?? null));
    if (meeting.kind === 'repeat' && resolveRule(statuteRulesOnInternal(db, meeting.heldOn).rules, meeting.organId, 'repeatMeeting').value?.noQuorum) hints.push(WORDS.repeatNoQuorum);
    if (remote && meeting.remoteNote) hints.push(WORDS.remote(meeting.remoteNote));
  }
  // Mehrheit mit Fundstelle je Satzungs-, Zweck- und Auflösungspunkt; geänderte Absätze als Anlage (Plan U2).
  const annexes: NonNullable<InvitationInput['annexes']> = [];
  const annexOf = new Map<string, number>();
  if (kind !== 'cancellation') {
    const rules = statuteRulesOnInternal(db, meeting.heldOn).rules;
    for (const item of items) {
      if (item.kind !== 'statute' && item.kind !== 'purpose' && item.kind !== 'dissolution') continue;
      let annexNo: number | null = null;
      if (item.wordingChanges.length > 0) {
        annexNo = annexes.length + 1;
        annexOf.set(item.id, annexNo);
        annexes.push({ title: WORDS.annexTitle(annexNo, item.title), columns: WORDS.annexColumns, rows: item.wordingChanges.map((w) => ({ label: w.label, before: w.before, after: w.after })) });
      }
      const required = resolveMajority(rules, meeting.organId, item.kind);
      hints.push(WORDS.majorityHint(item.position, majorityPhrase(required.value, organ.kind), referenceOf(required), annexNo));
    }
  }
  const subject = kind === 'invitation' ? WORDS.subjectInvitation(title, meeting.heldOn) : kind === 'supplement' ? WORDS.subjectSupplement(title, meeting.heldOn) : WORDS.subjectCancellation(title, meeting.heldOn);
  const intro = kind === 'invitation' ? WORDS.introInvitation(phrase, meeting.heldOn, meeting.startsAt) : kind === 'supplement' ? WORDS.introSupplement(phrase, meeting.heldOn) : WORDS.cancellation(phrase, meeting.heldOn);
  return {
    recipient: organ.kind === 'assembly' ? WORDS.recipientAll : WORDS.recipientOrgan(organ.name),
    greeting: null,
    organizationName: (readSetting<string>(deps, 'organization.name') ?? '').trim(),
    subject,
    intro: [intro],
    head,
    agenda: items.map((i) => {
      const annexNo = annexOf.get(i.id);
      const text = annexNo ? [i.invitationText, WORDS.wordingInAnnex(annexNo)].filter(Boolean).join('\n') : i.invitationText;
      return { position: i.position, title: i.title, text, attachments: i.attachmentDocumentIds.map((d) => numbers.get(d) ?? '').filter((n) => n !== '') };
    }),
    hints,
    closing: [...WORDS.closing],
    annexes,
  };
}
