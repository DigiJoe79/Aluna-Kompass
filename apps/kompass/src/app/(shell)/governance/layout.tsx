import { isModuleEnabled } from '@kompass/core';
import type { ReactNode } from 'react';
import { ModuleInactiveCard } from '@/components/module-inactive-card';
import { Page } from '@/components/page';
import { requireSession } from '@/lib/request-context';

export default async function GovernanceLayout({ children }: { children: ReactNode }) {
  const { deps } = await requireSession();
  if (isModuleEnabled(deps, 'governance')) return <>{children}</>;
  return (
    <Page width="task">
      <ModuleInactiveCard namespace="governance.common" />
    </Page>
  );
}
