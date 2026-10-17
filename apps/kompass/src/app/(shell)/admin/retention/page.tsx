import { hasPermission, listRetentionDue, readSetting, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { dateFormatOf } from '@/lib/date-format';
import { requireSession } from '@/lib/request-context';
import { RetentionSettings } from './retention-settings';
import { Section } from '@/components/section';

export default async function RetentionPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'retention.view')) return <Page width="standard"><ForbiddenCard permission="retention.view" /></Page>;
  const t = await getTranslations('retention');
  const result = await listRetentionDue(deps, ctx);
  if (!result.ok) return <Page width="standard"><ForbiddenCard permission="retention.view" /></Page>;

  const statutory10Y = readSetting<number>(deps, 'retention.statutory10Y');
  const statutory8Y = readSetting<number>(deps, 'retention.statutory8Y');
  const statutory6Y = readSetting<number>(deps, 'retention.statutory6Y');
  const consent = readSetting<number>(deps, 'retention.consent');
  const canManageSettings = hasPermission(ctx, 'settings.manage');
  const fmt = dateFormatOf(deps);

  const byEntity = new Map<string, typeof result.value>();
  for (const item of result.value) byEntity.set(item.entity, [...(byEntity.get(item.entity) ?? []), item]);

  return (
    <Page width="standard" header={<PageHeader title={t('title')} description={t('description')} />}>
      <RetentionSettings
        statutory10Y={statutory10Y}
        statutory8Y={statutory8Y}
        statutory6Y={statutory6Y}
        consent={consent}
        canManage={canManageSettings}
      />
      {result.value.length === 0 ? (
        <EmptyState title={t('empty.title')} text={t('empty.text')} />
      ) : (
        [...byEntity.entries()].map(([entity, items]) => (
          // Runde 3, 181: eine Form für Überschriften — jede Art als Karte mit Abschnittstitel wie „Fristen“; „fällig
          // seit …“ ist Arbeit und steht ocker. Layout und Farbe, kein Test.
          <section key={entity} aria-labelledby={`retention-${entity}`} className="mb-6 mt-6 rounded-lg border border-line bg-surface p-5">
            <Section title={t.has(`entities.${entity}`) ? t(`entities.${entity}`) : entity} headingId={`retention-${entity}`}>
              <ul className="divide-y divide-line-2">
                {items.map((item) => {
                  const href = item.href;
                  return (
                    <li key={`${item.entity}:${item.id}`} className="flex items-center justify-between gap-4 py-2">
                      <span>{href ? <Link href={href} className="underline underline-offset-2">{item.label}</Link> : item.label}</span>
                      <span className="text-meta text-warning">{t('dueSince', { date: fmt.date(item.dueSince) })}</span>
                    </li>
                  );
                })}
              </ul>
            </Section>
          </section>
        ))
      )}
      <p className="mt-3 text-hint text-muted-ink">{t('footnote')}</p>
    </Page>
  );
}
