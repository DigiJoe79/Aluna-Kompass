import { isModuleEnabled } from '@kompass/core';
import type { ReactNode } from 'react';
import { ModuleInactiveCard } from '@/components/module-inactive-card';
import { Page } from '@/components/page';
import { requireSession } from '@/lib/request-context';

export default async function FinanceLayout({ children }: { children: ReactNode }) {
  const { deps } = await requireSession();
  if (isModuleEnabled(deps, 'finance')) return <>{children}</>;
  return (
    <Page width="task">
      <ModuleInactiveCard namespace="finance.common" />
    </Page>
  );
}
