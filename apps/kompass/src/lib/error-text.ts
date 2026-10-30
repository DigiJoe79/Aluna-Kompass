import { vatPeriodLabel, type VatPeriodTranslator } from './finance/vat-period';
import type { ServiceError } from '@kompass/core';
import { formatEuro, formatIban } from '@kompass/module-finance/format';
import { formatDate } from './dates';

type Translate = ((key: string, values?: Record<string, string | number | Date>) => string) & { has?: (key: string) => boolean };
type ConflictError = Extract<ServiceError, { type: 'conflict' }>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Die Parameter eines Konflikts oder einer Beschriftung für die Sprachdatei, fertig geschrieben (Stufe 1, Aufträge 1
 * und 2): Ein Tag (`YYYY-MM-DD`) wird fest zu TT.MM.JJJJ (`formatDate` im Modus `locale`, wie vorher ICU `::ddMMyyyy`)
 * — ein Kalendertag, ohne Zeitzone, also in jeder Zone derselbe; Beträge (`amounts`, in Cent) schreibt `formatEuro`
 * (MUSTER § Beträge). Die Sprachdatei hat dafür schlichte Platzhalter, kein ICU-Skelett. Alles andere bleibt, wie es
 * kommt.
 */
export function messageValues(params: Record<string, string | number> = {}, amounts: readonly string[] = []): Record<string, string | number | Date> {
  // Ein Wert auf `…Text` hat der Dienst schon für den Bildschirm geschrieben (`messageDate`) — er bleibt Text, auch wenn
  // er bei Datumsformat „ISO“ wie ein ISO-Datum aussieht (Backlog 55).
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => {
      if (amounts.includes(key) && typeof value === 'number') return [key, formatEuro(value)];
      return [key, typeof value === 'string' && !key.endsWith('Text') && ISO_DATE.test(value) ? formatDate(value, 'locale', 'UTC') : value];
    }),
  );
}

const listOf = (items: string[]): string => new Intl.ListFormat('de', { type: 'conjunction' }).format(items);

/**
 * Backlog 55: `permissionKeys` („users.manage,finance.read“) wird zu `permissions` („Nutzer verwalten und Finanzen
 * lesen“), `matches` und `holders` (getrennt durch U+001F, damit ein Komma nichts zerschneidet) zu `matchList` und
 * `holderList`, jeder Eintrag in „…“, `references` zu `referenceList` (ohne Anführungszeichen); `ibans` wird gruppiert.
 */
function withListValues(values: Record<string, string | number | Date>, t: Translate): Record<string, string | number | Date> {
  const next = { ...values };
  if (typeof values.permissionKeys === 'string') {
    next.permissions = listOf(values.permissionKeys.split(',').map((key) => ((t.has?.(`permissions.keys.${key}.label`) ?? false) ? t(`permissions.keys.${key}.label`) : key)));
  }
  // E6b: ein Umsatzsteuer-Zeitraum (`'2026-Q2'`) lesbar wie in Fristen und Kachel.
  if (typeof values.vatPeriod === 'string') next.vatPeriod = vatPeriodLabel(values.vatPeriod, t as unknown as VatPeriodTranslator);
  if (typeof values.matches === 'string') next.matchList = listOf(values.matches.split('\u001f').map((m) => `„${m}“`));
  if (typeof values.holders === 'string') next.holderList = listOf(values.holders.split('\u001f').map((h) => `„${h}“`));
  // K2: Verweise tragen ihre Anführungszeichen schon in der Bezeichnung („Dokument „…“ (Entwurf)“) — ohne zweite.
  if (typeof values.references === 'string') next.referenceList = listOf(values.references.split('\u001f'));
  // `ibans` („DE60…, DE12…“) kommt kompakt (Daten, MCP); im Text in Vierergruppen (MUSTER § IBAN).
  if (typeof values.ibans === 'string') next.ibans = values.ibans.split(', ').map(formatIban).join(', ');
  return next;
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
  return [{ messageKey: error.messageKey, params: error.params, amounts: error.amounts }, ...(error.also ?? [])].map((r) => {
    const values = withListValues(withModuleNames(messageValues(r.params, r.amounts), t), t);
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
  if (error.code === 'humanOnly') {
    // M31: Der Satz nennt den Weg zum Schalter des Moduls (die Meldung trägt den Schlüssel der Einstellung), nicht „hier“.
    const key = `errors.humanOnlyFor.${error.message.split('.')[0]}`;
    return (t.has?.(key) ?? false) ? t(key) : t('errors.humanOnly');
  }
  // V-10: der Name des Moduls, nicht sein Schlüssel.
  if (error.code === 'settingManaged') return t('errors.settingManaged', { module: (t.has?.(`modules.names.${error.message}`) ?? false) ? t(`modules.names.${error.message}`) : error.message });
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
  // N21: auch `forbidden` und `notFound` mit Satz wie die Konflikte — für alle Module an dieser Stelle.
  if (error.type === 'forbidden') {
    const labelKey = `permissions.keys.${error.permission}.label`;
    return { ...error, message: (t.has?.(labelKey) ?? false) ? t('errors.forbiddenNamed', { label: t(labelKey), permission: error.permission }) : t('errors.forbidden', { permission: error.permission }) };
  }
  if (error.type === 'notFound') {
    const entityKey = `audit.entities.${error.entity}`;
    return { ...error, message: t('errors.notFoundNamed', { entity: (t.has?.(entityKey) ?? false) ? t(entityKey) : error.entity, id: error.id }) };
  }
  if (error.type === 'validation') {
    return { type: 'validation', issues: error.issues.map((issue) => ({ path: issue.path, code: issue.message, message: fieldMessage(issue.message, t, issue.params) })) };
  }
  if (error.type !== 'conflict') return error;
  return { type: 'conflict', code: error.code, message: conflictMessage(error, t) ?? error.message, ...(error.params && Object.keys(error.params).length > 0 ? { params: error.params } : {}), ...(error.also ? { also: error.also.map(({ amounts: _amounts, ...reason }) => reason) } : {}) };
}

const KNOWN_CONFLICTS = new Set([
  'pendingUnavailable',
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
  'roleProtected',
  'lastAdministrator',
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
  'duplicateLocale',
  'tooManyLocales',
  'lastLocale',
  'unknownLocale',
  'folderExists',
  'folderParentMissing',
  'folderNotFound',
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
  'viewNotInTemplate',
  'siteNotEmpty',
  'templateMissing',
  'templateResolutionMissing',
  'templateInvalid',
  'templateNeedsReview',
  'templateStale',
  'animalNotAdopted',
  'bundleEmpty',
  'documentAlreadyVoided',
  'documentAltered',
  'documentHasNoFile',
  'documentIsFiled',
  'documentNumberContention',
  'documentTypeExists',
  'documentTypeHasDocuments',
  'documentTypeInUse',
  'documentTypeIsDefault',
  'documentTypeOwnedByModule',
  'documentTypePrefixTaken',
  'documentTypeProvisioned',
  'folderHasProtectedDocuments',
  'linkTypeReserved',
  'slugTaken',
  'textExtractionGaveUp',
  'textExtractionSuperseded',
  'noReviewPending',
]);

const CONFLICTS_WITH_DETAIL = new Set([
  'blockedTermsPresent',
  'siteBuildFailed',
  'publishFailed',
  'mediaAssetInUse',
  'folderNotEmpty',
  'templateUnreadable',
  'localeMissing',
  'seedAssetsMissing',
  'deployCredentialsUnusable',
  'deployCheckFailed',
  'previewFailed',
  'unknownView',
  'unknownViewField',
  'bundleTooLarge',
  'documentTooManyPages',
  'retentionRunning',
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
  // Daten in `params` wie bei Konflikten lesbar (N7: „ab dem …“), MCP behält sie als YYYY-MM-DD in `params`.
  if (t.has?.(`errors.fields.${issueMessage}`)) return t(`errors.fields.${issueMessage}`, params ? messageValues(params) : params);
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

