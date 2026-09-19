import { requirePermission } from '@kompass/core';
import { activeTemplate, listReferenceOptions, readValues, valuesVersion } from '@kompass/module-site';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { VariablesForm } from './variables-form';

export const dynamic = 'force-dynamic';

export default async function SiteVariablesPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'site.manage')) return <ForbiddenCard permission="site.manage" />;
  const t = await getTranslations('site.variables');
  const tpl = await getTranslations('site.template');
  const template = activeTemplate(deps);
  const options = template ? await listReferenceOptions(deps, ctx) : null;
  return (
    <>
      <PageHeader title={t('title')} />
      {template && Object.keys(template.schema.variables).length > 0 ? (
        <VariablesForm schema={template.schema.variables} value={readValues(deps)} version={valuesVersion(deps)} locales={deps.locales()} options={options?.ok ? options.value : {}} />
      ) : (
        <EmptyState title={t('title')} text={tpl('neverRead')} />
      )}
    </>
  );
}
