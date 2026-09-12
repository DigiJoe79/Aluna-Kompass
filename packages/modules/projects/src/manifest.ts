import { defineModule, type ModuleManifest } from '@kompass/core';
import { PROJECTS_MCP_TOOLS } from './mcp-tools';
import { projectsMediaReferences } from './references';
import { seedProjects } from './seed';
import { publishedProjects } from './views';

/**
 * Projekte: Spendenzwecke mit öffentlicher Seite. Bis zum 2026-09-12 lagen sie
 * im Kern, mit der Spalte einer bestimmten Spendenplattform, bei der jeder
 * andere Verein gestutzt hätte (Prinzip 1). Finanzen hängt sich später mit eigenen Tabellen an.
 */
export const projectsModule: ModuleManifest = defineModule({
  key: 'projects',
  version: '0.1.0',
  permissions: ['projects.view', 'projects.manage'],
  navigation: [{ key: 'projects.list', href: '/projects', icon: 'folder', group: 'projects', permission: 'projects.view' }],
  publishedViews: [publishedProjects],
  mcpTools: PROJECTS_MCP_TOOLS,
  mediaReferences: projectsMediaReferences,
  seed: seedProjects,
});
