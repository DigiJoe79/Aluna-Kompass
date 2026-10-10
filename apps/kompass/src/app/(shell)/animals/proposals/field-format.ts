import type { ProposalField } from '@kompass/module-animals';

/** Kurze Beschriftungen der Gegenüberstellung (Board Vorschläge 2a); sonst die der Maske. */
const SHORT: readonly ProposalField[] = ['sizeCm', 'sizeText', 'status'];
const LOCALIZED: readonly ProposalField[] = ['birthText', 'sizeText', 'summary', 'body', 'traits'];

export function fieldLabelKey(field: ProposalField): string {
  return SHORT.includes(field) ? `animals.proposals.fields.${field}` : `animals.form.${field}`;
}

const plain = (value: unknown, field: ProposalField, t: (key: string) => string): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return t(value ? 'common.yes' : 'common.no');
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (field === 'status') return t(`animals.form.status.${String(value)}`);
  if (field === 'sex') return t(`animals.form.sexes.${String(value)}`);
  if (field === 'location') return t(`animals.form.locations.${String(value)}`);
  return String(value);
};

/** Ein Wert eines Vorschlags oder des Hundes als Text, Sprachfelder je Sprache der Installation (Board „DE … EN …“). */
export function formatProposalValue(field: ProposalField, value: unknown, o: { t: (key: string) => string; locales: readonly string[] }): { locale: string | null; text: string }[] {
  if (LOCALIZED.includes(field)) {
    const map = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    return o.locales.map((locale) => ({ locale, text: plain(map[locale] ?? '', field, o.t) }));
  }
  return [{ locale: null, text: plain(value, field, o.t) }];
}
