import { existsSync } from 'node:fs';
import path from 'node:path';
import { readSetting, requirePermission } from '@kompass/core';
import { activeTemplate, siteTemplateDir } from '@kompass/module-site';
import { getFormatter, getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { SyncClient } from './sync-client';
import { SeedClient } from './seed-client';

export const dynamic = 'force-dynamic';

export default async function SiteTemplatePage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'site.manage')) return <ForbiddenCard permission="site.manage" />;
  const t = await getTranslations('site.template');
  const tSeed = await getTranslations('site.seed');
  const format = await getFormatter();
  const state = activeTemplate(deps);

  const seedFile = path.join(siteTemplateDir(), 'seed', 'content.json');
  const seedAppliedAt = readSetting<string | null>(deps, 'site.seedAppliedAt');
  const showSeedCard = existsSync(seedFile);

  return (
    <>
      <PageHeader
        title={t('title')}
        description={state ? t('lastRead', { when: format.dateTime(new Date(state.readAt), { dateStyle: 'medium', timeStyle: 'short' }) }) : t('neverRead')}
      />
      <SyncClient name={state?.name ?? null} />
      {showSeedCard ? (
        seedAppliedAt ? (
          <p className="rounded-lg border border-line bg-surface p-6 text-[14px] text-ink-2">
            {tSeed('done', { when: format.dateTime(new Date(seedAppliedAt), { dateStyle: 'medium', timeStyle: 'short' }) })}
          </p>
        ) : (
          <SeedClient />
        )
      ) : null}
    </>
  );
}
