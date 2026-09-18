import { getDashboardLayout, hasPermission, listDashboardTiles, readDashboard } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
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
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <h2 className="font-heading text-[26px]">{t('greeting', { name: firstName })}</h2>
        {layout.ok && available.ok ? <DashboardCustomize layout={layout.value} available={available.value} /> : null}
      </div>
      {tiles.length === 0 ? (
        <p className="text-[14px] text-ink-2">{t('noTiles')}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {tiles.map((view) => (
            <TileCard key={`${view.module}.${view.key}`} view={view} canComplete={hasPermission(ctx, 'followUps.manage')} />
          ))}
        </div>
      )}
    </div>
  );
}
