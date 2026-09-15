import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { InferContent } from '@kompass/site-template';
import template from '../../kompass.template';

/**
 * Ein mehrsprachiges Feld ist ein Record über Sprachschlüssel, genau wie
 * Kompass es exportiert. Welche Sprache eine Seite zeigt, entscheidet die
 * Seite — seit dem 2026-09-15 baut ein Lauf alle Sprachen auf einmal, statt
 * dass eine Umgebungsvariable die eine auswählt. Siehe `lib/locale.ts`.
 */
export type { Localized } from '@kompass/site-template';

/**
 * Die Form von content.json kommt aus der Deklaration, nicht aus einer zweiten
 * Abschrift: Wer in kompass.template.ts ein Feld umbenennt, bekommt hier einen
 * Typfehler statt einer leeren Seite.
 */
/**
 * Die Vereinsstammdaten, die Kompass jedem Template mitgibt, ohne dass es sie
 * deklariert (`views.organization`). Anschrift, Bankverbindung und
 * Registereintrag stehen damit genau einmal — in den Einstellungen.
 */
export interface Organization {
  name: string;
  legalForm: string;
  foundedYear: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  website: string;
  iban: string;
  bic: string;
  bankName: string;
  registerCourt: string;
  registerNumber: string;
}

const NO_ORGANIZATION: Organization = {
  name: '', legalForm: '', foundedYear: '', street: '', postalCode: '', city: '', country: '',
  email: '', phone: '', website: '', iban: '', bic: '', bankName: '', registerCourt: '', registerNumber: '',
};

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

/**
 * Die Stammdaten aus dem Inhalt. Fehlen sie — etwa in einer von Hand
 * gebauten Fixture — bleibt jedes Feld leer, statt dass der Build wirft: Eine
 * Seite ohne Anschrift ist ärgerlich, eine Seite, die gar nicht baut, hilft
 * niemandem weiter.
 */
export function organizationOf(content: SiteContent): Organization {
  const rows = (content.views as { organization?: Organization[] }).organization;
  return rows?.[0] ?? NO_ORGANIZATION;
}

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
