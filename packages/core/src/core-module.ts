import { CORE_DASHBOARD_TILES } from './dashboard/tiles';
import { CORE_DELETION_RULES } from './deletion-policy';
import { coreRecordReferences } from './deletion-guards';
import { coreMediaReferences } from './media/references';
import { defineModule } from './modules/manifest';
import { publishedOrganization } from './published/organization';
import { CORE_PERMISSIONS } from './permissions/core';
import { CORE_SETTINGS } from './settings/core';

export const coreModule = defineModule({
  key: 'core',
  version: '0.1.0',
  permissions: CORE_PERMISSIONS,
  settings: CORE_SETTINGS,
  publishedViews: [publishedOrganization],
  mediaReferences: coreMediaReferences,
  recordReferences: coreRecordReferences,
  deletionRules: CORE_DELETION_RULES,
  dashboardTiles: CORE_DASHBOARD_TILES,
  files: true,
  providedFiles: ['document-templates'],
});
