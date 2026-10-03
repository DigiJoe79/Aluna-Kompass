import { requirePermission } from '@kompass/core';
import { activeTemplate, listPublishes, siteCacheStatus, siteContentHash } from '@kompass/module-site';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { runtimeEnv } from '@/lib/deps';
import { requireSession } from '@/lib/request-context';
import { siteEnv } from '@/lib/site-env';
import { PublishClient } from './publish-client';
import { PublishTarget } from './publish-target';

export default async function PublishPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'site.publish')) return <ForbiddenCard permission="site.publish" />;
  const t = await getTranslations('site.publish');
  // „Publizieren“ steht auch ohne Template in der Leiste; jeder Lauf endete an
  // `noTemplate`, deshalb ein Leerzustand mit dem Weg in die Einstellungen.
  if (!activeTemplate(deps)) {
    const canManage = !requirePermission(ctx, 'site.manage');
    return (
      <>
        <PageHeader title={t('title')} />
        <EmptyState
          title={t('title')}
          text={t('empty.text')}
          action={canManage ? <Link href="/admin/site?panel=template" className={buttonVariants({ variant: 'outline' })}>{t('empty.action')}</Link> : null}
        />
      </>
    );
  }
  const env = runtimeEnv().env;
  const se = siteEnv();
  const historyRes = await listPublishes(deps, ctx, { environment: env });
  const history = historyRes.ok ? historyRes.value : [];
  // Ohne `site.manage` liefert der Dienst `forbidden`; dann kein Hinweis.
  const cache = siteCacheStatus(deps, ctx, se);
  const imageCacheEmpty = cache.ok && cache.value.images.count === 0;
  // Der Stand der Inhalte jetzt, ohne Kopie der Bilder (Sekunden): Damit erkennt die Seite nach dem Neuladen,
  // ob die letzte Vorschau noch gilt. Nach jedem Lauf frisch, denn der Poller ruft bei Start und Ende
  // `router.refresh()` auf dieser Seite.
  const hash = await siteContentHash(deps, ctx);
  const currentHash = hash.ok ? hash.value.contentHash : null;
  const lastPublishedAt = history.find((h) => h.status === 'success')?.startedAt ?? null;

  return (
    <>
      <PageHeader title={t('title')} />
      <div className="flex max-w-[880px] flex-col gap-4">
        <PublishTarget env={env} publicUrl={se.publicUrl} />
        <PublishClient
          env={env}
          publicUrl={se.publicUrl}
          hasDeploy={se.deploy !== null}
          canManage={!requirePermission(ctx, 'site.manage')}
          imageCacheEmpty={imageCacheEmpty}
          history={history}
          currentHash={currentHash}
          lastPublishedAt={lastPublishedAt}
        />
      </div>
    </>
  );
}
