import { defineModule, type ModuleManifest } from '@kompass/core';
import { CONTACTS_MCP_TOOLS } from './mcp-tools';
import { contactsRetentionDue, contactsRetentionHolds } from './retention';
import { seedContacts } from './seed';

export const contactsModule: ModuleManifest = defineModule({
  key: 'contacts',
  version: '0.1.0',
  permissions: ['contacts.view', 'contacts.manage'],
  // Fehlt `icon` in der Whitelist in `apps/kompass/src/components/shell/sidebar.tsx`,
  // fällt die Suche dort still auf ein Standard-Icon zurück — kein Fehler, nur ein
  // falsches Icon. `contact` ist noch nicht eingetragen; das erledigt Plan 3 Task 4
  // zusammen mit der Installation.
  navigation: [{ key: 'contacts.list', href: '/contacts', icon: 'contact', group: 'contacts', permission: 'contacts.view' }],
  /**
   * Die allgemeinen Rollen. Fachliche Rollen bringen die Fachmodule mit:
   * Tiere `adopter`/`sponsor`, Finanzen `donor`, Mitglieder `member`.
   * `authority` ist `permanent`, weil eine Behörde kein personenbezogener
   * Datensatz ist und nichts an ihr abläuft.
   */
  contactRoles: [
    { key: 'interested', retention: 'consent' },
    { key: 'partner', retention: 'consent' },
    { key: 'authority', retention: 'permanent' },
    { key: 'service', retention: 'consent' },
  ],
  retentionHolds: contactsRetentionHolds,
  retentionDue: contactsRetentionDue,
  mcpTools: CONTACTS_MCP_TOOLS,
  seed: seedContacts,
});
