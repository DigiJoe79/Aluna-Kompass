import type { HandbookChapter } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Overline } from '@/components/overline';

/** Das Inhaltsverzeichnis des Handbuchs, links neben der Seite und als Seite `/help`. */
/**
 * Alle Bereiche gleich gesetzt (01 B22): Ein Bereich mit genau einer Seite ist ein gewöhnlicher Link wie die
 * Unterseiten der anderen, nicht fett — sonst wirkte er wichtiger als die Bereiche mit Overline. `className`
 * setzt auf der Seite `/help` das Raster in Spalten.
 */
export async function HandbookToc({ chapters, current, className }: { chapters: HandbookChapter[]; current: string | null; className?: string }) {
  const t = await getTranslations('help');
  return (
    <nav aria-label={t('toc')} className={cn('flex flex-col gap-3 text-body', className)}>
      {chapters.map((chapter) => {
        const single = chapter.pages.length === 1 && chapter.pages[0]!.title === chapter.title;
        return (
          <div key={chapter.title} className="flex flex-col gap-0.5">
            {single ? (
              <Link href={`/help/${chapter.pages[0]!.doc}`} aria-current={current === chapter.pages[0]!.doc ? 'page' : undefined} className={cn('rounded-md px-2 py-1 text-ink-2 hover:bg-hover hover:text-ink', current === chapter.pages[0]!.doc && 'bg-selected font-semibold text-selected-ink')}>
                {chapter.title}
              </Link>
            ) : (
              <>
                <Overline as="div" className="px-2 py-1">{chapter.title}</Overline>
                {chapter.pages.map((page) => (
                  <Link key={page.doc} href={`/help/${page.doc}`} aria-current={current === page.doc ? 'page' : undefined} className={cn('rounded-md px-2 py-1 text-ink-2 hover:bg-hover hover:text-ink', current === page.doc && 'bg-selected font-semibold text-selected-ink')}>
                    {page.title}
                  </Link>
                ))}
              </>
            )}
          </div>
        );
      })}
    </nav>
  );
}
