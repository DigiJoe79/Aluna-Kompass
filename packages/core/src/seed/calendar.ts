import type { Deps } from '../deps';
import { isoDayIn, todayIn } from '../today';
import { seedStoryYear } from './story-year';

/**
 * Hilfen für Entwicklungsdaten, die wie ein Jahr Vereinsarbeit aussehen
 * (Spec 2026-10-06 § 4). Seeds legen Dokumente, Rollen und Buchungen über die
 * Dienste an; die Dienste nehmen ihre Zeit von `deps.clock`. Wer eine Uhr
 * verschiebt (`seedClockAt`), bekommt Ablagezeit, Nummernjahr und
 * Protokollzeit passend zum Datum — Vorbild `animals/src/seed.ts:205-206`.
 */

/** `isoDay` um `time` (UTC), nie nach jetzt — eine Ablage in der Zukunft gibt es nicht. */
export function seedMoment(deps: Pick<Deps, 'clock'>, isoDay: string, time = '09:00'): Date {
  const at = new Date(`${isoDay}T${time}:00.000Z`);
  const now = deps.clock.now();
  return at.getTime() > now.getTime() ? now : at;
}

/** Ein Tag `MM-DD` im Stichjahr der Entwicklungsdaten, nie nach heute. */
export function storyDay(deps: Deps, monthDay: string): string {
  const today = todayIn(deps);
  const day = `${seedStoryYear(today)}-${monthDay}`;
  return day > today ? today : day;
}

/** Der Kalendertag vor `days` Tagen, in der Zeitzone des Vereins. */
export function seedDaysAgo(deps: Deps, days: number): string {
  return isoDayIn(deps, deps.clock.now().getTime() - days * 86_400_000);
}

/** Dieselben Dienste mit einer Uhr, die auf `at` steht. */
export function seedClockAt<D extends Pick<Deps, 'clock'>>(deps: D, at: Date): D {
  return { ...deps, clock: { now: () => new Date(at.getTime()) } };
}
