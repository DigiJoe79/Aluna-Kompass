import type { Result, ServiceError } from '@kompass/core';
import type { NoticeRemedy } from '@/components/notice';
import { conflictMessage, conflictReasons, conflictText, fieldMessage } from './error-text';

export { fieldMessage } from './error-text';

export type ActionState =
  | { status: 'idle' }
  | { status: 'success'; message?: string; data?: unknown }
  /** `reasons`: nur bei mehreren Gründen eines Konflikts, je Grund ein Satz — die Fehlerbox zeigt sie als Liste. */
  | {
      status: 'error';
      message: string;
      fieldErrors: Record<string, string>;
      code?: string;
      detail?: string;
      reasons?: string[];
      /** Überschrift der Ablehnung; ohne Angabe nimmt `RefusalNotice` „Nicht gespeichert“. */
      title?: string;
      /** Ein bis drei Auswege unter der Ablehnung. */
      remedies?: NoticeRemedy[];
      /** `network`: die Aktion hat den Server nicht erreicht — keine Ablehnung des Dienstes. */
      kind?: 'refused' | 'network';
    };

export const idleState: ActionState = { status: 'idle' };

/** Eine Ablehnung des Dienstes: Fehler ohne Netzproblem und ohne Feldfehler (die stehen am Feld). */
export function isRefusal(s: ActionState): s is Extract<ActionState, { status: 'error' }> {
  return s.status === 'error' && s.kind !== 'network' && Object.keys(s.fieldErrors).length === 0;
}

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
  // Veraltete Version: Der Dienst nennt weder Person noch Uhrzeit — der Satz bleibt allgemein, die Auswege setzt die Leiste (conflict-remedies).
  const stale = result.error.type === 'conflict' && result.error.code === 'staleVersion' ? { title: t('common.refused.title'), detail: t('common.conflict.textPlain') } : {};
  return { status: 'error', message: errorMessage(result.error, t), fieldErrors, ...conflictFields, ...stale, ...(reasons.length > 1 ? { reasons } : {}) };
}
