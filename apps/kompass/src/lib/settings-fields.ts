import type { FieldSize } from '@/components/forms/form-field';
import { panelHref } from '@/components/panel-nav';
export type FieldKind = 'text' | 'mono' | 'textarea' | 'select' | 'date' | 'theme' | 'font-body' | 'font-heading';

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
}

export interface SettingsTab {
  key: 'organization' | 'tax' | 'bank' | 'branding' | 'display';
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
      { key: 'organization.postalCode', kind: 'mono', size: 's', section: 'address' },
      { key: 'organization.city', kind: 'text', size: 's', section: 'address' },
      { key: 'organization.country', kind: 'text', size: 's', section: 'locale' },
      { key: 'organization.timeZone', kind: 'mono', size: 's', section: 'locale', hintKey: 'timeZoneHint', placeholderKey: 'timeZone' },
      { key: 'organization.foundedYear', kind: 'mono', size: 's', section: 'locale' },
      { key: 'organization.registerCourt', kind: 'text', size: 'm', section: 'register' },
      { key: 'organization.registerNumber', kind: 'mono', size: 's', section: 'register', hintKey: 'registerNumberHint' },
      { key: 'organization.email', kind: 'text', size: 'm', section: 'contact' },
      { key: 'organization.phone', kind: 'mono', size: 's', section: 'contact' },
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
    ],
  },
  {
    key: 'display',
    fields: [{ key: 'ui.dateFormat', kind: 'select', size: 'm', options: ['locale', 'iso'] }],
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
 * Übersetzungsschlüssel unter `settings.managedTarget.*` für den kurzen Namen
 * im Link „geführt unter …“. Finanzamt, Steuernummer, Art und Datum des
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
