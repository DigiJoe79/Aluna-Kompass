import { defineModule, type ModuleManifest } from '@kompass/core';
import { ANIMALS_DASHBOARD_TILES } from './dashboard';
import { animalsMediaReferences } from './references';
import { animalsRecordLabels } from './record-labels';
import { seedAnimals } from './seed';
import { ANIMALS_SETTINGS } from './settings';
import { animalsSetTranslations, animalsTranslatables } from './translations';
import { publishedAnimals } from './views';
import { ANIMALS_MCP_TOOLS } from './mcp-tools';

export const animalsModule: ModuleManifest = defineModule({
  key: 'animals',
  version: '0.1.0',
  permissions: ['animals.view', 'animals.manage'],
  navigation: [{ key: 'animals.list', href: '/animals', icon: 'paw-print', group: 'animals', permission: 'animals.view' }],
  adminNavigation: [{ key: 'animals.admin', href: '/admin/animals', icon: 'paw-print', permission: 'settings.manage' }],
  help: [
    { href: '/animals', doc: 'tiere' },
    { href: '/admin/animals', doc: 'einstellungen/tiere-einrichten' },
  ],
  settings: ANIMALS_SETTINGS,
  deletionRules: [
    {
      entity: 'animal',
      deletable: true,
      reason: 'Webseiteninhalt. Rechenschaftsrelevant sind die Vorgänge, die an einem Tier hängen, nicht das Profil.',
      guard: 'nur zurückgezogen; nur solange kein Halter läuft (retentionHolds) und nichts mehr auf das Tier zeigt (recordReferences)',
      auditAction: 'animals.delete',
    },
  ],
  publishedViews: [publishedAnimals],
  mcpTools: ANIMALS_MCP_TOOLS,
  mediaReferences: animalsMediaReferences,
  recordLabels: animalsRecordLabels,
  translatables: animalsTranslatables,
  setTranslations: animalsSetTranslations,
  seed: seedAnimals,
  dashboardTiles: ANIMALS_DASHBOARD_TILES,
});
