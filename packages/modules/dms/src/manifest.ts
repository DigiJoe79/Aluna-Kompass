import { defineModule, type ModuleManifest } from '@kompass/core';
import { dmsRetentionDue, dmsRetentionHolds } from './retention';
import { dmsMediaReferences } from './service';
import { letterTemplate } from './templates';

export const dmsModule: ModuleManifest = defineModule({
  key: 'dms',
  version: '0.1.0',
  dependsOn: ['contacts'],
  permissions: ['dms.view', 'dms.create', 'dms.file', 'dms.void', 'dms.deleteDraft', 'dms.manage'],
  documentTemplates: [letterTemplate],
  // Noch kein Navigationseintrag: `/dms` entsteht erst mit dem Oberflächenplan.
  // Ein Menüpunkt auf eine fehlende Route wäre ein toter Link.
  // `icon` muss dann in der Whitelist in `apps/kompass/src/components/shell/sidebar.tsx` stehen.
  mediaReferences: dmsMediaReferences,
  retentionHolds: dmsRetentionHolds,
  retentionDue: dmsRetentionDue,
});
