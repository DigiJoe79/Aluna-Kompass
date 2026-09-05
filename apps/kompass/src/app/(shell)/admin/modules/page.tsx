import { listModules, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { ModuleCard } from './module-card';

export default async function ModulesPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'modules.manage')) return <ForbiddenCard permission="modules.manage" />;
  const t = await getTranslations('modules');
  const modules = listModules(deps);
  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          <span className="text-[13px] text-muted-ink">
            {t('count', { active: modules.filter((m) => m.enabled).length, total: modules.length })}
          </span>
        }
      />
      <p className="mb-4 rounded-md border border-line bg-surface-2 p-3 text-[13px] text-ink-2">
        {t('hint')}
      </p>
      <div className="flex flex-col gap-3">
        {modules.map((m) => (
          <ModuleCard key={m.key} module={m} />
        ))}
      </div>
    </>
  );
}
