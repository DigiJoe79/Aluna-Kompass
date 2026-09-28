import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

/**
 * Sperre „Modul inaktiv“, wenn ein Modul ausgeschaltet ist — Muster
 * `(shell)/animals/layout.tsx`. `namespace` zeigt auf einen Block mit
 * `moduleInactiveTitle`, `moduleInactiveText`, `openModules`.
 */
export async function ModuleInactiveCard({ namespace }: { namespace: string }) {
  const t = await getTranslations(namespace);
  return (
    <section className="max-w-[720px] rounded-lg border border-line bg-surface p-7">
      <h2 className="font-heading text-[20px]">{t('moduleInactiveTitle')}</h2>
      <p className="mt-2 text-[14px] text-ink-2">{t('moduleInactiveText')}</p>
      <Link href="/admin/modules" className={buttonVariants({ className: 'mt-4' })}>
        {t('openModules')}
      </Link>
    </section>
  );
}
