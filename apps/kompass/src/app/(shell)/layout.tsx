import { enabledManifests, readSetting } from '@kompass/core';
import type { ReactNode } from 'react';
import { EnvBanner } from '@/components/shell/env-banner';
import { ShellFrame } from '@/components/shell/shell-frame';
import { runtimeEnv } from '@/lib/deps';
import { bannerFor } from '@/lib/env-banner';
import { buildNavigation } from '@/lib/navigation';
import { requireSession } from '@/lib/request-context';

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const { deps, ctx, user } = await requireSession();
  const env = runtimeEnv();
  const context = { lastImportAt: readSetting<string | null>(deps, 'system.lastImportAt'), migrationCount: deps.migrationCount };
  const banner = bannerFor(env.env, context);
  const groups = buildNavigation({ manifests: deps.registry.manifests, enabledKeys: new Set(enabledManifests(deps).map((m) => m.key)), permissions: ctx.permissions });
  const logoId = readSetting<string | null>(deps, 'branding.logoAssetId');
  return (
    <div className="flex min-h-screen flex-col">
      {banner ? <EnvBanner banner={banner} context={context} /> : null}
      <ShellFrame organization={readSetting<string>(deps, 'organization.name')} logoUrl={logoId ? `/media/${logoId}` : null} groups={groups} user={{ name: user.name, roleNames: user.roles.map((r) => r.name) }} permissions={[...ctx.permissions]}>
        {children}
      </ShellFrame>
    </div>
  );
}
