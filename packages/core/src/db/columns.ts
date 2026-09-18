import { text } from 'drizzle-orm/sqlite-core';
import type { LocalizedText } from '../i18n/localized';

export const localizedColumn = (name: string) => text(name, { mode: 'json' }).$type<LocalizedText>().notNull();
