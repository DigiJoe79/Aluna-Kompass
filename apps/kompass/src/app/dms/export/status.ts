import type { Failure, ServiceError } from '@kompass/core';
import { conflictMessage } from '@/lib/error-text';

export function statusFor(error: Failure['error']): number {
  return error.type === 'forbidden' ? 403 : error.type === 'validation' ? 400 : error.type === 'conflict' ? 409 : 404;
}

type Translate = ((key: string, values?: Record<string, string | number | Date>) => string) & { has?: (key: string) => boolean };

/**
 * Die Ablehnung, wie der Exportdialog sie zeigt: `message` ist der Satz der Sprachdatei (`conflictMessage`, wie die
 * Server Actions über `toActionState`), nie der Diensttext — der ist für Protokoll und Entwickler geschrieben.
 */
export function conflictBody(error: Extract<ServiceError, { type: 'conflict' }>, t: Translate): { code: string; message: string } {
  return { code: error.code, message: conflictMessage(error, t) ?? t('errors.conflict.default', { detail: error.message }) };
}
