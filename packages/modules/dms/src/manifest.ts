import { defineModule, type ModuleManifest } from '@kompass/core';
import { DMS_MCP_TOOLS } from './mcp-tools';
import { dmsRetentionDue, dmsRetentionHolds } from './retention';
import { seedDms } from './seed';
import { dmsMediaReferences } from './service';
import { letterTemplate } from './templates';

export const dmsModule: ModuleManifest = defineModule({
  key: 'dms',
  version: '0.1.0',
  dependsOn: ['contacts'],
  permissions: ['dms.view', 'dms.create', 'dms.file', 'dms.void', 'dms.deleteDraft', 'dms.manage'],
  documentTemplates: [letterTemplate],
  navigation: [{ key: 'dms.list', href: '/dms', icon: 'file', group: 'dms', permission: 'dms.view' }],
  mediaReferences: dmsMediaReferences,
  retentionHolds: dmsRetentionHolds,
  retentionDue: dmsRetentionDue,
  mcpTools: DMS_MCP_TOOLS,
  seed: seedDms,
});
