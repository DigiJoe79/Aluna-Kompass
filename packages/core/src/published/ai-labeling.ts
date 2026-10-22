import { z } from 'zod';
import type { Deps } from '../deps';
import { localizedText } from '../i18n/localized';
import { aiLabelingEnabled, readAiLabelingTexts } from '../media/ai-labeling';
import { definePublishedView } from './view';

/**
 * Die Texte und Einstellungen zur Bildkennzeichnung für Webseiten-Vorlagen. `mark` ist die Marke an erstellten,
 * `editedMark` die an bearbeiteten Bildern.
 * Ist der Schalter ausgeschaltet, liefert die Sicht keine Zeilen, und die
 * Vorlage zeigt weder Marken noch Sätze oder Legenden.
 */
export const publishedAiLabeling = definePublishedView({
  name: 'aiLabeling',
  schema: z.object({
    mark: localizedText({ max: 12 }),
    editedMark: localizedText({ max: 12 }),
    editedLabel: localizedText({ max: 80 }),
    generatedLabel: localizedText({ max: 80 }),
    editedNote: localizedText({ max: 300 }),
    generatedNote: localizedText({ max: 300 }),
    mixedNote: localizedText({ max: 300 }),
    editedNoteSingle: localizedText({ max: 300 }),
    generatedNoteSingle: localizedText({ max: 300 }),
    moreLink: localizedText({ max: 80 }),
  }),
  load: (deps: Deps) => {
    if (!aiLabelingEnabled(deps)) return [];
    return [readAiLabelingTexts(deps)];
  },
  editLink: () => ({ href: '/admin/settings', title: 'Bildkennzeichnung' }),
});
