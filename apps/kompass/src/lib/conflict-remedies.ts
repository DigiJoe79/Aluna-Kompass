import type { NoticeRemedy } from '@/components/notice';

/**
 * Hat jemand einen Eintrag inzwischen geändert (`staleVersion`), bietet die
 * Leiste an, die eigenen Eingaben neben den neuen Stand zu legen: Sie werden
 * je Seitenadresse in der Sitzung abgelegt, die Seite lädt neu, und danach
 * stehen sie als Vergleich über der Leiste. Nichts wird automatisch übernommen.
 */
export interface StashedInput {
  name: string;
  label: string;
  value: string;
}

export const STASH_KEY = (path: string) => `kompass:conflict:${path}`;

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

/** Legt die Eingaben ab. Ein fehlender oder gesperrter Speicher (privates Fenster) ist kein Fehler: dann bleibt es beim Neuladen. */
export function stashInputs(path: string, entries: StashedInput[], storage: Storage | undefined = defaultStorage()): void {
  try {
    storage?.setItem(STASH_KEY(path), JSON.stringify(entries));
  } catch {
    // nichts abzulegen
  }
}

/** Liest und löscht die abgelegten Eingaben — sie gelten genau für das eine Neuladen. */
export function takeStash(path: string, storage: Storage | undefined = defaultStorage()): StashedInput[] | null {
  try {
    const raw = storage?.getItem(STASH_KEY(path));
    if (!raw) return null;
    storage!.removeItem(STASH_KEY(path));
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as StashedInput[]) : null;
  } catch {
    return null;
  }
}

/** Zwei Auswege, der Vergleich zuerst. `t` löst `conflict.compare` und `conflict.reload` auf. */
export function conflictRemedies(opts: { compare: () => void; reload: () => void }, t: (key: string) => string): NoticeRemedy[] {
  return [
    { label: t('conflict.compare'), onSelect: opts.compare },
    { label: t('conflict.reload'), onSelect: opts.reload },
  ];
}
