import { hasPermission, listDocumentBases, readSetting, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { BasesPanel } from './bases-panel';

/**
 * Nur noch die Pipeline (Basis-Vorlagen): die Akte selbst — Liste, Entwurf,
 * Vorschau, Storno — zog ins Modul `dms` und bekommt dort ihre eigene
 * Oberfläche unter `/dms` (Plan „dms-4-oberflaeche-mcp-seed“).
 */
export default async function DocumentsPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'documents.export')) return <ForbiddenCard permission="documents.export" />;
  const t = await getTranslations('documents');
  const registered = [...deps.registry.documentTemplates.values()];
  const basesResult = await listDocumentBases(deps, ctx);
  const bases = basesResult.ok ? basesResult.value : [];
  const configured = readSetting<Record<string, string>>(deps, 'documents.bases');
  const baseTypes = registered.map((tpl) => ({
    key: tpl.key,
    label: t.has(`create.templates.${tpl.key}`) ? t(`create.templates.${tpl.key}`) : tpl.key,
    base: configured[tpl.key] ?? tpl.base,
    isDefault: !configured[tpl.key],
  }));
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <BasesPanel bases={bases} types={baseTypes} canManage={hasPermission(ctx, 'settings.manage')} />
    </>
  );
}
