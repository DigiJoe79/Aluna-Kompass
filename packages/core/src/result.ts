/**
 * `message` ist ein Code der Sprachdatei (`errors.fields.<code>`), nie ein Satz; `params` füllt dessen
 * Platzhalter. Oberfläche und MCP übersetzen denselben Code (Nachtrag Rest 0.2.0, Task M).
 */
export type ValidationIssue = { path: string; message: string; params?: Record<string, string | number>; /** Nur übersetzt (MCP): der Code, `message` ist dann der Satz. */ code?: string };

export type UnauthorizedReason = 'invalidCredentials' | 'locked' | 'inactive' | 'passwordChangeRequired' | 'throttled';

/** Ein weiterer Grund eines Konflikts: Code und Schlüssel der Sprachdatei wie beim ersten. */
export type ConflictReason = { code: string; messageKey: string; params?: Record<string, string | number> };

export type ServiceError =
  | { type: 'forbidden'; permission: string }
  | { type: 'validation'; issues: ValidationIssue[] }
  | { type: 'notFound'; entity: string; id: string }
  | {
      type: 'conflict';
      code: string;
      /** Für Menschen ohne Sprachdatei (Protokolle, `unwrap`). Trägt der Fehler `messageKey`, ist das nur der Code. */
      message: string;
      /**
       * Schlüssel in der Sprachdatei mit `reason` (Grund) und `remedy` (Abhilfe). Oberfläche und MCP setzen daraus
       * denselben Text zusammen; `params` füllt die ICU-Platzhalter (Daten als `YYYY-MM-DD`, Beträge in Cent).
       */
      messageKey?: string;
      params?: Record<string, string | number>;
      /** N6: weitere Gründe desselben Vorgangs (etwa alle fehlenden Voraussetzungen einer Freigabe) — Oberfläche und MCP nennen sie alle. */
      also?: ConflictReason[];
    }
  | { type: 'unauthorized'; reason: UnauthorizedReason; lockedUntil?: string };

export type Success<T> = { ok: true; value: T };
export type Failure = { ok: false; error: ServiceError };
export type Result<T> = Success<T> | Failure;

export const ok = <T>(value: T): Success<T> => ({ ok: true, value });
export const fail = (error: ServiceError): Failure => ({ ok: false, error });
export const forbidden = (permission: string): Failure => fail({ type: 'forbidden', permission });
export const notFound = (entity: string, id: string): Failure => fail({ type: 'notFound', entity, id });
export const conflict = (code: string, message: string): Failure => fail({ type: 'conflict', code, message });
/** Ein Konflikt, dessen Text aus der Sprachdatei kommt (`<messageKey>.reason` und `.remedy`). */
export const localizedConflict = (code: string, messageKey: string, params: Record<string, string | number> = {}): Failure =>
  fail({ type: 'conflict', code, message: code, messageKey, params });
export const invalid = (issues: ValidationIssue[]): Failure => fail({ type: 'validation', issues });
export const unauthorized = (
  reason: UnauthorizedReason,
  extra: { lockedUntil?: string } = {},
): Failure => fail({ type: 'unauthorized', reason, ...extra });

/**
 * N6: mehrere Ablehnungen eines Vorgangs als **eine** — der erste Grund bleibt Code und Text, die weiteren
 * Konflikte mit Sprachschlüssel hängen als `also` daran. `null`, wenn nichts abgelehnt ist.
 */
export function combineConflicts(failures: readonly Failure[]): Failure | null {
  const [first, ...rest] = failures;
  if (!first) return null;
  if (first.error.type !== 'conflict') return first;
  const also: ConflictReason[] = rest.flatMap((f) => (f.error.type === 'conflict' && f.error.messageKey ? [{ code: f.error.code, messageKey: f.error.messageKey, params: f.error.params ?? {} }] : []));
  return also.length > 0 ? fail({ ...first.error, also }) : first;
}

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`unexpected failure: ${JSON.stringify(result.error)}`);
  return result.value;
}
