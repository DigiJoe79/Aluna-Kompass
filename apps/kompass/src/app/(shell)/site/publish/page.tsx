import { requirePermission } from '@kompass/core';
import { activeTemplate, listPublishes } from '@kompass/module-site';
import { getFormatter, getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { runtimeEnv } from '@/lib/deps';
import { requireSession } from '@/lib/request-context';
import { siteEnv } from '@/lib/site-env';
import { PublishClient } from './publish-client';

export default async function PublishPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'site.publish')) return <ForbiddenCard permission="site.publish" />;
  const t = await getTranslations('site.publish');
  // Die Navigation blendet „Publizieren" ohne Template aus; über die Adresse
  // ist die Seite trotzdem erreichbar, und jeder Lauf endete an `noTemplate`.
  if (!activeTemplate(deps)) {
    const tpl = await getTranslations('site.template');
    return (
      <>
        <PageHeader title={t('title')} />
        <EmptyState title={t('title')} text={tpl('neverRead')} />
      </>
    );
  }
  const format = await getFormatter();
  const env = runtimeEnv().env;
  const se = siteEnv();
  const historyRes = await listPublishes(deps, ctx, { environment: env });
  const history = historyRes.ok ? historyRes.value : [];
  const last = history[0];

  return (
    <>
      <PageHeader
        title={t('title')}
        description={`${t(`target.${env}`)}${se.publicUrl ? ` (${se.publicUrl})` : ''}`}
      />
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
        <PublishClient
          env={env}
          publicUrl={se.publicUrl}
          hasDeploy={se.deploy !== null}
          history={history}
        />
      </div>
    </>
  );
}
