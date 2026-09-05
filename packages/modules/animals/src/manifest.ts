import { defineModule, type ModuleManifest } from '@kompass/core';
import { publishedAnimals } from './views';
import { ANIMALS_MCP_TOOLS } from './mcp-tools';

export const animalsModule: ModuleManifest = defineModule({
  key: 'animals',
  version: '0.1.0',
  permissions: ['animals.view', 'animals.manage'],
  navigation: [{ key: 'animals.list', href: '/animals', icon: 'paw-print', group: 'animals', permission: 'animals.view' }],
  publishedViews: [publishedAnimals],
  mcpTools: ANIMALS_MCP_TOOLS,
});
