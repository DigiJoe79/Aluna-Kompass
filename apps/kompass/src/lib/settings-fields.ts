import type { FieldSize } from '@/components/forms/form-field';
import { panelHref } from '@/components/panel-nav';
export type FieldKind = 'text' | 'mono' | 'textarea' | 'select' | 'date' | 'theme' | 'font-body' | 'font-heading' | 'country' | 'timeZone' | 'switch' | 'localized';

/**
 * Ein Feld der Vereinseinstellungen. `size` ist die Spannweite im `FormGrid` (docs/MUSTER.md § J), `section` der
 * Abschnitt, zu dem es gehört (Titel unter `settings.sections.*`); Felder ohne `section` bilden einen Abschnitt ohne
 * Titel. Aufeinanderfolgende Felder desselben Abschnitts stehen zusammen, die Reihenfolge bildet die Zeilen.
 */
export interface SettingsField {
  key: string;
  kind: FieldKind;
  size: FieldSize;
  section?: string;
  options?: string[];
  maxLength?: number;
  hintKey?: string;
  placeholderKey?: string;
  multiline?: boolean;
}

export interface SettingsTab {
  key: 'organization' | 'tax' | 'bank' | 'branding' | 'media';
  fields: SettingsField[];
}

export const SETTINGS_TABS: SettingsTab[] = [
  {
    key: 'organization',
    // Vorlage „Verein“ (Handoff Konsistenz § 8b.3, § 8c): Name · Anschrift · Land und Zeit · Register · Kontakt.
    fields: [
      { key: 'organization.name', kind: 'text', size: 'm', section: 'name' },
      { key: 'organization.legalForm', kind: 'select', size: 'm', section: 'name', options: ['registeredAssociation', 'unregisteredAssociation'] },
      { key: 'organization.street', kind: 'text', size: 'm', section: 'address' },
      { key: 'organization.postalCode', kind: 'text', size: 's', section: 'address' },
      { key: 'organization.city', kind: 'text', size: 's', section: 'address' },
      // Auswahl mit Klarnamen, gespeichert bleibt der Code (11-1 B19).
      { key: 'organization.country', kind: 'country', size: 's', section: 'locale' },
      { key: 'organization.timeZone', kind: 'timeZone', size: 's', section: 'locale', hintKey: 'timeZoneHint' },
      { key: 'organization.foundedYear', kind: 'text', size: 's', section: 'locale' },
      { key: 'organization.registerCourt', kind: 'text', size: 'm', section: 'register' },
      { key: 'organization.registerNumber', kind: 'text', size: 's', section: 'register', hintKey: 'registerNumberHint' },
      { key: 'organization.registeredOn', kind: 'date', size: 's', section: 'register' },
      { key: 'organization.email', kind: 'text', size: 'm', section: 'contact' },
      { key: 'organization.phone', kind: 'text', size: 's', section: 'contact' },
      { key: 'organization.website', kind: 'text', size: 'm', section: 'contact' },
    ],
  },
  {
    key: 'tax',
    fields: [
      { key: 'organization.taxNumber', kind: 'mono', size: 's', section: 'taxOffice' },
      { key: 'organization.taxOffice', kind: 'text', size: 'm', section: 'taxOffice' },
      { key: 'organization.exemptionNoticeType', kind: 'select', size: 'm', section: 'notice', options: ['none', 'exemptionNotice', 'corporateTaxNoticeAttachment', 'section60a'] },
      { key: 'organization.exemptionNoticeDate', kind: 'date', size: 's', section: 'notice' },
    ],
  },
  {
    key: 'bank',
    fields: [
      { key: 'organization.iban', kind: 'mono', size: 'm' },
      { key: 'organization.bic', kind: 'mono', size: 's' },
      { key: 'organization.bankName', kind: 'text', size: 'm' },
    ],
  },
  {
    key: 'branding',
    fields: [
      { key: 'branding.fontBody', kind: 'font-body', size: 'm', section: 'fontsAndColors', options: ['source-sans-3', 'public-sans', 'atkinson-hyperlegible'] },
      { key: 'branding.fontHeading', kind: 'font-heading', size: 'm', section: 'fontsAndColors', options: ['source-serif-4', 'same-as-body'] },
      { key: 'branding.activeTheme', kind: 'theme', size: 'm', section: 'fontsAndColors' },
      // Ein Reiter „Darstellung“ mit Logo, Schrift, Theme und Datumsformat; vorher stand das Datumsformat allein (11-1 B21).
      { key: 'ui.dateFormat', kind: 'select', size: 'm', options: ['locale', 'iso'], hintKey: 'dateFormatHint' },
    ],
  },
  {
    key: 'media',
    fields: [
      { key: 'media.aiLabeling.enabled', kind: 'switch', size: 'full', section: 'aiLabeling', hintKey: 'aiLabelingEnabledHint' },
      { key: 'media.aiLabeling.editedMark', kind: 'localized', size: 'm', section: 'aiLabeling', hintKey: 'aiLabelingEditedMarkHint' },
      { key: 'media.aiLabeling.mark', kind: 'localized', size: 'm', section: 'aiLabeling', hintKey: 'aiLabelingMarkHint' },
      { key: 'media.aiLabeling.editedLabel', kind: 'localized', size: 'm', section: 'aiLabeling', hintKey: 'aiLabelingEditedLabelHint' },
      { key: 'media.aiLabeling.generatedLabel', kind: 'localized', size: 'm', section: 'aiLabeling', hintKey: 'aiLabelingGeneratedLabelHint' },
      { key: 'media.aiLabeling.editedNote', kind: 'localized', size: 'full', multiline: true, section: 'aiLabeling', hintKey: 'aiLabelingEditedNoteHint' },
      { key: 'media.aiLabeling.generatedNote', kind: 'localized', size: 'full', multiline: true, section: 'aiLabeling', hintKey: 'aiLabelingGeneratedNoteHint' },
      { key: 'media.aiLabeling.mixedNote', kind: 'localized', size: 'full', multiline: true, section: 'aiLabeling', hintKey: 'aiLabelingMixedNoteHint' },
      { key: 'media.aiLabeling.editedNoteSingle', kind: 'localized', size: 'full', multiline: true, section: 'aiLabeling', hintKey: 'aiLabelingEditedNoteSingleHint' },
      { key: 'media.aiLabeling.generatedNoteSingle', kind: 'localized', size: 'full', multiline: true, section: 'aiLabeling', hintKey: 'aiLabelingGeneratedNoteSingleHint' },
      { key: 'media.aiLabeling.moreLink', kind: 'localized', size: 'm', section: 'aiLabeling', hintKey: 'aiLabelingMoreLinkHint' },
    ],
  },
];

/** Die Abschnitte eines Reiters: aufeinanderfolgende Felder mit demselben `section`, in der Reihenfolge der Felder. */
export function settingsSections(tab: SettingsTab): { section: string | undefined; fields: SettingsField[] }[] {
  const sections: { section: string | undefined; fields: SettingsField[] }[] = [];
  for (const field of tab.fields) {
    const last = sections.at(-1);
    if (last && last.section === field.section) last.fields.push(field);
    else sections.push({ section: field.section, fields: [field] });
  }
  return sections;
}

export const TAX_REQUIRED = [
  'organization.taxNumber',
  'organization.taxOffice',
  'organization.exemptionNoticeType',
  'organization.exemptionNoticeDate',
] as const;

/**
 * Der Satz, der unter einem Feld steht, das ein eingeschaltetes Modul führt
 * (`managedBy`, `managedSettings` im Kern): je Reiter einer, weil der Reiter
 * die Stelle bestimmt, an der die Werte gepflegt werden. `null` für Felder,
 * die kein Modul führen kann.
 */
const MANAGEABLE = new Set([...TAX_REQUIRED, 'organization.iban', 'organization.bic', 'organization.bankName']);

export function managedHintKey(key: string): string | null {
  if (!MANAGEABLE.has(key)) return null;
  const tab = SETTINGS_TABS.find((t) => t.fields.some((f) => f.key === key));
  return tab ? `managedHint.${tab.key}` : null;
}

/**
 * Wo ein geführtes Feld gepflegt wird (E-1): der Weg (`href`) und ein
 * Kennzeichen des Ziels; der Link steht im Satz über den Feldern (`settings.managedHint.*`, Runde 3 150/151),
 * nicht mehr an jedem Feld. Finanzamt, Steuernummer, Art und Datum des
 * Bescheids führen zu den Bescheiden; IBAN, BIC und Bankname zum Hauptkonto.
 */
const MANAGED_TARGET: Record<string, { href: string; targetKey: 'notices' | 'accounts' }> = {
  'organization.taxNumber': { href: '/finance/donations/notices', targetKey: 'notices' },
  'organization.taxOffice': { href: '/finance/donations/notices', targetKey: 'notices' },
  'organization.exemptionNoticeType': { href: '/finance/donations/notices', targetKey: 'notices' },
  'organization.exemptionNoticeDate': { href: '/finance/donations/notices', targetKey: 'notices' },
  'organization.iban': { href: panelHref('/admin/finance', 'accounts'), targetKey: 'accounts' },
  'organization.bic': { href: panelHref('/admin/finance', 'accounts'), targetKey: 'accounts' },
  'organization.bankName': { href: panelHref('/admin/finance', 'accounts'), targetKey: 'accounts' },
};

export function managedTarget(key: string): { href: string; targetKey: 'notices' | 'accounts' } | null {
  return MANAGED_TARGET[key] ?? null;
}
