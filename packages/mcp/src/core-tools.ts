import {
  activateTheme, addLocale, assignRole, completeFollowUp, createFollowUp, deleteFollowUp, followUpCreateSchema,
  followUpDueSchema, followUpIdSchema, followUpListSchema, listDueFollowUpsWithTargets, listFollowUps, reopenFollowUp,
  dashboardLayoutSchema, getDashboardLayout, listDashboardTiles, readDashboard, resetDashboardLayout, setDashboardLayout,
  createMediaFolder, createRole, createUser, deleteMediaAsset, deleteMediaFolder, getAuditEntry, listDocumentBases, listLocales, listMediaAssets, listModules, mediaListFilterSchema,
  getSetting, listRetentionDue, listRoles, listSettings, listThemes, listUsers, moveMediaAsset, queryAudit, removeLocale, removeRole, renameMediaFolder,
  reorderLocales, resetStartPassword, setModuleEnabled, setRolePermissions, setSetting, setUserActive, storeMediaAsset,
  updateRole, ok, invalid,
  createTheme, deleteTheme, duplicateTheme, getUser, listMediaFolders, previewLocaleRemoval, themeSchema, updateTheme, updateUser,
  listTranslationGaps, setTranslations, translationGapsFilterSchema, translationsSetSchema,
  type McpToolDefinition,
} from '@kompass/core';
import { z } from 'zod';

const t = <T>(def: McpToolDefinition<T>): McpToolDefinition => def as McpToolDefinition;

/**
 * Base64 ohne Data-URL-Präfix. Node's `Buffer.from(…, 'base64')` verwirft
 * fremde Zeichen still; ein Agent bekäme dann ein leeres oder verstümmeltes
 * Bild ohne Fehler. Deshalb die Form vorab prüfen.
 */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
function decodeBase64(text: string): Uint8Array | null {
  const compact = text.replace(/\s+/g, '');
  if (compact.length === 0 || compact.length % 4 !== 0 || !BASE64.test(compact)) return null;
  return new Uint8Array(Buffer.from(compact, 'base64'));
}

export const coreMcpTools: McpToolDefinition[] = [
  t({
    name: 'media_upload',
    description: 'Upload a file into the media library: filename plus base64 content (no data-URL prefix), optional folder path (null or omitted = root). Same limits as the UI: 10 MB, PNG/JPEG/WebP/SVG/PDF. Identical bytes are deduplicated — the existing record comes back, with its own filename and folder. Requires media.upload. Audited.',
    inputSchema: z.object({ filename: z.string().min(1).max(200), contentBase64: z.string().min(1), folder: z.string().nullable().optional() }),
    handler: (deps, ctx, { filename, contentBase64, folder }) => {
      const bytes = decodeBase64(contentBase64);
      if (!bytes) return Promise.resolve(invalid([{ path: 'contentBase64', message: 'invalidBase64' }]));
      return storeMediaAsset(deps, ctx, { originalName: filename, bytes, folder: folder ?? null });
    },
    service: storeMediaAsset,
  }),
  t({ name: 'settings_list', description: 'Read all registered settings with their current values. Requires settings.manage.', inputSchema: z.object({}), handler: (deps, ctx) => listSettings(deps, ctx), service: listSettings }),
  t({ name: 'settings_get', description: 'Read one setting by key, e.g. organization.name. Requires settings.manage.', inputSchema: z.object({ key: z.string() }), handler: (deps, ctx, args) => getSetting(deps, ctx, args), service: getSetting }),
  t({ name: 'settings_set', description: 'Update one setting. Requires settings.manage. Audited.', inputSchema: z.object({ key: z.string(), value: z.unknown() }), handler: (deps, ctx, args) => setSetting(deps, ctx, args), service: setSetting }),
  t({ name: 'roles_list', description: 'List roles with permission keys and user counts.', inputSchema: z.object({}), handler: (deps, ctx) => listRoles(deps, ctx), service: listRoles }),
  t({ name: 'roles_create', description: 'Create a role. Requires roles.manage.', inputSchema: z.object({ name: z.string(), description: z.string().optional() }), handler: (deps, ctx, args) => createRole(deps, ctx, args), service: createRole }),
  t({ name: 'roles_update', description: 'Rename or describe a role. Requires roles.manage.', inputSchema: z.object({ id: z.string(), name: z.string().optional(), description: z.string().optional() }), handler: (deps, ctx, args) => updateRole(deps, ctx, args), service: updateRole }),
  t({ name: 'roles_set_permissions', description: 'Replace the permission set of a role. Requires roles.manage.', inputSchema: z.object({ roleId: z.string(), permissionKeys: z.array(z.string()) }), handler: (deps, ctx, args) => setRolePermissions(deps, ctx, args), service: setRolePermissions }),
  t({ name: 'roles_assign', description: 'Assign a role to a user. Requires users.manage.', inputSchema: z.object({ userId: z.string(), roleId: z.string() }), handler: (deps, ctx, args) => assignRole(deps, ctx, args), service: assignRole }),
  t({ name: 'roles_remove', description: 'Remove a role from a user. Requires users.manage.', inputSchema: z.object({ userId: z.string(), roleId: z.string() }), handler: (deps, ctx, args) => removeRole(deps, ctx, args), service: removeRole }),
  t({ name: 'users_list', description: 'List users with roles and status. Requires users.manage.', inputSchema: z.object({}), handler: (deps, ctx) => listUsers(deps, ctx), service: listUsers }),
  t({ name: 'users_create', description: 'Create a user; returns the one-time start password. Requires users.manage.', inputSchema: z.object({ name: z.string(), email: z.string(), roleIds: z.array(z.string()).default([]) }), handler: (deps, ctx, args) => createUser(deps, ctx, args), service: createUser }),
  t({ name: 'users_get', description: 'Read one user with roles and derived status. Requires users.manage.', inputSchema: z.object({ id: z.string() }), handler: (deps, ctx, { id }) => getUser(deps, ctx, id), service: getUser }),
  t({ name: 'users_update', description: 'Change name and e-mail of a user. The e-mail must stay unique; roles are set with roles_assign and roles_remove. Requires users.manage. Audited.', inputSchema: z.object({ id: z.string(), name: z.string(), email: z.string() }), handler: (deps, ctx, args) => updateUser(deps, ctx, args), service: updateUser }),
  t({ name: 'users_set_active', description: 'Activate or deactivate a user. Requires users.manage.', inputSchema: z.object({ id: z.string(), isActive: z.boolean() }), handler: (deps, ctx, args) => setUserActive(deps, ctx, args), service: setUserActive }),
  t({ name: 'users_reset_start_password', description: 'Issue a new one-time start password. Requires users.manage.', inputSchema: z.object({ id: z.string() }), handler: (deps, ctx, args) => resetStartPassword(deps, ctx, args), service: resetStartPassword }),
  t({ name: 'audit_query', description: 'Query the immutable audit log. Requires audit.view.', inputSchema: z.object({ userId: z.string().optional(), channel: z.enum(['ui', 'mcp', 'system']).optional(), action: z.string().optional(), entityType: z.string().optional(), entityId: z.string().optional(), from: z.string().optional(), to: z.string().optional(), text: z.string().optional(), limit: z.number().int().optional(), offset: z.number().int().optional() }), handler: async (deps, ctx, args) => queryAudit(deps, ctx, args), service: queryAudit }),
  t({ name: 'audit_get', description: 'Read one audit entry. Requires audit.view.', inputSchema: z.object({ id: z.string() }), handler: async (deps, ctx, { id }) => getAuditEntry(deps, ctx, id), service: getAuditEntry }),
  // Die Akte (Ablage, Nummernvergabe, Storno) lebt im Modul `dms`, das seine
  // eigenen Werkzeuge mitbringt. Der Kern behält nur den Auszugsweg.
  t({ name: 'documents_bases', description: 'List the available document base templates and whether each renders. Requires documents.export.', inputSchema: z.object({}), handler: (deps, ctx) => listDocumentBases(deps, ctx), service: listDocumentBases }),
  t({ name: 'media_list', description: 'List media assets with size, type, folder and where each is used (label, entity, id, href). Filters: folder (omitted = all, null = root), query (case-insensitive, matches filename and usage labels), kind (image | pdf), sort (newest default | oldest | name | size). Requires media.upload.', inputSchema: mediaListFilterSchema, handler: (deps, ctx, args) => listMediaAssets(deps, ctx, args), service: listMediaAssets }),
  t({ name: 'media_delete', description: 'Delete a media asset. Refused while any record still references it (editorial content, audited). Requires media.upload.', inputSchema: z.object({ id: z.string() }), handler: (deps, ctx, args) => deleteMediaAsset(deps, ctx, args), service: deleteMediaAsset }),
  t({ name: 'media_move', description: 'Move a media asset into a folder (null = root). Requires media.upload.', inputSchema: z.object({ id: z.string(), folder: z.string().nullable() }), handler: (deps, ctx, args) => moveMediaAsset(deps, ctx, args), service: moveMediaAsset }),
  t({ name: 'media_folder_list', description: 'List the media folders with the number of assets in each. Requires media.upload.', inputSchema: z.object({}), handler: (deps, ctx) => listMediaFolders(deps, ctx), service: listMediaFolders }),
  t({ name: 'media_folder_create', description: 'Create a virtual media folder; the parent must exist. Requires media.upload.', inputSchema: z.object({ path: z.string() }), handler: (deps, ctx, args) => createMediaFolder(deps, ctx, args), service: createMediaFolder }),
  t({ name: 'media_folder_rename', description: 'Rename a media folder; subfolders and assets move with it. Requires media.upload.', inputSchema: z.object({ from: z.string(), to: z.string() }), handler: (deps, ctx, args) => renameMediaFolder(deps, ctx, args), service: renameMediaFolder }),
  t({ name: 'media_folder_delete', description: 'Delete an empty media folder. Requires media.upload.', inputSchema: z.object({ path: z.string() }), handler: (deps, ctx, args) => deleteMediaFolder(deps, ctx, args), service: deleteMediaFolder }),
  t({ name: 'modules_list', description: 'List installed modules and whether they are enabled. Open to any signed-in user — the start page shows the same.', inputSchema: z.object({}), handler: async (deps) => ok(listModules(deps)), service: listModules }),
  t({ name: 'modules_set_enabled', description: 'Enable or disable a module. Requires modules.manage.', inputSchema: z.object({ key: z.string(), enabled: z.boolean() }), handler: (deps, ctx, args) => setModuleEnabled(deps, ctx, args), service: setModuleEnabled }),
  t({ name: 'themes_list', description: 'List themes and the active theme key. Open to any signed-in user — the active theme is in every page anyway.', inputSchema: z.object({}), handler: async (deps) => ok(listThemes(deps)), service: listThemes }),
  t({ name: 'themes_activate', description: 'Activate a theme. Requires settings.manage.', inputSchema: z.object({ key: z.string() }), handler: (deps, ctx, args) => activateTheme(deps, ctx, args), service: activateTheme }),
  /*
   * Ein Theme trägt jeden Token für hell und dunkel. Das Schema ist deshalb
   * dasselbe, das der Dienst prüft — eine Abschrift hier hinkte der ersten
   * neuen Farbe hinterher.
   */
  t({ name: 'themes_create', description: 'Create a theme: key, name and every design token as a light/dark pair. Requires settings.manage. Audited.', inputSchema: themeSchema, handler: (deps, ctx, args) => createTheme(deps, ctx, args), service: createTheme }),
  t({ name: 'themes_update', description: 'Replace name and tokens of an editable theme; the shipped default is read-only. Requires settings.manage. Audited.', inputSchema: themeSchema, handler: (deps, ctx, args) => updateTheme(deps, ctx, args), service: updateTheme }),
  t({ name: 'themes_duplicate', description: 'Copy a theme under a new key and name — the way to start from the shipped default. Requires settings.manage. Audited.', inputSchema: z.object({ sourceKey: z.string(), key: z.string(), name: z.string() }), handler: (deps, ctx, args) => duplicateTheme(deps, ctx, args), service: duplicateTheme }),
  t({ name: 'themes_delete', description: 'Delete a theme. Refused for the active one and for the shipped default. Requires settings.manage. Audited.', inputSchema: z.object({ key: z.string() }), handler: (deps, ctx, args) => deleteTheme(deps, ctx, args), service: deleteTheme }),
  t({ name: 'locales_list', description: 'List the locales this installation keeps, leading one first. Requires settings.manage.', inputSchema: z.object({}), handler: (deps, ctx) => listLocales(deps, ctx), service: listLocales }),
  t({ name: 'locales_add', description: 'Add a locale. Requires settings.manage.', inputSchema: z.object({ code: z.string() }), handler: (deps, ctx, args) => addLocale(deps, ctx, args), service: addLocale }),
  t({ name: 'locales_reorder', description: 'Reorder locales; the first is the leading locale. Requires settings.manage.', inputSchema: z.object({ codes: z.array(z.string()) }), handler: (deps, ctx, args) => reorderLocales(deps, ctx, args), service: reorderLocales }),
  t({ name: 'locales_preview_removal', description: 'Count what removing a locale would strip: how many records and settings carry text in it. Read-only — locales_remove does the work. Requires settings.manage.', inputSchema: z.object({ code: z.string() }), handler: (deps, ctx, args) => previewLocaleRemoval(deps, ctx, args), service: previewLocaleRemoval }),
  t({ name: 'locales_remove', description: 'Remove a locale and strip it from all stored text. Requires settings.manage and confirm. Audited.', inputSchema: z.object({ code: z.string(), confirm: z.boolean() }), handler: (deps, ctx, args) => removeLocale(deps, ctx, args), service: removeLocale }),
  // Übersetzungen (Spec 2026-09-13-uebersetzungen-ueber-mcp). Kein eigenes
  // Recht: Die Module prüfen ihres im Haken, deshalb nennt die Beschreibung
  // die Rechte der Module.
  t({ name: 'translations_list_gaps', description: 'List missing translations across all enabled modules with the source text in the leading locale: every record whose leading-locale text is filled while another locale is empty, drafts included. Optional filters: locale, entityType. Requires the view right of each module (animals.view, projects.view, site.view); modules you may not read are named under omitted.', inputSchema: translationGapsFilterSchema, handler: (deps, ctx, args) => listTranslationGaps(deps, ctx, args), service: listTranslationGaps }),
  t({ name: 'translations_set', description: 'Write translations for single locales without touching the other locales. Items for the same record (entityType + id) are written together through the module update service and need its manage right (animals.manage, projects.manage, site.manage). Audited once per record. Returns the applied count and the failed items by index; a failed record does not stop the others.', inputSchema: translationsSetSchema, handler: (deps, ctx, args) => setTranslations(deps, ctx, args), service: setTranslations }),
  // Die Projekte gehören dem Kern; bis zum Cutover boten sie das Webseiten-Modul an.
  t({ name: 'retention_due', description: 'List everything whose retention period has run out and that is due for deletion, across all enabled modules. Requires retention.view.', inputSchema: z.object({}), handler: (deps, ctx) => listRetentionDue(deps, ctx), service: listRetentionDue }),
  // Wiedervorlagen: Anlässe an Vorgängen aller Module. Der Kern prüft die
  // Entität nicht; ein Modul, das eine anlegt, hat sie vorher geprüft. Über
  // dieses Werkzeug legt ein Agent deshalb nur an, was er selbst gelesen hat.
  t({ name: 'followups_list_due', description: 'List open follow-ups due until a date, oldest first, with a label and link for each record they point at. Optional assigneeUserId. Requires followUps.view.', inputSchema: followUpDueSchema, handler: (deps, ctx, args) => listDueFollowUpsWithTargets(deps, ctx, args), service: listDueFollowUpsWithTargets }),
  t({ name: 'followups_list', description: 'List the follow-ups on one record (entityType + entityId), open ones first; includeDone adds ticked-off ones. Requires followUps.view.', inputSchema: followUpListSchema, handler: (deps, ctx, args) => listFollowUps(deps, ctx, args), service: listFollowUps }),
  t({ name: 'followups_create', description: 'Create a follow-up on a record: due date, title, optional assignee. Requires followUps.manage. Audited.', inputSchema: followUpCreateSchema, handler: (deps, ctx, args) => createFollowUp(deps, ctx, args), service: createFollowUp }),
  t({ name: 'followups_complete', description: 'Tick a follow-up off; the row stays. Requires followUps.manage. Audited.', inputSchema: followUpIdSchema, handler: (deps, ctx, args) => completeFollowUp(deps, ctx, args), service: completeFollowUp }),
  t({ name: 'followups_reopen', description: 'Reopen a ticked-off follow-up. Requires followUps.manage. Audited.', inputSchema: followUpIdSchema, handler: (deps, ctx, args) => reopenFollowUp(deps, ctx, args), service: reopenFollowUp }),
  t({ name: 'followups_delete', description: 'Delete a follow-up (working material). Requires followUps.manage. Audited.', inputSchema: followUpIdSchema, handler: (deps, ctx, args) => deleteFollowUp(deps, ctx, args), service: deleteFollowUp }),
  // Die Startseite (Spec 2026-09-17): jede Sitzung darf die eigene Anordnung
  // lesen und setzen — wie beim Passwortwechsel gibt es dafür kein Recht.
  // Die Kacheln selbst tragen je eines; ohne es fehlen sie einfach.
  t({ name: 'dashboard_tiles', description: 'List the start page tiles the caller may place: module, key, kind (count | list | status), defaultOn and option fields with defaults. Only tiles whose permission the caller holds. Any signed-in user.', inputSchema: z.object({}), handler: (deps, ctx) => listDashboardTiles(deps, ctx), service: listDashboardTiles }),
  t({ name: 'dashboard_get_layout', description: 'Read the caller\'s own start page layout: ordered tiles with options; custom=false means the default. Any signed-in user.', inputSchema: z.object({}), handler: (deps, ctx) => getDashboardLayout(deps, ctx), service: getDashboardLayout }),
  t({ name: 'dashboard_set_layout', description: 'Replace the caller\'s own start page layout: an ordered list of { module, key, options }. Tiles not listed are off. Refuses unknown tiles, tiles without permission and options outside their schema. Any signed-in user. Audited.', inputSchema: dashboardLayoutSchema, handler: (deps, ctx, args) => setDashboardLayout(deps, ctx, args), service: setDashboardLayout }),
  t({ name: 'dashboard_reset_layout', description: 'Drop the caller\'s own start page layout and return to the default. Any signed-in user. Audited.', inputSchema: z.object({}), handler: (deps, ctx) => resetDashboardLayout(deps, ctx), service: resetDashboardLayout }),
  t({ name: 'dashboard_read', description: 'Read the caller\'s start page: every enabled tile with its content — what is pending across all modules (inbox, drafts, due follow-ups, website changes, setup gaps). Any signed-in user.', inputSchema: z.object({}), handler: (deps, ctx) => readDashboard(deps, ctx), service: readDashboard }),
];
