import { startName } from './start-data';

/**
 * Titel der Wiedervorlagen, die das Modul selbst anlegt (Auftrag aus einem Beschluss, Zwischenverfügung mit Frist) —
 * gespeicherter Text, deshalb Nutzdaten aus einer Sprachtabelle in der Leitsprache (Prinzip 7, wie `start-data.ts`),
 * ein Datum fest als TT.MM.JJJJ (`paperDate`). Der Titel landet im Protokoll der Wiedervorlage: nie der Name einer
 * Person und kein Freitext — beim Auftrag nur die Beschlussnummer mit fester Bezeichnung; die Aufgabe steht am
 * verlinkten Beschluss (Prinzip 7, W-12).
 */
export const FOLLOW_UP_TITLES = {
  mandate: { de: 'Auftrag aus {number}', en: 'Mandate from {number}' },
  interimOrder: { de: 'Zwischenverfügung vom {date}', en: 'Interim order of {date}' },
} as const satisfies Record<string, Readonly<Record<string, string>>>;
export type FollowUpTitleKey = keyof typeof FOLLOW_UP_TITLES;

/** Der Titel in `locale` (sonst deutsch) mit eingesetzten Werten; ein fehlender Wert bleibt leer. */
export function followUpTitle(locale: string, key: FollowUpTitleKey, values: Readonly<Record<string, string>>): string {
  return startName(FOLLOW_UP_TITLES[key], locale)
    .replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '')
    .trim();
}
