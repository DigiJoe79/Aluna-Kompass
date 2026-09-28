import 'server-only';
import { constraintFailure, isConstraintError } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { toActionState, type ActionState } from './actions';

/**
 * Der Wächter jeder Server Action mit `ActionState` (Nachrunde 28.09., Task 6b
 * Design-Nachtrag Phase 4) — das Gegenstück zu `guardConstraint` im
 * MCP-Handler: Scheitert ein Dienst an einer Regel der Datenbank
 * (`SQLITE_CONSTRAINT*`), geht die Ursache ins Server-Log und zurück kommt
 * „databaseConstraint“ als Meldung, statt dass die Action wirft. Alles andere
 * — auch `redirect()` — wird weitergeworfen. `tests/action-guard.test.ts`
 * verlangt ihn in jeder Datei `actions.ts`.
 */
export async function guardAction<T>(where: string, run: () => Promise<T>): Promise<T | ActionState> {
  try {
    return await run();
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    console.error(`[db] action ${where}`, error);
    return toActionState(constraintFailure(), await getTranslations());
  }
}
