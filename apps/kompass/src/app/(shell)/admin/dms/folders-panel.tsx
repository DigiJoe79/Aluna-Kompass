import { ArrowRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

/**
 * Ordner pflegt man in der Akte, im Baum (README § 3, Artboard 12). Die Karte
 * bleibt als Verweis für die, die sie hier suchen — und für das Handbuch
 * („Akte einrichten“); eine zweite, flache Übersicht könnte weniger als der Baum.
 */
export async function FoldersPanel() {
  const t = await getTranslations('dms.admin');
  return (
    <section data-testid="folders-moved" className="flex flex-wrap items-start gap-4 rounded-md border border-line bg-surface p-5">
      <div className="flex min-w-[240px] flex-1 flex-col gap-1">
        <p className="text-[13px] leading-[1.5] text-pretty text-ink-2">{t('foldersMoved')}</p>
      </div>
      <Link href="/dms" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        {t('toFile')}
        <ArrowRight aria-hidden />
      </Link>
    </section>
  );
}
