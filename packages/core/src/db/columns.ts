import { text } from 'drizzle-orm/sqlite-core';
import type { LocalizedText } from '../i18n/localized';

/** Jede mehrsprachige Spalte trägt sich ein, damit ein Sprachwechsel sie findet. */
export const LOCALIZED_COLUMNS: { table: string; column: string }[] = [];

export const localizedColumn = (name: string, table?: string) => {
  if (table) LOCALIZED_COLUMNS.push({ table, column: name });
  return text(name, { mode: 'json' }).$type<LocalizedText>().notNull();
};
