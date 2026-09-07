import { z } from 'zod';

/** Text je Sprachschlüssel. Welche Schlüssel gültig sind, entscheidet die Installation. */
export type LocalizedText = Record<string, string>;

/**
 * Nimmt beliebige Sprachschlüssel an und prüft nur die Werte. Ob die Schlüssel
 * zu den gepflegten Sprachen passen und die Leitsprache gefüllt ist, prüft
 * `validate` — die Schemata entstehen beim Import, die Sprachen stehen in der
 * Datenbank.
 */
export function localizedText(opts: { required?: boolean; max?: number } = {}): z.ZodType<LocalizedText> {
  const max = opts.max ?? 20_000;
  return z
    .record(z.string().regex(/^[a-z]{2}(-[a-z]{2})?$/), z.string().trim().max(max))
    .meta({ localized: true, required: opts.required ?? false, max }) as unknown as z.ZodType<LocalizedText>;
}

/** Wie `localizedText`, nur trägt jede Sprache eine Liste kurzer Begriffe. */
export function localizedList(opts: { max?: number; itemMax?: number } = {}): z.ZodType<Record<string, string[]>> {
  const item = z.string().trim().min(1).max(opts.itemMax ?? 40);
  return z
    .record(z.string().regex(/^[a-z]{2}(-[a-z]{2})?$/), z.array(item).max(opts.max ?? 12))
    .meta({ localized: true, required: false, list: true }) as unknown as z.ZodType<Record<string, string[]>>;
}

export const emptyLocalized = (locales: readonly string[]): LocalizedText =>
  Object.fromEntries(locales.map((l) => [l, '']));

export function resolveText(text: LocalizedText, locale: string, fallback: string): { value: string; fallback: string | null } {
  const value = text[locale];
  if (value && value.length > 0) return { value, fallback: null };
  const alternative = text[fallback] ?? '';
  return { value: alternative, fallback: locale === fallback || alternative.length === 0 ? null : fallback };
}

const isLocalized = (v: unknown): v is LocalizedText =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string');

/** Felder, deren Leitsprache gefüllt ist, während eine weitere Sprache fehlt. */
export function translationGaps(record: Record<string, unknown>, fields: string[], locales: readonly string[]): string[] {
  const [leading, ...rest] = locales;
  if (!leading || rest.length === 0) return [];
  return fields.filter((field) => {
    const value = record[field];
    if (!isLocalized(value)) return false;
    return (value[leading] ?? '').length > 0 && rest.some((l) => (value[l] ?? '').length === 0);
  });
}
