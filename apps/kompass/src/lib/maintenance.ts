import { isMaintenanceActive } from '@kompass/core/maintenance';
import { runtimeEnv } from '@/lib/deps';

/**
 * Läuft gerade ein Einspielen? Dann ist die Datenbank geschlossen oder halb ersetzt, und was jede Seite liest (Theme
 * im Layout, Zeitzone der Übersetzungen) muss ohne sie auskommen — sonst bräche die Wartungsseite selbst.
 */
export function maintenanceActive(): boolean {
  return isMaintenanceActive(runtimeEnv().backupPath);
}
