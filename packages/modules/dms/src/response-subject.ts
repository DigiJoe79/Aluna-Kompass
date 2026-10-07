import { isIsoDay, paperDate, type Deps, type IsoDay } from '@kompass/core';

/**
 * Der Betreff einer Antwort (eingegangen) und eines Folgeschreibens (ausgehend).
 * Grundausstattung wie die Startarten in `install.ts`: Startwert in der
 * führenden Sprache, danach gehört der Betreff dem, der schreibt.
 */
// Ausgeschrieben statt `Intl`: Der Betreff bleibt unabhängig von der ICU-Fassung gleich.
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const RESPONSE_SUBJECTS: Record<string, { incoming: [string, string]; outgoing: [string, string]; date: (day: IsoDay) => string }> = {
  de: {
    incoming: ['Ihr Schreiben vom {date}: {subject}', 'Ihr Schreiben: {subject}'],
    outgoing: ['Unser Schreiben vom {date}: {subject}', 'Unser Schreiben: {subject}'],
    date: paperDate,
  },
  en: {
    incoming: ['Your letter of {date}: {subject}', 'Your letter: {subject}'],
    outgoing: ['Our letter of {date}: {subject}', 'Our letter: {subject}'],
    date: (iso) => `${Number(iso.slice(8, 10))} ${EN_MONTHS[Number(iso.slice(5, 7)) - 1] ?? iso.slice(5, 7)} ${iso.slice(0, 4)}`,
  },
};

export function responseSubject(deps: Deps, direction: 'incoming' | 'outgoing', documentDate: string, subject: string): string {
  const table = RESPONSE_SUBJECTS[deps.locales()[0] ?? 'de'] ?? RESPONSE_SUBJECTS.de!;
  const [dated, undated] = table[direction];
  const text = (isIsoDay(documentDate) ? dated.replace('{date}', table.date(documentDate)) : undated).replace('{subject}', subject);
  return text.length > 300 ? `${text.slice(0, 299)}…` : text;
}
