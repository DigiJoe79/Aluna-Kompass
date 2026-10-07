import { parseHandbookIndex, readHandbookIndex, readHandbookPage } from '@kompass/core';
import { renderHandbook } from '@kompass/markdown';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { HandbookToc } from '@/components/handbook-toc';
import { Page } from '@/components/page';
import { runtimeEnv } from '@/lib/deps';
import { requireSession } from '@/lib/request-context';

export default async function HelpPage({ params }: { params: Promise<{ doc?: string[] }> }) {
  await requireSession();
  const t = await getTranslations('help');
  const env = runtimeEnv();
  const chapters = parseHandbookIndex(readHandbookIndex(env));
  const { doc: segments } = await params;
  const doc = segments?.join('/') ?? null;

  if (!doc) {
    return (
      <Page width="standard">
        <div className="max-w-[72ch]">
          <h2 className="font-heading text-[22px]">{t('title')}</h2>
          <div className="mt-4">
            <HandbookToc chapters={chapters} current={null} />
          </div>
        </div>
      </Page>
    );
  }

  const page = readHandbookPage(env, doc);
  if (!page) notFound();
  const html = await renderHandbook(page.body, { doc });
  return (
    <Page width="standard">
      {/* Telefon (`max-sm`, Muster „Seitenrahmen“): Artikel und Verzeichnis untereinander, der Artikel zuerst —
          das ganze Verzeichnis davor schöbe den Text mehrere Bildschirme nach unten. Kein Layout-Test (Projektregel). */}
      <div className="flex gap-8 max-sm:flex-col-reverse">
        <aside className="w-60 shrink-0 max-sm:w-auto max-sm:border-t max-sm:border-line max-sm:pt-5">
          <HandbookToc chapters={chapters} current={doc} />
        </aside>
        <article className="prose-preview min-w-0 max-w-[72ch] flex-1">
          <h2 className="font-heading text-[22px]">{page.title}</h2>
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </article>
      </div>
    </Page>
  );
}
