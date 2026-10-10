import { startBackgroundWork } from '@/lib/background';

/**
 * Next ruft das beim Serverstart — einmal je Prozess, vor der ersten Anfrage.
 * Die Abhängigkeiten werden hier **verzögert** geladen: `better-sqlite3` darf
 * im Edge-Zweig nicht einmal importiert werden, und der Wächter
 * `process.env.NEXT_RUNTIME === 'nodejs'` sorgt dafür, dass der Edge-Bundler
 * den Block eliminiert.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getDeps } = await import('@/lib/deps');
    const { startTextWorker } = await import('@kompass/module-dms');
    const { startHousekeeping } = await import('@kompass/core');
    startBackgroundWork({
      onStart: () => {
        const worker = startTextWorker(getDeps);
        // Aufräumen der Module (Haken `housekeeping`) hängt nicht an der Akte, läuft aber im selben Takt an und hält mit an.
        const keeper = startHousekeeping(getDeps);
        console.log('[kompass] Texterkennung und Aufräumen laufen');
        return {
          wake: () => worker.wake(),
          stop: async () => {
            await Promise.all([worker.stop(), keeper.stop()]);
          },
        };
      },
    });
  }
}
