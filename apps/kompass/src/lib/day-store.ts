import { isoDayInZone } from '@kompass/core/dates';

/**
 * „Heute“ für `useDateFormat().stamp`: prüft einmal pro Minute und beim Fokus auf das Fenster und meldet nur,
 * wenn der Vereinstag wechselt. So zeigt ein über Mitternacht offener Entwurf das Datum, und die vielen Nutzer
 * von `useDateFormat` zeichnen höchstens einmal am Tag neu (Spec K10 Charge 2, § 2.2).
 */
export function createDayStore(timeZone: string, now: () => number = Date.now) {
  let day: string = isoDayInZone(now(), timeZone);
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | undefined;

  const check = () => {
    const next = isoDayInZone(now(), timeZone);
    if (next === day) return;
    day = next;
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        // Ohne Abonnenten lief kein Takt: erst nachsehen, ob der Tag inzwischen gewechselt hat.
        check();
        timer = setInterval(check, 60_000);
        window.addEventListener('focus', check);
        document.addEventListener('visibilitychange', check);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        clearInterval(timer);
        timer = undefined;
        window.removeEventListener('focus', check);
        document.removeEventListener('visibilitychange', check);
      };
    },
    getSnapshot: () => day,
  };
}

export type DayStore = ReturnType<typeof createDayStore>;
