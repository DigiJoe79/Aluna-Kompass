import { z } from 'zod';

export const LOCALES = ['de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'de';

export interface LocalizedText {
  de: string;
  en: string;
}

export function localizedText(opts: { required?: boolean; max?: number } = {}): z.ZodType<LocalizedText> {
  const max = opts.max ?? 20_000;
  const de = opts.required ? z.string().trim().min(1).max(max) : z.string().trim().max(max).default('');
  const en = z.string().trim().max(max).default('');
  return z.object({ de, en }) as unknown as z.ZodType<LocalizedText>;
}

export const emptyLocalized = (): LocalizedText => ({ de: '', en: '' });

export function resolveText(text: LocalizedText, locale: Locale): { value: string; fallback: Locale | null } {
  const value = text[locale];
  if (value && value.length > 0) return { value, fallback: null };
  return { value: text[DEFAULT_LOCALE], fallback: locale === DEFAULT_LOCALE ? null : DEFAULT_LOCALE };
}

const isLocalized = (v: unknown): v is LocalizedText => typeof v === 'object' && v !== null && 'de' in v && 'en' in v;

export function translationGaps(record: Record<string, unknown>, fields: string[]): string[] {
  return fields.filter((field) => {
    const value = record[field];
    return isLocalized(value) && value.de.length > 0 && value.en.length === 0;
  });
}
