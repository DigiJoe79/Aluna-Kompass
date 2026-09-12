import { hasPermission, listRetentionDue, readSetting, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { formatDate, type DateFormatMode } from '@/lib/dates';
import { requireSession } from '@/lib/request-context';
import { RetentionSettings } from './retention-settings';

/** Wohin ein fälliger Eintrag führt. Der Kern löscht nie selbst — er verweist. */
const HREF_BY_ENTITY: Record<string, (id: string) => string> = {
  contact: (id) => `/contacts/${id}`,
  document: (id) => `/dms/${id}`,
};

export default async function RetentionPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'retention.view')) return <ForbiddenCard permission="retention.view" />;
  const t = await getTranslations('retention');
  const result = await listRetentionDue(deps, ctx);
  if (!result.ok) return <ForbiddenCard permission="retention.view" />;

  const statutory10Y = readSetting<number>(deps, 'retention.statutory10Y');
  const statutory6Y = readSetting<number>(deps, 'retention.statutory6Y');
  const consent = readSetting<number>(deps, 'retention.consent');
  const canManageSettings = hasPermission(ctx, 'settings.manage');

  const byEntity = new Map<string, typeof result.value>();
  for (const item of result.value) byEntity.set(item.entity, [...(byEntity.get(item.entity) ?? []), item]);

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <RetentionSettings
        statutory10Y={statutory10Y}
        statutory6Y={statutory6Y}
        consent={consent}
        canManage={canManageSettings}
      />
      {result.value.length === 0 ? (
        <EmptyState title={t('empty.title')} text={t('empty.text')} />
      ) : (
        [...byEntity.entries()].map(([entity, items]) => (
          <section key={entity} className="mb-6">
            <h2 className="mb-2 text-[13px] font-semibold text-muted-ink">{t.has(`entities.${entity}`) ? t(`entities.${entity}`) : entity}</h2>
            <ul className="divide-y divide-line rounded-md border border-line">
              {items.map((item) => {
                const href = HREF_BY_ENTITY[item.entity]?.(item.id);
                return (
                  <li key={`${item.entity}:${item.id}`} className="flex items-center justify-between gap-4 px-3 py-2">
                    <span>{href ? <Link href={href} className="underline underline-offset-2">{item.label}</Link> : item.label}</span>
                    <span className="text-[12px] text-muted-ink">{t('dueSince', { date: formatDate(item.dueSince, readSetting<DateFormatMode>(deps, 'ui.dateFormat')) })}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      <p className="mt-3 text-[12px] text-muted-ink">{t('footnote')}</p>
    </>
  );
}
