import { defineModule, type ModuleManifest } from '@kompass/core';
import { CONTACTS_MCP_TOOLS } from './mcp-tools';
import { contactsRetentionDue, contactsRetentionHolds } from './retention';
import { seedContacts } from './seed';

export const contactsModule: ModuleManifest = defineModule({
  key: 'contacts',
  version: '0.1.0',
  permissions: ['contacts.view', 'contacts.manage'],
  // `icon` muss in der Whitelist in `apps/kompass/src/components/shell/sidebar.tsx`
  // stehen (`contact`), sonst bleibt der Navigationspunkt ohne Symbol.
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
