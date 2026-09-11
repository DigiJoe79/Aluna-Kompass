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
    startBackgroundWork({
      onStart: () => {
        const worker = startTextWorker(getDeps());
        console.log('[kompass] Texterkennung läuft');
        return worker;
      },
    });
  }
}
