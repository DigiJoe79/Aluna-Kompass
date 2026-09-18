export type FieldKind = 'text' | 'mono' | 'textarea' | 'select' | 'date' | 'theme' | 'font-body' | 'font-heading';

export interface SettingsField {
  key: string;
  kind: FieldKind;
  span?: 'full';
  options?: string[];
  maxLength?: number;
  hintKey?: string;
}

export interface SettingsTab {
  key: 'organization' | 'tax' | 'bank' | 'branding' | 'display';
  fields: SettingsField[];
}

export const SETTINGS_TABS: SettingsTab[] = [
  {
    key: 'organization',
    fields: [
      { key: 'organization.name', kind: 'text' },
      { key: 'organization.legalForm', kind: 'select', options: ['registeredAssociation', 'unregisteredAssociation'] },
      { key: 'organization.street', kind: 'text', span: 'full' },
      { key: 'organization.postalCode', kind: 'mono' },
      { key: 'organization.city', kind: 'text' },
      { key: 'organization.country', kind: 'text' },
      { key: 'organization.foundedYear', kind: 'mono' },
      { key: 'organization.registerCourt', kind: 'text' },
      { key: 'organization.registerNumber', kind: 'mono', hintKey: 'registerNumberHint' },
      { key: 'organization.email', kind: 'text' },
      { key: 'organization.phone', kind: 'mono' },
      { key: 'organization.website', kind: 'text' },
    ],
  },
  {
    key: 'tax',
    fields: [
      { key: 'organization.taxNumber', kind: 'mono' },
      { key: 'organization.taxOffice', kind: 'text' },
      { key: 'organization.exemptionNoticeType', kind: 'select', options: ['none', 'exemptionNotice', 'corporateTaxNoticeAttachment', 'section60a'] },
      { key: 'organization.exemptionNoticeDate', kind: 'date' },
      { key: 'organization.statutoryPurpose', kind: 'textarea', span: 'full', maxLength: 500, hintKey: 'statutoryPurposeHint' },
    ],
  },
  {
    key: 'bank',
    fields: [
      { key: 'organization.iban', kind: 'mono' },
      { key: 'organization.bic', kind: 'mono' },
      { key: 'organization.bankName', kind: 'text' },
    ],
  },
  {
    key: 'branding',
    fields: [
      { key: 'branding.fontBody', kind: 'font-body', options: ['source-sans-3', 'public-sans', 'atkinson-hyperlegible'] },
      { key: 'branding.fontHeading', kind: 'font-heading', options: ['source-serif-4', 'same-as-body'] },
      { key: 'branding.activeTheme', kind: 'theme' },
    ],
  },
  {
    key: 'display',
    fields: [{ key: 'ui.dateFormat', kind: 'select', options: ['locale', 'iso'] }],
  },
];

export const TAX_REQUIRED = [
  'organization.taxNumber',
  'organization.taxOffice',
  'organization.exemptionNoticeType',
  'organization.exemptionNoticeDate',
] as const;
