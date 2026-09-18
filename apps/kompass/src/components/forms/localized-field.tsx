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

export function LocalizedField({
  name,
  label,
  kind = 'input',
  value,
  rows = 4,
  hint,
  errors,
  required,
  locales,
}: {
  name: string;
  label: string;
  kind?: 'input' | 'textarea' | 'markdown';
  value: LocalizedText;
  rows?: number;
  hint?: string;
  errors?: Record<string, string>;
  required?: boolean;
  locales: string[];
}) {
  const t = useTranslations('content');
  const [text, setText] = useState<LocalizedText>(value);
  const leading = locales[0] ?? 'de';
  const [previewLocale, setPreviewLocale] = useState<string>(leading);
  const [activeTab, setActiveTab] = useState<string>(leading);
  const error = errors?.[name] ?? errors?.[`${name}.${leading}`];

  const field = (locale: string) => {
    const id = `${name}-${locale}`;
    const isLeading = locale === leading;
    const props = {
      id,
      name: `${name}.${locale}`,
      value: text[locale] ?? '',
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setText({ ...text, [locale]: e.target.value }),
      required: required && isLeading,
      'aria-invalid': isLeading && !!error ? true : undefined,
    };
    const isHidden = locales.length >= 4 && locale !== activeTab;
    return (
      <div key={locale} className={cn('flex min-w-0 flex-col gap-1', isHidden && 'hidden')}>
        <Label htmlFor={id} className="flex items-center gap-2 text-[12px] font-semibold text-muted-ink">
          <span className="rounded-sm bg-badge px-1.5 py-0.5 font-mono text-[10px] text-badge-ink">
            {locale.toUpperCase()}
          </span>
          {locale !== leading && (text[leading] ?? '').length > 0 && (text[locale] ?? '').length === 0 ? (
            <span className="text-warning">{t('untranslated')}</span>
          ) : null}
        </Label>
        {kind === 'input' ? (
          <Input {...props} />
        ) : (
          <Textarea {...props} rows={rows} className={cn(kind === 'markdown' && 'font-mono text-[13px]')} />
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-1.5 md:col-span-2">
      <span className="text-[13px] font-semibold text-ink-2">
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-1.5 font-bold text-brand-accent">
            *
          </span>
        ) : null}
      </span>
      {locales.length >= 4 ? (
        <div className="flex flex-wrap gap-1 border-b border-subtle pb-1">
          {locales.map((l) => {
            const isUntranslated = l !== leading && (text[leading] ?? '').length > 0 && (text[l] ?? '').length === 0;
            return (
              <button
                key={l}
                type="button"
                onClick={() => setActiveTab(l)}
                className={cn(
                  'flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[12px] font-medium transition-colors',
                  activeTab === l ? 'bg-panel-selected font-semibold text-ink' : 'text-muted-ink hover:text-ink',
                )}
              >
                <span className="font-mono text-[10px] uppercase">{l}</span>
                {isUntranslated ? <span className="h-1.5 w-1.5 rounded-full bg-warning" title={t('untranslated')} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      <div
        className={cn(
          'grid gap-3',
          locales.length === 1 ? 'grid-cols-1' : locales.length === 2 ? 'md:grid-cols-2' : locales.length === 3 ? 'md:grid-cols-3' : 'grid-cols-1',
        )}
      >
        {locales.map((l) => field(l))}
      </div>
      {hint && !error ? <p className="text-[12px] text-muted-ink">{hint}</p> : null}
      <FieldError id={`${name}-error`} message={error} />
      {kind === 'markdown' ? (
        <div className="mt-1 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="text-muted-ink">{t('preview')}</span>
            {locales.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={previewLocale === l}
                onClick={() => setPreviewLocale(l)}
                className={cn(
                  'rounded-sm px-2 py-0.5 font-mono',
                  previewLocale === l ? 'bg-brand text-on-brand' : 'bg-badge text-badge-ink',
                )}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <MarkdownPreview markdown={text[previewLocale] ?? ''} />
        </div>
      ) : null}
    </div>
  );
}
