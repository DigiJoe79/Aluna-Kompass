import { isModuleEnabled } from '@kompass/core';
import type { ReactNode } from 'react';
import { ModuleInactiveCard } from '@/components/module-inactive-card';
import { requireSession } from '@/lib/request-context';

export default async function ContactsLayout({ children }: { children: ReactNode }) {
  const { deps } = await requireSession();
  if (isModuleEnabled(deps, 'contacts')) return <>{children}</>;
  return <ModuleInactiveCard namespace="contacts.common" />;
}
