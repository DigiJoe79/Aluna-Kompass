import {
  activateTheme, addLocale, assignRole, completeFollowUp, createFollowUp, deleteFollowUp, followUpCreateSchema,
  followUpDueSchema, followUpIdSchema, followUpListSchema, listDueFollowUpsWithTargets, listFollowUps, reopenFollowUp,
  dashboardLayoutSchema, getDashboardLayout, listDashboardTiles, readDashboard, resetDashboardLayout, setDashboardLayout,
  createMediaFolder, createRole, createUser, deleteMediaAsset, getMediaAsset, getMediaPreview, deleteMediaFolder, getAuditEntry, listAuditActions, listDocumentBases, listLocales, listMediaAssets, listModules, mediaListFilterSchema,
  getSetting, listRetentionDue, listRoles, listSettings, listThemes, listUsers, moveMediaAsset, queryAudit, removeLocale, removeRole, renameMediaFolder,
  reorderLocales, resetStartPassword, setMediaAiKind, setModuleEnabled, setRolePermissions, setSetting, setUserActive, storeMediaAsset,
  updateRole, ok, invalid,
  createTheme, deleteTheme, duplicateTheme, getUser, listMediaFolders, previewLocaleRemoval, themeSchema, updateTheme, updateUser,
  listTranslationGaps, setTranslations, translationGapsFilterSchema, translationsSetSchema,
  backupJobStatus, backupNameSchema, backupRunIdSchema, cancelBackupJob, deleteBackup, isAppDeps, listBackupArchives,
  localizedConflict, pinBackup, pinBackupSchema, restorePreview, restoreSchema, startBackup, startBackupVerification,
  startRestore, unpinBackup,
  type AppDeps, type CallContext, type Deps, type McpToolDefinition, type Result,
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

/**
 * Backup-Dienste brauchen die laufende App (Backup-Verzeichnis, Sicherung der Datenbank). Ein Aufruf mit anderen
 * `Deps` (Skript, Test) bekommt dieselbe Ablehnung wie eine Installation ohne Verzeichnis, keinen Wurf. Rechte und
 * fehlendes Verzeichnis prüft der Dienst selbst in seiner Reihenfolge.
 */
const withBackup = <I>(fn: (deps: AppDeps, ctx: CallContext, input: I) => Promise<Result<unknown>>) =>
  async (deps: Deps, ctx: CallContext, input: I): Promise<Result<unknown>> => {
    if (!isAppDeps(deps)) return localizedConflict('backupPathMissing', 'backup.errors.backupPathMissing');
    const result = await fn(deps, ctx, input);
    return result.ok ? ok(withoutFileLists(result.value)) : result;
  };

/**
 * Die Dateiliste im Manifest eines Backups (bei einem Verein mit Akte und Mediathek Zehntausende Pfade) gehört nicht in
 * ein Modell: `backup_list` brachte schon mit Seed-Daten 90 KB (Prüfung 2026-10-23). Statt `files` steht `fileCount`.
 */
function withoutFileLists(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutFileLists);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (key === 'files' && Array.isArray(inner)) out.fileCount = inner.length;
    else out[key] = withoutFileLists(inner);
  }
  return out;
}

const emptyInput = z.object({});

const backupTools: McpToolDefinition[] = [
  t({
    name: 'backup_list',
    description: 'List the backups in the backup directory, newest first: name, kind (automatic, manual, preUpdate, preRestore, upload, unknown), createdAt, size, Kompass version, migrationCount, verification, pinned and its label, counts, number of files (fileCount; the file list itself is not returned), restorable and retention (how long it stays). Also storage, last error, mount warning, schedule and whether e-mail alerts are available. No download over MCP — files of this size do not belong in a model. Requires backup.export. Read only.',
    inputSchema: emptyInput,
    handler: (deps, ctx) => withBackup(listBackupArchives)(deps, ctx, {}),
    service: listBackupArchives,
  }),
  t({
    name: 'backup_create',
    description: 'Start a manual backup in the background; one backup job runs at a time. Returns runId, or the running job. The manual slot keeps one backup; the previous one goes only after the new one passed verification. Poll backup_job_status. Requires backup.export. Audited.',
    inputSchema: emptyInput,
    handler: (deps, ctx) => withBackup(startBackup)(deps, ctx, {}),
    service: startBackup,
  }),
  t({
    name: 'backup_job_status',
    description: 'The running backup job (create, verify, restore) with steps and progress, and the last result of each kind. Requires backup.export. Read only.',
    inputSchema: emptyInput,
    handler: (deps, ctx) => withBackup(backupJobStatus)(deps, ctx, {}),
    service: backupJobStatus,
  }),
  t({
    name: 'backup_job_cancel',
    description: 'Cancel the running backup job by runId. A restore can be cancelled only before it starts replacing data, and needs backup.import as well. Requires backup.export. Audited.',
    inputSchema: backupRunIdSchema,
    handler: withBackup(cancelBackupJob),
    service: cancelBackupJob,
  }),
  t({
    name: 'backup_verify',
    description: 'Verify an existing backup again in the background: read it fully, check the file list and sizes, the database integrity and the checksum. Requires backup.export. Audited.',
    inputSchema: backupNameSchema,
    handler: withBackup(startBackupVerification),
    service: startBackupVerification,
  }),
  t({
    name: 'backup_pin',
    description: 'Pin a backup with an optional label (at most 60 characters): it leaves every ring and stays until unpinned. At most 3 pinned. Pinning a backup that is already pinned only replaces its label (audited as a rename); otherwise it stays unchanged. Requires backup.export. Audited.',
    inputSchema: pinBackupSchema,
    handler: withBackup(pinBackup),
    service: pinBackup,
  }),
  t({
    name: 'backup_unpin',
    description: 'Release a pinned backup; it returns to its ring and may be removed at the next cleanup. A backup that is not pinned stays unchanged (success, nothing audited). Requires backup.export. Audited.',
    inputSchema: backupNameSchema,
    handler: withBackup(unpinBackup),
    service: unpinBackup,
  }),
  t({
    name: 'backup_delete',
    description: 'Delete one backup (archive and sidecar), pinned ones too. Refused for the newest verified backup and while a backup job runs. Requires backup.import. Audited.',
    inputSchema: backupNameSchema,
    handler: withBackup(deleteBackup),
    service: deleteBackup,
  }),
  t({
    name: 'backup_restore_preview',
    description: "Before a restore: changes and distinct people in the audit log since the backup was made, the backup's counts and an estimated duration. Requires backup.import. Read only.",
    inputSchema: backupNameSchema,
    handler: withBackup(restorePreview),
    service: restorePreview,
  }),
  t({
    name: 'backup_restore',
    description: 'Restore a backup from the list as a background job: first a backup of the current state (kind preRestore), then verification, then all data is replaced and migrated. Current API tokens and backup settings stay; all sessions end; the published website, sent e-mails and submitted direct-debit files do not go back. confirmation is the environment name (produktion, test, entwicklung). Human only: refused over MCP unless the association has set backup.mcpHumanOnlyAllowed at the screen. Requires backup.import. Audited.',
    inputSchema: restoreSchema,
    handler: withBackup(startRestore),
    service: startRestore,
  }),
];

export const coreMcpTools: McpToolDefinition[] = [
  ...backupTools,
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
  t({
    name: 'media_get',
    description: 'Download a media asset: its record, contentType and the content as base64 (no data-URL prefix) — the counterpart of media_upload, e.g. to copy images between installations. variant: original (default, up to 10 MB, the upload limit — about 13 MB of base64) or preview (the media library thumbnail, WebP at most 320 px wide, a few KB — enough to see what is on an image; SVG comes back as is, a PDF has no preview and returns contentBase64 null). Open to any signed-in user; an asset used by a record also requires the view right of that record (animals.view, projects.view, site.view, …), like the UI. Read only, not audited.',
    inputSchema: z.object({ id: z.string(), variant: z.enum(['original', 'preview']).optional() }),
    handler: async (deps, ctx, { id, variant }) => {
      if (variant === 'preview') {
        const preview = await getMediaPreview(deps, ctx, id);
        if (!preview.ok) return preview;
        const { record, bytes, contentType } = preview.value;
        return ok({ record, contentType, contentBase64: bytes ? Buffer.from(bytes).toString('base64') : null });
      }
      const result = await getMediaAsset(deps, ctx, id);
      if (!result.ok) return result;
      const { record, bytes } = result.value;
      return ok({ record, contentType: record.mimeType, contentBase64: Buffer.from(bytes).toString('base64') });
    },
    service: getMediaAsset,
  }),
  t({ name: 'settings_list', description: 'Read all registered settings with their current values. Requires settings.manage.', inputSchema: z.object({}), handler: (deps, ctx) => listSettings(deps, ctx), service: listSettings }),
  t({ name: 'settings_get', description: 'Read one setting by key, e.g. organization.name. Requires settings.manage.', inputSchema: z.object({ key: z.string() }), handler: (deps, ctx, args) => getSetting(deps, ctx, args), service: getSetting }),
  t({ name: 'settings_set', description: 'Update one setting. Requires settings.manage. Audited.', inputSchema: z.object({ key: z.string(), value: z.unknown() }), handler: (deps, ctx, args) => setSetting(deps, ctx, args), service: setSetting }),
  t({ name: 'roles_list', description: 'List roles with permission keys and user counts. Requires roles.manage or users.manage.', inputSchema: z.object({}), handler: (deps, ctx) => listRoles(deps, ctx), service: listRoles }),
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
  t({ name: 'audit_query', description: 'Query the immutable audit log. Entries carry action and params (language-neutral values for the action; persons only as ids, names in paramUserNames). text searches stored values (params, entity id, before/after), not sentences. Requires audit.view.', inputSchema: z.object({ userId: z.string().optional(), channel: z.enum(['ui', 'mcp', 'system']).optional(), action: z.string().optional(), entityType: z.string().optional(), entityId: z.string().optional(), from: z.string().optional(), to: z.string().optional(), text: z.string().optional(), limit: z.number().int().optional(), offset: z.number().int().optional() }), handler: async (deps, ctx, args) => queryAudit(deps, ctx, args), service: queryAudit }),
  t({ name: 'audit_actions', description: 'List every action key that occurs in the audit log, once each and sorted — the values audit_query accepts as action. Requires audit.view.', inputSchema: z.object({}), handler: async (deps, ctx) => listAuditActions(deps, ctx), service: listAuditActions }),
  t({ name: 'audit_get', description: 'Read one audit entry (action, params, paramUserNames, before/after). Requires audit.view.', inputSchema: z.object({ id: z.string() }), handler: async (deps, ctx, { id }) => getAuditEntry(deps, ctx, id), service: getAuditEntry }),
  // Die Akte (Ablage, Nummernvergabe, Storno) lebt im Modul `dms`, das seine
  // eigenen Werkzeuge mitbringt. Der Kern behält nur den Auszugsweg.
  t({ name: 'documents_bases', description: 'List the available document base templates, whether each renders, and whether the installation keeps its own copy (own). Requires documents.export.', inputSchema: z.object({}), handler: (deps, ctx) => listDocumentBases(deps, ctx), service: listDocumentBases }),
  t({ name: 'media_list', description: 'List media assets with size, type, folder and where each is used (label, entity, id, href). Filters: folder (omitted = all, null = assets without a folder, a path = exactly that folder; with includeSubfolders: true also everything in its subfolders), query (case-insensitive, matches filename and usage labels), kind (image | pdf), sort (newest default | oldest | name | size), unused (true = only assets used nowhere). Requires media.upload.', inputSchema: mediaListFilterSchema, handler: (deps, ctx, args) => listMediaAssets(deps, ctx, args), service: listMediaAssets }),
  t({ name: 'media_delete', description: 'Delete a media asset. Refused while any record still references it (editorial content, audited). Requires media.upload.', inputSchema: z.object({ id: z.string() }), handler: (deps, ctx, args) => deleteMediaAsset(deps, ctx, args), service: deleteMediaAsset }),
  t({ name: 'media_move', description: 'Move a media asset into a folder (null = root). Pass expectedFolder (the folder you last saw) to be refused with movedInBetween instead of moving something that was moved in between. Answers moved: false (and records nothing) when the asset already lives in that folder. Requires media.upload.', inputSchema: z.object({ id: z.string(), folder: z.string().nullable(), expectedFolder: z.string().nullable().optional() }), handler: (deps, ctx, args) => moveMediaAsset(deps, ctx, args), service: moveMediaAsset }),
  t({ name: 'media_set_ai_kind', description: 'Set the image label of a media asset, shown on the website (none, edited, generated). edited = the image content was changed (people or objects removed or blurred, areas retouched), with any tool; whole-image corrections (crop, light, colour, sharpness) are not labelled, use none. generated = the image was created with AI. Set by a human decision, never guessed. Requires media.upload and that image labeling is switched on. Audited.', inputSchema: z.object({ id: z.string(), aiKind: z.enum(['none', 'edited', 'generated']) }), handler: (deps, ctx, args) => setMediaAiKind(deps, ctx, args), service: setMediaAiKind }),
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
  t({ name: 'locales_preview_removal', description: 'Count what removing a locale would strip: how many records and settings carry text in it, and nextLeading — the locale that leads afterwards when the leading one is removed (null otherwise). Read-only — locales_remove does the work. Refused (localeRequired) while an enabled module needs the locale, e.g. the website template. Requires settings.manage.', inputSchema: z.object({ code: z.string() }), handler: (deps, ctx, args) => previewLocaleRemoval(deps, ctx, args), service: previewLocaleRemoval }),
  t({ name: 'locales_remove', description: 'Remove a locale and strip it from all stored text. Refused (localeRequired) while an enabled module needs the locale, e.g. the website template declares it. Requires settings.manage and confirm. Audited.', inputSchema: z.object({ code: z.string(), confirm: z.boolean() }), handler: (deps, ctx, args) => removeLocale(deps, ctx, args), service: removeLocale }),
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
  t({ name: 'dashboard_tiles', description: 'List the start page tiles the caller may place: module, key, kind (count | list | status), variant (due | work | null), defaultOn and option fields with defaults. Only tiles whose permission the caller holds. Any signed-in user.', inputSchema: z.object({}), handler: (deps, ctx) => listDashboardTiles(deps, ctx), service: listDashboardTiles }),
  t({ name: 'dashboard_get_layout', description: 'Read the caller\'s own start page layout: the active layout (thirds = three equal columns, wide-narrow = one wide and one narrow column), its columns as ordered lists of { module, key, options }, and arrangements with the columns of both layouts — each layout keeps its own; one never saved is derived from the other. custom=false means the default (wide-narrow for whoever may see a work tile such as finance todo, else thirds). Any signed-in user.', inputSchema: z.object({}), handler: (deps, ctx) => getDashboardLayout(deps, ctx), service: getDashboardLayout }),
  t({ name: 'dashboard_set_layout', description: 'Set the caller\'s own start page layout. Either { layout, columns }: the columns of that layout (3 for thirds, 2 for wide-narrow: wide, narrow), each an ordered list of { module, key, options }; the other layout keeps its arrangement, but on and off apply to both: a tile dropped here is dropped there too, a tile newly listed here is appended to the shortest column there. Or { layout } alone: switch to that layout with its remembered arrangement. Or the older flat form { tiles }: an ordered list, spread over the columns of the active layout by order and estimated length (the other layout derived from it). Tiles not listed are off. Refuses unknown tiles, tiles without permission, duplicates, a wrong column count and options outside their schema. Any signed-in user. Audited.', inputSchema: dashboardLayoutSchema, handler: (deps, ctx, args) => setDashboardLayout(deps, ctx, args), service: setDashboardLayout }),
  t({ name: 'dashboard_reset_layout', description: 'Drop the caller\'s own start page layout and return to the default. Any signed-in user. Audited.', inputSchema: z.object({}), handler: (deps, ctx) => resetDashboardLayout(deps, ctx), service: resetDashboardLayout }),
  t({ name: 'dashboard_read', description: 'Read the caller\'s start page: every enabled tile with its content, column by column — what is pending across all modules (inbox, drafts, due follow-ups, website changes, setup gaps). Each tile names its column (from 0) in the active layout, its variant (due | work | null) and warningAction (a warning carries a button with a verb). A list line may carry `trailing`, a ready-formatted value shown right-aligned (e.g. an amount from finance). Any signed-in user.', inputSchema: z.object({}), handler: (deps, ctx) => readDashboard(deps, ctx), service: readDashboard }),
];
