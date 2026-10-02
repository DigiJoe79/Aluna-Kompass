import { ChevronRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Fragment } from 'react';
import { ancestorsOf, nameOf } from '@/lib/folder-tree-model';
import { cn } from '@/lib/utils';

/**
 * Über der Liste: wo man ist (README § 3, Artboard 1). Der Weg nennt die
 * Elternordner als Links, mit Pfeilen statt Schrägstrichen; darunter Titel
 * und Anzahl. Die Anzahl ist die der Liste — der geöffnete Ordner zeigt seinen
 * ganzen Teilbaum, deshalb steht hier kein „davon … direkt“ (Spec § 9).
 */
export async function FolderHeading({
  folder,
  inbox,
  count,
  readableOnly,
  className,
}: {
  folder: string | null;
  inbox: boolean;
  count: number;
  /** Nur mit Bereichsrecht: die Zahl zählt nur Lesbares, und das steht dabei (Artboard 9b). */
  readableOnly: boolean;
  className?: string;
}) {
  const t = await getTranslations('dms');
  const ancestors = folder === null ? [] : ancestorsOf(folder);
  const title = inbox ? t('inbox') : folder === null ? t('allDocuments') : nameOf(folder);
  return (
    <div data-testid="folder-heading" className={cn('mb-3 flex flex-col gap-[3px]', className)}>
      {ancestors.length > 0 ? (
        <nav aria-label={t('heading.path')} className="flex flex-wrap items-center gap-1 text-[13px] text-muted-ink">
          {ancestors.map((path) => (
            <Fragment key={path}>
              <Link href={`/dms?folder=${encodeURIComponent(path)}`} className="wrap-anywhere text-link hover:underline">
                {nameOf(path)}
              </Link>
              <ChevronRight className="size-3 shrink-0 text-muted-ink-2" strokeWidth={2.4} aria-hidden />
            </Fragment>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <h2 className="font-heading text-[20px] wrap-anywhere text-ink">{title}</h2>
        <span className="text-[13px] text-muted-ink">{readableOnly ? t('heading.countReadable', { count }) : t('heading.count', { count })}</span>
      </div>
    </div>
  );
}
