/**
 * Das Stichjahr des Entwicklungs-Seeds liegt seit Plan 2b im Kern
 * (`packages/core/src/seed/story-year.ts`), weil auch Kern, Kontakte und Akte
 * im Stichjahr säen. Diese Datei hält die Importe des Finanzmoduls stabil.
 * Wer die Funktion ohne Datenbankschicht braucht (E2E), lädt die Kern-Datei per Pfad.
 */
export { SEED_STORY_LAST_DAY, seedStoryYear } from '@kompass/core';
