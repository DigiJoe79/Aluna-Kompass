import type { ServiceError } from '@kompass/core';

type Translate = ((key: string, values?: Record<string, string | number | Date>) => string) & { has?: (key: string) => boolean };
type ConflictError = Extract<ServiceError, { type: 'conflict' }>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Die Parameter eines Konflikts für ICU: ein Datum (`YYYY-MM-DD`) wird zum Zeitpunkt **Mittag UTC** dieses Tages,
 * damit `{date, date, ::ddMMyyyy}` in jeder Zeitzone von −12 bis +12 Stunden denselben Kalendertag zeigt. Beträge
 * kommen in Cent und formatiert das ICU-Skelett (`::currency/EUR scale/0.01`). Alles andere bleibt, wie es kommt.
 */
export function messageValues(params: Record<string, string | number> = {}): Record<string, string | number | Date> {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, typeof value === 'string' && ISO_DATE.test(value) ? new Date(`${value}T12:00:00.000Z`) : value]));
}

/** `moduleKeys` („dms,finance“) wird zu `modules` („Dokumentenmanagement, Finanzen“): Meldungen nennen Namen, nicht Schlüssel. */
function withModuleNames(values: Record<string, string | number | Date>, t: Translate): Record<string, string | number | Date> {
  const keys = values.moduleKeys;
  if (typeof keys !== 'string') return values;
  const names = keys.split(',').map((key) => ((t.has?.(`modules.names.${key}`) ?? false) ? t(`modules.names.${key}`) : key));
  return { ...values, modules: names.join(', ') };
}

/**
 * Die Gründe eines Konflikts, je Grund ein Satz aus Grund und Abhilfe (N6: alle, nicht nur der erste). Leer, wenn der
 * Konflikt keinen Schlüssel der Sprachdatei trägt.
 */
export function conflictReasons(error: ConflictError, t: Translate): string[] {
  if (!error.messageKey) return [];
  return [{ messageKey: error.messageKey, params: error.params }, ...(error.also ?? [])].map((r) => {
    const values = withModuleNames(messageValues(r.params), t);
    return `${t(`${r.messageKey}.reason`, values)} ${t(`${r.messageKey}.remedy`, values)}`;
  });
}

/**
 * A6: der Text eines Konflikts — für Oberfläche und MCP derselbe. Trägt der Konflikt einen Schlüssel der
 * Sprachdatei (`messageKey`), sind es Grund und Abhilfe von dort; sonst die Meldung des Dienstes. Ein Grund ist ein
 * Satz, mehrere stehen je in einer Zeile mit „- “ (Prüfer-Fixrunde 28.09.) — die Oberfläche zeigt sie als Liste aus
 * `conflictReasons`, ohne diesen Text wieder zu zerschneiden.
 */
export function conflictText(error: ConflictError, t: Translate): string {
  if (!error.messageKey) return error.message;
  const reasons = conflictReasons(error, t);
  return reasons.length === 1 ? reasons[0]! : reasons.map((r) => `- ${r}`).join('\n');
}

/**
 * Der Text eines Konflikts, wie ihn die Oberfläche zeigt — `null`, wenn die Sprachdatei für diesen Code nichts
 * kennt (die Oberfläche nimmt dann `errors.conflict.default`, MCP die Meldung des Dienstes).
 */
export function conflictMessage(error: ConflictError, t: Translate): string | null {
  if (error.messageKey) return conflictText(error, t);
  if (error.code === 'humanOnly') return t('errors.humanOnly');
  if (error.code === 'settingManaged') return t('errors.settingManaged', { module: error.message });
  if (error.code === 'settingUiOnly') return t('errors.settingUiOnly');
  if (error.code === 'moduleRefusesDisable') {
    const key = `modules.cannotDisable.${error.message}`;
    return (t.has?.(key) ?? false) ? t(key) : t('modules.cannotDisable.generic');
  }
  const detail = error.message.includes(':') ? error.message.slice(error.message.indexOf(':') + 1).trim() : error.message;
  if (CONFLICTS_WITH_DETAIL.has(error.code)) {
    return t(`errors.conflict.${error.code}`, { detail });
  }
  return KNOWN_CONFLICTS.has(error.code) ? t(`errors.conflict.${error.code}`) : null;
}

/**
 * Ein Fehler, wie ihn ein Agent über MCP sieht — derselbe Text wie in der Oberfläche (A6, Nachtrag Rest 0.2.0
 * Task 7g/M): Konflikte mit Übersetzung bekommen ihren Satz, Prüfmeldungen ihren Feldtext; der Code bleibt
 * daneben maschinenlesbar, ebenso die Werte des Konflikts als `params` (Beträge in Cent, Daten als YYYY-MM-DD).
 */
export function localizeError(error: ServiceError, t: Translate): ServiceError {
  if (error.type === 'validation') {
    return { type: 'validation', issues: error.issues.map((issue) => ({ path: issue.path, code: issue.message, message: fieldMessage(issue.message, t, issue.params) })) };
  }
  if (error.type !== 'conflict') return error;
  return { type: 'conflict', code: error.code, message: conflictMessage(error, t) ?? error.message, ...(error.params && Object.keys(error.params).length > 0 ? { params: error.params } : {}), ...(error.also ? { also: error.also } : {}) };
}

const KNOWN_CONFLICTS = new Set([
  'documentIsDraft',
  'notOutgoing',
  'notDispatched',
  'relationSelf',
  'relationExists',
  'snippetExists',
  'documentNotVoided',
  'followUpDone',
  'followUpOpen',
  'linkExists',
  'emailTaken',
  'roleNameTaken',
  'roleProtected',
  'lastAdministrator',
  'insufficientPrivileges',
  'settingSystemOnly',
  'themeKeyTaken',
  'themeReadOnly',
  'themeActive',
  'moduleLocked',
  'setupAlreadyDone',
  'publicUrlMissing',
  'publishTargetMissing',
  'publishNotAllowedHere',
  'blockedTermsPresent',
  'siteBuildFailed',
  'publishFailed',
  'siteJobRunning',
  'duplicateLocale',
  'tooManyLocales',
  'lastLocale',
  'unknownLocale',
  'folderExists',
  'folderParentMissing',
  'folderNotFound',
  'retentionHoldActive',
  'retentionUnknown',
  'belongsToNotAnOrganization',
  'multiplePrimaryChannels',
  'roleAlreadyRunning',
  'userAlreadyLinked',
  'contactAlreadyLinked',
  'userNotLinked',
  'ownLinkNeedsSecondPerson',
  'stillPublished',
  'staleVersion',
  'notIncoming',
  'documentVoided',
  'documentTypeInactive',
  'alreadySeeded',
  'noSeed',
  'noTemplate',
  'siteNotEmpty',
  'templateMissing',
  'templateResolutionMissing',
  'templateInvalid',
  'templateNeedsReview',
  'templateStale',
]);

const CONFLICTS_WITH_DETAIL = new Set([
  'blockedTermsPresent',
  'siteBuildFailed',
  'publishFailed',
  'mediaAssetInUse',
  'folderNotEmpty',
  'recordHeld',
  'stillReferenced',
  'templateUnreadable',
  'localeMissing',
  'seedAssetsMissing',
  'deployCredentialsUnusable',
  'deployCheckFailed',
  'previewFailed',
  'unknownView',
  'unknownViewField',
]);

const MEDIA_FIELD_CODES = ['unsupportedMediaType', 'notAPdf', 'fileTooLarge', 'svgContainsScript'];
const BACKUP_FIELD_CODES = ['confirmationMismatch', 'backupFormatUnsupported', 'backupNewerThanApp', 'backupCorrupt', 'backupWithoutUsers'];

/** Die drei Prüfungen des Versandvermerks — sie melden Codes, keine Zod-Texte. */
const DISPATCH_FIELD_CODES = ['unknownDispatchChannel', 'sentBeforeDocumentDate', 'sentInFuture'];

/** Die Regeltabelle einer Kategorie (Finanz-Spec 5.1, H3): Regelverstöße am Feld, nicht als Liste. */
const FINANCE_CATEGORY_FIELD_CODES = [
  'sphereRequired', 'incomeKindRequired', 'costFunctionRequired', 'costFunctionOnlyForExpense', 'incomeKindOnlyForIncome',
  'certifiableOnlyIdeal', 'allowanceOnlyForExpense', 'inputTaxNotInIdeal', 'transitHasNoSphere',
];

/**
 * Die Feldmeldung zu einem Prüfcode (Nachtrag Rest 0.2.0, Task M): `validate` liefert nur Codes, jeder steht unter
 * `errors.fields` (Wächter `tests/mcp-error-text.test.ts`); `params` füllt die Platzhalter. Die Stichwortsuche
 * darunter fängt nur noch Sätze ab, die an `validate` vorbei entstehen.
 */
export function fieldMessage(issueMessage: string, t: Translate, params?: Record<string, string | number>): string {
  const lower = issueMessage.toLowerCase();
  if (issueMessage === 'confirmationRequired') return t('site.publish.publishCard.confirm');
  if (t.has?.(`errors.fields.${issueMessage}`)) return t(`errors.fields.${issueMessage}`, params);
  if (
    issueMessage === 'passwordTooShort' ||
    issueMessage === 'unknownPermission' ||
    issueMessage === 'unknownSetting' ||
    MEDIA_FIELD_CODES.includes(issueMessage) ||
    BACKUP_FIELD_CODES.includes(issueMessage) ||
    DISPATCH_FIELD_CODES.includes(issueMessage) ||
    FINANCE_CATEGORY_FIELD_CODES.includes(issueMessage)
  ) {
    return t(`errors.fields.${issueMessage}`);
  }
  if (lower.includes('email')) return t('errors.fields.email');
  if (lower.includes('too small') || lower.includes('required') || lower.includes('expected string') || lower.includes('at least 1')) {
    return t('errors.fields.required');
  }
  return t('errors.fields.invalid');
}

