import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { clearMaintenance, writeMaintenance } from '@kompass/core/maintenance';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDeps } from '@/lib/deps';

/**
 * Während des Einspielens kommen Anfragen mit Körper (Server Actions, Uploads, Agenten) nicht durch den Proxy — dort
 * puffert Next sonst jeden Körper (`proxy.ts`). `getDeps` verweigert deshalb selbst, solange der Merker liegt: Keine
 * Anfrage schreibt mitten in den Austausch.
 */
let bp: string;
const saved = process.env.BACKUP_PATH;
beforeEach(() => {
  bp = mkdtempSync(path.join(tmpdir(), 'kompass-deps-maint-'));
  process.env.BACKUP_PATH = bp;
});
afterEach(() => {
  clearMaintenance(bp);
  rmSync(bp, { recursive: true, force: true });
  if (saved === undefined) delete process.env.BACKUP_PATH;
  else process.env.BACKUP_PATH = saved;
});

describe('getDeps während des Einspielens', () => {
  it('wirft MaintenanceError, solange der Merker liegt', () => {
    writeMaintenance(bp, { runId: 'R', since: 't', phase: 'replace', aside: null, backupName: 'b', backupCreatedAt: 't', contact: null });
    expect(() => getDeps()).toThrow(/maintenance/);
  });
});
