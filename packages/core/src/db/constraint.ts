import { localizedConflict, type Failure, type Result } from '../result';

/** Ein Fehler von better-sqlite3 mit einem der Codes `SQLITE_CONSTRAINT*` (Fremdschlüssel, Eindeutigkeit, NOT NULL …). */
export function isConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code: unknown = (error as Error & { code?: unknown }).code;
  return typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT');
}

/** Der Konflikt, den Oberfläche und MCP statt des rohen SQLite-Textes sehen; Grund und Abhilfe in `errors.databaseConstraint`. */
export const constraintFailure = (): Failure => localizedConflict('databaseConstraint', 'errors.databaseConstraint');

/**
 * N1 (Nachrunde 28.09.): Ein Dienst, der an einer Regel der Datenbank scheitert, hat einen Fehler — aber die Person
 * davor soll nicht „FOREIGN KEY constraint failed“ lesen. Die Ursache geht ins Server-Log (mit `where`: Werkzeug oder
 * Action), zurück kommt ein `conflict` mit Text aus der Sprachdatei. Jeder andere Fehler wird weitergeworfen.
 */
export async function guardConstraint<T>(where: string, run: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await run();
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    console.error(`[db] ${where}`, error);
    return constraintFailure();
  }
}
