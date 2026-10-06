import { isModuleEnabled } from '@kompass/core';
import type { ReactNode } from 'react';
import { ModuleInactiveCard } from '@/components/module-inactive-card';
import { Page } from '@/components/page';
import { requireSession } from '@/lib/request-context';

export default async function AnimalsLayout({ children }: { children: ReactNode }) {
  const { deps } = await requireSession();
  if (isModuleEnabled(deps, 'animals')) return <>{children}</>;
  return (
    <Page width="task">
      <ModuleInactiveCard namespace="animals.common" />
    </Page>
  );
}
