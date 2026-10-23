import type { Deps } from './deps';
import { enabledManifests } from './modules/service';

/**
 * Eine Mail des Systems an einen Menschen (Spec Backup § Meldungen) — reiner Text, ohne Anhang. Der Kern baut sie,
 * ein Modul mit Mailversand schickt sie über den Haken `systemMail` mit seinen Absender-Einstellungen.
 */
export interface SystemMailMessage {
  to: string;
  subject: string;
  text: string;
}

export type SystemMailResult = { sent: true } | { sent: false; reason: 'unavailable' | 'sendFailed' };

export interface SystemMailHook {
  available(deps: Deps): boolean;
  send(deps: Deps, message: SystemMailMessage): Promise<SystemMailResult>;
}

function systemMailHook(deps: Deps): SystemMailHook | null {
  for (const manifest of enabledManifests(deps)) {
    if (manifest.systemMail?.available(deps)) return manifest.systemMail;
  }
  return null;
}

/** Ob ein eingeschaltetes Modul gerade Systemmails senden kann. */
export function systemMailAvailable(deps: Deps): boolean {
  return systemMailHook(deps) !== null;
}

/** Über das erste eingeschaltete Modul in Registry-Reihenfolge, das verfügbar ist; keins → `unavailable`. */
export async function sendSystemMail(deps: Deps, message: SystemMailMessage): Promise<SystemMailResult> {
  const hook = systemMailHook(deps);
  if (!hook) return { sent: false, reason: 'unavailable' };
  return hook.send(deps, message);
}
