import { documentBaseGaps, hasPermission, listDocumentBases, readSetting, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { documentTemplateGroups } from '@/lib/document-template-rows';
import { requireSession } from '@/lib/request-context';
import { BasesPanel } from './bases-panel';

/**
 * Zwei Tabellen: welche Basis-Vorlagen es gibt, und welche Dokumentart auf
 * welcher erscheint (`BasesPanel`). Die Akte selbst — Liste, Entwurf,
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
  const m = await getTranslations('modules.names');
  const groups = documentTemplateGroups(registered, deps.registry.manifests, configured, bases).map((group) => ({
    module: group.module,
    moduleLabel: m.has(group.module) ? m(group.module) : group.module,
    rows: group.rows.map((row) => ({ ...row, label: t.has(`create.templates.${row.key}`) ? t(`create.templates.${row.key}`) : row.key })),
  }));
  // Befund 51 b: nur, wenn die Installation überhaupt eigene Basen führt.
  const gaps = documentBaseGaps(deps).missing.map((gap) => ({
    base: gap.base,
    label: bases.find((b) => b.id === gap.base)?.label ?? gap.base,
    module: m.has(gap.module) ? m(gap.module) : gap.module,
  }));
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <BasesPanel bases={bases} groups={groups} gaps={gaps} canManage={hasPermission(ctx, 'settings.manage')} />
    </>
  );
}
