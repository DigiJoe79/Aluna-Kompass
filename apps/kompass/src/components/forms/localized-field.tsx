'use client';

import type { LocalizedText } from '@kompass/core';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
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
 * sie in Reitern, eine sichtbar. Ist schon eine Sprache `full` (Größe je Sprache), stehen sie erst ab einer breiten
 * Spalte nebeneinander (zwei ab 720 px, drei ab 1080 px), darunter untereinander — mehrsprachige Felder stehen ab `md`
 * nebeneinander (Designer Runde 3: 128, 130, Vorlage 190).
 */
export function languageColumns(localeCount: number, size?: FieldSize): string {
  if (size === 'full') return localeCount === 2 ? '@[720px]:grid-cols-2' : localeCount === 3 ? '@[1080px]:grid-cols-3' : '';
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

/**
 * Das Sprachkürzel im Stil der Marke (mono 11/600, MUSTER § J) — eine benannte Ausnahme von den Schriftstufen; auch die
 * Gegenüberstellung der Vorschläge nimmt sie (Designer 2026-10-10). Feste Mindestbreite setzt die Aufrufstelle.
 */
export const LOCALE_CODE = 'bg-badge font-mono text-key font-semibold text-badge-ink';

/**
 * Die Labelzeile einer Sprache (Designer 2026-10-16, Teil 2 Nr. 8; docs/MUSTER.md § J): links das Label des Feldes —
 * nur über der ersten Sprache —, rechts das Kürzel als `<label>` der Eingabe. Ein- und mehrzeilige Felder sehen so
 * gleich aus, und die Eingaben einer Rasterzeile liegen auf einer Linie. Den zugänglichen Namen der Eingabe bringt ihr
 * `aria-label` mit („‹Label› (‹Sprachname›)“).
 */
export function LocaleLabel({ htmlFor, locale, children }: { htmlFor: string; locale: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-5 items-end justify-between gap-2">
      {children ?? <span />}
      <Label htmlFor={htmlFor} className="shrink-0">
        <span className={cn('rounded-sm px-1.5 py-0.5', LOCALE_CODE)}>{locale.toUpperCase()}</span>
      </Label>
    </div>
  );
}

function areLocalizedEqual(a: LocalizedText | undefined, b: LocalizedText | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (a[k] !== b[k]) return false;
  }
  return true;
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
  onChange,
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
  onChange?: (value: LocalizedText) => void;
}) {
  const t = useTranslations('content');
  const languageName = useLanguageName();
  const [text, setText] = useState<LocalizedText>(value);
  const [prevValue, setPrevValue] = useState<LocalizedText>(value);
  // Nur ein gesteuertes Feld (mit `onChange`) folgt seinem Wert. Ohne hält das Formular die Eingaben selbst: Ein neuer
  // Stand vom Server — etwa nach einem Versionskonflikt — überschriebe sonst, was die Person getippt hat.
  if (onChange && !areLocalizedEqual(value, prevValue)) {
    setPrevValue(value);
    setText(value);
  }
  const leading = locales[0] ?? 'de';
  const [previewLocale, setPreviewLocale] = useState<string>(leading);
  const [activeTab, setActiveTab] = useState<string>(leading);
  const error = errors?.[name] ?? errors?.[`${name}.${leading}`];
  const tabbed = locales.length >= 4;
  const fieldLabel = (
    <span className="min-w-0 text-meta font-semibold text-ink-2">
      {label}
      {required ? (
        <span aria-hidden="true" className="ml-1.5 font-semibold text-brand-accent">
          *
        </span>
      ) : null}
    </span>
  );

  const field = (locale: string) => {
    const id = `${name}-${locale}`;
    const isLeading = locale === leading;
    const isUntranslated = !isLeading && (text[leading] ?? '').length > 0 && (text[locale] ?? '').length === 0;
    const hintId = `${id}-untranslated`;
    const props = {
      id,
      name: `${name}.${locale}`,
      value: text[locale] ?? '',
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const next = { ...text, [locale]: e.target.value };
        setText(next);
        onChange?.(next);
      },
      required: required && isLeading,
      'aria-invalid': isLeading && !!error ? true : undefined,
      'aria-label': t('localizedName', { label, language: languageName(locale) }),
      'aria-describedby': isUntranslated ? hintId : undefined,
    };
    const isHidden = tabbed && locale !== activeTab;
    return (
      <div key={locale} className={cn('flex min-w-0 flex-col gap-1', isHidden && 'hidden')}>
        <LocaleLabel htmlFor={id} locale={locale}>
          {isLeading && !tabbed ? fieldLabel : undefined}
        </LocaleLabel>
        {kind === 'input' ? <Input {...props} type="text" /> : <Textarea {...props} rows={rows} className={cn(kind === 'markdown' && ' text-meta')} />}
        {/* „Nicht übersetzt“ ist ein Hinweis, keine Warnung (§ A, 05 B16). */}
        {isUntranslated ? (
          <p id={hintId} className="text-hint text-muted-ink">
            {t('untranslated')}
          </p>
        ) : null}
      </div>
    );
  };

  const perLocale = size ?? (kind === 'input' ? 'm' : 'l');
  return (
    <FormCell size={localizedSize(perLocale, locales.length)} className="flex flex-col gap-1.5">
      {/* Ab vier Sprachen (Reiter) steht das Label über den Reitern, sonst in der Labelzeile der ersten Sprache. */}
      {tabbed ? fieldLabel : null}
      {tabbed ? (
        <div className="flex flex-wrap gap-1 border-b border-line pb-1">
          {locales.map((l) => {
            const isUntranslated = l !== leading && (text[leading] ?? '').length > 0 && (text[l] ?? '').length === 0;
            return (
              <button
                key={l}
                type="button"
                onClick={() => setActiveTab(l)}
                className={cn(
                  'flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-hint transition-colors',
                  activeTab === l ? 'bg-selected font-semibold text-ink' : 'text-muted-ink hover:text-ink',
                )}
              >
                <span className="font-mono text-key font-semibold">{l.toUpperCase()}</span>
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
      {hint && !error ? <p className="text-hint text-muted-ink">{hint}</p> : null}
      <FieldError id={`${name}-error`} message={error} />
      {kind === 'markdown' ? (
        <div className="mt-1 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-hint">
            {/* Runde 3, 190: Die Vorschau nennt das Feld, das sie zeigt. */}
            <span className="text-muted-ink">{t('preview', { label })}</span>
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
