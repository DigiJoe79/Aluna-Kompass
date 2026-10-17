import { parseHandbookIndex, readHandbookIndex, readHandbookPage } from '@kompass/core';
import { renderHandbook } from '@kompass/markdown';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { HandbookToc } from '@/components/handbook-toc';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
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
      // Das Verzeichnis als Raster in bis zu drei Spalten statt einer schmalen Spalte auf breitem Grund (01 B22).
      // Kein Layout-Test (AGENTS.md).
      <Page width="standard" header={<PageHeader title={t('title')} />}>
        <HandbookToc chapters={chapters} current={null} className="grid items-start gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3" />
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
        {/* Der Artikeltitel ist das `h1` der Seite (`PageHeader`, Spec Seitenkopf § 2.2), außerhalb von
            `prose-preview`, damit er nicht deren Überschriftenabstände erbt. Der Rumpf beginnt ohne `# Titel`
            (`parseHandbookPage`), seine Überschriften senkt `renderHandbook` um eine Stufe. */}
        <article className="min-w-0 max-w-[72ch] flex-1">
          <PageHeader title={page.title} />
          <div className="prose-preview" dangerouslySetInnerHTML={{ __html: html }} />
        </article>
      </div>
    </Page>
  );
}
