import { existsSync } from 'node:fs';
import path from 'node:path';
import { readSetting, type Deps } from '@kompass/core';
import { activeTemplate, siteTemplateDir, templateNeedsReview } from '@kompass/module-site';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/notice';
import { dateFormatOf } from '@/lib/date-format';
import { SeedClient } from './seed-client';
import { SyncClient } from './sync-client';

export async function TemplatePanel({ deps }: { deps: Deps }) {
  const t = await getTranslations('site.template');
  const tSeed = await getTranslations('site.seed');
  const fmt = dateFormatOf(deps);
  const state = activeTemplate(deps);
  const needsReview = templateNeedsReview(deps);
  const seedFile = path.join(siteTemplateDir(), 'seed', 'content.json');
  const seedAppliedAt = readSetting<string | null>(deps, 'site.seedAppliedAt');
  const showSeedCard = existsSync(seedFile);

  return (
    <>
      <p className="text-[13px] text-ink-2">
        {state ? t('lastRead', { when: fmt.dateTime(state.readAt) }) : t('neverRead')}
      </p>
      {needsReview ? (
        <Notice level="warn">{t('needsReview')}</Notice>
      ) : null}
      <SyncClient name={state?.name ?? null} />
      {showSeedCard ? (
        seedAppliedAt ? (
          <p className="rounded-lg border border-line bg-surface p-5 text-[14px] text-ink-2">
            {tSeed('done', { when: fmt.dateTime(seedAppliedAt) })}
          </p>
        ) : (
          <SeedClient />
        )
      ) : null}
    </>
  );
}
