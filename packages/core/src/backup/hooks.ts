/*
 * Was ein Einspielen von der App braucht, ohne dass der Kern die App kennt: ob gerade etwas das Einspielen verbietet
 * (ein Webseiten-Lauf), wie die Hintergrundarbeit (Texterkennung, Mailversand, Hauswirtschaft) angehalten und wieder
 * angelassen wird, und was danach neu aufzusetzen ist (MCP-Handler). Die App meldet sie in `instrumentation.ts` an;
 * sie liegen auf `globalThis`, das sich alle Route-Bündel eines Prozesses teilen.
 */

export interface RestoreHooks {
  /** Ein Grund, nicht einzuspielen (Schlüssel unter `backup.blockReasons`), sonst `null`. */
  busyReason(): string | null;
  /** Hält die Hintergrundarbeit an und wartet, bis laufende Durchläufe fertig sind. */
  pauseBackground(): Promise<void>;
  resumeBackground(): void;
  afterRestore(): Promise<void>;
}

const NONE: RestoreHooks = {
  busyReason: () => null,
  pauseBackground: async () => undefined,
  resumeBackground: () => undefined,
  afterRestore: async () => undefined,
};

const holder = () => globalThis as { __kompassRestoreHooks?: RestoreHooks };

export function registerRestoreHooks(hooks: RestoreHooks): void {
  holder().__kompassRestoreHooks = hooks;
}

/** Die angemeldeten Haken; ohne Anmeldung (Tests, Skripte) ist nichts belegt und nichts anzuhalten. */
export function restoreHooks(): RestoreHooks {
  return holder().__kompassRestoreHooks ?? NONE;
}
