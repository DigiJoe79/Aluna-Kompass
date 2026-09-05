import { getTranslations } from 'next-intl/server';

export async function DocumentPreview({ id, number, pages }: { id: string; number: string; pages?: number }) {
  const t = await getTranslations('documents.preview');
  return (
    <aside className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-4">
      <div className="flex items-center justify-between text-[13px]"><span className="font-semibold">{t('title')} · <span className="font-mono">{number}</span></span>{pages ? <span className="text-muted-ink">{t('pages', { count: pages })}</span> : null}</div>
      <iframe title={`${t('title')} ${number}`} src={`/documents/${id}/file`} className="h-[640px] w-full rounded-sm border border-line-strong bg-surface" />
      <a href={`/documents/${id}/file`} download={`${number}.pdf`} className="text-[13px] text-link underline">{t('download')}</a>
    </aside>
  );
}