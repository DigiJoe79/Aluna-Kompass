import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '../db/client';
import { settings } from '../db/schema';
import type { Deps } from '../deps';
import { localizedText, type LocalizedText } from '../i18n/localized';
import type { SettingDefinition } from '../modules/manifest';
import { readSetting } from '../settings/service';

export const AI_LABELING_ENABLED_KEY = 'media.aiLabeling.enabled';

export type AiKind = 'none' | 'edited' | 'generated';

export type AiLabelingTextKey =
  | 'mark'
  | 'editedMark'
  | 'editedLabel'
  | 'generatedLabel'
  | 'editedNote'
  | 'generatedNote'
  | 'mixedNote'
  | 'editedNoteSingle'
  | 'generatedNoteSingle'
  | 'moreLink';

export type AiLabelingTexts = Record<AiLabelingTextKey, Record<string, string>>;

const TEXT_KEYS_LIST = [
  'media.aiLabeling.mark',
  'media.aiLabeling.editedMark',
  'media.aiLabeling.editedLabel',
  'media.aiLabeling.generatedLabel',
  'media.aiLabeling.editedNote',
  'media.aiLabeling.generatedNote',
  'media.aiLabeling.mixedNote',
  'media.aiLabeling.editedNoteSingle',
  'media.aiLabeling.generatedNoteSingle',
  'media.aiLabeling.moreLink',
] as const;

export const AI_LABELING_TEXT_KEYS = Object.assign([...TEXT_KEYS_LIST] as const, {
  mark: 'media.aiLabeling.mark' as const,
  editedMark: 'media.aiLabeling.editedMark' as const,
  editedLabel: 'media.aiLabeling.editedLabel' as const,
  generatedLabel: 'media.aiLabeling.generatedLabel' as const,
  editedNote: 'media.aiLabeling.editedNote' as const,
  generatedNote: 'media.aiLabeling.generatedNote' as const,
  mixedNote: 'media.aiLabeling.mixedNote' as const,
  editedNoteSingle: 'media.aiLabeling.editedNoteSingle' as const,
  generatedNoteSingle: 'media.aiLabeling.generatedNoteSingle' as const,
  moreLink: 'media.aiLabeling.moreLink' as const,
});

/**
 * Vorgaben, neutral; ein Verein überschreibt sie in den Stammdaten. Schwelle (Nachtrag 2026-10-22): „bearbeitet“ heißt,
 * der Bildinhalt wurde verändert, mit welchem Werkzeug auch immer; Korrekturen am ganzen Bild tragen keine Marke.
 */
export const AI_LABELING_DEFAULTS: AiLabelingTexts = {
  // Marke an erstellten Bildern.
  mark: { de: 'KI', en: 'AI' },
  // Marke an bearbeiteten Bildern; eine Vorlage ohne sie fällt auf `mark` zurück.
  editedMark: { de: 'Bearbeitet', en: 'Edited' },
  editedLabel: { de: 'Digital bearbeitet', en: 'Digitally edited' },
  generatedLabel: { de: 'Mit KI erstellt', en: 'Created with AI' },
  // Ein Satz je Galerie, je nachdem, was vorkommt; die Marke steht am Bild, nicht im Satz (Joe 2026-10-20).
  editedNote: {
    de: 'Einige Fotos von {name} sind digital bearbeitet.',
    en: 'Some photos of {name} have been digitally edited.',
  },
  generatedNote: {
    de: 'Einige Bilder von {name} sind mit KI erstellt.',
    en: 'Some images of {name} were created with AI.',
  },
  mixedNote: {
    de: 'Einige Fotos von {name} sind digital bearbeitet, andere mit KI erstellt.',
    en: 'Some photos of {name} have been digitally edited, others were created with AI.',
  },
  editedNoteSingle: {
    de: 'Dieses Foto ist digital bearbeitet.',
    en: 'This photo has been digitally edited.',
  },
  generatedNoteSingle: {
    de: 'Dieses Bild ist mit KI erstellt.',
    en: 'This image was created with AI.',
  },
  moreLink: {
    de: 'Mehr zu Bildbearbeitung und KI',
    en: 'More about image editing and AI',
  },
};

export const aiLabelingMarkSchema = z
  .record(z.string().regex(/^[a-z]{2}(-[a-z]{2})?$/), z.string().trim().min(1).max(12))
  .meta({ localized: true, leadingRequired: true, max: 12 }) as unknown as z.ZodType<LocalizedText>;

export const AI_LABELING_SETTINGS: SettingDefinition[] = [
  { key: AI_LABELING_ENABLED_KEY, schema: z.boolean(), default: false },
  { key: 'media.aiLabeling.mark', schema: aiLabelingMarkSchema, default: AI_LABELING_DEFAULTS.mark },
  { key: 'media.aiLabeling.editedMark', schema: aiLabelingMarkSchema, default: AI_LABELING_DEFAULTS.editedMark },
  { key: 'media.aiLabeling.editedLabel', schema: localizedText({ max: 80 }), default: AI_LABELING_DEFAULTS.editedLabel },
  { key: 'media.aiLabeling.generatedLabel', schema: localizedText({ max: 80 }), default: AI_LABELING_DEFAULTS.generatedLabel },
  { key: 'media.aiLabeling.editedNote', schema: localizedText({ max: 300 }), default: AI_LABELING_DEFAULTS.editedNote },
  { key: 'media.aiLabeling.generatedNote', schema: localizedText({ max: 300 }), default: AI_LABELING_DEFAULTS.generatedNote },
  { key: 'media.aiLabeling.mixedNote', schema: localizedText({ max: 300 }), default: AI_LABELING_DEFAULTS.mixedNote },
  { key: 'media.aiLabeling.editedNoteSingle', schema: localizedText({ max: 300 }), default: AI_LABELING_DEFAULTS.editedNoteSingle },
  { key: 'media.aiLabeling.generatedNoteSingle', schema: localizedText({ max: 300 }), default: AI_LABELING_DEFAULTS.generatedNoteSingle },
  { key: 'media.aiLabeling.moreLink', schema: localizedText({ max: 80 }), default: AI_LABELING_DEFAULTS.moreLink },
];

export function aiLabelingEnabled(deps: Deps): boolean {
  return readSetting<boolean>(deps, AI_LABELING_ENABLED_KEY) === true;
}

/**
 * Derselbe Schalter für Lesehelfer, die nur die Datenbank haben (`mediaPixelSizes`). Die Vorgabe ist „aus“: Fehlt die
 * Zeile, ist die Kennzeichnung aus.
 */
export function aiLabelingEnabledIn(db: DbOrTx): boolean {
  const row = db.select({ value: settings.value }).from(settings).where(eq(settings.key, AI_LABELING_ENABLED_KEY)).get();
  return row ? JSON.parse(row.value) === true : false;
}

export function readAiLabelingTexts(deps: Deps): AiLabelingTexts {
  return {
    mark: readSetting<Record<string, string>>(deps, 'media.aiLabeling.mark') ?? AI_LABELING_DEFAULTS.mark,
    editedMark: readSetting<Record<string, string>>(deps, 'media.aiLabeling.editedMark') ?? AI_LABELING_DEFAULTS.editedMark,
    editedLabel: readSetting<Record<string, string>>(deps, 'media.aiLabeling.editedLabel') ?? AI_LABELING_DEFAULTS.editedLabel,
    generatedLabel: readSetting<Record<string, string>>(deps, 'media.aiLabeling.generatedLabel') ?? AI_LABELING_DEFAULTS.generatedLabel,
    editedNote: readSetting<Record<string, string>>(deps, 'media.aiLabeling.editedNote') ?? AI_LABELING_DEFAULTS.editedNote,
    generatedNote: readSetting<Record<string, string>>(deps, 'media.aiLabeling.generatedNote') ?? AI_LABELING_DEFAULTS.generatedNote,
    mixedNote: readSetting<Record<string, string>>(deps, 'media.aiLabeling.mixedNote') ?? AI_LABELING_DEFAULTS.mixedNote,
    editedNoteSingle: readSetting<Record<string, string>>(deps, 'media.aiLabeling.editedNoteSingle') ?? AI_LABELING_DEFAULTS.editedNoteSingle,
    generatedNoteSingle: readSetting<Record<string, string>>(deps, 'media.aiLabeling.generatedNoteSingle') ?? AI_LABELING_DEFAULTS.generatedNoteSingle,
    moreLink: readSetting<Record<string, string>>(deps, 'media.aiLabeling.moreLink') ?? AI_LABELING_DEFAULTS.moreLink,
  };
}
