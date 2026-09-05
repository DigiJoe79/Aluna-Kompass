import type { Result, ServiceError } from '@kompass/core';

export type ActionState =
  | { status: 'idle' }
  | { status: 'success'; message?: string; data?: unknown }
  | { status: 'error'; message: string; fieldErrors: Record<string, string> };

export const idleState: ActionState = { status: 'idle' };

type Translate = (key: string, values?: any) => string;

const KNOWN_CONFLICTS = new Set([
  'emailTaken',
  'roleNameTaken',
  'roleProtected',
  'lastAdministrator',
  'settingSystemOnly',
  'themeKeyTaken',
  'themeReadOnly',
  'themeActive',
  'moduleLocked',
  'moduleDependencyInactive',
  'moduleRequiredByOthers',
  'setupAlreadyDone',
  'publicUrlMissing',
  'publishTargetMissing',
  'publishNotAllowedHere',
  'blockedTermsPresent',
  'siteBuildFailed',
  'publishFailed',
]);

const MEDIA_FIELD_CODES = ['unsupportedMediaType', 'fileTooLarge', 'svgContainsScript'];
const BACKUP_FIELD_CODES = ['confirmationMismatch', 'backupFormatUnsupported', 'backupNewerThanApp', 'backupCorrupt'];

export function fieldMessage(issueMessage: string, t: Translate): string {
  const lower = issueMessage.toLowerCase();
  if (issueMessage === 'confirmationRequired') return t('website.publish.publishCard.confirm');
  if (issueMessage === 'passwordTooShort' || issueMessage === 'unknownPermission' || issueMessage === 'unknownSetting' || MEDIA_FIELD_CODES.includes(issueMessage) || BACKUP_FIELD_CODES.includes(issueMessage)) {
    return t(`errors.fields.${issueMessage}`);
  }
  if (lower.includes('email')) return t('errors.fields.email');
  if (lower.includes('too small') || lower.includes('required') || lower.includes('expected string') || lower.includes('at least 1')) {
    return t('errors.fields.required');
  }
  return t('errors.fields.invalid');
}

function errorMessage(error: ServiceError, t: Translate): string {
  switch (error.type) {
    case 'forbidden':
      return t('errors.forbidden', { permission: error.permission });
    case 'validation':
      return t('errors.validation');
    case 'notFound':
      return t('errors.notFound');
    case 'unauthorized':
      return t('errors.unauthorized');
    case 'conflict': {
      const detail = error.message.includes(':') ? error.message.slice(error.message.indexOf(':') + 1).trim() : error.message;
      if (error.code === 'moduleDependencyInactive' || error.code === 'moduleRequiredByOthers' || error.code === 'blockedTermsPresent' || error.code === 'siteBuildFailed' || error.code === 'publishFailed') {
        return t(`errors.conflict.${error.code}`, { detail });
      }
      return KNOWN_CONFLICTS.has(error.code) ? t(`errors.conflict.${error.code}`) : t('errors.conflict.default', { detail: error.message });
    }
  }
}

export function toActionState<T>(result: Result<T>, t: Translate, successMessage?: string): ActionState {
  if (result.ok) return { status: 'success', ...(successMessage ? { message: successMessage } : {}), data: result.value };
  const fieldErrors: Record<string, string> = {};
  if (result.error.type === 'validation') {
    for (const issue of result.error.issues) {
      fieldErrors[issue.path] ??= fieldMessage(issue.message, t);
    }
  }
  return { status: 'error', message: errorMessage(result.error, t), fieldErrors };
}
