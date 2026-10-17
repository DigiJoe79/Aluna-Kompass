import { getDashboardLayout, hasPermission, listDashboardTiles, readDashboard } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { dateFormatOf } from '@/lib/date-format';
import { requireSession } from '@/lib/request-context';
import { tileArt, viewColumns } from './dashboard/columns';
import { DashboardColumns } from './dashboard/dashboard-columns';
import { DashboardCustomize } from './dashboard/customize';
import { TileCard } from './dashboard/tile-card';

/**
 * Die Startseite (Spec 2026-09-17, Briefing Startseite 0.2.12): was ansteht, in Widgets, die der Nutzer selbst
 * wählt und in Spalten anordnet. Drei Leseaufrufe nacheinander — Server Actions und Server
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
  const fmt = dateFormatOf(deps);
  const canComplete = hasPermission(ctx, 'followUps.manage');
  const tileId = (view: { module: string; key: string }) => `${view.module}.${view.key}`;

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
      {tiles.length === 0 || !layout.ok ? (
        <p className="text-body text-ink-2">{t('noTiles')}</p>
      ) : (
        // Spalten statt Zeilenraster (Briefing Startseite § 1): Jede Spalte stapelt für sich, eine lange Kachel macht nur
        // ihre eigene Spalte länger. Die Widgets rendert der Server, `DashboardColumns` stellt sie in Spalten und misst
        // dafür den Behälter. Kein Layout-Test für Abstände (AGENTS.md); der Überlauf-Wächter der Bild-Pipeline sieht es.
        <DashboardColumns
          layout={layout.value.layout}
          columns={viewColumns(tiles, layout.value.columns.length).map((column) => column.map((view) => ({ id: tileId(view), art: tileArt(view) })))}
          tiles={Object.fromEntries(tiles.map((view) => [tileId(view), <TileCard key={tileId(view)} view={view} canComplete={canComplete} fmt={fmt} />]))}
        />
      )}
    </Page>
  );
}
