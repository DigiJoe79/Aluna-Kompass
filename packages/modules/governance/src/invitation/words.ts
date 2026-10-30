import { isoDay, paperDate } from '@kompass/core';
import type { MeetingForm, MeetingKind } from '../schema';

/**
 * Wortlaut der Einladung (Plan G2 Task 5) — fest deutsch im Modul wie die Briefe der Mitglieder und Finanzen
 * (Prinzip 7, Ausnahme Vorlage). Die Tagesordnung selbst sind Nutzdaten des Vereins.
 */
export const day = (iso: string): string => paperDate(isoDay(iso));

/** Die Sitzung im Satz: „zur ordentlichen Mitgliederversammlung“; bei Vorstand und anderen Organen deren Name. */
export function meetingPhrase(kind: MeetingKind, organName: string): string {
  switch (kind) {
    case 'founding':
      return 'zur Gründungsversammlung';
    case 'ordinary':
      return 'zur ordentlichen Mitgliederversammlung';
    case 'extraordinary':
      return 'zur außerordentlichen Mitgliederversammlung';
    case 'repeat':
      return 'zur Wiederholungsversammlung';
    case 'board':
      return `zur Sitzung des Organs „${organName}“`;
  }
}

/** Die Sitzung als Gegenstand: „Ordentliche Mitgliederversammlung“. */
export function meetingTitle(kind: MeetingKind, organName: string): string {
  switch (kind) {
    case 'founding':
      return 'Gründungsversammlung';
    case 'ordinary':
      return 'Ordentliche Mitgliederversammlung';
    case 'extraordinary':
      return 'Außerordentliche Mitgliederversammlung';
    case 'repeat':
      return 'Wiederholungsversammlung';
    case 'board':
      return `Sitzung „${organName}“`;
  }
}

export const FORM_WORDS: Record<MeetingForm, string> = { inPerson: 'Präsenz', hybrid: 'hybrid (vor Ort und online)', virtual: 'online' };

export const WORDS = {
  subjectInvitation: (title: string, on: string) => `Einladung: ${title} am ${day(on)}`,
  subjectSupplement: (title: string, on: string) => `Nachtrag zur Einladung: ${title} am ${day(on)}`,
  subjectCancellation: (title: string, on: string) => `Absage: ${title} am ${day(on)}`,
  introInvitation: (phrase: string, on: string, at: string) => `hiermit laden wir Sie ${phrase} am ${day(on)} um ${at} Uhr ein.`,
  introSupplement: (phrase: string, on: string) => `zu unserer Einladung ${phrase} am ${day(on)} ergänzen wir die Tagesordnung um folgende Punkte.`,
  cancellation: (phrase: string, on: string) => `die Einladung ${phrase} am ${day(on)} nehmen wir zurück: Die Sitzung findet nicht statt.`,
  cancelReason: (reason: string) => `Grund: ${reason}`,
  headDate: 'Datum',
  headStart: 'Beginn',
  headForm: 'Form',
  headPlace: 'Ort',
  headAccess: 'Zugang',
  startsAt: (at: string) => `${at} Uhr`,
  agendaTitle: 'Tagesordnung',
  attachments: 'Anlagen',
  motionsBy: (on: string, reference: string | null = null) => `Anträge zur Tagesordnung reichen Sie bitte bis zum ${day(on)} beim Vorstand ein${reference ? ` (${reference})` : ''}.`,
  majorityHint: (position: number, majority: string, reference: string, annexNo: number | null) =>
    `Für den Beschluss zu TOP ${position} sind ${majority} nötig (${reference}).${annexNo !== null ? ` Den bisherigen und den neuen Wortlaut finden Sie in Anlage ${annexNo}.` : ''}`,
  annexTitle: (no: number, title: string) => `Anlage ${no}: ${title}, bisheriger und neuer Wortlaut`,
  annexColumns: ['Bisheriger Wortlaut', 'Neuer Wortlaut'] as [string, string],
  wordingInAnnex: (no: number) => `Wortlaut in Anlage ${no}`,
  repeatNoQuorum: 'Die Versammlung ist ohne Rücksicht auf die Zahl der Erschienenen beschlussfähig.',
  remote: (note: string) => `So nehmen Sie elektronisch teil und üben Ihre Rechte aus: ${note}`,
  recipientAll: 'An die Mitglieder',
  recipientOrgan: (organName: string) => `An die Mitglieder des Organs „${organName}“`,
  closing: ['Mit freundlichen Grüßen', 'Der Vorstand'],
} as const;
