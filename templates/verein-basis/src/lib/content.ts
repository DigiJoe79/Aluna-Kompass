import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { InferContent } from '@kompass/site-template';
import template from '../../kompass.template';

/**
 * Ein mehrsprachiges Feld ist ein Record über Sprachschlüssel, genau wie Kompass
 * es exportiert. Dieses Template rendert eine Sprache; welche, sagt `LOCALE`.
 */
export type { Localized } from '@kompass/site-template';
import type { Localized } from '@kompass/site-template';

export const LOCALE = process.env.SITE_LOCALE ?? 'de';

/** Wert eines mehrsprachigen Feldes in der gerenderten Sprache, sonst leer. */
export function t(field: Localized | string | undefined | null): string {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  return field[LOCALE] ?? Object.values(field)[0] ?? '';
}

/**
 * Die Form von content.json kommt aus der Deklaration, nicht aus einer zweiten
 * Abschrift: Wer in kompass.template.ts ein Feld umbenennt, bekommt hier einen
 * Typfehler statt einer leeren Seite.
 */
export type SiteContent = InferContent<typeof template>;
export type Asset = SiteContent['assets'][number];
export type Variables = SiteContent['variables'];
export type NewsEntry = SiteContent['collections']['news'][number];
export type TeamEntry = SiteContent['collections']['team'][number];
export type FaqEntry = SiteContent['collections']['faq'][number];
export type DocumentEntry = SiteContent['collections']['documents'][number];

export const CONTENT_DIR = process.env.SITE_CONTENT_DIR ?? path.resolve(process.cwd(), 'fixtures/example');
export const PUBLIC_URL = process.env.SITE_PUBLIC_URL ?? 'https://example.org';
export const IS_STAGING = process.env.SITE_STAGING === '1';

const EMPTY: SiteContent = {
  variables: {},
  collections: { news: [], team: [], faq: [], documents: [] },
  views: {},
  assets: [],
};

let cache: Promise<SiteContent> | null = null;
export function loadContent(): Promise<SiteContent> {
  cache ??= readFile(path.join(CONTENT_DIR, 'content.json'), 'utf8').then((raw) => {
    const parsed = JSON.parse(raw) as Partial<SiteContent>;
    return {
      variables: parsed.variables ?? {},
      collections: {
        news: parsed.collections?.news ?? [],
        team: parsed.collections?.team ?? [],
        faq: parsed.collections?.faq ?? [],
        documents: parsed.collections?.documents ?? [],
      },
      views: parsed.views ?? {},
      assets: parsed.assets ?? [],
    } satisfies SiteContent;
  });
  return cache;
}

export const emptyContent = (): SiteContent => EMPTY;

/** Ein URL-tauglicher Bezeichner aus einem Titel — für Sammlungen ohne eigenen Slug. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
