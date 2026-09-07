import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Ein mehrsprachiges Feld ist ein Record über Sprachschlüssel, genau wie Kompass
 * es exportiert. Dieses Template rendert eine Sprache; welche, sagt `LOCALE`.
 */
export type Localized = Record<string, string>;

export const LOCALE = process.env.SITE_LOCALE ?? 'de';

/** Wert eines mehrsprachigen Feldes in der gerenderten Sprache, sonst leer. */
export function t(field: Localized | string | undefined | null): string {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  return field[LOCALE] ?? Object.values(field)[0] ?? '';
}

export interface Asset {
  id: string;
  filename: string;
  mimeType: string;
  width: number | null;
  height: number | null;
}

export interface Variables {
  claim?: Localized;
  intro?: Localized;
  heroImage?: string | null;
  donationAccount?: string;
  memberFee?: number;
}

export interface NewsEntry {
  slug: string;
  title: Localized;
  body: Localized;
  image: string | null;
}

export interface TeamEntry {
  name: string;
  role: Localized;
  photo: string | null;
  sortOrder: number;
}

export interface FaqEntry {
  question: Localized;
  answer: Localized;
  sortOrder: number;
}

export interface DocumentEntry {
  title: Localized;
  file: string | null;
}

export interface SiteContent {
  variables: Variables;
  collections: {
    news: NewsEntry[];
    team: TeamEntry[];
    faq: FaqEntry[];
    documents: DocumentEntry[];
  };
  views: Record<string, unknown[]>;
  assets: Asset[];
}

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
