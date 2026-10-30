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
    const { registerMailSender, restartBackgroundWork, stopBackgroundWork } = await import('@/lib/background');
    const { readEnv, recordPreUpdateBackup, recoverInterruptedRestore, registerRestoreHooks, runPreUpdateBackup } = await import('@kompass/core');
    const { preUpdateGate } = await import('@/lib/pre-update');
    const { runningSiteJob } = await import('@kompass/module-site');
    const { siteEnv } = await import('@/lib/site-env');
    const { resetMcpHandler } = await import('@/lib/mcp');
    // Ein Neustart mitten im Einspielen: Rücklage zurück, bevor jemand die Datenbank öffnet (Spec Backup § Einspielen).
    const env = readEnv();
    const recovered = recoverInterruptedRestore({ dataPath: env.dataPath, backupPath: env.backupPath });
    if (recovered !== 'none') console.warn('[kompass] Einspielen nach Neustart: %s', recovered);
    // In Wartung festgehalten (Zurücklegen gescheitert): Der Bestand ist in unklarem Zustand, bis die Technik eingreift.
    // Kein Backup vor Update, keine Migration, keine Hintergrundarbeit — der Proxy zeigt allen die Wartungsseite.
    if (recovered === 'stuck') return;
    // Backup vor Update: nur wenn Migrationen anstehen, vor dem ersten getDeps (das migriert). Scheitert es, endet der
    // Prozess hier. /api/health antwortet erst danach; die NAS-Skripte warten 60 bzw. 120 s (Spec § Backup vor Update).
    const sidecar = await preUpdateGate(env, { run: runPreUpdateBackup, exit: (code) => process.exit(code), log: console, now: () => new Date() });
    if (sidecar) {
      try {
        recordPreUpdateBackup(getDeps(), sidecar);
      } catch (error) {
        console.error('[kompass] Backup vor Update nicht protokolliert: %s', String(error));
      }
    }
    // Was ein Einspielen von der App braucht: ob ein Webseiten-Lauf es verbietet, wie der Hintergrund anhält, was danach neu aufzusetzen ist.
    registerRestoreHooks({
      busyReason: () => (runningSiteJob(siteEnv()) ? 'siteJobRunning' : null),
      pauseBackground: stopBackgroundWork,
      resumeBackground: restartBackgroundWork,
      afterRestore: resetMcpHandler,
    });
    startBackgroundWork({
      ready: getDeps,
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
