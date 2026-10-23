import { maintenanceView } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { runtimeEnv } from '@/lib/deps';
import { MaintenanceCard } from './maintenance-card';

export const dynamic = 'force-dynamic';

/**
 * Wartungsseite während des Einspielens (N1) — außerhalb der Schale, ohne Sitzung und ohne Datenbank; liest nur den
 * Stand des Laufs (`maintenanceView`). Lädt sich nach, solange es läuft und solange das Zurücklegen gescheitert ist:
 * Entfernt die Technik den Merker, wechselt die Seite von selbst.
 */
export default async function MaintenancePage() {
  const now = new Date();
  const view = maintenanceView(runtimeEnv().backupPath, now);
  if (view.phase === 'idle') redirect('/');
  const app = await getTranslations('app');
  const reload = view.phase === 'running' || view.phase === 'rollbackFailed';
  return (
    <>
      {reload ? <meta httpEquiv="refresh" content="5" /> : null}
      <MaintenanceCard view={view} appName={app('name')} now={now} />
    </>
  );
}
