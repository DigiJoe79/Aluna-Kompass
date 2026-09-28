import { isModuleEnabled } from '@kompass/core';
import type { ReactNode } from 'react';
import { ModuleInactiveCard } from '@/components/module-inactive-card';
import { requireSession } from '@/lib/request-context';

export default async function DmsLayout({ children }: { children: ReactNode }) {
  const { deps } = await requireSession();
  if (isModuleEnabled(deps, 'dms')) return <>{children}</>;
  return <ModuleInactiveCard namespace="dms.common" />;
}
