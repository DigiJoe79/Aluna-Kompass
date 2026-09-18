import { defineModule, type ModuleManifest, type NavigationItem } from '@kompass/core';
import { SITE_DASHBOARD_TILES } from './dashboard';
import { SITE_MCP_TOOLS } from './mcp-tools';
import { siteMediaReferences } from './references';
import { SITE_SETTINGS } from './settings';
import { activeTemplate } from './service';
import { siteSetTranslations, siteTranslatables } from './translations';
import { seedSiteDevelopment } from './dev-seed';

export const SITE_PERMISSIONS = ['site.view', 'site.manage', 'site.publish'] as const;

/**
 * Je Sammlung ein Navigationseintrag mit ihrer Beschriftung, dazu „Variablen“
 * und „Publizieren“ — alles erst, wenn ein Template eingelesen ist. Ohne
 * Template lehnt der Export mit `noTemplate` ab; der Eintrag führte bis dahin
 * auf eine Seite, die nur scheitern konnte.
 */
const siteNavigationFor = (deps: Parameters<typeof activeTemplate>[0]): NavigationItem[] => {
  const template = activeTemplate(deps);
  if (!template) return [];
  return [
    // „Publizieren“ schließt oben an „Template“ an (das steht als fester Eintrag im
    // Manifest); darunter, hinter einer Trennlinie, die pflegbaren Inhalte.
    { key: 'site.publish', href: '/site/publish', icon: 'upload', group: 'site', permission: 'site.publish' },
    { key: 'site.variables', href: '/site/variables', icon: 'sliders', group: 'site', permission: 'site.manage', sectionBreak: true },
    ...Object.entries(template.schema.collections).map(([key, col]): NavigationItem => ({
      key: `site.c.${key}`,
      href: `/site/c/${key}`,
      icon: 'list',
      group: 'site',
      permission: 'site.view',
      label: col.label,
    })),
  ];
};

export const siteModule: ModuleManifest = defineModule({
  key: 'site',
  version: '0.1.0',
  permissions: SITE_PERMISSIONS,
  settings: SITE_SETTINGS,
  // `moduleIcon` muss in der Whitelist in `apps/kompass/src/components/shell/rail.tsx`
  // stehen (`globe`). Das erste Item-Icon `layout-template` meint die Seite
  // „Template“, nicht das Modul „Webseite“.
  moduleIcon: 'globe',
  // Nur der Weg hinein steht immer da; alles Weitere hängt am Template.
  navigation: [{ key: 'site.template', href: '/site/template', icon: 'layout-template', group: 'site', permission: 'site.manage' }],
  help: [
    { href: '/site/template', doc: 'webseite/template-einlesen' },
    { href: '/site/variables', doc: 'webseite/variablen' },
    { href: '/site/c', doc: 'webseite/sammlungen' },
    { href: '/site/publish', doc: 'webseite/publizieren' },
  ],
  navigationFor: siteNavigationFor,
  mcpTools: SITE_MCP_TOOLS,
  seed: seedSiteDevelopment,
  mediaReferences: siteMediaReferences,
  dashboardTiles: SITE_DASHBOARD_TILES,
  deletionRules: [
    {
      entity: 'sitePublish',
      deletable: false,
      reason: 'Die Publish-Historie ist ein Betriebsprotokoll über Jahre.',
    },
    {
      entity: 'siteEntry',
      deletable: true,
      reason: 'Redaktioneller Inhalt der Webseite (Prinzip 3).',
      guard: 'nur zurückgezogen, sofern die Sammlung einen Veröffentlicht-Schalter hat; nur solange nichts mehr auf den Eintrag zeigt (recordReferences)',
      auditAction: 'site.entry.delete',
    },
  ],
  translatables: siteTranslatables,
  setTranslations: siteSetTranslations,
  files: true,
  providedFiles: ['template'],
});
