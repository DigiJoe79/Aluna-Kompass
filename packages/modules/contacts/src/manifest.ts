import { defineModule, type ModuleManifest } from '@kompass/core';

export const contactsModule: ModuleManifest = defineModule({
  key: 'contacts',
  version: '0.1.0',
  permissions: ['contacts.view', 'contacts.manage'],
  // `icon` muss in der Whitelist in `apps/kompass/src/components/shell/sidebar.tsx`
  // stehen. `contact` ist dort noch nicht eingetragen — das erledigt Plan 3 Task 4
  // zusammen mit der Installation. Bis dahin ist der Name nur eine Zeichenkette.
  navigation: [{ key: 'contacts.list', href: '/contacts', icon: 'contact', group: 'contacts', permission: 'contacts.view' }],
});
