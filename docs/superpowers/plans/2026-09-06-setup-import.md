# Import auf der Einrichtungsseite — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine uneingerichtete Installation kann ein Backup einspielen, ohne vorher ein Wegwerf-Konto anzulegen.

**Architecture:** Der Kern bekommt `importBackupForSetup`, das statt einer Rechteprüfung `isSetupRequired` unmittelbar vor dem Dateiaustausch prüft; der destruktive Rumpf wird aus `importBackup` in ein gemeinsames `applyBackup` gezogen, das beide Wege nutzen. Das Entpacken wandert in ein eigenes Modul mit Eintragsfilter und Größengrenze und gilt damit für beide Importwege. In der App nimmt ein Route Handler die Datei im Strom entgegen, legt sie unter einer ULID ab und gibt das Manifest zurück; die Bestätigungs-Action kennt nur noch die Kennung.

**Tech Stack:** TypeScript, Next.js 16 (App Router, Route Handler), better-sqlite3, node-tar, Zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-06-setup-import-design.md`

## Global Constraints

- Service-Signatur: `fn(deps, ctx, input) → Promise<Result<T>>`; Ablauf `requirePermission` → `validate` → `db.transaction` → `recordAudit` → `ok(...)`. `importBackupForSetup` hat bewusst **kein** `ctx` und **keine** Rechteprüfung; die Bedingung ist `isSetupRequired`.
- Fachfehler sind `Result`-Werte, nie Exceptions. Nur technische Fehler werfen.
- Code Englisch, Oberfläche über `apps/kompass/messages/de.json` (Sie-Form). Kein hartcodierter UI-Text.
- IDs: ULID über `newId()`. Zeit: `deps.clock.now()`, nie `new Date()`.
- Tests: Vitest, Service-Tests gegen `createTestDeps()`. Pro Service mindestens Erfolg, Fehlerfall, Audit-Eintrag.
- Upload-Grenze: **2 GB** (`2 * 1024 * 1024 * 1024`).
- Entpackgrenze: **8 GB** (`8 * 1024 * 1024 * 1024`).
- Erlaubte Archiveinträge: `manifest.json`, `kompass.db`, alles unter `media/`.
- ULID-Muster für Kennungen: `^[0-9A-HJKMNP-TV-Z]{26}$`.
- Seiten, die die Datenbank lesen und nicht unter `(shell)` liegen, brauchen `export const dynamic = 'force-dynamic'`.

---

### Task 1: Archivbehandlung mit Filter und Grenze

Zieht das Entpacken aus `import.ts` in ein eigenes Modul und setzt die drei Schutzregeln durch. Betrifft beide Importwege.

**Files:**
- Create: `packages/core/src/backup/archive.ts`
- Modify: `packages/core/src/backup/import.ts:17-21` (die lokale `extract`-Funktion entfällt)
- Test: `packages/core/tests/backup-archive.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces:
  - `isAllowedBackupEntry(entryPath: string): boolean`
  - `extractBackup(opts: { archivePath: string; workDir: string; maxBytes?: number }): Promise<string>` — legt ein Unterverzeichnis in `workDir` an und gibt dessen Pfad zurück
  - `class BackupTooLargeError extends Error`
  - `const BACKUP_MAX_UNPACKED_BYTES = 8 * 1024 * 1024 * 1024`

- [ ] **Step 1: Test für die reine Pfadprüfung schreiben**

Neue Datei `packages/core/tests/backup-archive.test.ts`:

```ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as tar from 'tar';
import { afterEach, describe, expect, it } from 'vitest';
import { BackupTooLargeError, extractBackup, isAllowedBackupEntry } from '../src/backup/archive';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-archive-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('isAllowedBackupEntry', () => {
  it('accepts exactly the three kinds of entry a backup contains', () => {
    expect(isAllowedBackupEntry('manifest.json')).toBe(true);
    expect(isAllowedBackupEntry('kompass.db')).toBe(true);
    expect(isAllowedBackupEntry('media/foto-abc123.png')).toBe(true);
    expect(isAllowedBackupEntry('./manifest.json')).toBe(true);
    expect(isAllowedBackupEntry('media')).toBe(true);
    expect(isAllowedBackupEntry('media/')).toBe(true);
  });

  it('rejects escapes and anything unexpected', () => {
    expect(isAllowedBackupEntry('../etc/passwd')).toBe(false);
    expect(isAllowedBackupEntry('media/../../etc/passwd')).toBe(false);
    expect(isAllowedBackupEntry('/etc/passwd')).toBe(false);
    expect(isAllowedBackupEntry('site.pw')).toBe(false);
    expect(isAllowedBackupEntry('kompass.db-wal')).toBe(false);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core exec vitest run tests/backup-archive.test.ts`
Expected: FAIL — `Cannot find module '../src/backup/archive'`

- [ ] **Step 3: Modul anlegen**

Neue Datei `packages/core/src/backup/archive.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import * as tar from 'tar';

/** Obergrenze fuer die entpackte Gesamtgroesse. Ohne sie genuegt ein kleines
 *  Archiv, um die Platte zu fuellen. */
export const BACKUP_MAX_UNPACKED_BYTES = 8 * 1024 * 1024 * 1024;

export class BackupTooLargeError extends Error {
  constructor(limitBytes: number) {
    super(`Das Archiv entpackt sich auf mehr als ${Math.round(limitBytes / 1024 / 1024 / 1024)} GB`);
    this.name = 'BackupTooLargeError';
  }
}

// `media` selbst gehoert dazu: der Export packt das Verzeichnis mit, und ohne
// diesen Eintrag entstuende es bei einem Backup ohne Medien gar nicht.
const ALLOWED = /^(manifest\.json|kompass\.db|media(\/.*)?)$/;

/**
 * Ein Backup enthaelt genau drei Arten von Eintrag. Alles andere wird beim
 * Entpacken verworfen — und zwar ausdruecklich, statt sich auf die
 * Voreinstellung von node-tar zu verlassen, die sich aendern koennte.
 */
export function isAllowedBackupEntry(entryPath: string): boolean {
  const normalized = entryPath.replace(/^\.\//, '');
  if (normalized.startsWith('/')) return false;
  if (normalized.split('/').includes('..')) return false;
  return ALLOWED.test(normalized);
}

export async function extractBackup(opts: {
  archivePath: string;
  workDir: string;
  maxBytes?: number;
}): Promise<string> {
  const limit = opts.maxBytes ?? BACKUP_MAX_UNPACKED_BYTES;
  const dir = await mkdtemp(path.join(opts.workDir, 'kompass-import-'));
  let unpacked = 0;
  let exceeded = false;
  await tar.extract({
    file: opts.archivePath,
    cwd: dir,
    // Aus dem Filter darf nicht geworfen werden: tar 7.5 reicht den Fehler
    // nicht als abgelehntes Promise weiter, er entkommt synchron durch den
    // Ereignis-Emitter und beendet den Prozess. Ein zu grosses Archiv waere
    // damit ein Denial-of-Service statt einer abgelehnten Datei. Stattdessen
    // wird ab der Grenze nichts mehr geschrieben und danach geworfen.
    filter: (entryPath, entry) => {
      if (exceeded || !isAllowedBackupEntry(entryPath)) return false;
      unpacked += entry.size;
      if (unpacked > limit) {
        exceeded = true;
        return false;
      }
      return true;
    },
  });
  if (exceeded) {
    await rm(dir, { recursive: true, force: true });
    throw new BackupTooLargeError(limit);
  }
  return dir;
}
```

- [ ] **Step 4: Test ausführen**

Run: `pnpm --filter @kompass/core exec vitest run tests/backup-archive.test.ts`
Expected: PASS (2 Tests)

- [ ] **Step 5: Tests für das echte Entpacken ergänzen**

An `packages/core/tests/backup-archive.test.ts` anhängen:

```ts
function archiveWith(entries: Record<string, string>): string {
  const src = tmp();
  for (const [name, content] of Object.entries(entries)) {
    const file = path.join(src, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  const out = path.join(tmp(), 'backup.tar.gz');
  tar.create({ file: out, cwd: src, gzip: true, sync: true }, Object.keys(entries));
  return out;
}

describe('extractBackup', () => {
  it('unpacks the expected entries and drops the rest', async () => {
    const archive = archiveWith({
      'manifest.json': '{}',
      'kompass.db': 'db',
      'media/foto.png': 'bild',
      'fremd.txt': 'weg damit',
    });
    const dir = await extractBackup({ archivePath: archive, workDir: tmp() });
    const { readdirSync, existsSync } = await import('node:fs');
    expect(readdirSync(dir).sort()).toEqual(['kompass.db', 'manifest.json', 'media']);
    expect(existsSync(path.join(dir, 'fremd.txt'))).toBe(false);
  });

  it('refuses an archive that unpacks beyond the limit', async () => {
    const archive = archiveWith({ 'kompass.db': 'x'.repeat(4096), 'manifest.json': '{}' });
    await expect(extractBackup({ archivePath: archive, workDir: tmp(), maxBytes: 100 })).rejects.toThrow(
      BackupTooLargeError,
    );
  });
});
```

- [ ] **Step 6: Tests ausführen**

Run: `pnpm --filter @kompass/core exec vitest run tests/backup-archive.test.ts`
Expected: PASS (4 Tests)

- [ ] **Step 7: `import.ts` auf das neue Modul umstellen**

In `packages/core/src/backup/import.ts` die lokale `extract`-Funktion (Zeilen 17–21) löschen und den Import ergänzen:

```ts
import { extractBackup } from './archive';
```

Die beiden Aufrufstellen ändern:

```ts
// in inspectBackup
const dir = await extractBackup({ archivePath: opts.archivePath, workDir: opts.workDir });

// in importBackup
const dir = await extractBackup({ archivePath, workDir });
```

`mkdtemp` aus dem `node:fs/promises`-Import entfernen, falls es sonst unbenutzt ist, und `import * as tar from 'tar';` ebenfalls, wenn keine weitere Verwendung bleibt. Anschließend `pnpm --filter @kompass/core typecheck` bis 0 Fehler.

- [ ] **Step 8: `archive.ts` exportieren**

In `packages/core/src/backup/index.ts` ergänzen:

```ts
export * from './archive';
```

- [ ] **Step 9: Gesamtlauf**

Run: `pnpm --filter @kompass/core typecheck && pnpm --filter @kompass/core test`
Expected: alle grün, insbesondere die vorhandene `backup.test.ts`

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/backup/archive.ts packages/core/src/backup/import.ts packages/core/src/backup/index.ts packages/core/tests/backup-archive.test.ts
git commit -m "feat(backup): restrict what an archive may unpack and how large it may get"
```

---

### Task 2: `importBackupForSetup` im Kern

Zieht den destruktiven Rumpf in ein gemeinsames `applyBackup` und legt den unauthentifizierten Weg daneben.

**Files:**
- Modify: `packages/core/src/backup/import.ts`
- Test: `packages/core/tests/backup.test.ts`

**Interfaces:**
- Consumes: `extractBackup` aus Task 1; `isSetupRequired(deps: Deps): boolean` aus `packages/core/src/setup/service.ts`.
- Produces: `importBackupForSetup(deps: AppDeps, input: unknown): Promise<Result<{ manifest: BackupManifest }>>`

- [ ] **Step 1: Tests schreiben**

An `packages/core/tests/backup.test.ts` anhängen (die Datei bringt `fileDeps`, `tmp`, `ctxWith`, `seedDevelopment`, `unwrap`, `exportBackup`, `users` bereits mit; `importBackupForSetup` und `isSetupRequired` dem bestehenden Import hinzufügen):

```ts
describe('importBackupForSetup', () => {
  async function archiveFromSeeded(): Promise<string> {
    const source = tmp();
    const deps = fileDeps(source);
    await seedDevelopment(deps);
    const archive = unwrap(await exportBackup(deps, ctxWith(['backup.export']), { workDir: tmp() }));
    deps.close();
    return archive.archivePath;
  }

  it('imports into an empty installation and records who did it', async () => {
    const archivePath = await archiveFromSeeded();
    const target = tmp();
    const deps = fileDeps(target);
    expect(isSetupRequired(deps)).toBe(true);

    const result = unwrap(await importBackupForSetup(deps, { archivePath, workDir: tmp() }));
    expect(result.manifest.environment).toBe('test');
    expect(isSetupRequired(deps)).toBe(false);

    const entry = deps.db.select().from(auditLog).all().find((e) => e.action === 'backup.import');
    expect(entry).toBeTruthy();
    expect(entry!.userId).toBeNull();
    expect(entry!.channel).toBe('system');
    deps.close();
  });

  it('refuses once the installation has a user', async () => {
    const archivePath = await archiveFromSeeded();
    const target = tmp();
    const deps = fileDeps(target);
    await seedDevelopment(deps);
    const result = await importBackupForSetup(deps, { archivePath, workDir: tmp() });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.type === 'conflict') expect(result.error.code).toBe('setupAlreadyDone');
    deps.close();
  });

  it('refuses an archive without users, which would leave the installation open and unusable', async () => {
    const source = tmp();
    const empty = fileDeps(source);
    const archive = unwrap(await exportBackup(empty, ctxWith(['backup.export']), { workDir: tmp() }));
    empty.close();

    const deps = fileDeps(tmp());
    const result = await importBackupForSetup(deps, { archivePath: archive.archivePath, workDir: tmp() });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.type === 'validation') {
      expect(result.error.issues[0]!.message).toBe('backupWithoutUsers');
    }
    deps.close();
  });
});
```

- [ ] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core exec vitest run tests/backup.test.ts`
Expected: FAIL — `importBackupForSetup is not a function`

- [ ] **Step 3: Rumpf in `applyBackup` ziehen**

In `packages/core/src/backup/import.ts` den Block von `const importer = ...` bis `return ok({ manifest: manifest.value });` (Zeilen 58–91) aus `importBackup` herausnehmen und als eigene Funktion darüber setzen:

```ts
async function applyBackup(
  deps: AppDeps,
  dir: string,
  manifest: BackupManifest,
  opts: { archiveName: string; ctx: CallContext; importerEmail: string | null; onlyWhileSetupPending: boolean },
): Promise<Result<{ manifest: BackupManifest }>> {
  // Die Bedingung wird unmittelbar vor dem Austausch geprueft, nicht am
  // Anfang: dazwischen soll moeglichst nichts liegen.
  if (opts.onlyWhileSetupPending && !isSetupRequired(deps)) {
    return conflict('setupAlreadyDone', 'Die Einrichtung wurde bereits abgeschlossen');
  }
  const stampSuffix = `.before-import-${isoNow(deps.clock).replace(/[-:.]/g, '')}`;
  deps.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${deps.databasePath}${suffix}`;
    if (await stat(file).catch(() => null)) await rename(file, `${file}${stampSuffix}`);
  }
  await cp(path.join(dir, 'kompass.db'), deps.databasePath);
  if (deps.media.rootDir) {
    const root = deps.media.rootDir;
    // Im Container ist das Medienverzeichnis ein Einhaengepunkt eines Volumes.
    // Ein Mountpoint laesst sich nicht umbenennen, und sein Elternverzeichnis
    // ist nicht beschreibbar — deshalb wird innerhalb gearbeitet.
    await mkdir(root, { recursive: true });
    const aside = path.join(root, stampSuffix);
    await mkdir(aside, { recursive: true });
    for (const entry of await readdir(root)) {
      if (entry.startsWith('.before-import-')) continue;
      await rename(path.join(root, entry), path.join(aside, entry));
    }
    await cp(path.join(dir, 'media'), root, { recursive: true });
  }
  deps.reopen();

  const now = isoNow(deps.clock);
  deps.db.transaction((tx) => {
    const sys = { ...systemContext(opts.ctx.requestId), ipAddress: opts.ctx.ipAddress };
    writeSettingInternal(tx, deps, sys, 'system.lastImportAt', now, 'backup.import.mark');
    writeSettingInternal(tx, deps, sys, 'system.lastImportSource', `${manifest.environment} ${manifest.createdAt}`, 'backup.import.mark');
    recordAudit(tx, deps, sys, {
      action: 'backup.import',
      entityType: 'backup',
      entityId: opts.archiveName,
      after: manifest,
      summary: `Bestand aus Backup (${manifest.environment}, ${manifest.createdAt}) importiert durch ${opts.importerEmail ?? 'unbekannt'}`,
    });
  });
  return ok({ manifest });
}
```

Ergänzende Importe am Dateikopf:

```ts
import { conflict } from '../result';
import { isSetupRequired } from '../setup/service';
```

- [ ] **Step 4: `importBackup` auf `applyBackup` umstellen**

Der Rumpf ab der Integritätsprüfung lautet nun:

```ts
    const importer = ctx.userId ? loadUserSummary(deps.db, ctx.userId) : null;
    return await applyBackup(deps, dir, manifest.value, {
      archiveName: path.basename(archivePath),
      ctx,
      importerEmail: importer?.email ?? null,
      onlyWhileSetupPending: false,
    });
```

- [ ] **Step 5: `importBackupForSetup` schreiben**

Unter `importBackup` einfügen:

```ts
const setupImportSchema = z.object({ archivePath: z.string().min(1), workDir: z.string().min(1) });

/**
 * Import ohne Anmeldung, ausschliesslich solange die Einrichtung aussteht.
 * Kein CallContext und keine Rechtepruefung: es gibt keinen Nutzer, dem
 * Rechte gehoeren koennten. Die Bedingung prueft applyBackup unmittelbar
 * vor dem Austausch noch einmal.
 */
export async function importBackupForSetup(deps: AppDeps, input: unknown): Promise<Result<{ manifest: BackupManifest }>> {
  const parsed = validate(setupImportSchema, input);
  if (!parsed.ok) return parsed;
  if (!isSetupRequired(deps)) return conflict('setupAlreadyDone', 'Die Einrichtung wurde bereits abgeschlossen');
  const { archivePath, workDir } = parsed.value;
  const dir = await extractBackup({ archivePath, workDir });
  try {
    const manifest = await readManifest(dir);
    if (!manifest.ok) return manifest;
    if (manifest.value.migrationCount > deps.migrationCount) return invalid([{ path: 'archive', message: 'backupNewerThanApp' }]);
    // Ohne Nutzer bliebe die Installation unbenutzbar und zugleich dauerhaft
    // offen: niemand koennte sich anmelden, der Endpunkt bliebe erreichbar.
    if (manifest.value.counts.users === 0) return invalid([{ path: 'archive', message: 'backupWithoutUsers' }]);
    const dbFile = path.join(dir, 'kompass.db');
    if (!(await stat(dbFile).catch(() => null))) return invalid([{ path: 'archive', message: 'backupCorrupt' }]);
    const probe = new Database(dbFile, { readonly: true });
    const integrity = (probe.prepare('pragma integrity_check').get() as { integrity_check: string }).integrity_check;
    probe.close();
    if (integrity !== 'ok') return invalid([{ path: 'archive', message: 'backupCorrupt' }]);
    return await applyBackup(deps, dir, manifest.value, {
      archiveName: path.basename(archivePath),
      ctx: systemContext(),
      importerEmail: null,
      onlyWhileSetupPending: true,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 6: Tests ausführen**

Run: `pnpm --filter @kompass/core exec vitest run tests/backup.test.ts`
Expected: PASS — die drei neuen Tests und alle bestehenden

- [ ] **Step 7: Gesamtlauf und Commit**

Run: `pnpm --filter @kompass/core typecheck && pnpm --filter @kompass/core test`

```bash
git add packages/core/src/backup/import.ts packages/core/tests/backup.test.ts
git commit -m "feat(backup): allow an unauthenticated import while setup is still pending"
```

---

### Task 3: Ablage und Kennungen in der App

Reine Hilfsfunktionen für Ablageort, Kennungsprüfung und Aufräumen. Ohne Netz und ohne Datenbank, deshalb schnell prüfbar.

**Files:**
- Create: `apps/kompass/src/lib/setup-uploads.ts`
- Test: `apps/kompass/tests/setup-uploads.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces:
  - `uploadsDir(databasePath: string): string`
  - `isUploadHandle(value: string): boolean`
  - `resolveUpload(databasePath: string, handle: string): string | null`
  - `clearUploads(databasePath: string): Promise<string>` — leert die Ablage und gibt ihren Pfad zurück
  - `const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024`

- [ ] **Step 1: Test schreiben**

Neue Datei `apps/kompass/tests/setup-uploads.test.ts`:

```ts
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearUploads, isUploadHandle, resolveUpload, uploadsDir } from '@/lib/setup-uploads';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-uploads-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('setup uploads', () => {
  it('puts the store next to the database', () => {
    expect(uploadsDir('/data/kompass.db')).toBe(path.join('/data', 'uploads'));
  });

  it('accepts only a ULID as a handle', () => {
    expect(isUploadHandle('01M1V39786ARW1M2PTG6YTWN8T')).toBe(true);
    expect(isUploadHandle('../../etc/passwd')).toBe(false);
    expect(isUploadHandle('01m1v39786arw1m2ptg6ytwn8t')).toBe(false);
    expect(isUploadHandle('')).toBe(false);
    expect(isUploadHandle('01M1V39786ARW1M2PTG6YTWN8T/x')).toBe(false);
  });

  it('resolves a valid handle inside the store and refuses anything else', () => {
    const file = resolveUpload('/data/kompass.db', '01M1V39786ARW1M2PTG6YTWN8T');
    expect(file).toBe(path.join('/data', 'uploads', '01M1V39786ARW1M2PTG6YTWN8T.tar.gz'));
    expect(resolveUpload('/data/kompass.db', '../../etc/passwd')).toBeNull();
  });

  it('empties the store, so only one upload can ever occupy disk', async () => {
    const dir = tmp();
    const dbPath = path.join(dir, 'kompass.db');
    const store = await clearUploads(dbPath);
    writeFileSync(path.join(store, 'alt.tar.gz'), 'alt');
    await clearUploads(dbPath);
    expect(existsSync(path.join(store, 'alt.tar.gz'))).toBe(false);
    expect(existsSync(store)).toBe(true);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app exec vitest run tests/setup-uploads.test.ts`
Expected: FAIL — `Cannot find module '@/lib/setup-uploads'`

- [ ] **Step 3: Modul schreiben**

Neue Datei `apps/kompass/src/lib/setup-uploads.ts`:

```ts
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

/** Obergrenze fuer den Upload. Der Endpunkt ist ohne Anmeldung erreichbar. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Neben der Datenbank, nicht in /tmp: gleiches Dateisystem wie das Ziel, und
 *  ein angefangener Upload ueberlebt keinen Containerneustart im Abbild. */
export function uploadsDir(databasePath: string): string {
  return path.join(path.dirname(databasePath), 'uploads');
}

export function isUploadHandle(value: string): boolean {
  return ULID.test(value);
}

/** Prueft die Kennung, bevor sie zu einem Pfad wird, und stellt sicher, dass
 *  der aufgeloeste Pfad in der Ablage liegt. Null heisst: nicht anfassen. */
export function resolveUpload(databasePath: string, handle: string): string | null {
  if (!isUploadHandle(handle)) return null;
  const dir = path.resolve(uploadsDir(databasePath));
  const file = path.resolve(path.join(dir, `${handle}.tar.gz`));
  return file.startsWith(`${dir}${path.sep}`) ? file : null;
}

export async function clearUploads(databasePath: string): Promise<string> {
  const dir = uploadsDir(databasePath);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  return dir;
}
```

- [ ] **Step 4: Test ausführen**

Run: `pnpm --filter @kompass/app exec vitest run tests/setup-uploads.test.ts`
Expected: PASS (4 Tests)

- [ ] **Step 5: Commit**

```bash
git add apps/kompass/src/lib/setup-uploads.ts apps/kompass/tests/setup-uploads.test.ts
git commit -m "feat(setup): store and address a pending backup upload"
```

---

### Task 4: Route Handler für den Upload

Nimmt die Datei im Strom entgegen, begrenzt sie, liest das Manifest.

**Files:**
- Create: `apps/kompass/src/app/setup/import/upload/route.ts`

**Interfaces:**
- Consumes: `clearUploads`, `resolveUpload`, `MAX_UPLOAD_BYTES` aus Task 3; `inspectBackup` und `isSetupRequired` aus `@kompass/core`.
- Produces: `POST /setup/import/upload` → `200 { handle: string; manifest: BackupManifest }`, `409` wenn eingerichtet, `413` bei Überschreiten der Grenze, `422` bei unlesbarem Archiv.

- [ ] **Step 1: Handler schreiben**

Neue Datei `apps/kompass/src/app/setup/import/upload/route.ts`:

```ts
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { inspectBackup, isSetupRequired, newId } from '@kompass/core';
import { getDeps } from '@/lib/deps';
import { clearUploads, MAX_UPLOAD_BYTES, resolveUpload } from '@/lib/setup-uploads';

export const dynamic = 'force-dynamic';

class UploadTooLargeError extends Error {}

export async function POST(request: Request): Promise<Response> {
  const deps = getDeps();
  // Nur zur Bedienbarkeit — massgeblich prueft der Kern beim Einspielen.
  if (!isSetupRequired(deps)) return new Response(null, { status: 409 });
  if (!request.body) return new Response(null, { status: 400 });

  // Vor jeder Annahme leeren: so belegt immer nur ein Archiv Platz.
  await clearUploads(deps.databasePath);
  const handle = newId();
  const file = resolveUpload(deps.databasePath, handle);
  if (!file) return new Response(null, { status: 500 });

  let received = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      received += chunk.length;
      if (received > MAX_UPLOAD_BYTES) {
        done(new UploadTooLargeError());
        return;
      }
      done(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]), limiter, createWriteStream(file));
  } catch (error) {
    await rm(file, { force: true });
    if (error instanceof UploadTooLargeError) return new Response(null, { status: 413 });
    throw error;
  }

  const manifest = await inspectBackup({ archivePath: file, workDir: tmpdir() });
  if (!manifest.ok) {
    await rm(file, { force: true });
    return Response.json({ error: 'backupFormatUnsupported' }, { status: 422 });
  }
  return Response.json({ handle, manifest: manifest.value });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @kompass/app typecheck`
Expected: 0 Fehler

- [ ] **Step 3: Commit**

```bash
git add apps/kompass/src/app/setup/import/upload/route.ts
git commit -m "feat(setup): accept a backup upload as a stream with its own limit"
```

---

### Task 5: Seite, Formular, Action und Verweis

**Files:**
- Create: `apps/kompass/src/app/setup/import/page.tsx`
- Create: `apps/kompass/src/app/setup/import/import-form.tsx`
- Create: `apps/kompass/src/app/setup/import/actions.ts`
- Modify: `apps/kompass/src/app/setup/page.tsx`
- Modify: `apps/kompass/messages/de.json`
- Modify: `apps/kompass/src/lib/actions.ts`

**Interfaces:**
- Consumes: `POST /setup/import/upload` aus Task 4; `importBackupForSetup` aus Task 2; `resolveUpload` aus Task 3.
- Produces: `importForSetupAction(_prev: ActionState, formData: FormData): Promise<ActionState>` — erwartet das Feld `handle`.

- [ ] **Step 1: Texte ergänzen**

In `apps/kompass/messages/de.json` unter `auth.setup` einen Geschwisterknoten `auth.setupImport` einfügen (Einrückung der Nachbarn übernehmen):

```json
"setupImport": {
  "link": "Sie haben ein Backup? Bestand wiederherstellen",
  "title": "Bestand wiederherstellen",
  "intro": "Spielen Sie ein Backup ein, statt neu zu beginnen. Die Datenbank ist noch leer, es geht nichts verloren.",
  "file": "Backup-Datei",
  "upload": "Datei prüfen",
  "uploading": "Wird geprüft …",
  "manifestTitle": "Inhalt des Archivs",
  "environment": "Umgebung",
  "createdAt": "Erstellt am",
  "users": "Nutzer",
  "documents": "Dokumente",
  "mediaAssets": "Medien",
  "credentialWarning": "Nach dem Einspielen melden Sie sich mit den Zugangsdaten aus diesem Backup an. Ohne diese kommen Sie nicht mehr hinein.",
  "confirm": "Diesen Bestand einspielen",
  "running": "Wird eingespielt …",
  "back": "Zurück zur Einrichtung",
  "tooLarge": "Die Datei ist größer als 2 GB.",
  "unreadable": "Die Datei ist kein Kompass-Backup."
}
```

Ebenso unter `errors.fields` ergänzen:

```json
"backupWithoutUsers": "Dieses Backup enthält keine Nutzer. Damit ließe sich die Installation nicht mehr benutzen.",
```

- [ ] **Step 2: Fehlercode bekannt machen**

In `apps/kompass/src/lib/actions.ts` die Zeile

```ts
const BACKUP_FIELD_CODES = ['confirmationMismatch', 'backupFormatUnsupported', 'backupNewerThanApp', 'backupCorrupt'];
```

ersetzen durch

```ts
const BACKUP_FIELD_CODES = ['confirmationMismatch', 'backupFormatUnsupported', 'backupNewerThanApp', 'backupCorrupt', 'backupWithoutUsers'];
```

- [ ] **Step 3: Action schreiben**

Neue Datei `apps/kompass/src/app/setup/import/actions.ts`:

```ts
'use server';

import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { importBackupForSetup } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { toActionState, type ActionState } from '@/lib/actions';
import { getDeps } from '@/lib/deps';
import { resolveUpload } from '@/lib/setup-uploads';

export async function importForSetupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const deps = getDeps();
  const archivePath = resolveUpload(deps.databasePath, String(formData.get('handle') ?? ''));
  if (!archivePath) return { status: 'error', message: t('auth.setupImport.unreadable'), fieldErrors: {} };
  const result = await importBackupForSetup(deps, { archivePath, workDir: tmpdir() });
  await rm(archivePath, { force: true });
  if (!result.ok) return toActionState(result, t);
  redirect('/login?imported=1');
}
```

- [ ] **Step 4: Formular schreiben**

Neue Datei `apps/kompass/src/app/setup/import/import-form.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { idleState } from '@/lib/actions';
import { importForSetupAction } from './actions';

interface Manifest {
  environment: string;
  createdAt: string;
  counts: { users: number; documents: number; mediaAssets: number };
}

export function ImportForm() {
  const t = useTranslations('auth.setupImport');
  const [state, submit, pending] = useActionState(importForSetupAction, idleState);
  const [handle, setHandle] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch('/setup/import/upload', { method: 'POST', body: file });
      if (res.status === 413) {
        setProblem(t('tooLarge'));
        return;
      }
      if (!res.ok) {
        setProblem(t('unreadable'));
        return;
      }
      const body = (await res.json()) as { handle: string; manifest: Manifest };
      setHandle(body.handle);
      setManifest(body.manifest);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] leading-[1.55] text-ink-2">{t('intro')}</p>

      <label className="flex flex-col gap-1 text-[13px]">
        <span>{t('file')}</span>
        <input
          type="file"
          accept=".gz,.tar.gz,application/gzip"
          disabled={busy || pending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </label>
      {busy && <p className="text-[13px] text-muted-ink">{t('uploading')}</p>}
      {problem && <p role="alert" className="text-[13px] text-danger">{problem}</p>}

      {manifest && handle && (
        <form action={submit} className="flex flex-col gap-3 rounded-lg border border-line p-4">
          <input type="hidden" name="handle" value={handle} />
          <h3 className="font-heading text-[16px]">{t('manifestTitle')}</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
            <dt className="text-muted-ink">{t('environment')}</dt>
            <dd className="font-mono">{manifest.environment}</dd>
            <dt className="text-muted-ink">{t('createdAt')}</dt>
            <dd className="font-mono">{manifest.createdAt}</dd>
            <dt className="text-muted-ink">{t('users')}</dt>
            <dd className="font-mono">{manifest.counts.users}</dd>
            <dt className="text-muted-ink">{t('documents')}</dt>
            <dd className="font-mono">{manifest.counts.documents}</dd>
            <dt className="text-muted-ink">{t('mediaAssets')}</dt>
            <dd className="font-mono">{manifest.counts.mediaAssets}</dd>
          </dl>
          <p className="text-[13px] text-ink-2">{t('credentialWarning')}</p>
          {state.status === 'error' && (
            <p role="alert" className="text-[13px] text-danger">
              {state.message}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? t('running') : t('confirm')}
          </Button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Seite schreiben**

Neue Datei `apps/kompass/src/app/setup/import/page.tsx`:

```tsx
import { isSetupRequired } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { getDeps } from '@/lib/deps';
import { ImportForm } from './import-form';

// Diese Seite entscheidet anhand der Datenbank, ob eingerichtet werden muss.
// Ohne force-dynamic backt `next build` den Bauzeit-Zustand ein.
export const dynamic = 'force-dynamic';

export default async function SetupImportPage() {
  if (!isSetupRequired(getDeps())) redirect('/login');
  const t = await getTranslations('auth.setupImport');
  const app = await getTranslations('app');
  return (
    <AuthCard brand={app('name')} title={t('title')} width={520} footer={t('back')}>
      <ImportForm />
    </AuthCard>
  );
}
```

- [ ] **Step 6: Verweis auf der Einrichtungsseite**

In `apps/kompass/src/app/setup/page.tsx` unter `<SetupForm />` ergänzen:

```tsx
      <p className="mt-4 text-[13px]">
        <a className="underline" href="/setup/import">
          {t('importLink')}
        </a>
      </p>
```

und in `messages/de.json` unter `auth.setup` ergänzen:

```json
"importLink": "Sie haben ein Backup? Bestand wiederherstellen",
```

- [ ] **Step 7: Typecheck und Tests**

Run: `pnpm --filter @kompass/app typecheck && pnpm --filter @kompass/app test`
Expected: 0 Fehler, alle Tests grün

- [ ] **Step 8: Commit**

```bash
git add apps/kompass/src/app/setup apps/kompass/messages/de.json apps/kompass/src/lib/actions.ts
git commit -m "feat(setup): offer restoring a backup instead of creating the first account"
```

---

### Task 6: E2E über den ganzen Weg

**Files:**
- Create: `apps/kompass/e2e/setup-import.spec.ts`
- Keine Änderung an `apps/kompass/e2e/helpers.ts`: `resetDatabase(page, 'empty' | 'seeded')` und `loginAsAdmin(page)` sind vorhanden, letzteres prüft bereits, dass anschließend `/` erreicht ist.

**Interfaces:**
- Consumes: alles aus den Tasks 1–5.
- Produces: nichts.

- [ ] **Step 1: E2E-Test schreiben**

Neue Datei `apps/kompass/e2e/setup-import.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test('restores a backup from the setup page and signs in with its credentials', async ({ page }) => {
  // Erst einen Bestand erzeugen und exportieren.
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/admin/backup');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export erstellen' }).click(),
  ]);
  const archivePath = await download.path();

  // Dann eine leere Installation und der Weg ueber die Einrichtungsseite.
  await resetDatabase(page, 'empty');
  await page.goto('/setup');
  await page.getByRole('link', { name: /Bestand wiederherstellen/ }).click();
  await expect(page).toHaveURL(/\/setup\/import$/);

  await page.getByLabel('Backup-Datei').setInputFiles(archivePath!);
  const manifest = page.getByText('Inhalt des Archivs');
  await expect(manifest).toBeVisible();
  await expect(page.getByText('Nach dem Einspielen melden Sie sich')).toBeVisible();

  await page.getByRole('button', { name: 'Diesen Bestand einspielen' }).click();
  await expect(page).toHaveURL(/\/login\?imported=1/);

  // loginAsAdmin prueft selbst, dass danach die Startseite erreicht ist.
  await loginAsAdmin(page);

  // Der Endpunkt schliesst sich selbst.
  await page.goto('/setup/import');
  await expect(page).not.toHaveURL(/\/setup\/import$/);
});
```

- [ ] **Step 2: E2E ausführen**

Run: `pnpm --filter @kompass/app e2e --grep "restores a backup"`
Expected: PASS. Läuft der Dev-Server auf Port 3000, vorher beenden — Next verweigert einen zweiten Dev-Server im selben Verzeichnis.

- [ ] **Step 3: Gesamtlauf**

Run: `pnpm typecheck && pnpm test && pnpm --filter @kompass/app e2e`
Expected: alle grün

- [ ] **Step 4: Backlog nachziehen**

Punkt 1 aus `docs/backlog.md` entfernen (Erledigtes wird dort gelöscht, nicht abgehakt).

- [ ] **Step 5: Commit**

```bash
git add apps/kompass/e2e/setup-import.spec.ts docs/backlog.md
git commit -m "test(e2e): restore a backup from the setup page end to end"
```

---

## Abschluss dieses Plans

Danach kann eine frische Installation ihren Bestand einspielen, ohne ein Wegwerf-Konto anzulegen. Offen bleiben die Backlog-Punkte 2 bis 7, insbesondere der Route Handler für den angemeldeten Import, der dieselbe Ablage nutzen könnte.

## Self-Review (durchgeführt beim Schreiben)

**Spec-Abdeckung:** Zuschnitt „nur eigene Backups" → Task 5 Step 1 (`credentialWarning`), kein Mechanismus zum Setzen eines Administrators. Ablauf mit Verweis statt zweitem Formular → Task 5 Step 6. Route Handler statt Server Action → Task 4. Ablage neben der Datenbank, eine Datei gleichzeitig → Task 3, Task 4 Step 1. Kennungsprüfung vor Pfadbildung → Task 3. `importBackupForSetup` ohne `ctx`, Prüfung unmittelbar vor dem Austausch → Task 2 Step 3 (`onlyWhileSetupPending`). Selbstverschluss → Task 6 Step 2 letzte Zusicherung. Ablehnung bei `counts.users = 0` → Task 2. Protokolleintrag mit `userId: null` → Task 2 Step 1. Archivfilter, Ausbruchschutz, 8-GB-Grenze → Task 1. 2-GB-Uploadgrenze → Task 3, Task 4. `force-dynamic` → Task 5 Step 5.

**Korrektur nach der Planprüfung (2026-09-06):** Task 1 warf ursprünglich aus dem
tar-Filter. Eine Probe gegen tar 7.5.22 zeigte, dass der Fehler dort nicht als
abgelehntes Promise ankommt, sondern den Prozess beendet — ein absichtlich zu
grosses Archiv wäre damit ein Denial-of-Service geworden. Der Filter gibt jetzt
`false` zurück und `extractBackup` wirft danach im gewöhnlichen Ablauf.

**Platzhalter:** Keine. Die beiden Stellen, an denen ich zunächst auf Nachschlagen ausgewichen war, sind aufgelöst: `resetDatabase` kennt `'empty' | 'seeded'`, und `loginAsAdmin` bringt die Zugangsdaten mit und prüft selbst auf `/`. Beides in `apps/kompass/e2e/helpers.ts:5-16` verifiziert.

**Verifizierte Annahmen:** `newId` wird aus `@kompass/core` exportiert (`packages/core/src/index.ts:5`). `AuthCard` nimmt `{ brand, organization?, title, width?, children, footer? }` (`apps/kompass/src/components/auth-card.tsx:3`). `useActionState` ist das Muster der Einrichtungsseite; die dreistellige Form mit `pending` ist unter React 19 gültig.

**Typkonsistenz:** `extractBackup({ archivePath, workDir, maxBytes? })` in Task 1 wird in Task 2 mit denselben Feldnamen aufgerufen. `resolveUpload(databasePath, handle)` aus Task 3 wird in Task 4 und Task 5 gleich benannt verwendet. `importBackupForSetup(deps, { archivePath, workDir })` aus Task 2 entspricht dem Aufruf in Task 5 Step 3. Das Feld `handle` verbindet Task 4 (Antwort), Task 5 Step 4 (verstecktes Feld) und Task 5 Step 3 (`formData.get('handle')`).
