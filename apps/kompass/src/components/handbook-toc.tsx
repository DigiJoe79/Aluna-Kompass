import type { HandbookChapter } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/** Das Inhaltsverzeichnis des Handbuchs, links neben der Seite und als Seite `/help`. */
export async function HandbookToc({ chapters, current }: { chapters: HandbookChapter[]; current: string | null }) {
  const t = await getTranslations('help');
  return (
    <nav aria-label={t('toc')} className="flex flex-col gap-3 text-[14px]">
      {chapters.map((chapter) => {
        const single = chapter.pages.length === 1 && chapter.pages[0]!.title === chapter.title;
        return (
          <div key={chapter.title} className="flex flex-col gap-0.5">
            {single ? (
              <Link href={`/help/${chapter.pages[0]!.doc}`} aria-current={current === chapter.pages[0]!.doc ? 'page' : undefined} className={cn('rounded-md px-2 py-1 font-semibold hover:bg-hover', current === chapter.pages[0]!.doc && 'bg-selected text-selected-ink')}>
                {chapter.title}
              </Link>
            ) : (
              <>
                <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-[.09em] text-muted-ink">{chapter.title}</div>
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
