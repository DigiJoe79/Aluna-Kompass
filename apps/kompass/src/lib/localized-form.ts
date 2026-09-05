import { translationGaps, type LocalizedText } from '@kompass/core';

export function localizedFromForm(formData: FormData, name: string): LocalizedText {
  const read = (locale: 'de' | 'en') => String(formData.get(`${name}.${locale}`) ?? '').trim();
  return { de: read('de'), en: read('en') };
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

export function gapCount(record: Record<string, unknown>, fields: string[]): number {
  return translationGaps(record, fields).length;
}
