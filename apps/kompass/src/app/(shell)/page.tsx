import { listModules, listRoles, readAllSettings, readSetting } from '@kompass/core';
import { Info } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { computeSetupProgress } from '@/lib/setup-progress';
import { requireSession } from '@/lib/request-context';

function Card({ title, counter, text, hint, percent, href, cta }: { title: string; counter: string; text: string; hint: string; percent: number; href: string; cta: string }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-[18px]">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-heading text-[17px]">{title}</h3>
        <span className="font-mono text-[12px] text-muted-ink">{counter}</span>
      </div>
      <p className="min-h-[63px] text-[14px] leading-[1.5] text-ink-2">{text}</p>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden><div className="h-full bg-brand" style={{ width: `${percent}%` }} /></div>
      <p className="text-[12px] text-muted-ink">{hint}</p>
      <Link href={href} className={buttonVariants({ variant: 'secondary', className: 'w-fit' })}>{cta}</Link>
    </section>
  );
}

export default async function HomePage() {
  const { deps, ctx, user } = await requireSession();
  const t = await getTranslations('home');
  const roles = await listRoles(deps, ctx);
  const progress = computeSetupProgress({ settings: readAllSettings(deps), roleCount: roles.ok ? roles.value.length : 0, modules: listModules(deps) });
  const pct = (d: number, tot: number) => (tot === 0 ? 0 : Math.round((d / tot) * 100));
  const firstName = user.name.split(' ')[0] ?? user.name;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-heading text-[26px]">{t('greeting', { name: firstName })}</h2>
        <p className="mt-1 text-[15px] leading-[1.55] text-ink-2">{t('intro')}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card title={t('settings.title')} counter={t('counter', { done: progress.settings.done, total: progress.settings.total })} text={t('settings.text')} hint={t('settings.hint', { count: progress.settings.missing.length })} percent={pct(progress.settings.done, progress.settings.total)} href="/admin/settings" cta={t('settings.cta')} />
        <Card title={t('roles.title')} counter={t('counter', { done: progress.roles.done, total: progress.roles.total })} text={t('roles.text')} hint={t('roles.hint')} percent={pct(progress.roles.done, progress.roles.total)} href="/admin/roles" cta={t('roles.cta')} />
        <Card title={t('modules.title')} counter={t('counter', { done: progress.modules.done, total: progress.modules.total })} text={progress.modules.total === 0 ? t('modules.none') : t('modules.text')} hint={t('modules.hint')} percent={pct(progress.modules.done, progress.modules.total)} href="/admin/modules" cta={t('modules.cta')} />
      </div>
      <p className="flex max-w-[820px] gap-2 rounded-md border border-info bg-info-bg p-3 text-[13px] leading-[1.55] text-ink-2">
        <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <span>{readSetting<string | null>(deps, 'system.lastExportAt') ? t('backupDone') : t('backupMissing')}</span>
      </p>
    </div>
  );
}
