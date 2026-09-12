import { defineModule, type ModuleManifest } from '@kompass/core';
import { dmsFollowUpTargets } from './follow-ups';
import { DMS_SETTINGS, installDms } from './install';
import { DMS_MCP_TOOLS } from './mcp-tools';
import { dmsRetentionDue, dmsRetentionHolds } from './retention';
import { seedDms } from './seed';
import { letterTemplate } from './templates';

export const dmsModule: ModuleManifest = defineModule({
  key: 'dms',
  version: '0.1.0',
  dependsOn: ['contacts'],
  files: true,
  settings: DMS_SETTINGS,
  install: installDms,
  permissions: ['dms.view', 'dms.create', 'dms.file', 'dms.void', 'dms.deleteDraft', 'dms.manage'],
  documentTemplates: [letterTemplate],
  navigation: [{ key: 'dms.list', href: '/dms', icon: 'file', group: 'dms', permission: 'dms.view' }],
  adminNavigation: [{ key: 'dms.admin', href: '/admin/dms', icon: 'folder', permission: 'dms.manage' }],
  retentionHolds: dmsRetentionHolds,
  retentionDue: dmsRetentionDue,
  followUpTargets: dmsFollowUpTargets,
  mcpTools: DMS_MCP_TOOLS,
  seed: seedDms,
});
