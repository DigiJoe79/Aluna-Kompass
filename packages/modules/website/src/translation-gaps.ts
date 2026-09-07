import { translationGaps } from '@kompass/core';

export interface TranslationGap {
  collection: string;
  id: string;
  field: string;
}

const idOf = (record: Record<string, unknown>): string => String(record.key ?? record.slug ?? record.id ?? '?');

export function collectTranslationGaps(content: Record<string, unknown>, locales: readonly string[]): TranslationGap[] {
  const gaps: TranslationGap[] = [];
  for (const [collection, rows] of Object.entries(content)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const record = row as Record<string, unknown>;
      for (const field of translationGaps(record, Object.keys(record), locales)) gaps.push({ collection, id: idOf(record), field });
    }
  }
  return gaps;
}
