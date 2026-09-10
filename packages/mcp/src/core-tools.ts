import {
  activateTheme, addLocale, assignRole, createMediaFolder, createProject, createRole, createUser, deleteMediaAsset, deleteMediaFolder, getAuditEntry, getProject, listDocumentBases, listLocales, listMediaAssets, listModules, listProjects,
  listRetentionDue, listRoles, listThemes, listUsers, moveMediaAsset, projectCreateSchema, projectUpdateSchema, queryAudit, readAllSettings, readSetting, removeLocale, removeRole, renameMediaFolder,
  reorderLocales, reorderProjects, resetStartPassword, setModuleEnabled, setProjectPublished, setRolePermissions, setSetting, setUserActive, updateProject,
  updateRole, ok, invalid,
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
  // Die Akte (Ablage, Nummernvergabe, Storno) lebt im Modul `dms`, das seine
  // eigenen Werkzeuge mitbringt. Der Kern behält nur den Auszugsweg.
  t({ name: 'documents_bases', description: 'List the available document base templates and whether each renders. Requires documents.export.', inputSchema: z.object({}), handler: (deps, ctx) => listDocumentBases(deps, ctx) }),
  t({ name: 'media_list', description: 'List media assets with size, type, folder and where each is used. Optional folder filter (omitted = all, null = root). Requires media.upload.', inputSchema: z.object({ folder: z.string().nullable().optional() }), handler: (deps, ctx, { folder }) => listMediaAssets(deps, ctx, folder) }),
  t({ name: 'media_delete', description: 'Delete a media asset. Refused while any record still references it (editorial content, audited). Requires media.upload.', inputSchema: z.object({ id: z.string() }), handler: (deps, ctx, args) => deleteMediaAsset(deps, ctx, args) }),
  t({ name: 'media_move', description: 'Move a media asset into a folder (null = root). Requires media.upload.', inputSchema: z.object({ id: z.string(), folder: z.string().nullable() }), handler: (deps, ctx, args) => moveMediaAsset(deps, ctx, args) }),
  t({ name: 'media_folder_create', description: 'Create a virtual media folder; the parent must exist. Requires media.upload.', inputSchema: z.object({ path: z.string() }), handler: (deps, ctx, args) => createMediaFolder(deps, ctx, args) }),
  t({ name: 'media_folder_rename', description: 'Rename a media folder; subfolders and assets move with it. Requires media.upload.', inputSchema: z.object({ from: z.string(), to: z.string() }), handler: (deps, ctx, args) => renameMediaFolder(deps, ctx, args) }),
  t({ name: 'media_folder_delete', description: 'Delete an empty media folder. Requires media.upload.', inputSchema: z.object({ path: z.string() }), handler: (deps, ctx, args) => deleteMediaFolder(deps, ctx, args) }),
  t({ name: 'modules_list', description: 'List installed modules and whether they are enabled.', inputSchema: z.object({}), handler: async (deps) => ok(listModules(deps)) }),
  t({ name: 'modules_set_enabled', description: 'Enable or disable a module. Requires modules.manage.', inputSchema: z.object({ key: z.string(), enabled: z.boolean() }), handler: (deps, ctx, args) => setModuleEnabled(deps, ctx, args) }),
  t({ name: 'themes_list', description: 'List themes and the active theme key.', inputSchema: z.object({}), handler: async (deps) => ok(listThemes(deps)) }),
  t({ name: 'themes_activate', description: 'Activate a theme. Requires settings.manage.', inputSchema: z.object({ key: z.string() }), handler: (deps, ctx, args) => activateTheme(deps, ctx, args) }),
  t({ name: 'locales_list', description: 'List the locales this installation keeps, leading one first. Requires settings.manage.', inputSchema: z.object({}), handler: (deps, ctx) => listLocales(deps, ctx) }),
  t({ name: 'locales_add', description: 'Add a locale. Requires settings.manage.', inputSchema: z.object({ code: z.string() }), handler: (deps, ctx, args) => addLocale(deps, ctx, args) }),
  t({ name: 'locales_reorder', description: 'Reorder locales; the first is the leading locale. Requires settings.manage.', inputSchema: z.object({ codes: z.array(z.string()) }), handler: (deps, ctx, args) => reorderLocales(deps, ctx, args) }),
  t({ name: 'locales_remove', description: 'Remove a locale and strip it from all stored text. Requires settings.manage and confirm. Audited.', inputSchema: z.object({ code: z.string(), confirm: z.boolean() }), handler: (deps, ctx, args) => removeLocale(deps, ctx, args) }),
  // Die Projekte gehören dem Kern; bis zum Cutover boten sie das Webseiten-Modul an.
  t({ name: 'projects_list', description: 'List projects with their public fields. Requires projects.view.', inputSchema: z.object({}), handler: (deps, ctx) => listProjects(deps, ctx) }),
  t({ name: 'project_get', description: 'Read one project. Requires projects.view.', inputSchema: z.object({ id: z.string() }), handler: (deps, ctx, { id }) => getProject(deps, ctx, id) }),
  t({ name: 'project_create', description: 'Create a project (unpublished). Requires projects.manage. Audited.', inputSchema: projectCreateSchema, handler: (deps, ctx, args) => createProject(deps, ctx, args) }),
  t({ name: 'project_update', description: 'Update a project. Requires projects.manage. Audited.', inputSchema: projectUpdateSchema, handler: (deps, ctx, args) => updateProject(deps, ctx, args) }),
  t({ name: 'project_set_published', description: 'Publish or unpublish a project. Requires projects.manage. Audited.', inputSchema: z.object({ id: z.string(), isPublished: z.boolean() }), handler: (deps, ctx, args) => setProjectPublished(deps, ctx, args) }),
  t({ name: 'projects_reorder', description: 'Reorder projects; the order decides what a template shows first. Requires projects.manage.', inputSchema: z.object({ ids: z.array(z.string()) }), handler: (deps, ctx, args) => reorderProjects(deps, ctx, args) }),
  t({ name: 'retention_due', description: 'List everything whose retention period has run out and that is due for deletion, across all enabled modules. Requires retention.view.', inputSchema: z.object({}), handler: (deps, ctx) => listRetentionDue(deps, ctx) }),
];
