import { listAgentSwitches, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { AgentsForm } from './agents-form';

/**
 * Verwaltung → Agenten (Spec 2026-10-29): die Erlaubnisse für Agenten aller eingeschalteten Module an einer Stelle.
 * Welche es gibt, sagt der Kern (`listAgentSwitches`); die Einstellungen bleiben Eigentum der Module.
 */
export default async function AgentsPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'settings.manage')) return <Page width="standard"><ForbiddenCard permission="settings.manage" /></Page>;
  const t = await getTranslations('admin.agents');
  const result = await listAgentSwitches(deps, ctx);
  if (!result.ok) return <Page width="standard"><ForbiddenCard permission="settings.manage" /></Page>;
  return (
    <Page width="standard" header={<PageHeader title={t('title')} description={t('description')} />}>
      <AgentsForm switches={result.value.map(({ key, value }) => ({ key, value }))} />
    </Page>
  );
}
