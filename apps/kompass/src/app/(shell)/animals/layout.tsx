import { isModuleEnabled } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { requireSession } from '@/lib/request-context';

export default async function AnimalsLayout({ children }: { children: ReactNode }) {
  const { deps } = await requireSession();
  if (isModuleEnabled(deps, 'animals')) return <>{children}</>;
  const t = await getTranslations('animals.common');
  return (
    <section className="max-w-[720px] rounded-lg border border-line bg-surface p-7">
      <h2 className="font-heading text-[20px]">{t('moduleInactiveTitle')}</h2>
      <p className="mt-2 text-[14px] text-ink-2">{t('moduleInactiveText')}</p>
      <Link href="/admin/modules" className={buttonVariants({ className: 'mt-4' })}>{t('openModules')}</Link>
    </section>
  );
}
