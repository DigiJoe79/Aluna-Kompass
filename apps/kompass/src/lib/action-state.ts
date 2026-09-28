import 'server-only';
import type { Result } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { toActionState, type ActionState } from './actions';

/** Das Ergebnis einer Server Action als `ActionState`, mit den Übersetzungen der Anfrage — ein Helfer für alle Finanz-Actions (A6). */
export async function actionState<T>(result: Result<T>, successMessage?: string): Promise<ActionState> {
  return toActionState(result, await getTranslations(), successMessage);
}
