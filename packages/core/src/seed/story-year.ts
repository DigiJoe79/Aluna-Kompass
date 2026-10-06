/**
 * Das Stichjahr des Entwicklungs-Seeds (Plan 2026-10-06-seed-kalender).
 *
 * Die Finanzgeschichte des Seeds reicht vom Januar des Vorjahrs bis zum
 * 31. August des Stichjahrs und bucht über die echten Dienste, die keine
 * Zukunft und kein abgeschlossenes Jahr annehmen. Bis 0.2.6 war das Stichjahr
 * „das laufende Jahr“, und der Seed lief nur von Ende August bis Silvester
 * (Befund 2026-10-06). Jetzt ist es das jüngste Jahr, in dem die ganze
 * Geschichte schon vergangen ist: ab dem 31. August das laufende, davor das
 * vorige. Im Frühjahr zeigt der Seed also das Vorjahr („alt, aber stimmig“,
 * Spec Screenshot-Pipeline § 2 Nr. 7).
 *
 * Rein und ohne Imports: Die E2E (`apps/kompass/e2e/story-year.ts`) rechnen
 * mit derselben Funktion, ohne die Datenbankschicht zu laden. Seit Plan 2b im Kern,
 * weil auch Kern, Kontakte und Akte im Stichjahr säen; das Finanzmodul re-exportiert.
 */

/** Der späteste Tag der Geschichte im Stichjahr (`MM-TT`): das Ende des August-Auszugs auf „Importkonto“. */
export const SEED_STORY_LAST_DAY = '08-31';

/** Das Stichjahr zu einem Vereinstag `YYYY-MM-DD` (`todayIn`). */
export function seedStoryYear(today: string): number {
  const year = Number(today.slice(0, 4));
  return today.slice(5, 10) >= SEED_STORY_LAST_DAY ? year : year - 1;
}
