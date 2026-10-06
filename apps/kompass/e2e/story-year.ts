import { readFileSync } from 'node:fs';
import path from 'node:path';
import { seedStoryYear } from '../../../packages/core/src/seed/story-year';
import { associationDay } from './association-day';

/**
 * Das Stichjahr des Entwicklungs-Seeds aus Sicht der E2E (Plan 2026-10-06-seed-kalender). Die Finanzgeschichte
 * des Seeds spielt im Stichjahr und seinem Vorjahr, nicht im laufenden Jahr. Die Specs schreiben ihre Daten so,
 * wie sie im Stichjahr 2026 aussahen, und schieben sie mit `story` — so bleibt der Text lesbar, und bis zum
 * 30.08.2027 ist er Zeichen für Zeichen der alte. `story-year.ts` (Kern) ist rein, der Playwright-Lauf lädt damit
 * keine Datenbankschicht (wie `association-day.ts`).
 */
export const WRITTEN_YEAR = 2026;
export const STORY_YEAR = seedStoryYear(associationDay());
const SHIFT = STORY_YEAR - WRITTEN_YEAR;

/** Jede alleinstehende Jahreszahl 2022–2029 um `shift` verschoben („RE-2026-041“, „01.04.2026“, „2026-01-05“, „2022–2024“). */
export function shiftYears(text: string, shift: number): string {
  return shift === 0 ? text : text.replace(/(?<!\d)(202[2-9])(?!\d)/g, (year) => String(Number(year) + shift));
}

/**
 * Eine Fixture-Datei, verschoben und gleich lang. XML und CSV über `shiftYears`, byteweise (`latin1`), damit
 * Windows-1252 und UTF-8 heil bleiben; im PDF nur die Datumsangaben der eingebetteten Rechnung (`>20260108<`) —
 * eine Jahreszahl in Längen- oder Versatzangaben des PDF zu ändern, hieße die Datei zu zerbrechen.
 */
export function shiftFixture(bytes: Buffer, ext: string, shift: number): Buffer {
  if (shift === 0) return bytes;
  const text = bytes.toString('latin1');
  const shifted =
    ext === '.pdf' ? text.replace(/>(202[2-9])(\d{4})</g, (_match, year: string, rest: string) => `>${Number(year) + shift}${rest}<`) : shiftYears(text, shift);
  return Buffer.from(shifted, 'latin1');
}

/** Seed-Daten, wie sie im Stichjahr 2026 hießen, ins Stichjahr dieses Laufs verschoben. */
export const story = (text: string): string => shiftYears(text, SHIFT);

/** Wie `story`, für ein Muster: `storyPattern('Auszug importiert bis 31\\.08\\.2026')`. */
export const storyPattern = (source: string, flags?: string): RegExp => new RegExp(story(source), flags);

export interface StoryFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

const MIME: Record<string, string> = { '.xml': 'application/xml', '.csv': 'text/csv', '.pdf': 'application/pdf' };

/** Eine Fixture für `setInputFiles`: im Stichjahr 2026 der Pfad selbst, sonst die verschobene Datei unter demselben Namen. */
export function storyFile(file: string): string | StoryFile {
  if (SHIFT === 0) return file;
  const ext = path.extname(file).toLowerCase();
  return { name: path.basename(file), mimeType: MIME[ext] ?? 'application/octet-stream', buffer: shiftFixture(readFileSync(file), ext, SHIFT) };
}

/** Mehrere Fixtures auf einmal — `setInputFiles` nimmt nur reine Pfad- oder reine Inhaltslisten, keine gemischten. */
export function storyFiles(...files: string[]): string[] | StoryFile[] {
  return SHIFT === 0 ? files : files.map((file) => storyFile(file) as StoryFile);
}
