/** Laufende Sicherung nach 800 ms Ruhe (Verhalten D1, HANDOFF § 13.4). */
export const AUTOSAVE_MS = 800;

export type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: string } | { kind: 'offline' } | { kind: 'failed'; detail: string };

/** Was eine Sicherung zurückmeldet. Wirft sie, gilt das als „keine Verbindung“. */
export type SaveOutcome<T> = { kind: 'saved'; at: string; apply: (current: T) => T } | { kind: 'failed'; detail: string };

export interface AutosaveOptions<T> {
  initial: T;
  /** Der Stand am Server beim Öffnen — etwa „gespeichert um …“ eines vorhandenen Entwurfs. */
  initialState?: SaveState;
  /**
   * Sichert den übergebenen Stand. `apply` führt die Antwort (neue Version,
   * vergebene IDs) in den Stand zum Zeitpunkt der Antwort ein — was während
   * der Sicherung getippt wurde, bleibt so erhalten.
   */
  save: (current: T) => Promise<SaveOutcome<T>>;
  delayMs?: number;
  onValue?: (value: T) => void;
  /** `pending`: Es liegt Getipptes vor, das noch nicht am Server ist. */
  onState?: (state: SaveState, pending: boolean) => void;
}

export interface Autosave<T> {
  get(): T;
  /** Ersetzt den Stand, ohne eine Sicherung einzuplanen (etwa nach einem Upload, der die Version nicht ändert). */
  set(next: T): void;
  /** Ändert den Stand und plant die Sicherung nach `delayMs` Ruhe. */
  update(fn: (current: T) => T): void;
  /** Erzwingt die nächste Sicherung, auch ohne Änderung (etwa bevor es eine ID gibt). */
  markDirty(): void;
  isDirty(): boolean;
  /** Sichert sofort, falls etwas ungesichert ist — hinter der vorigen Sicherung eingereiht. Liefert den gesicherten Stand oder `null`. */
  flush(): Promise<T | null>;
  /** Bricht eine geplante Sicherung ab (beim Aushängen). Die nächste Eingabe plant wieder. */
  dispose(): void;
}

/**
 * Der Kern des Autosave aus D1, ohne React: Die Sicherungen laufen
 * nacheinander, jede mit dem Stand (und damit der Version) nach der vorigen;
 * nur der jüngste Stand geht hinaus. Wird während einer Sicherung
 * weitergetippt, folgt gleich die nächste.
 */
export function createAutosave<T>(options: AutosaveOptions<T>): Autosave<T> {
  const delay = options.delayMs ?? AUTOSAVE_MS;
  let value = options.initial;
  let dirty = false;
  let chain: Promise<unknown> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last: SaveState = options.initialState ?? { kind: 'idle' };

  const setValue = (next: T) => {
    value = next;
    options.onValue?.(next);
  };
  const report = (state: SaveState) => {
    last = state;
    options.onState?.(state, dirty);
  };

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const flush = (): Promise<T | null> => {
    clearTimer();
    const run = async (): Promise<T | null> => {
      if (!dirty) return value;
      dirty = false;
      report({ kind: 'saving' });
      let outcome: SaveOutcome<T>;
      try {
        outcome = await options.save(value);
      } catch {
        dirty = true;
        report({ kind: 'offline' });
        return null;
      }
      if (outcome.kind === 'failed') {
        dirty = true;
        report({ kind: 'failed', detail: outcome.detail });
        return null;
      }
      const next = outcome.apply(value);
      setValue(next);
      report({ kind: 'saved', at: outcome.at });
      return next;
    };
    const result = chain.then(run, run);
    chain = result.catch(() => null);
    return result;
  };

  const schedule = () => {
    clearTimer();
    timer = setTimeout(() => {
      void flush().then((saved) => {
        if (saved && dirty) schedule();
      });
    }, delay);
  };

  return {
    get: () => value,
    set: setValue,
    update(fn) {
      setValue(fn(value));
      dirty = true;
      options.onState?.(last, true);
      schedule();
    },
    markDirty() {
      dirty = true;
    },
    isDirty: () => dirty,
    flush,
    /** Bricht nur die geplante Sicherung ab — kein Endzustand: React ruft Aufräumen im Strict Mode auch zwischendurch auf. */
    dispose() {
      clearTimer();
    },
  };
}

