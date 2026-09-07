// WEGWERF — Feldstudie zur Maskenerzeugung, nicht committen.
import { z } from 'zod';

/** Mehrsprachiger Text über beliebig viele Sprachen. */
const localized = (locales: string[], opts: { markdown?: boolean; max?: number } = {}) =>
  z
    .object(Object.fromEntries(locales.map((l) => [l, z.string().max(opts.max ?? 20_000).default('')])))
    .meta({ widget: 'localized', locales, markdown: opts.markdown ?? false });

const asset = (accept = 'image/*') => z.string().nullable().default(null).meta({ widget: 'asset', accept });

const LOCALES = ['de', 'en', 'fr'];

/** So könnte ein Template seine Seitenfelder deklarieren. */
export const examplePageTemplate = z.object({
  title: localized(LOCALES, { max: 120 }).meta({ widget: 'localized', locales: LOCALES, label: 'Titel' }),
  lede: localized(LOCALES, { max: 400 }).meta({ widget: 'localized', locales: LOCALES, label: 'Einleitung' }),
  body: localized(LOCALES, { markdown: true }).meta({ widget: 'localized', locales: LOCALES, markdown: true, label: 'Fließtext' }),
  heroImage: asset().meta({ widget: 'asset', accept: 'image/*', label: 'Titelbild' }),
  publishedFrom: z.iso.date().meta({ label: 'Sichtbar ab' }),
  layout: z.enum(['narrow', 'wide', 'full']).meta({ label: 'Breite' }),
  keywords: z.array(z.string().max(40)).max(8).meta({ label: 'Stichwörter' }),
  metrics: z
    .array(
      z.object({
        label: localized(LOCALES, { max: 60 }).meta({ widget: 'localized', locales: LOCALES, label: 'Bezeichnung' }),
        value: z.number().min(0).max(1_000_000).meta({ label: 'Wert' }),
        suffix: z.string().max(8).meta({ label: 'Einheit' }),
      }),
    )
    .max(3)
    .meta({ label: 'Kennzahlen', itemLabel: 'Kennzahl' }),
  blocks: z
    .array(
      z.object({
        title: localized(LOCALES, { max: 120 }).meta({ widget: 'localized', locales: LOCALES, label: 'Überschrift' }),
        text: localized(LOCALES, { max: 1000 }).meta({ widget: 'localized', locales: LOCALES, label: 'Text' }),
        image: asset().meta({ widget: 'asset', accept: 'image/*', label: 'Bild' }),
        href: z.string().max(300).meta({ label: 'Link' }),
      }),
    )
    .max(12)
    .meta({ label: 'Bausteine', itemLabel: 'Baustein' }),
});
