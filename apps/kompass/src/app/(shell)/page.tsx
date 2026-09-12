import {
  hasPermission,
  isModuleEnabled,
  listDueFollowUpsWithTargets,
  listModules,
  listRoles,
  readAllSettings,
  readSetting,
  requirePermission,
  schema,
} from '@kompass/core';
import { listPublishes } from '@kompass/module-site';
import { Info } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { runtimeEnv } from '@/lib/deps';
import { requireSession } from '@/lib/request-context';
import { computeSetupProgress } from '@/lib/setup-progress';
import { DuePanel, type DueItemView } from './due-panel';

function Card({
  title,
  counter,
  text,
  hint,
  percent,
  href,
  cta,
}: {
  title: string;
  counter: string;
  text: string;
  hint: string;
  percent?: number;
  href: string;
  cta: string;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-[18px]">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-heading text-[17px]">{title}</h3>
        <span className="font-mono text-[12px] text-muted-ink">{counter}</span>
      </div>
      <p className="min-h-[63px] text-[14px] leading-[1.5] text-ink-2">{text}</p>
      {percent !== undefined ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="h-full bg-brand" style={{ width: `${percent}%` }} />
        </div>
      ) : (
        <div className="h-1.5" aria-hidden />
      )}
      <p className="text-[12px] text-muted-ink">{hint}</p>
      <Link href={href} className={buttonVariants({ variant: 'secondary', className: 'w-fit' })}>
        {cta}
      </Link>
    </section>
  );
}

export default async function HomePage() {
  const { deps, ctx, user } = await requireSession();
  const t = await getTranslations('home');
  const roles = await listRoles(deps, ctx);
  const progress = computeSetupProgress({
    settings: readAllSettings(deps),
    roleCount: roles.ok ? roles.value.length : 0,
    modules: listModules(deps),
  });
  const pct = (d: number, tot: number) => (tot === 0 ? 0 : Math.round((d / tot) * 100));

  /**
   * Sieben Tage nach vorn: Was weiter weg liegt, gehört noch nicht auf die
   * Startseite — es stünde da, bis man darüber hinwegliest.
   */
  const today = deps.clock.now().toISOString().slice(0, 10);
  const until = new Date(deps.clock.now().getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const canSeeDue = hasPermission(ctx, 'followUps.view');
  const dueRes = canSeeDue ? await listDueFollowUpsWithTargets(deps, ctx, { until }) : null;
  const userNames = new Map(
    deps.db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).all().map((u) => [u.id, u.name]),
  );
  const dueItems: DueItemView[] =
    dueRes?.ok
      ? dueRes.value.map((row) => ({
          id: row.id,
          dueAt: row.dueAt,
          title: row.title,
          assigneeUserId: row.assigneeUserId,
          assigneeName: row.assigneeUserId ? (userNames.get(row.assigneeUserId) ?? null) : null,
          target: row.target,
        }))
      : [];
  const firstName = user.name.split(' ')[0] ?? user.name;

  const env = runtimeEnv().env;
  const canSeeWebsite = isModuleEnabled(deps, 'site') && requirePermission(ctx, 'site.view') === null;
  const publishesResult = canSeeWebsite ? await listPublishes(deps, ctx, { environment: env }) : null;
  const publishList = publishesResult?.ok ? publishesResult.value : [];
  const lastPublish = publishList[0];
  const tWebsite = await getTranslations('site.publish');
  const format = await getFormatter();
  const websiteHint = lastPublish
    ? tWebsite('state.last', {
        date: format.dateTime(new Date(lastPublish.startedAt), { dateStyle: 'medium', timeStyle: 'short' }),
        status: lastPublish.status,
      })
    : t('website.never');

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-heading text-[26px]">{t('greeting', { name: firstName })}</h2>
        <p className="mt-1 text-[15px] leading-[1.55] text-ink-2">
          {progress.settings.missing.length === 0 && progress.roles.done >= progress.roles.total && progress.modules.done >= progress.modules.total
            ? t('introDone')
            : t('intro')}
        </p>
      </div>
      {canSeeDue ? (
        <DuePanel items={dueItems} userId={user.id} today={today} canManage={hasPermission(ctx, 'followUps.manage')} />
      ) : null}
      <div className={canSeeWebsite ? 'grid gap-4 md:grid-cols-2 xl:grid-cols-4' : 'grid gap-4 md:grid-cols-3'}>
        <Card
          title={t('settings.title')}
          counter={t('counter', { done: progress.settings.done, total: progress.settings.total })}
          text={t('settings.text')}
          hint={t('settings.hint', { count: progress.settings.missing.length })}
          percent={pct(progress.settings.done, progress.settings.total)}
          href="/admin/settings"
          cta={t('settings.cta')}
        />
        <Card
          title={t('roles.title')}
          counter={t('counter', { done: progress.roles.done, total: progress.roles.total })}
          text={t('roles.text')}
          hint={t('roles.hint')}
          percent={pct(progress.roles.done, progress.roles.total)}
          href="/admin/roles"
          cta={t('roles.cta')}
        />
        <Card
          title={t('modules.title')}
          counter={t('counter', { done: progress.modules.done, total: progress.modules.total })}
          text={progress.modules.total === 0 ? t('modules.none') : t('modules.text')}
          hint={t('modules.hint')}
          percent={pct(progress.modules.done, progress.modules.total)}
          href="/admin/modules"
          cta={t('modules.cta')}
        />
        {canSeeWebsite ? (
          <Card
            title={t('website.title')}
            counter={t('website.count', { count: publishList.length })}
            text={t('website.text')}
            hint={websiteHint}
            href="/site/publish"
            cta={t('website.cta')}
          />
        ) : null}
      </div>
      <p className="flex max-w-[820px] gap-2 rounded-md border border-info bg-info-bg p-3 text-[13px] leading-[1.55] text-ink-2">
        <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <span>{readSetting<string | null>(deps, 'system.lastExportAt') ? t('backupDone') : t('backupMissing')}</span>
      </p>
    </div>
  );
}
