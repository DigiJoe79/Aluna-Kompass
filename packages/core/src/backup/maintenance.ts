import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/*
 * Der Wartungsmerker während eines Einspielens. Eine Datei unter `BACKUP_PATH/.jobs`, weil der Proxy (`src/proxy.ts`)
 * ihn liest und Next den Proxy getrennt vom Render-Code ausführen darf — geteilte Module und `globalThis` taugen dort
 * nicht. Deshalb importiert diese Datei nur `node:fs` und `node:path` und hat einen eigenen Subpfad
 * (`@kompass/core/maintenance`): Der Hauptexport zöge `better-sqlite3` in den Proxy.
 */

export interface MaintenanceMarker {
  /** Lesbare Kennung des Laufs (`restore-<JJJJMMTT-HHmm>`), die Wartungsseite zeigt sie bei `rollbackFailed`. */
  runId: string;
  since: string;
  /** `safeguard`: Sichern und Prüfen, noch nichts ersetzt · `prepare`: noch nichts ersetzt · `replace`: Bestand liegt in `aside` · `migrate`: neuer Bestand steht · `done`: eingespielt, nur noch Aufräumen · `rollbackFailed`: Zurücklegen gescheitert. */
  phase: 'safeguard' | 'prepare' | 'replace' | 'migrate' | 'done' | 'rollbackFailed';
  /** Die Rücklage `.before-import-*` unter `DATA_PATH`, sobald es eine gibt. */
  aside: string | null;
  backupName: string;
  backupCreatedAt: string;
  /** Vereinsadresse (`organization.email`), vor dem Austausch gelesen. */
  contact: string | null;
}

export function maintenanceFile(backupPath: string): string {
  return path.join(backupPath, '.jobs', 'maintenance.json');
}

export function readMaintenance(backupPath: string): MaintenanceMarker | null {
  try {
    return JSON.parse(readFileSync(maintenanceFile(backupPath), 'utf8')) as MaintenanceMarker;
  } catch {
    return null;
  }
}

/** Über eine Zwischendatei und `rename`: Ein Abbruch hinterlässt den alten oder den neuen Merker, nie einen halben. */
export function writeMaintenance(backupPath: string, marker: MaintenanceMarker): void {
  const file = maintenanceFile(backupPath);
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(marker));
  renameSync(temp, file);
}

export function clearMaintenance(backupPath: string): void {
  rmSync(maintenanceFile(backupPath), { force: true });
}

export function isMaintenanceActive(backupPath: string): boolean {
  return existsSync(maintenanceFile(backupPath));
}
