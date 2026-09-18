import { inArray } from 'drizzle-orm';
import { users } from '../db/schema';
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
