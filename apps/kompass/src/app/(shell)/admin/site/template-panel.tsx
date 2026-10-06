import { existsSync } from 'node:fs';
import path from 'node:path';
import { readSetting, type Deps } from '@kompass/core';
import { activeTemplate, siteTemplateDir, templateNeedsReview } from '@kompass/module-site';
import { getFormatter, getTranslations } from 'next-intl/server';
import { SeedClient } from './seed-client';
import { SyncClient } from './sync-client';

export async function TemplatePanel({ deps }: { deps: Deps }) {
  const t = await getTranslations('site.template');
  const tSeed = await getTranslations('site.seed');
  const format = await getFormatter();
  const state = activeTemplate(deps);
  const needsReview = templateNeedsReview(deps);
  const seedFile = path.join(siteTemplateDir(), 'seed', 'content.json');
  const seedAppliedAt = readSetting<string | null>(deps, 'site.seedAppliedAt');
  const showSeedCard = existsSync(seedFile);

  return (
    <>
      <p className="text-[13px] text-ink-2">
        {state ? t('lastRead', { when: format.dateTime(new Date(state.readAt), { dateStyle: 'medium', timeStyle: 'short' }) }) : t('neverRead')}
      </p>
      {needsReview ? (
        <p className="rounded-lg border border-line bg-error-bg p-5 text-[14px] text-ink" role="status">
          {t('needsReview')}
        </p>
      ) : null}
      <SyncClient name={state?.name ?? null} />
      {showSeedCard ? (
        seedAppliedAt ? (
          <p className="rounded-lg border border-line bg-surface p-5 text-[14px] text-ink-2">
            {tSeed('done', { when: format.dateTime(new Date(seedAppliedAt), { dateStyle: 'medium', timeStyle: 'short' }) })}
          </p>
        ) : (
          <SeedClient />
        )
      ) : null}
    </>
  );
}
