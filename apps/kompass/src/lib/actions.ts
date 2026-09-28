import type { Result, ServiceError } from '@kompass/core';
import { conflictMessage, conflictReasons, conflictText, fieldMessage } from './error-text';

export { fieldMessage } from './error-text';

export type ActionState =
  | { status: 'idle' }
  | { status: 'success'; message?: string; data?: unknown }
  /** `reasons`: nur bei mehreren Gründen eines Konflikts, je Grund ein Satz — die Fehlerbox zeigt sie als Liste. */
  | { status: 'error'; message: string; fieldErrors: Record<string, string>; code?: string; detail?: string; reasons?: string[] };

export const idleState: ActionState = { status: 'idle' };

type Translate = ((key: string, values?: any) => string) & {
  has?: (key: string) => boolean;
};

/** Der Teil einer Konfliktmeldung nach dem ersten Doppelpunkt — sonst die ganze Meldung (z. B. Finanzfehler, die keinen Doppelpunkt kennen). */
function rawDetail(message: string): string {
  return message.includes(':') ? message.slice(message.indexOf(':') + 1).trim() : message;
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
    case 'conflict':
      return conflictMessage(error, t) ?? t('errors.conflict.default', { detail: error.message });
  }
}

export function toActionState<T>(result: Result<T>, t: Translate, successMessage?: string): ActionState {
  if (result.ok) return { status: 'success', ...(successMessage ? { message: successMessage } : {}), data: result.value };
  const fieldErrors: Record<string, string> = {};
  if (result.error.type === 'validation') {
    for (const issue of result.error.issues) {
      fieldErrors[issue.path] ??= fieldMessage(issue.message, t, issue.params);
    }
  }
  const conflictFields = result.error.type === 'conflict' ? { code: result.error.code, detail: result.error.messageKey ? conflictText(result.error, t) : rawDetail(result.error.message) } : {};
  const reasons = result.error.type === 'conflict' ? conflictReasons(result.error, t) : [];
  return { status: 'error', message: errorMessage(result.error, t), fieldErrors, ...conflictFields, ...(reasons.length > 1 ? { reasons } : {}) };
}
