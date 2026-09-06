import { z } from 'zod';
import type { SettingDefinition } from '../modules/manifest';
import { DEFAULT_THEME } from '../themes/default-theme';
import { themeSchema } from '../themes/tokens';

const shortText = z.string().trim().max(200);
const isoDateOrEmpty = z.union([z.literal(''), z.iso.date()]);

const organization: SettingDefinition[] = [
  { key: 'organization.name', schema: z.string().trim().min(1).max(200), default: 'Neuer Verein' },
  {
    key: 'organization.legalForm',
    schema: z.enum(['registeredAssociation', 'unregisteredAssociation']),
    default: 'registeredAssociation',
  },
  { key: 'organization.street', schema: shortText, default: '' },
  { key: 'organization.postalCode', schema: z.string().trim().max(10), default: '' },
  { key: 'organization.city', schema: shortText, default: '' },
  { key: 'organization.country', schema: z.string().trim().length(2).toUpperCase(), default: 'DE' },
  { key: 'organization.foundedYear', schema: z.union([z.literal(''), z.string().regex(/^(1[89]|20|21)\d{2}$/)]), default: '' },
  { key: 'organization.registerCourt', schema: shortText, default: '' },
  { key: 'organization.registerNumber', schema: shortText, default: '' },
  { key: 'organization.taxNumber', schema: shortText, default: '' },
  { key: 'organization.taxOffice', schema: shortText, default: '' },
  {
    key: 'organization.exemptionNoticeType',
    schema: z.enum(['none', 'exemptionNotice', 'corporateTaxNoticeAttachment', 'section60a']),
    default: 'none',
  },
  { key: 'organization.exemptionNoticeDate', schema: isoDateOrEmpty, default: '' },
  { key: 'organization.statutoryPurpose', schema: z.string().trim().max(500), default: '' },
  { key: 'organization.email', schema: z.union([z.literal(''), z.email()]), default: '' },
  { key: 'organization.website', schema: z.union([z.literal(''), z.url()]), default: '' },
  { key: 'organization.phone', schema: shortText, default: '' },
  { key: 'organization.iban', schema: z.string().trim().max(34), default: '' },
  { key: 'organization.bic', schema: z.string().trim().max(11), default: '' },
  { key: 'organization.bankName', schema: shortText, default: '' },
];

const branding: SettingDefinition[] = [
  { key: 'branding.logoAssetId', schema: z.string().nullable(), default: null },
  {
    key: 'branding.fontBody',
    schema: z.enum(['source-sans-3', 'public-sans', 'atkinson-hyperlegible']),
    default: 'source-sans-3',
  },
  { key: 'branding.fontHeading', schema: z.enum(['source-serif-4', 'same-as-body']), default: 'source-serif-4' },
  { key: 'branding.activeTheme', schema: z.string().min(1), default: 'default' },
];

const themes: SettingDefinition[] = [
  { key: 'themes', schema: z.array(themeSchema).min(1), default: [DEFAULT_THEME] },
];

const modules: SettingDefinition[] = [
  { key: 'modules.enabled', schema: z.array(z.string()), default: [] },
];

const system: SettingDefinition[] = [
  { key: 'system.lastImportAt', schema: z.string().nullable(), default: null, systemOnly: true },
  { key: 'system.lastImportSource', schema: z.string().nullable(), default: null, systemOnly: true },
  { key: 'system.lastExportAt', schema: z.string().nullable(), default: null, systemOnly: true },
];

export const CORE_SETTINGS: SettingDefinition[] = [...organization, ...branding, ...themes, ...modules, ...system];
