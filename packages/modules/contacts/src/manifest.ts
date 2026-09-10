import { defineModule, type ModuleManifest } from '@kompass/core';

export const contactsModule: ModuleManifest = defineModule({
  key: 'contacts',
  version: '0.1.0',
  permissions: ['contacts.view', 'contacts.manage'],
  // Fehlt `icon` in der Whitelist in `apps/kompass/src/components/shell/sidebar.tsx`,
  // fällt die Suche dort still auf ein Standard-Icon zurück — kein Fehler, nur ein
  // falsches Icon. `contact` ist noch nicht eingetragen; das erledigt Plan 3 Task 4
  // zusammen mit der Installation.
  navigation: [{ key: 'contacts.list', href: '/contacts', icon: 'contact', group: 'contacts', permission: 'contacts.view' }],
});
