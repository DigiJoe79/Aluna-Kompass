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
    const { startMailSender, startTextWorker } = await import('@kompass/module-dms');
    const { startHousekeeping } = await import('@kompass/core');
    const { registerMailSender } = await import('@/lib/background');
    startBackgroundWork({
      onStart: () => {
        const worker = startTextWorker(getDeps);
        // Aufräumen der Module (Haken `housekeeping`) hängt nicht an der Akte, läuft aber im selben Takt an und hält mit an.
        const keeper = startHousekeeping(getDeps);
        // Der Ausgangskorb der E-Mails: alle 30 s, und sofort nach dem Einreihen (`kickMailSender`).
        const mail = startMailSender(getDeps);
        registerMailSender(mail);
        console.log('[kompass] Texterkennung, Mailversand und Aufräumen laufen');
        return {
          wake: () => worker.wake(),
          stop: async () => {
            registerMailSender(null);
            await Promise.all([worker.stop(), keeper.stop(), mail.stop()]);
          },
        };
      },
    });
  }
}
