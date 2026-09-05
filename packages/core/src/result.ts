export type ValidationIssue = { path: string; message: string };

export type UnauthorizedReason = 'invalidCredentials' | 'locked' | 'inactive' | 'passwordChangeRequired';

export type ServiceError =
  | { type: 'forbidden'; permission: string }
  | { type: 'validation'; issues: ValidationIssue[] }
  | { type: 'notFound'; entity: string; id: string }
  | { type: 'conflict'; code: string; message: string }
  | { type: 'unauthorized'; reason: UnauthorizedReason; attemptsLeft?: number; lockedUntil?: string };

export type Success<T> = { ok: true; value: T };
export type Failure = { ok: false; error: ServiceError };
export type Result<T> = Success<T> | Failure;

export const ok = <T>(value: T): Success<T> => ({ ok: true, value });
export const fail = (error: ServiceError): Failure => ({ ok: false, error });
export const forbidden = (permission: string): Failure => fail({ type: 'forbidden', permission });
export const notFound = (entity: string, id: string): Failure => fail({ type: 'notFound', entity, id });
export const conflict = (code: string, message: string): Failure => fail({ type: 'conflict', code, message });
export const invalid = (issues: ValidationIssue[]): Failure => fail({ type: 'validation', issues });
export const unauthorized = (
  reason: UnauthorizedReason,
  extra: { attemptsLeft?: number; lockedUntil?: string } = {},
): Failure => fail({ type: 'unauthorized', reason, ...extra });

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`unexpected failure: ${JSON.stringify(result.error)}`);
  return result.value;
}
