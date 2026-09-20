import { defineModule, type ModuleManifest } from '@kompass/core';
import { PROJECTS_MCP_TOOLS } from './mcp-tools';
import { projectsMediaReferences } from './references';
import { projectsRecordLabels } from './record-labels';
import { seedProjects } from './seed';
import { projectsSetTranslations, projectsTranslatables } from './translations';
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
  help: [{ href: '/projects', doc: 'projekte' }],
  deletionRules: [
    {
      entity: 'project',
      deletable: true,
      reason: 'Webseiteninhalt. Rechenschaftsrelevant sind die Vorgänge, die an einem Projekt hängen, nicht der Eintrag.',
      guard: 'nur zurückgezogen; nur solange kein Halter läuft (retentionHolds) und nichts mehr auf das Projekt zeigt (recordReferences)',
      auditAction: 'projects.delete',
    },
  ],
  publishedViews: [publishedProjects],
  mcpTools: PROJECTS_MCP_TOOLS,
  mediaReferences: projectsMediaReferences,
  recordLabels: projectsRecordLabels,
  translatables: projectsTranslatables,
  setTranslations: projectsSetTranslations,
  seed: seedProjects,
});
