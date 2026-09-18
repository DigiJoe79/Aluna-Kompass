import { translationGaps, type LocalizedText } from '@kompass/core';

export function localizedFromForm(formData: FormData, name: string, locales: readonly string[]): LocalizedText {
  return Object.fromEntries(locales.map((l) => [l, String(formData.get(`${name}.${l}`) ?? '').trim()]));
}

export function jsonFromForm<T>(formData: FormData, name: string, fallback: T): T {
  const raw = formData.get(`${name}__json`);
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function gapCount(record: Record<string, unknown>, fields: string[], locales: readonly string[]): number {
  return translationGaps(record, fields, locales).length;
}
