import { defineModule, type ModuleManifest } from '@kompass/core';
import { animalsMediaReferences } from './references';
import { seedAnimals } from './seed';
import { animalsSetTranslations, animalsTranslatables } from './translations';
import { publishedAnimals } from './views';
import { ANIMALS_MCP_TOOLS } from './mcp-tools';

export const animalsModule: ModuleManifest = defineModule({
  key: 'animals',
  version: '0.1.0',
  permissions: ['animals.view', 'animals.manage'],
  navigation: [{ key: 'animals.list', href: '/animals', icon: 'paw-print', group: 'animals', permission: 'animals.view' }],
  help: [{ href: '/animals', doc: 'tiere' }],
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
  translatables: animalsTranslatables,
  setTranslations: animalsSetTranslations,
  seed: seedAnimals,
});
