import { requirePermission } from '@kompass/core';
import { listPublishes } from '@kompass/module-website';
import { getFormatter, getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { runtimeEnv } from '@/lib/deps';
import { requireSession } from '@/lib/request-context';
import { CheckCard } from './check-card';

export default async function PublishPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'website.publish')) return <ForbiddenCard permission="website.publish" />;
  const t = await getTranslations('website.publish');
  const format = await getFormatter();
  const env = runtimeEnv().env;
  const history = await listPublishes(deps, ctx, { environment: env });
  const last = history.ok ? history.value[0] : undefined;
  return (
    <>
      <PageHeader title={t('title')} description={t(`target.${env}`)} />
      <div className="flex max-w-[880px] flex-col gap-4">
        <section className="rounded-lg border border-line bg-surface p-5 text-[13px]">
          <h3 className="font-heading text-[18px]">{t('state.title')}</h3>
          <p className="mt-2 text-ink-2">
            {last
              ? t('state.last', {
                  date: format.dateTime(new Date(last.startedAt), { dateStyle: 'medium', timeStyle: 'short' }),
                  status: last.status,
                })
              : t('state.never')}
          </p>
        </section>
        <CheckCard />
        <p className="text-[12px] text-muted-ink">{t('nextStage')}</p>
      </div>
    </>
  );
}
