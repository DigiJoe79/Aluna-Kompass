import { asc, eq, inArray } from 'drizzle-orm';
import { apiTokens, users } from '../db/schema';
import type { Deps } from '../deps';

/**
 * Namen zu Nutzer-IDs, ohne Rechteprüfung, wie `resolveFollowUpTarget`: Wer
 * eine Wiedervorlage sehen darf, darf lesen, wer dafür zuständig ist. Ein
 * Name ist kein Geheimnis, das `users.manage` braucht.
 */
export function userNamesFor(deps: Deps, ids: readonly (string | null | undefined)[]): Map<string, string> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (unique.length === 0) return new Map();
  return new Map(deps.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, unique)).all().map((u) => [u.id, u.name]));
}

/**
 * Wen man zuständig machen kann: die aktiven Nutzer, nach Namen. Ohne
 * Rechteprüfung aus demselben Grund wie oben — ohne die Namen der Kolleginnen
 * ließe sich keine Zuständigkeit setzen.
 */
export function activeUserChoices(deps: Deps): { id: string; name: string }[] {
  return deps.db.select({ id: users.id, name: users.name }).from(users).where(eq(users.isActive, true)).orderBy(asc(users.name)).all();
}

/** Namen zu API-Token-IDs (Kennung im Änderungsprotokoll und im Laufzustand), ohne Rechteprüfung wie `userNamesFor`; auch widerrufene Tokens behalten ihren Namen. */
export function apiTokenNamesFor(deps: Deps, ids: readonly (string | null | undefined)[]): Map<string, string> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (unique.length === 0) return new Map();
  return new Map(deps.db.select({ id: apiTokens.id, name: apiTokens.name }).from(apiTokens).where(inArray(apiTokens.id, unique)).all().map((t) => [t.id, t.name]));
}
