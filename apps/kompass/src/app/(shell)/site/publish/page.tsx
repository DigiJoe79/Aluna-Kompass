import { requirePermission } from '@kompass/core';
import { activeTemplate, countPublishes, listPublishes, siteCacheStatus, siteContentHash } from '@kompass/module-site';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { runtimeEnv } from '@/lib/deps';
import { requireSession } from '@/lib/request-context';
import { siteEnv } from '@/lib/site-env';
import { PublishClient } from './publish-client';
import { PublishTarget } from './publish-target';
import { panelHref } from '@/components/panel-nav';

/** So viele Publishes liest „Letzte Publishes“; mehr nennt `ListTruncated`. */
const HISTORY_LIMIT = 20;

export default async function PublishPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'site.publish')) return <Page width="standard"><ForbiddenCard permission="site.publish" /></Page>;
  const t = await getTranslations('site.publish');
  // „Publizieren“ steht auch ohne Template in der Leiste; jeder Lauf endete an
  // `noTemplate`, deshalb ein Leerzustand mit dem Weg in die Einstellungen.
  if (!activeTemplate(deps)) {
    const canManage = !requirePermission(ctx, 'site.manage');
    return (
      <Page width="standard" header={<PageHeader title={t('title')} />}>
        <EmptyState
          title={t('title')}
          text={t('empty.text')}
          action={canManage ? <Link href={panelHref('/admin/site', 'template')} className={buttonVariants({ variant: 'outline' })}>{t('empty.action')}</Link> : null}
        />
      </Page>
    );
  }
  const env = runtimeEnv().env;
  const se = siteEnv();
  // „Letzte Publishes“ zeigt die jüngsten 20 und nennt die Gesamtzahl (`ListTruncated` in `history.tsx`).
  const [historyRes, historyCountRes] = await Promise.all([listPublishes(deps, ctx, { environment: env, limit: HISTORY_LIMIT }), countPublishes(deps, ctx, { environment: env })]);
  const history = historyRes.ok ? historyRes.value : [];
  const historyTotal = historyCountRes.ok ? historyCountRes.value : history.length;
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
    <Page width="standard" header={<PageHeader title={t('title')} />}>
      <div className="flex flex-col gap-4">
        <PublishTarget env={env} publicUrl={se.publicUrl} />
        <PublishClient
          env={env}
          publicUrl={se.publicUrl}
          hasDeploy={se.deploy !== null}
          canManage={!requirePermission(ctx, 'site.manage')}
          imageCacheEmpty={imageCacheEmpty}
          history={history}
          historyTotal={historyTotal}
          currentHash={currentHash}
          lastPublishedAt={lastPublishedAt}
        />
      </div>
    </Page>
  );
}
