import { widgetOf } from './field-schema';
import type { CollectionSchema } from './types';

const LABEL_WIDGETS = ['text', 'localized', 'markdown'];

/**
 * Wie die Listenseite einen Eintrag beschriftet: erstes textartiges Feld in
 * der Leitsprache, sonst Slug, sonst ID. Eine Regel für Maske und MCP.
 */
export function entryLabel(col: CollectionSchema, entry: { id: string; slug: string | null; data: unknown }, leading: string): string {
  const labelField = Object.entries(col.fields).find(([, f]) => LABEL_WIDGETS.includes(widgetOf(f)))?.[0];
  const data = (entry.data ?? {}) as Record<string, unknown>;
  const raw = labelField ? data[labelField] : undefined;
  const text = typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? String((raw as Record<string, string>)[leading] ?? '') : '';
  return text || entry.slug || entry.id;
}
