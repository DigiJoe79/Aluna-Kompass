import { hasPermission, type LocalizedText } from '@kompass/core';
import { purposeOverview } from '@kompass/module-finance';
import { listProjects } from '@kompass/module-projects';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { PurposesTable } from './purposes-table';

/**
 * E3 „Zwecke“ (F8b Task 6a, Designer-README 4c): Tabelle mit Bestand und
 * Zustand; ohne `finance.read` (nur `finance.overview`) eine schmalere,
 * namenlose Zeile ohne Bewegungen — die Zeile öffnet dann nichts.
 */
export default async function PurposesPage() {
  const { deps, ctx } = await requireSession();
  const overview = hasPermission(ctx, 'finance.overview');
  const read = hasPermission(ctx, 'finance.read');
  if (!overview && !read) return <Page width="full"><ForbiddenCard permission="finance.overview" /></Page>;
  const t = await getTranslations('finance.purposes');

  const result = await purposeOverview(deps, ctx);
  const rows = result.ok ? result.value : [];
  const canTransfer = read && hasPermission(ctx, 'finance.entriesWrite');
  const canSetup = hasPermission(ctx, 'finance.setup');

  const leading = deps.locales()[0] ?? 'de';
  const projectsRes = read && hasPermission(ctx, 'projects.view') ? await listProjects(deps, ctx) : null;
  const projects = Object.fromEntries((projectsRes?.ok ? projectsRes.value : []).map((p) => [p.id, (p.name as LocalizedText)[leading] || p.slug]));

  // Neun Spalten mit `finance.read` — nach der Spaltenregel (MUSTER § I, ab fünf Spalten) `full` (K9-Befund 13).
  return (
    <Page width="full" header={<PageHeader title={t('title')} description={t('intro')} />}>
      {rows.length === 0 ? (
        <EmptyState title={t('empty')} text={t('intro')} />
      ) : (
        <PurposesTable rows={rows} projects={projects} full={read} canTransfer={canTransfer} canSetup={canSetup} />
      )}
    </Page>
  );
}
