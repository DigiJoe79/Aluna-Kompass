import {
  activateTheme, addLocale, assignRole, createRole, createUser, getAuditEntry, listDocuments, listLocales, listModules, listRoles, listThemes, listUsers,
  queryAudit, readAllSettings, readSetting, removeLocale, removeRole, renderDocument, reorderLocales, resetStartPassword, setModuleEnabled, setRolePermissions,
  setSetting, setUserActive, updateRole, voidDocument, ok, invalid,
  type McpToolDefinition,
} from '@kompass/core';
import { z } from 'zod';

const t = <T>(def: McpToolDefinition<T>): McpToolDefinition => def as McpToolDefinition;

export const coreMcpTools: McpToolDefinition[] = [
  t({ name: 'settings_list', description: 'Read all registered settings with their current values.', inputSchema: z.object({}), handler: async (deps) => ok(readAllSettings(deps)) }),
  t({ name: 'settings_get', description: 'Read one setting by key, e.g. organization.name.', inputSchema: z.object({ key: z.string() }), handler: async (deps, _ctx, { key }) => (deps.registry.settingDefinitions.has(key) ? ok({ key, value: readSetting(deps, key) }) : invalid([{ path: 'key', message: 'unknownSetting' }])) }),
  t({ name: 'settings_set', description: 'Update one setting. Requires settings.manage. Audited.', inputSchema: z.object({ key: z.string(), value: z.unknown() }), handler: (deps, ctx, args) => setSetting(deps, ctx, args) }),
  t({ name: 'roles_list', description: 'List roles with permission keys and user counts.', inputSchema: z.object({}), handler: (deps, ctx) => listRoles(deps, ctx) }),
  t({ name: 'roles_create', description: 'Create a role. Requires roles.manage.', inputSchema: z.object({ name: z.string(), description: z.string().optional() }), handler: (deps, ctx, args) => createRole(deps, ctx, args) }),
  t({ name: 'roles_update', description: 'Rename or describe a role. Requires roles.manage.', inputSchema: z.object({ id: z.string(), name: z.string().optional(), description: z.string().optional() }), handler: (deps, ctx, args) => updateRole(deps, ctx, args) }),
  t({ name: 'roles_set_permissions', description: 'Replace the permission set of a role. Requires roles.manage.', inputSchema: z.object({ roleId: z.string(), permissionKeys: z.array(z.string()) }), handler: (deps, ctx, args) => setRolePermissions(deps, ctx, args) }),
  t({ name: 'roles_assign', description: 'Assign a role to a user. Requires users.manage.', inputSchema: z.object({ userId: z.string(), roleId: z.string() }), handler: (deps, ctx, args) => assignRole(deps, ctx, args) }),
  t({ name: 'roles_remove', description: 'Remove a role from a user. Requires users.manage.', inputSchema: z.object({ userId: z.string(), roleId: z.string() }), handler: (deps, ctx, args) => removeRole(deps, ctx, args) }),
  t({ name: 'users_list', description: 'List users with roles and status. Requires users.manage.', inputSchema: z.object({}), handler: (deps, ctx) => listUsers(deps, ctx) }),
  t({ name: 'users_create', description: 'Create a user; returns the one-time start password. Requires users.manage.', inputSchema: z.object({ name: z.string(), email: z.string(), roleIds: z.array(z.string()).default([]) }), handler: (deps, ctx, args) => createUser(deps, ctx, args) }),
  t({ name: 'users_set_active', description: 'Activate or deactivate a user. Requires users.manage.', inputSchema: z.object({ id: z.string(), isActive: z.boolean() }), handler: (deps, ctx, args) => setUserActive(deps, ctx, args) }),
  t({ name: 'users_reset_start_password', description: 'Issue a new one-time start password. Requires users.manage.', inputSchema: z.object({ id: z.string() }), handler: (deps, ctx, args) => resetStartPassword(deps, ctx, args) }),
  t({ name: 'audit_query', description: 'Query the immutable audit log. Requires audit.view.', inputSchema: z.object({ userId: z.string().optional(), channel: z.enum(['ui', 'mcp', 'system']).optional(), action: z.string().optional(), entityType: z.string().optional(), entityId: z.string().optional(), from: z.string().optional(), to: z.string().optional(), text: z.string().optional(), limit: z.number().int().optional(), offset: z.number().int().optional() }), handler: async (deps, ctx, args) => queryAudit(deps, ctx, args) }),
  t({ name: 'audit_get', description: 'Read one audit entry. Requires audit.view.', inputSchema: z.object({ id: z.string() }), handler: async (deps, ctx, { id }) => getAuditEntry(deps, ctx, id) }),
  t({ name: 'documents_list', description: 'List generated documents. Requires documents.view.', inputSchema: z.object({ templateKey: z.string().optional(), entityType: z.string().optional(), entityId: z.string().optional(), limit: z.number().int().optional(), offset: z.number().int().optional() }), handler: (deps, ctx, args) => listDocuments(deps, ctx, args) }),
  t({ name: 'documents_render', description: 'Render a PDF from a registered template; returns the document record (download via the app). Requires documents.create.', inputSchema: z.object({ templateKey: z.string(), input: z.unknown(), entityType: z.string().optional(), entityId: z.string().optional() }), handler: (deps, ctx, args) => renderDocument(deps, ctx, args) }),
  t({ name: 'documents_void', description: 'Void a document with a reason; the PDF and number remain. Requires documents.create.', inputSchema: z.object({ id: z.string(), reason: z.string() }), handler: (deps, ctx, args) => voidDocument(deps, ctx, args) }),
  t({ name: 'modules_list', description: 'List installed modules and whether they are enabled.', inputSchema: z.object({}), handler: async (deps) => ok(listModules(deps)) }),
  t({ name: 'modules_set_enabled', description: 'Enable or disable a module. Requires modules.manage.', inputSchema: z.object({ key: z.string(), enabled: z.boolean() }), handler: (deps, ctx, args) => setModuleEnabled(deps, ctx, args) }),
  t({ name: 'themes_list', description: 'List themes and the active theme key.', inputSchema: z.object({}), handler: async (deps) => ok(listThemes(deps)) }),
  t({ name: 'themes_activate', description: 'Activate a theme. Requires settings.manage.', inputSchema: z.object({ key: z.string() }), handler: (deps, ctx, args) => activateTheme(deps, ctx, args) }),
  t({ name: 'locales_list', description: 'List the locales this installation keeps, leading one first. Requires settings.manage.', inputSchema: z.object({}), handler: (deps, ctx) => listLocales(deps, ctx) }),
  t({ name: 'locales_add', description: 'Add a locale. Requires settings.manage.', inputSchema: z.object({ code: z.string() }), handler: (deps, ctx, args) => addLocale(deps, ctx, args) }),
  t({ name: 'locales_reorder', description: 'Reorder locales; the first is the leading locale. Requires settings.manage.', inputSchema: z.object({ codes: z.array(z.string()) }), handler: (deps, ctx, args) => reorderLocales(deps, ctx, args) }),
  t({ name: 'locales_remove', description: 'Remove a locale and strip it from all stored text. Requires settings.manage and confirm. Audited.', inputSchema: z.object({ code: z.string(), confirm: z.boolean() }), handler: (deps, ctx, args) => removeLocale(deps, ctx, args) }),
];
