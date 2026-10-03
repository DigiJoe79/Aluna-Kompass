import { enabledManifests, hasPermission, parseHandbookIndex, readHandbookIndex, readSetting } from '@kompass/core';
import type { ReactNode } from 'react';
import { DateFormatProvider } from '@/components/date-format-provider';
import { SiteJobIndicator } from '@/components/site/site-job-indicator';
import { SiteJobProvider } from '@/components/site/site-job-provider';
import { EnvBanner } from '@/components/shell/env-banner';
import type { DateFormatMode } from '@/lib/dates';
import { ShellFrame } from '@/components/shell/shell-frame';
import { appVersion, buildId } from '@/lib/build';
import { runtimeEnv } from '@/lib/deps';
import { bannerFor } from '@/lib/env-banner';
import { buildNavigation } from '@/lib/navigation';
import { requireSession } from '@/lib/request-context';

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const { deps, ctx, user } = await requireSession();
  const env = runtimeEnv();
  const context = { lastImportAt: readSetting<string | null>(deps, 'system.lastImportAt'), migrationCount: deps.migrationCount };
  const banner = bannerFor(env.env, context);
  const extraItems = Object.fromEntries(
    deps.registry.manifests.filter((m) => m.navigationFor).map((m) => [m.key, m.navigationFor!(deps)]),
  );
  const groups = buildNavigation({ manifests: deps.registry.manifests, enabledKeys: new Set(enabledManifests(deps).map((m) => m.key)), permissions: ctx.permissions, extraItems });
  const helpChapters = parseHandbookIndex(readHandbookIndex(env));
  const helpPages = helpChapters.flatMap((c) => c.pages.map((p) => ({ doc: p.doc, title: p.title, chapter: c.title })));
  const logoId = readSetting<string | null>(deps, 'branding.logoAssetId');
  // Die einzige modulbezogene Zeile der Hülle: Wer die Webseite veröffentlichen
  // darf, sieht in der Kopfzeile, was gerade läuft. Ein allgemeiner Haken im
  // Manifest lohnt erst bei einem zweiten Modul.
  const siteJobs = enabledManifests(deps).some((m) => m.key === 'site') && hasPermission(ctx, 'site.publish');
  const frame = (
    <ShellFrame organization={readSetting<string>(deps, 'organization.name')} logoUrl={logoId ? `/media/${logoId}` : null} groups={groups} build={buildId()} version={appVersion()} user={{ name: user.name }} permissions={[...ctx.permissions]} helpChapters={helpChapters} helpPages={helpPages} extras={siteJobs ? <SiteJobIndicator key="site-jobs" /> : undefined}>
      <DateFormatProvider mode={readSetting<DateFormatMode>(deps, 'ui.dateFormat')}>{children}</DateFormatProvider>
    </ShellFrame>
  );
  // Feste Höhe, nicht „mindestens“: Gescrollt wird im Hauptbereich. Mit
  // `min-h-screen` konnte ein einzelner Bildschirm die Hülle aufblähen — der
  // Splitscreen der Akte tat es und liess unter sich tote Fläche.
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {banner ? <EnvBanner banner={banner} context={context} /> : null}
      {siteJobs ? <SiteJobProvider>{frame}</SiteJobProvider> : frame}
    </div>
  );
}
