import { z } from 'zod';
import type { CallContext } from '../context';
import type { Deps } from '../deps';
import type { LocalizedValue, Translatable } from '../modules/manifest';
import { enabledManifests } from '../modules/service';
import { invalid, notFound, ok, type Result, type ServiceError } from '../result';
import { validate } from '../validate';
import { LOCALE_CODE, readLocales } from './locales';

export interface TranslationGap {
  entityType: string;
  id: string;
  label: string;
  href: string;
  field: string;
  /** Die fehlende Sprache. */
  locale: string;
  /** Der Ausgangstext in der Leitsprache — das, was der Client übersetzt. */
  source: { locale: string; text: LocalizedValue };
}

export interface TranslationGapList {
  gaps: TranslationGap[];
  /** Module, deren Inhalte der Aufrufer nicht lesen darf. */
  omitted: string[];
}

export interface TranslationWriteReport {
  applied: number;
  failed: { index: number; error: ServiceError }[];
}

export const translationGapsFilterSchema = z.object({
  locale: z.string().regex(LOCALE_CODE).optional(),
  entityType: z.string().min(1).optional(),
});

const itemSchema = z.object({
  entityType: z.string().min(1),
  id: z.string().min(1),
  field: z.string().min(1),
  locale: z.string().regex(LOCALE_CODE),
  text: z.union([z.string(), z.array(z.string())]),
});
export const translationsSetSchema = z.object({ items: z.array(itemSchema).min(1).max(500) });

const filled = (value: unknown): boolean =>
  typeof value === 'string' ? value.trim().length > 0 : Array.isArray(value) && value.length > 0;

/**
 * Alle Lücken über die eingeschalteten Module: Leitsprache gefüllt, Zielsprache
 * leer, Entwürfe eingeschlossen. Kein eigenes Recht — jedes Modul prüft sein
 * Ansichtsrecht im Haken; wer ein Modul nicht lesen darf, sieht es unter
 * `omitted`, damit „keine Lücken" nicht wie „alles übersetzt" aussieht.
 */
export async function listTranslationGaps(deps: Deps, ctx: CallContext, input: unknown = {}): Promise<Result<TranslationGapList>> {
  const parsed = validate(deps, translationGapsFilterSchema, input);
  if (!parsed.ok) return parsed;
  const locales = readLocales(deps);
  const leading = locales[0]!;
  const { locale: onlyLocale, entityType: onlyType } = parsed.value;
  if (onlyLocale && !locales.includes(onlyLocale)) return invalid([{ path: 'locale', message: 'unknownLocale' }]);

  const gaps: TranslationGap[] = [];
  const omitted: string[] = [];
  for (const manifest of enabledManifests(deps)) {
    if (!manifest.translatables) continue;
    const found = manifest.translatables(deps, ctx);
    if (!found.ok) {
      if (found.error.type === 'forbidden') {
        omitted.push(manifest.key);
        continue;
      }
      throw new Error(`translatables of ${manifest.key} failed: ${JSON.stringify(found.error)}`);
    }
    for (const record of found.value) {
      if (onlyType && record.entityType !== onlyType) continue;
      gaps.push(...gapsOf(record, locales, leading, onlyLocale));
    }
  }
  return ok({ gaps, omitted });
}

function gapsOf(record: Translatable, locales: readonly string[], leading: string, onlyLocale: string | undefined): TranslationGap[] {
  const targets = (record.locales ?? locales).filter((l) => l !== leading && locales.includes(l) && (!onlyLocale || l === onlyLocale));
  const out: TranslationGap[] = [];
  for (const [field, value] of Object.entries(record.fields)) {
    const source = value[leading];
    if (!filled(source)) continue;
    for (const locale of targets) {
      if (filled(value[locale])) continue;
      out.push({ entityType: record.entityType, id: record.id, label: record.label, href: record.href, field, locale, source: { locale: leading, text: source! } });
    }
  }
  return out;
}

/**
 * Schreibt Übersetzungen, nach Datensatz gebündelt: je Gruppe ein Aufruf des
 * zuständigen Moduls, das über seinen Update-Service schreibt (Recht,
 * Validierung, ein Audit-Eintrag). Kein Alles-oder-nichts über Datensätze
 * hinweg — eine gescheiterte Gruppe steht mit allen ihren Indizes in `failed`.
 */
export async function setTranslations(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<TranslationWriteReport>> {
  const parsed = validate(deps, translationsSetSchema, input);
  if (!parsed.ok) return parsed;
  const locales = readLocales(deps);
  const unknown = parsed.value.items.flatMap((item, i) => (locales.includes(item.locale) ? [] : [{ path: `items.${i}.locale`, message: 'unknownLocale' }]));
  if (unknown.length > 0) return invalid(unknown);

  const groups = new Map<string, { entityType: string; id: string; indexes: number[] }>();
  parsed.value.items.forEach((item, i) => {
    const key = `${item.entityType} ${item.id}`;
    const group = groups.get(key) ?? { entityType: item.entityType, id: item.id, indexes: [] };
    group.indexes.push(i);
    groups.set(key, group);
  });

  const writers = enabledManifests(deps).filter((m) => m.setTranslations);
  let applied = 0;
  const failed: TranslationWriteReport['failed'] = [];
  for (const group of groups.values()) {
    const items = group.indexes.map((i) => {
      const { field, locale, text } = parsed.value.items[i]!;
      return { field, locale, text };
    });
    let outcome: Result<unknown> | null = null;
    for (const manifest of writers) {
      const pending = manifest.setTranslations!(deps, ctx, { entityType: group.entityType, id: group.id, items });
      if (pending) {
        outcome = await pending;
        break;
      }
    }
    const result = outcome ?? notFound(group.entityType, group.id);
    if (result.ok) applied += items.length;
    else for (const index of group.indexes) failed.push({ index, error: result.error });
  }
  return ok({ applied, failed });
}
