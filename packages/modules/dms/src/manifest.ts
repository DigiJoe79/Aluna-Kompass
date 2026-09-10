import { defineModule, type ModuleManifest } from '@kompass/core';

export const dmsModule: ModuleManifest = defineModule({
  key: 'dms',
  version: '0.1.0',
  dependsOn: ['contacts'],
  permissions: ['dms.view', 'dms.create', 'dms.file', 'dms.void', 'dms.deleteDraft', 'dms.manage'],
  // `icon` muss in der Whitelist in `apps/kompass/src/components/shell/sidebar.tsx` stehen.
  navigation: [{ key: 'dms.list', href: '/dms', icon: 'file', group: 'dms', permission: 'dms.view' }],
});
