import { ChevronRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Fragment } from 'react';
import { ancestorsOf, nameOf } from '@/lib/folder-tree-model';
import { SectionHeading } from '@/components/section';
import { cn } from '@/lib/utils';
import { folderHref } from './folder-href';

/**
 * Über der Liste: wo man ist (README § 3, Artboard 1). Der Weg nennt die
 * Elternordner als Links, mit Pfeilen statt Schrägstrichen; darunter der Titel.
 * Die Zahl steht in der Zählzeile der Filterleiste, nicht hier — sonst stünde
 * sie zweimal da (Spec Filterleisten § 4).
 */
export async function FolderHeading({
  folder,
  inbox,
  unfiled = false,
  keep,
  className,
}: {
  folder: string | null;
  inbox: boolean;
  /** „Ohne Ordner“: ausgehende Dokumente ohne Ordner (Stufe 1, Auftrag 7). */
  unfiled?: boolean;
  /** Suche, Filter und Sortierung der Liste: Der Weg nach oben behält sie wie ein Klick im Baum. */
  keep: URLSearchParams;
  className?: string;
}) {
  const t = await getTranslations('dms');
  const ancestors = folder === null ? [] : ancestorsOf(folder);
  const title = inbox ? t('inbox') : unfiled ? t('noFolder') : folder === null ? t('allDocuments') : nameOf(folder);
  return (
    <div data-testid="folder-heading" className={cn('mb-3 flex flex-col gap-[3px] wrap-anywhere', className)}>
      {ancestors.length > 0 ? (
        <nav aria-label={t('heading.path')} className="flex flex-wrap items-center gap-1 text-meta text-muted-ink">
          {ancestors.map((path) => (
            <Fragment key={path}>
              <Link href={folderHref(keep, { folder: path })} className="wrap-anywhere text-link hover:underline">
                {nameOf(path)}
              </Link>
              <ChevronRight className="size-3 shrink-0 text-muted-ink-2" strokeWidth={2.4} aria-hidden />
            </Fragment>
          ))}
        </nav>
      ) : null}
      <SectionHeading level={2}>{title}</SectionHeading>
    </div>
  );
}
