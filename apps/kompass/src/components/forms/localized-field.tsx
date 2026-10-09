'use client';

import type { LocalizedText } from '@kompass/core';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ComponentProps } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { FieldError } from './field-error';
import type { FieldSize } from './form-field';
import { FormCell } from './form-grid';
import { MarkdownPreview } from '../markdown-preview';

const UNITS: Record<FieldSize, number> = { s: 1, m: 2, l: 3, full: 4 };
const BY_UNITS: FieldSize[] = ['s', 's', 'm', 'l', 'full'];

/**
 * Die Spannweite eines mehrsprachigen Feldes im `FormGrid` (docs/MUSTER.md § J): `size` gilt je Sprache, die
 * nebeneinander stehenden Sprachen multiplizieren sie, höchstens `full`. Ab vier Sprachen stehen sie in Reitern,
 * dann gilt die Größe einer Sprache.
 */
export function localizedSize(size: FieldSize, localeCount: number): FieldSize {
  const sideBySide = localeCount >= 4 ? 1 : Math.max(1, localeCount);
  return BY_UNITS[Math.min(4, UNITS[size] * sideBySide)]!;
}

/**
 * Die Sprachspalten nach der Breite des Feldes (`@container` am Feld, nicht an der Karte): zwei nebeneinander ab
 * 520 px, drei ab 800 px, darunter untereinander. Entweder alle Sprachen in einer Reihe oder alle untereinander —
 * zwei oben und eine darunter ließe die dritte nachrangig wirken (HANDOFF Konsistenz § 8c). Ab vier Sprachen stehen
 * sie in Reitern, eine sichtbar. Ist schon eine Sprache `full` (Größe je Sprache), stehen sie immer untereinander,
 * jede über die volle Breite — nebeneinander würde jede Sprache schmaler als ihre Größe.
 */
export function languageColumns(localeCount: number, size?: FieldSize): string {
  if (size === 'full') return '';
  if (localeCount === 2) return '@[520px]:grid-cols-2';
  if (localeCount === 3) return '@[800px]:grid-cols-3';
  return '';
}

/** Der Sprachname zu einem Kürzel in der Sprache der Oberfläche („Deutsch“, „Brasilianisches Portugiesisch“). */
export function useLanguageName(): (code: string) => string {
  const uiLocale = useLocale();
  return (code: string) => {
    try {
      return new Intl.DisplayNames([uiLocale], { type: 'language' }).of(code) ?? code;
    } catch {
      return code;
    }
  };
}

/** Das Sprachkürzel im Stil der Marke (mono 11/600); feste Mindestbreite, damit die Texte bündig beginnen. */
const LOCALE_CODE = 'bg-badge font-mono text-[11px] font-semibold text-badge-ink';

/**
 * Einzeilige Eingabe einer Sprache: das Kürzel steht links im Feld als Präfix, aufgebaut wie das „€“ im
 * Betragsfeld (`finance/amount-field.tsx`). So liegen alle Eingaben einer Rasterzeile auf einer Linie
 * (docs/MUSTER.md § J). Den zugänglichen Namen bringt `aria-label` mit, das Kürzel selbst ist verborgen.
 */
export function LocaleInput({ locale, invalid, ...props }: ComponentProps<'input'> & { locale: string; invalid?: boolean }) {
  return (
    <div
      className={cn(
        'flex h-[var(--field-h)] min-w-0 items-stretch overflow-hidden rounded-md border bg-field transition-colors',
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
        // Feldrahmen im Fehlerzustand wie `ui/input`: aus `aria-invalid` am Feld, nicht aus einer eigenen Bedingung.
        'border-line-strong has-[[aria-invalid=true]]:border-error',
      )}
    >
      <span aria-hidden="true" className={cn('flex min-w-12 shrink-0 items-center justify-center border-r border-line px-1.5', LOCALE_CODE)}>
        {locale.toUpperCase()}
      </span>
      <input type="text" aria-invalid={invalid || undefined} {...props} className="w-full min-w-0 flex-1 bg-transparent px-2.5 text-[length:var(--field-font)] text-ink outline-none" />
    </div>
  );
}

/** Das Kürzel über einem mehrzeiligen Feld — dort bliebe ein Präfix nicht bündig mit der ersten Zeile. */
export function LocaleLabel({ htmlFor, locale }: { htmlFor: string; locale: string }) {
  return (
    <Label htmlFor={htmlFor} className="self-start">
      <span className={cn('rounded-sm px-1.5 py-0.5', LOCALE_CODE)}>{locale.toUpperCase()}</span>
    </Label>
  );
}

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
  size,
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
  /** Größe je Sprache; ohne Angabe `m` für eine Zeile, `l` für Langtext. */
  size?: FieldSize;
}) {
  const t = useTranslations('content');
  const languageName = useLanguageName();
  const [text, setText] = useState<LocalizedText>(value);
  const leading = locales[0] ?? 'de';
  const [previewLocale, setPreviewLocale] = useState<string>(leading);
  const [activeTab, setActiveTab] = useState<string>(leading);
  const error = errors?.[name] ?? errors?.[`${name}.${leading}`];

  const field = (locale: string) => {
    const id = `${name}-${locale}`;
    const isLeading = locale === leading;
    const isUntranslated = !isLeading && (text[leading] ?? '').length > 0 && (text[locale] ?? '').length === 0;
    const hintId = `${id}-untranslated`;
    const props = {
      id,
      name: `${name}.${locale}`,
      value: text[locale] ?? '',
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setText({ ...text, [locale]: e.target.value }),
      required: required && isLeading,
      'aria-invalid': isLeading && !!error ? true : undefined,
      'aria-label': t('localizedName', { label, language: languageName(locale) }),
      'aria-describedby': isUntranslated ? hintId : undefined,
    };
    const isHidden = locales.length >= 4 && locale !== activeTab;
    return (
      <div key={locale} className={cn('flex min-w-0 flex-col gap-1', isHidden && 'hidden')}>
        {kind === 'input' ? (
          <LocaleInput {...props} locale={locale} invalid={isLeading && !!error} />
        ) : (
          <>
            <LocaleLabel htmlFor={id} locale={locale} />
            <Textarea {...props} rows={rows} className={cn(kind === 'markdown' && 'font-mono text-[13px]')} />
          </>
        )}
        {isUntranslated ? (
          <p id={hintId} className="text-[12px] text-warning">
            {t('untranslated')}
          </p>
        ) : null}
      </div>
    );
  };

  const perLocale = size ?? (kind === 'input' ? 'm' : 'l');
  return (
    <FormCell size={localizedSize(perLocale, locales.length)} className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-ink-2">
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-1.5 font-bold text-brand-accent">
            *
          </span>
        ) : null}
      </span>
      {locales.length >= 4 ? (
        <div className="flex flex-wrap gap-1 border-b border-line pb-1">
          {locales.map((l) => {
            const isUntranslated = l !== leading && (text[leading] ?? '').length > 0 && (text[l] ?? '').length === 0;
            return (
              <button
                key={l}
                type="button"
                onClick={() => setActiveTab(l)}
                className={cn(
                  'flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[12px] font-medium transition-colors',
                  activeTab === l ? 'bg-selected font-semibold text-ink' : 'text-muted-ink hover:text-ink',
                )}
              >
                <span className="font-mono text-[10px] uppercase">{l}</span>
                {isUntranslated ? <span className="h-1.5 w-1.5 rounded-full bg-warning" title={t('untranslated')} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="@container">
        {/* Abstand wie `FormGrid`: Ein `m`-Feld mit zwei Sprachen liegt so genau auf den `s`-Spalten darüber (K10 § 4.6). */}
        <div className={cn('grid grid-cols-1 gap-x-5 gap-y-4', languageColumns(locales.length, perLocale))}>{locales.map((l) => field(l))}</div>
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
    </FormCell>
  );
}
