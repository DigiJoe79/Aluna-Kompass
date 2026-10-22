import { pick, type Locale } from './locale';
import type { SiteContent } from './content';

export interface AiLabeling {
  /** Marke an erstellten Bildern. */
  mark: Record<string, string>;
  /** Marke an bearbeiteten Bildern; fehlt sie (ältere Sicht), gilt `mark`. */
  editedMark?: Record<string, string>;
  editedLabel: Record<string, string>;
  generatedLabel: Record<string, string>;
  editedNote: Record<string, string>;
  generatedNote: Record<string, string>;
  editedNoteSingle: Record<string, string>;
  generatedNoteSingle: Record<string, string>;
  moreLink: Record<string, string>;
}

export type AiKind = 'none' | 'edited' | 'generated';

export function aiLabelingOf(c: SiteContent): AiLabeling | null {
  return (c.views as { aiLabeling?: AiLabeling[] })?.aiLabeling?.[0] ?? null;
}

export function aiKindOf(c: SiteContent, assetId: string | null | undefined): 'edited' | 'generated' | null {
  if (!assetId) return null;
  const asset = c.assets?.find((a) => a.id === assetId);
  if (asset?.aiKind) return asset.aiKind;
  // Ein Bildausschnitt (`<assetId>~<rechteck>`) hat keine eigene Art, es gilt die seines Ursprungs.
  const baseId = assetId.split('~')[0]!;
  if (baseId !== assetId) {
    const base = c.assets?.find((a) => a.id === baseId);
    if (base?.aiKind) return base.aiKind;
  }
  return null;
}

export function aiLabel(l: AiLabeling, kind: 'edited' | 'generated', locale: Locale): string {
  return pick(kind === 'edited' ? l.editedLabel : l.generatedLabel, locale).value;
}

/**
 * Der Text der Marke nach Art, mit Rückfall auf die Vorgabesprache wie jeder übersetzte Text. Bei `edited` gilt
 * `editedMark`; fehlt sie oder ist sie leer, `mark` — nie ein leerer Text.
 */
export function aiMark(l: AiLabeling, locale: Locale, kind: 'edited' | 'generated' = 'generated'): string {
  if (kind === 'edited') {
    const edited = pick(l.editedMark, locale).value;
    if (edited.trim()) return edited;
  }
  return pick(l.mark, locale).value;
}

export function withAiLabel(
  alt: string,
  kind: 'edited' | 'generated' | 'none' | null | undefined,
  l: AiLabeling | null | undefined,
  locale: Locale,
): string {
  if (!kind || kind === 'none' || !l) return alt;
  const label = aiLabel(l, kind, locale);
  if (!label) return alt;
  if (!alt || !alt.trim()) return label;
  const base = alt.trim().replace(/\.+$/, '');
  return `${base}. ${label}.`;
}
