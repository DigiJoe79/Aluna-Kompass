'use client';

import type { LocalizedText } from '@kompass/core';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { FieldError } from './field-error';
import { MarkdownPreview } from '../markdown-preview';

export function LocalizedField({ name, label, kind = 'input', value, rows = 4, hint, errors, required }: { name: string; label: string; kind?: 'input' | 'textarea' | 'markdown'; value: LocalizedText; rows?: number; hint?: string; errors?: Record<string, string>; required?: boolean }) {
  const t = useTranslations('website.common');
  const [text, setText] = useState<LocalizedText>(value);
  const [previewLocale, setPreviewLocale] = useState<'de' | 'en'>('de');
  const error = errors?.[name] ?? errors?.[`${name}.de`];
  const field = (locale: 'de' | 'en') => {
    const id = `${name}-${locale}`;
    const props = { id, name: `${name}.${locale}`, value: text[locale] ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText({ ...text, [locale]: e.target.value }), required: required && locale === 'de', 'aria-invalid': locale === 'de' && !!error ? true : undefined };
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <Label htmlFor={id} className="flex items-center gap-2 text-[12px] font-semibold text-muted-ink">
          <span className="rounded-sm bg-badge px-1.5 py-0.5 font-mono text-[10px] text-badge-ink">{locale.toUpperCase()}</span>
          {locale === 'en' && (text['de'] ?? '').length > 0 && (text['en'] ?? '').length === 0 ? <span className="text-warning">{t('untranslated')}</span> : null}
        </Label>
        {kind === 'input' ? <Input {...props} className="h-9" /> : <Textarea {...props} rows={rows} className={cn(kind === 'markdown' && 'font-mono text-[13px]')} />}
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-1.5 md:col-span-2">
      <span className="text-[13px] font-semibold text-ink-2">{label}{required ? ' *' : ''}</span>
      <div className="grid gap-3 md:grid-cols-2">{field('de')}{field('en')}</div>
      {hint && !error ? <p className="text-[12px] text-muted-ink">{hint}</p> : null}
      <FieldError id={`${name}-error`} message={error} />
      {kind === 'markdown' ? (
        <div className="mt-1 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="text-muted-ink">{t('preview')}</span>
            {(['de', 'en'] as const).map((l) => <button key={l} type="button" aria-pressed={previewLocale === l} onClick={() => setPreviewLocale(l)} className={cn('rounded-sm px-2 py-0.5 font-mono', previewLocale === l ? 'bg-brand text-on-brand' : 'bg-badge text-badge-ink')}>{l.toUpperCase()}</button>)}
          </div>
          <MarkdownPreview markdown={text[previewLocale] ?? ''} />
        </div>
      ) : null}
    </div>
  );
}
