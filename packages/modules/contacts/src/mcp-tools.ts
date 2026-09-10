import type { McpToolDefinition } from '@kompass/core';
import { z } from 'zod';
import {
  addContactRole, contactChannelsSchema, contactCreateSchema, contactListSchema, contactRetention,
  contactRoleAddSchema, contactRoleEndSchema, contactStatusSchema, contactUpdateSchema, createContact,
  endContactRole, getContact, listContacts, listDueContacts, setContactChannels, setContactStatus, updateContact,
} from './service';

const t = (name: string, description: string, inputSchema: z.ZodType<unknown>, handler: McpToolDefinition['handler']): McpToolDefinition => ({ name, description, inputSchema, handler });

export const CONTACTS_MCP_TOOLS: McpToolDefinition[] = [
  t('contacts_list', 'List contacts, filtered by kind, role or free text. Requires contacts.view.', contactListSchema, (deps, ctx, args) => listContacts(deps, ctx, args)),
  t('contacts_get', 'Read one contact with its channels, roles and affiliation. Requires contacts.view.', z.object({ id: z.string() }), (deps, ctx, args) => getContact(deps, ctx, (args as { id: string }).id)),
  t('contacts_retention', 'Report until when a contact is held and by whom. Requires contacts.view.', z.object({ id: z.string() }), (deps, ctx, args) => contactRetention(deps, ctx, (args as { id: string }).id)),
  t('contacts_create', 'Create a person or an organisation. Requires contacts.manage.', contactCreateSchema, (deps, ctx, args) => createContact(deps, ctx, args)),
  t('contacts_update', 'Update a contact. Requires contacts.manage.', contactUpdateSchema, (deps, ctx, args) => updateContact(deps, ctx, args)),
  t('contacts_set_channels', 'Replace the communication channels of a contact. Requires contacts.manage.', contactChannelsSchema, (deps, ctx, args) => setContactChannels(deps, ctx, args)),
  t('contacts_add_role', 'Start a role for a contact. Requires contacts.manage.', contactRoleAddSchema, (deps, ctx, args) => addContactRole(deps, ctx, args)),
  t('contacts_end_role', 'End a role of a contact without deleting it. Requires contacts.manage.', contactRoleEndSchema, (deps, ctx, args) => endContactRole(deps, ctx, args)),
  t('contacts_set_status', 'Archive or reactivate a contact. Requires contacts.manage.', contactStatusSchema, (deps, ctx, args) => setContactStatus(deps, ctx, args)),
  t('contacts_due', 'List contacts whose retention has run out and that are due for deletion. Requires contacts.manage.', z.object({}), (deps, ctx) => listDueContacts(deps, ctx)),
];
