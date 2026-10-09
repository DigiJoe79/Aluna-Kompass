/** Eine Aktion des Änderungsprotokolls und die Werte, die ihr Satz in `audit.sentences.*` braucht (Spec Protokoll § 3). */
export interface AuditActionDef {
  params: readonly string[];
}

/** Dieselbe Form wie ein Permission-Key: camelCase je Abschnitt, mindestens ein Punkt. */
export const AUDIT_ACTION = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

/** Ein Parameter heißt in camelCase; Personen stehen nur als `…UserId`/`…ContactId`. */
export const AUDIT_PARAM = /^[a-z][a-zA-Z0-9]*$/;

/** Personenbezug nur als ID (`…UserId`, `…ContactId`); diese Namen sind nie ein Parameter (Spec § 2). */
export const FORBIDDEN_AUDIT_PARAM = /(e-?mail|phone|telefon|iban|address|anschrift)/i;

/** Wirft bei einer unzulässigen Aktion oder einem unzulässigen Parameter; von `defineModule` aufgerufen. */
export function validateAuditActions(actions: Record<string, AuditActionDef>): void {
  for (const [action, def] of Object.entries(actions)) {
    if (!AUDIT_ACTION.test(action)) throw new Error(`invalid audit action: ${action}`);
    for (const param of def.params) {
      if (!AUDIT_PARAM.test(param) || FORBIDDEN_AUDIT_PARAM.test(param)) throw new Error(`invalid audit param: ${action}.${param}`);
    }
  }
}

/** Die Werte, die `writeSettingInternal` jeder Aktion mitgibt: den Schlüssel der Einstellung. */
export const SETTING_AUDIT: AuditActionDef = { params: ['key'] };

/**
 * Die Aktionen des Kerns (Auth, Nutzer, Rollen, Einstellungen, Sprachen, Backup, Medien, …) mit ihren Werten.
 * Personen nur als ID (`targetUserId`); wer handelte, steht in `user_id`.
 */
export const CORE_AUDIT_ACTIONS: Record<string, AuditActionDef> = {
  'apiTokens.create': { params: ['tokenName'] },
  'apiTokens.revoke': { params: ['tokenName'] },
  'auth.changePassword': { params: [] },
  /** Regel 4: zur vorhandenen Adresse die ID des Kontos, sonst `null` — nie die eingetippte Adresse. */
  'auth.failed': { params: ['targetUserId'] },
  'auth.locked': { params: ['targetUserId', 'attempts'] },
  'auth.login': { params: [] },
  'auth.throttled': { params: ['attempts', 'minutes'] },
  /** `sizeBytes`: Größe der Sicherung in Byte; die Anzeige rechnet in MB. */
  'backup.export': { params: ['sizeBytes'] },
  'backup.import': { params: ['environment', 'createdAt'] },
  'dashboard.resetLayout': { params: [] },
  'dashboard.setLayout': { params: ['tileCount'] },
  'documents.export': { params: [] },
  'followUps.create': { params: ['label', 'onRecord', 'dueOn'] },
  'followUps.complete': { params: ['label', 'onRecord'] },
  'followUps.reopen': { params: ['label', 'onRecord'] },
  'followUps.delete': { params: ['label', 'onRecord'] },
  'locale.add': { params: ['code'] },
  'locale.remove': { params: ['code'] },
  'locale.reorder': { params: [] },
  'media.upload': { params: ['filename'] },
  'media.delete': { params: ['filename'] },
  'media.move': { params: ['filename', 'folder', 'toRoot'] },
  'media.folder.create': { params: ['path'] },
  'media.folder.rename': { params: ['from', 'to'] },
  'media.folder.delete': { params: ['path'] },
  'roles.create': { params: ['roleName'] },
  'roles.update': { params: ['roleName'] },
  'roles.setPermissions': { params: ['roleName'] },
  'roles.provision': { params: ['roleName', 'module', 'created'] },
  'setup.complete': { params: [] },
  'users.create': { params: ['targetUserId'] },
  'users.update': { params: ['targetUserId'] },
  'users.activate': { params: ['targetUserId'] },
  'users.deactivate': { params: ['targetUserId'] },
  'users.resetStartPassword': { params: ['targetUserId'] },
  'users.assignRole': { params: ['roleName', 'targetUserId'] },
  'users.removeRole': { params: ['roleName', 'targetUserId'] },
  // Über `writeSettingInternal`: der Schlüssel der Einstellung.
  'settings.update': SETTING_AUDIT,
  'setup.organizationName': SETTING_AUDIT,
  'setup.locales': SETTING_AUDIT,
  'backup.export.mark': SETTING_AUDIT,
  'backup.import.mark': SETTING_AUDIT,
  'modules.enable': SETTING_AUDIT,
  'modules.disable': SETTING_AUDIT,
  'themes.activate': SETTING_AUDIT,
  'themes.create': SETTING_AUDIT,
  'themes.update': SETTING_AUDIT,
  'themes.duplicate': SETTING_AUDIT,
  'themes.delete': SETTING_AUDIT,
  'seed.organization': SETTING_AUDIT,
  'seed.locales': SETTING_AUDIT,
  'seed.modules': SETTING_AUDIT,
};
