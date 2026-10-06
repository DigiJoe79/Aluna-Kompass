import { getDashboardLayout, hasPermission, listDashboardTiles, readDashboard } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { DashboardCustomize } from './dashboard/customize';
import { TileCard } from './dashboard/tile-card';

/**
 * Die Startseite (Spec 2026-09-17): was ansteht, in Kacheln, die der Nutzer
 * selbst wählt. Drei Leseaufrufe nacheinander — Server Actions und Server
 * Components laufen hier seriell, ein `Promise.all` brächte nichts.
 */
export default async function HomePage() {
  const { deps, ctx, user } = await requireSession();
  const t = await getTranslations('home');
  const views = await readDashboard(deps, ctx);
  const layout = await getDashboardLayout(deps, ctx);
  const available = await listDashboardTiles(deps, ctx);
  const firstName = user.name.split(' ')[0] ?? user.name;
  const tiles = views.ok ? views.value : [];

  return (
    <Page
      width="full"
      header={
        <PageHeader
          title={t('greeting', { name: firstName })}
          actions={layout.ok && available.ok ? <DashboardCustomize layout={layout.value} available={available.value} /> : undefined}
        />
      }
    >
      {tiles.length === 0 ? (
        <p className="text-[14px] text-ink-2">{t('noTiles')}</p>
      ) : (
        // `grid-cols-1` ist `minmax(0,1fr)`: Ohne Vorgabe wuchs die implizite Spalte
        // auf dem Telefon auf die längste `truncate`-Zeile einer Kachel (602 px bei
        // 390 px Fenster). Wie die Nachbarraster (Kontakt, Konten); die Zeile selbst
        // begrenzt `tile-lines.tsx` (`max-w-full`), beides ist nötig. Kein Layout-Test
        // für diese Einzelstelle (AGENTS.md); der Überlauf-Wächter der
        // Screenshot-Pipeline sieht es.
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {tiles.map((view) => (
            <TileCard key={`${view.module}.${view.key}`} view={view} canComplete={hasPermission(ctx, 'followUps.manage')} />
          ))}
        </div>
      )}
    </Page>
  );
}
