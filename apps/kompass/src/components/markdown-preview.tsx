'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { renderMarkdownAction } from '@/lib/markdown-preview';

export function MarkdownPreview({ markdown }: { markdown: string }) {
  const t = useTranslations('website.common');
  const [html, setHtml] = useState('');
  useEffect(() => {
    const handle = setTimeout(() => { renderMarkdownAction(markdown).then(setHtml).catch(() => setHtml('')); }, 300);
    return () => clearTimeout(handle);
  }, [markdown]);
  if (!markdown.trim()) return <p className="text-[12px] text-muted-ink">{t('previewEmpty')}</p>;
  return <div className="prose-preview rounded-md border border-line bg-surface p-4 text-[14px]" dangerouslySetInnerHTML={{ __html: html }} />;
}
