# Fundament Teil 1: Kern (`packages/core`) — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Monorepo anlegen und die komplette, testgetriebene Fachlogik des Fundaments in `packages/core` bauen: Schema, Migrationen, Service-Schicht, Rechte, Änderungsprotokoll, Einstellungen, Nutzer, Rollen, Sessions, API-Tokens, Themes, Modul-Registry, Setup und Seed — ohne Oberfläche, ohne MCP-Adapter, ohne Docker (das sind Teil 2 und Teil 3).

**Architecture:** `packages/core` ist die einzige Schicht, die Daten liest oder schreibt. Jede Fachfunktion hat die Form `fn(deps, ctx, input) → Promise<Result<T>>`: Rechteprüfung → Zod-Validierung → Transaktion (Schreiben + Audit-Eintrag) → typisiertes Ergebnis. `deps` bündelt Datenbank, Uhr, Umgebung und Modul-Registry; `ctx` beschreibt den Aufrufer (Nutzer, Rechte, Kanal). Tests laufen gegen eine In-Memory-SQLite mit echten Migrationen.

**Tech Stack:** pnpm 11 Workspaces · TypeScript 6 (strict) · Node ≥ 24 · Drizzle ORM 0.45 auf better-sqlite3 13 · drizzle-kit 0.31 · Zod 4 · Vitest 5 · @node-rs/argon2 2 · ulid 3.

**Spec:** `docs/superpowers/specs/2026-09-05-fundament-design.md` — dieser Plan setzt die Abschnitte 4 (Repo-Struktur), 5 (Datenmodell), 6 (Modul-System, Service-Schicht) sowie die Kern-Teile von 8 (Testing) um. Abschnitt 6 „Oberfläche", 7 (Dokumenten-Engine), MCP-Adapter und 8 „Umgebungen/Auslieferung" folgen in den Plänen `fundament-2-oberflaeche` und `fundament-3-betrieb`.

## Global Constraints

Aus der Spec, gelten für jede Task:

- **Code Englisch** (Tabellen, Spalten, Funktionen, Variablen, Permission-Keys, Fehlercodes). Kommentare und Commit-Messages dürfen Deutsch sein. Kein UI-Text im Kern — der Kern liefert Codes, die Oberfläche übersetzt.
- **Kein statischer Farbwert im Anwendungscode.** Im Kern kommen Farbwerte ausschließlich als Seed-Daten des Default-Themes vor (`src/themes/default-theme.ts`) — diese Datei ist Daten, kein Code, und die einzige Stelle mit Hex-Werten.
- **Nichts Rechenschaftsrelevantes wird gelöscht**: keine `delete`-Funktion für Nutzer, Rollen, Einstellungen, Audit-Einträge, Dokumente. Sitzungen und API-Token-Widerruf sind erlaubt (Sitzungen löschen, Tokens `revokedAt`).
- **Jede schreibende Service-Funktion** prüft Rechte serverseitig über `requirePermission`, validiert mit Zod, schreibt in einer Transaktion und legt in derselben Transaktion einen Audit-Eintrag an.
- **Ein Weg zu den Daten**: Adapter (später UI, MCP) rufen nur Services. Services exportieren keine rohen Drizzle-Queries für Adapter.
- **Konventionen**: ULID-Strings als Primärschlüssel; Zeitstempel ISO-8601 UTC als `text`; Geldbeträge (später) Integer in Cent; `PRAGMA foreign_keys = ON`; WAL-Modus.
- **TDD**: Jede Task beginnt mit einem fehlschlagenden Test. Keine Implementierung ohne roten Test davor.
- **Passwortregel**: mindestens 12 Zeichen, keine Zeichenklassen-Pflicht. Startpasswörter sind Wortketten (`wiese-kanu-73-lampe`).
- **Login-Sperre**: 5 Fehlversuche → 15 Minuten, Sperre als Audit-Eintrag mit Kanal `system` und ohne Nutzer.
- **Geschützte Rolle**: die Setup-Rolle „Administration" ist `isProtected`, nicht editierbar, hat implizit alle Rechte, und mindestens ein aktiver Nutzer muss sie tragen.
- **Themes**: vollständig, keine Vererbung; `default` ist schreibgeschützt; aktives und Default-Theme nicht löschbar. Module werden nie gelöscht, `core` nie deaktiviert.
- **Versionen** (Stand 2026-09-05, exakt so in `package.json`): `next` bleibt Teil 2; hier: `drizzle-orm ^0.45.2`, `drizzle-kit ^0.31.10`, `better-sqlite3 ^13.0.3`, `@types/better-sqlite3 ^9.6.0`, `zod ^4.5.4`, `vitest ^5.0.0`, `typescript ^6.0.3`, `@node-rs/argon2 ^2.2.0`, `ulid ^3.0.2`, `tsx ^4.23.13`, `@types/node ^26.4.1`, `pnpm 11.25.0`.

---

## Dateistruktur (Ergebnis dieses Plans)

```
package.json                      pnpm-Root, Skripte test/typecheck
pnpm-workspace.yaml               apps/*, packages/*, packages/modules/*
tsconfig.base.json                strict, ESNext, bundler resolution
.gitignore  .nvmrc  .npmrc
AGENTS.md                         Prinzipien + Coding-Regeln (kanonisch)
CLAUDE.md                         dünner Verweis + Befehle
packages/core/
  package.json  tsconfig.json  vitest.config.ts  drizzle.config.ts
  src/index.ts                    öffentliche Exporte des Kerns
  src/result.ts                   Result/ServiceError + Konstruktoren
  src/clock.ts                    Clock, systemClock, fixedClock
  src/ids.ts                      newId (monotone ULID)
  src/validate.ts                 Zod → Result
  src/context.ts                  CallContext, Channel, systemContext
  src/deps.ts                     Deps, AppEnv
  src/db/schema.ts                alle Kern-Tabellen
  src/db/client.ts                openDatabase, runMigrations, Db/DbOrTx
  src/db/migrations/              drizzle-kit-Output + Trigger-Migration
  src/permissions/core.ts         CORE_PERMISSIONS
  src/permissions/check.ts        hasPermission, requirePermission, requireAnyPermission
  src/modules/manifest.ts         ModuleManifest, defineModule, SettingDefinition, PublishedView
  src/modules/registry.ts         createRegistry
  src/modules/service.ts          listModules, setModuleEnabled, isModuleEnabled
  src/core-module.ts              coreModule-Manifest
  src/audit/log.ts                recordAudit
  src/audit/query.ts              queryAudit, getAuditEntry
  src/settings/core.ts            CORE_SETTINGS-Definitionen
  src/settings/service.ts         readSetting, readAllSettings, setSetting, writeSettingInternal
  src/auth/password.ts            hashPassword, verifyPassword, passwordSchema, generateStartPassword
  src/auth/wordlist.ts            deutsche Wortliste für Startpasswörter
  src/auth/sessions.ts            createSession, resolveSession, revokeSession, revokeUserSessions
  src/auth/login.ts               login, changeOwnPassword
  src/auth/tokens.ts              createApiToken, resolveApiToken, revokeApiToken, listApiTokens
  src/roles/service.ts            createRole, updateRole, setRolePermissions, assignRole, removeRole, listRoles
  src/roles/effective.ts          getEffectivePermissions, countActiveProtectedHolders
  src/users/service.ts            createUser, listUsers, updateUser, setUserActive, resetStartPassword
  src/themes/tokens.ts            THEME_TOKENS, themeSchema
  src/themes/default-theme.ts     Default-Theme-Werte (Seed-Daten)
  src/themes/contrast.ts          contrastRatio, checkThemeContrast
  src/themes/service.ts           listThemes, createTheme, updateTheme, duplicateTheme, deleteTheme, activateTheme
  src/published/view.ts           definePublishedView
  src/setup/service.ts            isSetupRequired, completeSetup
  src/app.ts                      createDeps, readEnv (Composition Root)
  src/seed/seed.ts  src/seed/cli.ts
  src/testing/index.ts            createTestDeps, ctxWith, insertUser (nur für Tests)
  tests/*.test.ts                 ein Testfile je Modul
```

---

### Task 1: Monorepo-Gerüst, Repo-Regeln, erster grüner Test

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.nvmrc`, `.npmrc`
- Create: `AGENTS.md`; Replace: `CLAUDE.md`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`, `packages/core/src/index.ts`
- Test: `packages/core/tests/smoke.test.ts`

**Interfaces:**
- Produces: Workspace-Paket `@kompass/core`, Skripte `pnpm test`, `pnpm typecheck`, `pnpm --filter @kompass/core test`.

- [ ] **Step 1: pnpm bereitstellen**

Run: `corepack enable && corepack prepare pnpm@11.25.0 --activate && pnpm --version`
Expected: `11.25.0`. Falls `corepack` fehlt: `npm install -g pnpm@11.25.0`.

- [ ] **Step 2: Root-Dateien anlegen**

`package.json`:
```json
{
  "name": "aluna-kompass",
  "private": true,
  "packageManager": "pnpm@11.25.0",
  "engines": { "node": ">=24" },
  "scripts": {
    "test": "pnpm -r --workspace-concurrency=1 test",
    "typecheck": "pnpm -r typecheck"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "packages/modules/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  }
}
```

`.gitignore`:
```
.DS_Store
node_modules/
dist/
.next/
*.db
*.db-wal
*.db-shm
/data/
/media/
.env
.env.*
!.env.example
coverage/
```

`.nvmrc`: `26`

`.npmrc`:
```
engine-strict=true
```

- [ ] **Step 3: AGENTS.md und CLAUDE.md schreiben**

`AGENTS.md`:
```markdown
# AGENTS.md

Regeln für alle, die an diesem Repo arbeiten (menschlich oder agentisch). Kanonische Quelle für Ziel und Coding-Regeln; die Design-Specs unter `docs/superpowers/specs/` beschreiben das Was, dieses Dokument das Wie.

## Ziel

Aluna Kompass ist ein Open-Source-Vereinsverwaltungstool für gemeinnützige Vereine: Single Source of Truth für alle Vereinsvorgänge, aus der Jahresbericht, Kassenprüfungsunterlagen und Rechenschaftsdokumente erzeugt werden. Generischer Kern plus optionale, pro Installation schaltbare Module. Eine Installation pro Verein, kein Multi-Tenancy. Aluna Tierhilfe e.V. ist Erstnutzer und Taktgeber, nicht Grenze der Zielgruppe.

## Neun Prinzipien

1. **Generischer Kern, optionale Module.** Keine Vereinsspezifika im Kern. Faustregel: Würde ein anderer Verein bei einem Namen stutzen, ist er zu spezifisch.
2. **Konfiguration statt Konstanten.** Vereinsstamm, Steuerdaten, Branding, Farben, Regeln sind Einstellungen in der Datenbank. Kein statischer Farbwert im Anwendungscode — nur Theme-Tokens. Env-Vars nur für Betriebsparameter (Pfade, Port, Secrets, Umgebungsname).
3. **Nichts Rechenschaftsrelevantes wird gelöscht.** Storno/Deaktivieren/Widerrufen statt Löschen. Jede schreibende Aktion erzeugt einen Eintrag im Änderungsprotokoll (Nutzer, Zeit, Kanal, Vorher/Nachher).
4. **Interner Datensatz ≠ veröffentlichte Sicht.** Webseite und Berichte lesen nur explizit freigegebene Sichten.
5. **Abgeleitete Werte werden berechnet, nie gespeichert.**
6. **Rechteprüfung nur serverseitig**, zentral in der Service-Schicht vor jeder schreibenden Aktion. Permission-Keys fest im Code je Modul, Rollen frei benennbar.
7. **Code Englisch, Oberfläche über i18n.** Eine Sprachdatei `messages/de.json` (Sie-Form), kein hartcodierter UI-Text.
8. **Ein Weg zu den Daten.** Oberfläche und MCP rufen dieselbe Service-Schicht (`packages/core`). Keine Fachlogik in Adaptern.
9. **Nie in Prod testen.** TDD ab der ersten Zeile. Dev/Test/Prod strikt getrennt, Umgebungsbalken außerhalb von Prod, Website-Publish nur aus Prod.

## Coding-Regeln

- Service-Signatur: `fn(deps, ctx, input) → Promise<Result<T>>`. Ablauf: `requirePermission` → `validate` (Zod) → `db.transaction` → `recordAudit` in derselben Transaktion → `ok(...)`.
- Fachfehler sind `Result`-Werte (`forbidden`, `validation`, `notFound`, `conflict`, `unauthorized`), nie Exceptions. Nur technische Fehler werfen.
- IDs: ULID (`newId()`). Zeit: `deps.clock.now()` — nie `new Date()` in Fachcode. Zeitstempel ISO-8601 UTC. Geld: Integer in Cent.
- Passwörter: Argon2id. Tokens und Startpasswörter werden nur als Hash gespeichert und genau einmal im Klartext zurückgegeben.
- Tests: Vitest. Service-Tests gegen `createTestDeps()` (In-Memory-SQLite mit echten Migrationen). Pro Service mindestens: Erfolg, `forbidden`, `validation`, Audit-Eintrag.
- Migrationen: `pnpm --filter @kompass/core db:generate` nach jeder Schema-Änderung; erzeugte SQL-Dateien werden committet und nie nachträglich editiert.
- Keine Löschfunktionen für Nutzer, Rollen, Einstellungen, Audit-Einträge, Dokumente, Module. Erlaubt: Sitzungen löschen, Tokens widerrufen, Themes löschen (außer aktiv/Default).

## Befehle

- `pnpm install` — Abhängigkeiten
- `pnpm test` — alle Tests; `pnpm --filter @kompass/core test` — nur Kern
- `pnpm typecheck` — TypeScript
- `pnpm --filter @kompass/core db:generate` — Migration aus Schema erzeugen
- `pnpm --filter @kompass/core seed` — Entwicklungsdaten (nur `APP_ENV=development`)

## Quellen

- Specs: `docs/superpowers/specs/` (Fundament: `2026-09-05-fundament-design.md`)
- Pläne: `docs/superpowers/plans/`
- Design-Referenz Stufe 1: `docs/design/fundament/design_handoff_aluna_kompass_fundament/README.md`
```

`CLAUDE.md` (vollständig ersetzen):
```markdown
# CLAUDE.md

Regeln, Ziel und Befehle stehen in `AGENTS.md` — bitte zuerst lesen. Specs unter `docs/superpowers/specs/`, Pläne unter `docs/superpowers/plans/`, Design-Referenz unter `docs/design/`.

Schnellbefehle: `pnpm install` · `pnpm test` · `pnpm typecheck` · `pnpm --filter @kompass/core db:generate`.
```

- [ ] **Step 4: Kern-Paket anlegen**

`packages/core/package.json`:
```json
{
  "name": "@kompass/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./testing": "./src/testing/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "seed": "tsx src/seed/cli.ts"
  },
  "dependencies": {
    "@node-rs/argon2": "^2.2.0",
    "better-sqlite3": "^13.0.3",
    "drizzle-orm": "^0.45.2",
    "ulid": "^3.0.2",
    "zod": "^4.5.4"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^9.6.0",
    "@types/node": "^26.4.1",
    "drizzle-kit": "^0.31.10",
    "tsx": "^4.23.13",
    "typescript": "^6.0.3",
    "vitest": "^5.0.0"
  }
}
```

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src", "tests", "drizzle.config.ts", "vitest.config.ts"]
}
```

`packages/core/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

`packages/core/src/index.ts`:
```ts
export const CORE_VERSION = '0.1.0';
```

- [ ] **Step 5: Smoke-Test schreiben**

`packages/core/tests/smoke.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { CORE_VERSION } from '../src/index';

describe('core package', () => {
  it('exposes a version', () => {
    expect(CORE_VERSION).toBe('0.1.0');
  });
});
```

- [ ] **Step 6: Installieren und Test ausführen**

Run: `pnpm install && pnpm --filter @kompass/core test`
Expected: `1 passed`. Falls better-sqlite3 beim Install kompiliert: `pnpm approve-builds` ausführen und `better-sqlite3` sowie `@node-rs/argon2` freigeben, dann `pnpm install` erneut.

Run: `pnpm typecheck`
Expected: keine Fehler.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: monorepo scaffold with core package, AGENTS.md and smoke test"
```

---

### Task 2: Result-Typ, Clock, IDs

**Files:**
- Create: `packages/core/src/result.ts`, `packages/core/src/clock.ts`, `packages/core/src/ids.ts`
- Test: `packages/core/tests/result.test.ts`, `packages/core/tests/clock.test.ts`, `packages/core/tests/ids.test.ts`

**Interfaces:**
- Produces:
  - `type Result<T> = { ok: true; value: T } | { ok: false; error: ServiceError }`; Konstruktoren `ok`, `fail`, `forbidden(permission)`, `notFound(entity, id)`, `conflict(code, message)`, `invalid(issues)`, `unauthorized(reason, extra?)`, `unwrap(result)`.
  - `interface Clock { now(): Date }`, `systemClock`, `fixedClock(iso)` mit `advance(ms)`, `isoNow(clock)`.
  - `newId(): string` (monotone ULID), `ID_PATTERN`.

- [ ] **Step 1: Tests schreiben**

`packages/core/tests/result.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { conflict, forbidden, invalid, notFound, ok, unauthorized, unwrap } from '../src/result';

describe('result', () => {
  it('ok wraps a value', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
  });

  it('forbidden carries the permission key', () => {
    expect(forbidden('users.manage')).toEqual({
      ok: false,
      error: { type: 'forbidden', permission: 'users.manage' },
    });
  });

  it('notFound, conflict, invalid and unauthorized carry their payload', () => {
    expect(notFound('user', 'u1').error).toEqual({ type: 'notFound', entity: 'user', id: 'u1' });
    expect(conflict('emailTaken', 'E-Mail bereits vergeben').error).toEqual({
      type: 'conflict',
      code: 'emailTaken',
      message: 'E-Mail bereits vergeben',
    });
    expect(invalid([{ path: 'name', message: 'required' }]).error).toEqual({
      type: 'validation',
      issues: [{ path: 'name', message: 'required' }],
    });
    expect(unauthorized('locked', { lockedUntil: '2026-09-05T10:00:00.000Z' }).error).toEqual({
      type: 'unauthorized',
      reason: 'locked',
      lockedUntil: '2026-09-05T10:00:00.000Z',
    });
  });

  it('unwrap returns the value or throws on failure', () => {
    expect(unwrap(ok('x'))).toBe('x');
    expect(() => unwrap(forbidden('x'))).toThrow(/unexpected failure/);
  });
});
```

`packages/core/tests/clock.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { fixedClock, isoNow, systemClock } from '../src/clock';

describe('clock', () => {
  it('fixedClock returns the same instant until advanced', () => {
    const clock = fixedClock('2026-09-05T08:00:00.000Z');
    expect(isoNow(clock)).toBe('2026-09-05T08:00:00.000Z');
    clock.advance(60_000);
    expect(isoNow(clock)).toBe('2026-09-05T08:01:00.000Z');
  });

  it('fixedClock hands out copies, not the internal Date', () => {
    const clock = fixedClock('2026-09-05T08:00:00.000Z');
    clock.now().setFullYear(2000);
    expect(isoNow(clock)).toBe('2026-09-05T08:00:00.000Z');
  });

  it('systemClock is close to Date.now', () => {
    expect(Math.abs(systemClock.now().getTime() - Date.now())).toBeLessThan(1000);
  });
});
```

`packages/core/tests/ids.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ID_PATTERN, newId } from '../src/ids';

describe('ids', () => {
  it('produces 26-char Crockford base32 ULIDs', () => {
    expect(newId()).toMatch(ID_PATTERN);
  });

  it('is unique and lexicographically monotonic within a burst', () => {
    const ids = Array.from({ length: 200 }, () => newId());
    expect(new Set(ids).size).toBe(200);
    expect([...ids].sort()).toEqual(ids);
  });
});
```

- [ ] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core test`
Expected: FAIL — `Cannot find module '../src/result'` (und clock, ids).

- [ ] **Step 3: Implementieren**

`packages/core/src/result.ts`:
```ts
export type ValidationIssue = { path: string; message: string };

export type UnauthorizedReason = 'invalidCredentials' | 'locked' | 'inactive' | 'passwordChangeRequired';

export type ServiceError =
  | { type: 'forbidden'; permission: string }
  | { type: 'validation'; issues: ValidationIssue[] }
  | { type: 'notFound'; entity: string; id: string }
  | { type: 'conflict'; code: string; message: string }
  | { type: 'unauthorized'; reason: UnauthorizedReason; attemptsLeft?: number; lockedUntil?: string };

export type Success<T> = { ok: true; value: T };
export type Failure = { ok: false; error: ServiceError };
export type Result<T> = Success<T> | Failure;

export const ok = <T>(value: T): Success<T> => ({ ok: true, value });
export const fail = (error: ServiceError): Failure => ({ ok: false, error });
export const forbidden = (permission: string): Failure => fail({ type: 'forbidden', permission });
export const notFound = (entity: string, id: string): Failure => fail({ type: 'notFound', entity, id });
export const conflict = (code: string, message: string): Failure => fail({ type: 'conflict', code, message });
export const invalid = (issues: ValidationIssue[]): Failure => fail({ type: 'validation', issues });
export const unauthorized = (
  reason: UnauthorizedReason,
  extra: { attemptsLeft?: number; lockedUntil?: string } = {},
): Failure => fail({ type: 'unauthorized', reason, ...extra });

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`unexpected failure: ${JSON.stringify(result.error)}`);
  return result.value;
}
```

`packages/core/src/clock.ts`:
```ts
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface FixedClock extends Clock {
  advance(ms: number): void;
  set(iso: string): void;
}

export function fixedClock(iso: string): FixedClock {
  let current = new Date(iso);
  return {
    now: () => new Date(current.getTime()),
    advance: (ms) => {
      current = new Date(current.getTime() + ms);
    },
    set: (next) => {
      current = new Date(next);
    },
  };
}

export const isoNow = (clock: Clock): string => clock.now().toISOString();
```

`packages/core/src/ids.ts`:
```ts
import { monotonicFactory } from 'ulid';

const generate = monotonicFactory();

export const ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export const newId = (): string => generate();
```

- [ ] **Step 4: Tests ausführen**

Run: `pnpm --filter @kompass/core test`
Expected: alle Tests grün (smoke + result + clock + ids).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): Result type, Clock abstraction and monotonic ULIDs"
```

---

### Task 3: Schema, Datenbank-Client, Migrationen, Test-Datenbank

**Files:**
- Create: `packages/core/src/db/schema.ts`, `packages/core/src/db/client.ts`, `packages/core/drizzle.config.ts`, `packages/core/src/testing/test-db.ts`
- Generated: `packages/core/src/db/migrations/0000_*.sql` + `meta/`
- Test: `packages/core/tests/db.test.ts`

**Interfaces:**
- Produces:
  - Drizzle-Tabellen `users, sessions, apiTokens, roles, rolePermissions, userRoles, settings, auditLog, mediaAssets, documents` (Export `* as schema`).
  - `openDatabase(path): { db: Db; sqlite: Database }`, `runMigrations(db)`, Typen `Db`, `DbOrTx`.
  - `createTestDb(): { db: Db; sqlite: Database }` (In-Memory, migriert).

- [ ] **Step 1: Test schreiben**

`packages/core/tests/db.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/client';
import { sessions } from '../src/db/schema';
import { createTestDb } from '../src/testing/test-db';

describe('database', () => {
  it('applies migrations and creates all core tables', () => {
    const { sqlite } = createTestDb();
    const rows = sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name",
      )
      .all() as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual([
      'api_tokens',
      'audit_log',
      'documents',
      'media_assets',
      'role_permissions',
      'roles',
      'sessions',
      'settings',
      'user_roles',
      'users',
    ]);
  });

  it('enforces foreign keys', () => {
    const { db, sqlite } = createTestDb();
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(() =>
      db
        .insert(sessions)
        .values({ id: 'S1', userId: 'missing', createdAt: 'x', expiresAt: 'y' })
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it('runs migrations idempotently', () => {
    const { db } = createTestDb();
    expect(() => runMigrations(db)).not.toThrow();
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core test tests/db.test.ts`
Expected: FAIL — Module nicht gefunden.

- [ ] **Step 3: Schema schreiben**

`packages/core/src/db/schema.ts`:
```ts
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: text('locked_until'),
  lastLoginAt: text('last_login_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: text('created_at').notNull(),
    lastUsedAt: text('last_used_at'),
    revokedAt: text('revoked_at'),
  },
  (t) => [uniqueIndex('api_tokens_hash_idx').on(t.tokenHash), index('api_tokens_user_idx').on(t.userId)],
);

export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description').notNull().default(''),
  isProtected: integer('is_protected', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

export const rolePermissions = sqliteTable(
  'role_permissions',
  {
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id),
    permissionKey: text('permission_key').notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

export const userRoles = sqliteTable(
  'user_roles',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(), // JSON
  updatedAt: text('updated_at').notNull(),
  updatedByUserId: text('updated_by_user_id').references(() => users.id),
});

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    occurredAt: text('occurred_at').notNull(),
    userId: text('user_id').references(() => users.id),
    channel: text('channel', { enum: ['ui', 'mcp', 'system'] }).notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    before: text('before'), // JSON
    after: text('after'), // JSON
    summary: text('summary').notNull(),
    apiTokenId: text('api_token_id'),
    ipAddress: text('ip_address'),
    requestId: text('request_id').notNull(),
    environment: text('environment').notNull(),
  },
  (t) => [
    index('audit_occurred_idx').on(t.occurredAt),
    index('audit_entity_idx').on(t.entityType, t.entityId),
    index('audit_user_idx').on(t.userId),
  ],
);

export const mediaAssets = sqliteTable('media_assets', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull().unique(),
  mimeType: text('mime_type').notNull(),
  bytes: integer('bytes').notNull(),
  width: integer('width'),
  height: integer('height'),
  uploadedByUserId: text('uploaded_by_user_id').references(() => users.id),
  createdAt: text('created_at').notNull(),
});

export const documents = sqliteTable(
  'documents',
  {
    id: text('id').primaryKey(),
    templateKey: text('template_key').notNull(),
    number: text('number').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    inputSnapshot: text('input_snapshot').notNull(), // JSON
    assetId: text('asset_id')
      .notNull()
      .references(() => mediaAssets.id),
    status: text('status', { enum: ['issued', 'voided'] }).notNull().default('issued'),
    voidedAt: text('voided_at'),
    voidedByUserId: text('voided_by_user_id').references(() => users.id),
    voidReason: text('void_reason'),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('documents_number_idx').on(t.number)],
);
```

- [ ] **Step 4: Client und drizzle-Config schreiben**

`packages/core/drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
});
```

`packages/core/src/db/client.ts`:
```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function openDatabase(filePath: string): { db: Db; sqlite: Database.Database } {
  const sqlite = new Database(filePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
```

`packages/core/src/testing/test-db.ts`:
```ts
import type Database from 'better-sqlite3';
import { openDatabase, runMigrations, type Db } from '../db/client';

export function createTestDb(): { db: Db; sqlite: Database.Database } {
  const { db, sqlite } = openDatabase(':memory:');
  runMigrations(db);
  return { db, sqlite };
}
```

- [ ] **Step 5: Migration erzeugen**

Run: `pnpm --filter @kompass/core db:generate --name init`
Expected: `packages/core/src/db/migrations/0000_init.sql` und `meta/_journal.json`, `meta/0000_snapshot.json` entstehen. Die SQL-Datei kurz lesen: zehn `CREATE TABLE`, Indizes, `PRAGMA`-frei.

- [ ] **Step 6: Tests ausführen**

Run: `pnpm --filter @kompass/core test tests/db.test.ts`
Expected: 3 passed.

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): core schema, sqlite client with migrations, in-memory test db"
```

---

### Task 4: CallContext, Rechte-Registry, Modul-Manifest, Validierung, Test-Deps

**Files:**
- Create: `packages/core/src/context.ts`, `packages/core/src/deps.ts`, `packages/core/src/validate.ts`
- Create: `packages/core/src/permissions/core.ts`, `packages/core/src/permissions/check.ts`
- Create: `packages/core/src/modules/manifest.ts`, `packages/core/src/modules/registry.ts`, `packages/core/src/core-module.ts`
- Create: `packages/core/src/testing/index.ts`
- Test: `packages/core/tests/permissions.test.ts`, `packages/core/tests/registry.test.ts`, `packages/core/tests/validate.test.ts`

**Interfaces:**
- Consumes: `Result`-Konstruktoren (Task 2), `createTestDb` (Task 3).
- Produces:
  - `type Channel = 'ui' | 'mcp' | 'system'`; `interface CallContext { userId: string | null; permissions: ReadonlySet<string>; channel: Channel; apiTokenId: string | null; ipAddress: string | null; requestId: string }`; `systemContext(requestId?)`.
  - `type AppEnv = 'development' | 'test' | 'production'`; `interface Deps { db: Db; clock: Clock; env: AppEnv; registry: Registry }`.
  - `validate<T>(schema, input): Result<T>`.
  - `CORE_PERMISSIONS` (readonly Tuple der 10 Kern-Keys), `hasPermission(ctx, key)`, `requirePermission(ctx, key): Failure | null`, `requireAnyPermission(ctx, keys): Failure | null`.
  - `interface ModuleManifest { key; version; permissions; settings?; navigation?; dependsOn?; publishedViews? }`, `defineModule(manifest)`, `interface SettingDefinition<T> { key; schema; default; systemOnly? }`.
  - `interface Registry { manifests; permissionKeys: ReadonlySet<string>; settingDefinitions: ReadonlyMap<string, SettingDefinition>; module(key) }`, `createRegistry(manifests)`.
  - `coreModule: ModuleManifest` (Settings kommen in Task 6 dazu).
  - Testing: `createTestDeps(opts?)`, `ctxWith(permissions, userId?)`, `TEST_NOW`.

- [ ] **Step 1: Tests schreiben**

`packages/core/tests/permissions.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { systemContext } from '../src/context';
import { CORE_PERMISSIONS } from '../src/permissions/core';
import { hasPermission, requireAnyPermission, requirePermission } from '../src/permissions/check';
import { ctxWith } from '../src/testing';

describe('permissions', () => {
  it('defines the ten core permission keys', () => {
    expect([...CORE_PERMISSIONS].sort()).toEqual([
      'audit.view',
      'backup.export',
      'backup.import',
      'documents.create',
      'documents.view',
      'media.upload',
      'modules.manage',
      'roles.manage',
      'settings.manage',
      'users.manage',
    ]);
  });

  it('requirePermission returns null when granted and forbidden otherwise', () => {
    const ctx = ctxWith(['users.manage']);
    expect(hasPermission(ctx, 'users.manage')).toBe(true);
    expect(requirePermission(ctx, 'users.manage')).toBeNull();
    expect(requirePermission(ctx, 'roles.manage')).toEqual({
      ok: false,
      error: { type: 'forbidden', permission: 'roles.manage' },
    });
  });

  it('requireAnyPermission accepts one of several keys', () => {
    const ctx = ctxWith(['users.manage']);
    expect(requireAnyPermission(ctx, ['roles.manage', 'users.manage'])).toBeNull();
    expect(requireAnyPermission(ctx, ['roles.manage', 'audit.view'])?.error).toEqual({
      type: 'forbidden',
      permission: 'roles.manage',
    });
  });

  it('systemContext has no user and no permissions', () => {
    const ctx = systemContext('req-1');
    expect(ctx.userId).toBeNull();
    expect(ctx.channel).toBe('system');
    expect(ctx.permissions.size).toBe(0);
    expect(ctx.requestId).toBe('req-1');
  });
});
```

`packages/core/tests/registry.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { coreModule } from '../src/core-module';
import { defineModule } from '../src/modules/manifest';
import { createRegistry } from '../src/modules/registry';

const finance = defineModule({
  key: 'finance',
  version: '0.0.1',
  permissions: ['finance.view', 'finance.edit'],
  settings: [{ key: 'finance.reserveCapPercent', schema: z.number().min(0).max(100), default: 3 }],
});

describe('module registry', () => {
  it('collects permissions and settings from all manifests', () => {
    const registry = createRegistry([coreModule, finance]);
    expect(registry.permissionKeys.has('users.manage')).toBe(true);
    expect(registry.permissionKeys.has('finance.edit')).toBe(true);
    expect(registry.settingDefinitions.get('finance.reserveCapPercent')?.default).toBe(3);
    expect(registry.module('finance')?.version).toBe('0.0.1');
    expect(registry.module('nope')).toBeUndefined();
  });

  it('rejects duplicate module keys and duplicate permission keys', () => {
    expect(() => createRegistry([coreModule, coreModule])).toThrow(/duplicate module/);
    const clash = defineModule({ key: 'other', version: '1', permissions: ['users.manage'] });
    expect(() => createRegistry([coreModule, clash])).toThrow(/duplicate permission/);
  });

  it('defineModule validates key and permission formats', () => {
    expect(() => defineModule({ key: 'Bad Key', version: '1', permissions: [] })).toThrow(/module key/);
    expect(() => defineModule({ key: 'x', version: '1', permissions: ['nodot'] })).toThrow(/permission key/);
  });
});
```

`packages/core/tests/validate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validate } from '../src/validate';

describe('validate', () => {
  const schema = z.object({ name: z.string().min(1), age: z.number().int() });

  it('returns ok with parsed data', () => {
    expect(validate(schema, { name: 'A', age: 3 })).toEqual({ ok: true, value: { name: 'A', age: 3 } });
  });

  it('maps zod issues to path/message pairs', () => {
    const result = validate(schema, { name: '', age: 1.5 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('validation');
    if (result.error.type !== 'validation') return;
    expect(result.error.issues.map((i) => i.path)).toEqual(['name', 'age']);
  });
});
```

- [ ] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core test`
Expected: FAIL — Module `../src/context`, `../src/testing` usw. nicht gefunden.

- [ ] **Step 3: Implementieren**

`packages/core/src/context.ts`:
```ts
import { newId } from './ids';

export type Channel = 'ui' | 'mcp' | 'system';

export interface CallContext {
  userId: string | null;
  permissions: ReadonlySet<string>;
  channel: Channel;
  apiTokenId: string | null;
  ipAddress: string | null;
  requestId: string;
}

export function systemContext(requestId: string = newId()): CallContext {
  return {
    userId: null,
    permissions: new Set(),
    channel: 'system',
    apiTokenId: null,
    ipAddress: null,
    requestId,
  };
}
```

`packages/core/src/deps.ts`:
```ts
import type { Clock } from './clock';
import type { Db } from './db/client';
import type { Registry } from './modules/registry';

export type AppEnv = 'development' | 'test' | 'production';

export interface Deps {
  db: Db;
  clock: Clock;
  env: AppEnv;
  registry: Registry;
}
```

`packages/core/src/validate.ts`:
```ts
import type { z } from 'zod';
import { invalid, ok, type Result } from './result';

export function validate<T>(schema: z.ZodType<T>, input: unknown): Result<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return ok(parsed.data);
  return invalid(
    parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  );
}
```

`packages/core/src/permissions/core.ts`:
```ts
export const CORE_PERMISSIONS = [
  'users.manage',
  'roles.manage',
  'settings.manage',
  'modules.manage',
  'audit.view',
  'documents.create',
  'documents.view',
  'media.upload',
  'backup.export',
  'backup.import',
] as const;

export type CorePermission = (typeof CORE_PERMISSIONS)[number];
```

`packages/core/src/permissions/check.ts`:
```ts
import type { CallContext } from '../context';
import { forbidden, type Failure } from '../result';

export function hasPermission(ctx: CallContext, key: string): boolean {
  return ctx.permissions.has(key);
}

export function requirePermission(ctx: CallContext, key: string): Failure | null {
  return hasPermission(ctx, key) ? null : forbidden(key);
}

/** Erlaubt, wenn mindestens einer der Keys vorhanden ist; meldet sonst den ersten Key. */
export function requireAnyPermission(ctx: CallContext, keys: readonly string[]): Failure | null {
  if (keys.some((key) => hasPermission(ctx, key))) return null;
  return forbidden(keys[0] ?? '');
}
```

`packages/core/src/modules/manifest.ts`:
```ts
import type { z } from 'zod';
import type { Deps } from '../deps';

export interface SettingDefinition<T = unknown> {
  key: string;
  schema: z.ZodType<T>;
  default: T;
  /** Nur vom System schreibbar (Import, Export); im Admin lesbar, nicht editierbar. */
  systemOnly?: boolean;
}

export interface NavigationItem {
  key: string;
  href: string;
  icon: string;
  /** Gruppen-Key; ohne Gruppe erscheint der Eintrag ungruppiert oben. */
  group?: string;
  /** Recht, das zum Anzeigen nötig ist. */
  permission?: string;
}

export interface PublishedView<T = unknown> {
  name: string;
  schema: z.ZodType<T>;
  load(deps: Deps): T[];
}

export interface ModuleManifest {
  key: string;
  version: string;
  permissions: readonly string[];
  settings?: readonly SettingDefinition[];
  navigation?: readonly NavigationItem[];
  dependsOn?: readonly string[];
  publishedViews?: readonly PublishedView[];
}

const MODULE_KEY = /^[a-z][a-z0-9-]*$/;
const PERMISSION_KEY = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;

export function defineModule(manifest: ModuleManifest): ModuleManifest {
  if (!MODULE_KEY.test(manifest.key)) throw new Error(`invalid module key: ${manifest.key}`);
  for (const key of manifest.permissions) {
    if (!PERMISSION_KEY.test(key)) throw new Error(`invalid permission key: ${key}`);
  }
  return manifest;
}
```

`packages/core/src/modules/registry.ts`:
```ts
import type { ModuleManifest, SettingDefinition } from './manifest';

export interface Registry {
  manifests: readonly ModuleManifest[];
  permissionKeys: ReadonlySet<string>;
  settingDefinitions: ReadonlyMap<string, SettingDefinition>;
  module(key: string): ModuleManifest | undefined;
}

export function createRegistry(manifests: readonly ModuleManifest[]): Registry {
  const byKey = new Map<string, ModuleManifest>();
  const permissionKeys = new Set<string>();
  const settingDefinitions = new Map<string, SettingDefinition>();

  for (const manifest of manifests) {
    if (byKey.has(manifest.key)) throw new Error(`duplicate module key: ${manifest.key}`);
    byKey.set(manifest.key, manifest);
    for (const key of manifest.permissions) {
      if (permissionKeys.has(key)) throw new Error(`duplicate permission key: ${key}`);
      permissionKeys.add(key);
    }
    for (const setting of manifest.settings ?? []) {
      if (settingDefinitions.has(setting.key)) throw new Error(`duplicate setting key: ${setting.key}`);
      settingDefinitions.set(setting.key, setting);
    }
  }

  return {
    manifests,
    permissionKeys,
    settingDefinitions,
    module: (key) => byKey.get(key),
  };
}
```

`packages/core/src/core-module.ts`:
```ts
import { defineModule } from './modules/manifest';
import { CORE_PERMISSIONS } from './permissions/core';

export const coreModule = defineModule({
  key: 'core',
  version: '0.1.0',
  permissions: CORE_PERMISSIONS,
});
```

`packages/core/src/testing/index.ts`:
```ts
import type Database from 'better-sqlite3';
import { fixedClock, type FixedClock } from '../clock';
import type { CallContext } from '../context';
import { coreModule } from '../core-module';
import type { AppEnv, Deps } from '../deps';
import type { ModuleManifest } from '../modules/manifest';
import { createRegistry } from '../modules/registry';
import { createTestDb } from './test-db';

export { systemContext } from '../context';

export const TEST_NOW = '2026-09-05T08:00:00.000Z';

export interface TestDeps extends Deps {
  clock: FixedClock;
  sqlite: Database.Database;
}

export function createTestDeps(
  opts: { now?: string; manifests?: ModuleManifest[]; env?: AppEnv } = {},
): TestDeps {
  const { db, sqlite } = createTestDb();
  return {
    db,
    sqlite,
    clock: fixedClock(opts.now ?? TEST_NOW),
    env: opts.env ?? 'test',
    registry: createRegistry(opts.manifests ?? [coreModule]),
  };
}

export function ctxWith(permissions: readonly string[], userId: string | null = 'USER-TEST'): CallContext {
  return {
    userId,
    permissions: new Set(permissions),
    channel: 'ui',
    apiTokenId: null,
    ipAddress: '127.0.0.1',
    requestId: 'REQ-TEST',
  };
}
```

- [ ] **Step 4: Tests ausführen**

Run: `pnpm --filter @kompass/core test && pnpm --filter @kompass/core typecheck`
Expected: alle grün, keine Typfehler.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): call context, permission checks, module manifest and registry"
```

---

### Task 5: Änderungsprotokoll (recordAudit) und Unveränderbarkeit

**Files:**
- Create: `packages/core/src/audit/log.ts`
- Generated: `packages/core/src/db/migrations/0001_audit_log_immutable.sql` (custom)
- Test: `packages/core/tests/audit-log.test.ts`

**Interfaces:**
- Consumes: `CallContext`, `Deps`, `newId`, `isoNow`, Tabelle `auditLog`.
- Produces: `interface AuditInput { action: string; entityType: string; entityId: string | null; before?: unknown; after?: unknown; summary: string }`; `recordAudit(tx: DbOrTx, deps: Pick<Deps, 'clock' | 'env'>, ctx: CallContext, input: AuditInput): string` (gibt die Eintrags-ID zurück).

- [ ] **Step 1: Test schreiben**

`packages/core/tests/audit-log.test.ts`:
```ts
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { recordAudit } from '../src/audit/log';
import { auditLog } from '../src/db/schema';
import { createTestDeps, ctxWith, systemContext } from '../src/testing';

describe('recordAudit', () => {
  it('writes user, channel, request metadata, environment and JSON payloads', () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['settings.manage']);
    const id = recordAudit(deps.db, deps, ctx, {
      action: 'settings.update',
      entityType: 'setting',
      entityId: 'organization.name',
      before: 'Alt',
      after: 'Neu',
      summary: 'organization.name geändert',
    });
    const row = deps.db.select().from(auditLog).where(eq(auditLog.id, id)).get();
    expect(row).toMatchObject({
      occurredAt: '2026-09-05T08:00:00.000Z',
      userId: 'USER-TEST',
      channel: 'ui',
      action: 'settings.update',
      entityType: 'setting',
      entityId: 'organization.name',
      before: '"Alt"',
      after: '"Neu"',
      ipAddress: '127.0.0.1',
      requestId: 'REQ-TEST',
      environment: 'test',
      apiTokenId: null,
    });
  });

  it('stores system entries without a user and omits absent payloads', () => {
    const deps = createTestDeps();
    const id = recordAudit(deps.db, deps, systemContext('REQ-SYS'), {
      action: 'auth.locked',
      entityType: 'user',
      entityId: 'U1',
      summary: 'Konto gesperrt',
    });
    const row = deps.db.select().from(auditLog).where(eq(auditLog.id, id)).get();
    expect(row?.userId).toBeNull();
    expect(row?.channel).toBe('system');
    expect(row?.before).toBeNull();
    expect(row?.after).toBeNull();
  });

  it('rejects UPDATE and DELETE on audit_log at the database level', () => {
    const deps = createTestDeps();
    recordAudit(deps.db, deps, ctxWith([]), {
      action: 'x',
      entityType: 'y',
      entityId: null,
      summary: 's',
    });
    expect(() => deps.sqlite.prepare("update audit_log set summary = 'hacked'").run()).toThrow(/immutable/);
    expect(() => deps.sqlite.prepare('delete from audit_log').run()).toThrow(/immutable/);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core test tests/audit-log.test.ts`
Expected: FAIL — `../src/audit/log` nicht gefunden.

- [ ] **Step 3: recordAudit implementieren**

`packages/core/src/audit/log.ts`:
```ts
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import { auditLog } from '../db/schema';
import type { Deps } from '../deps';
import { newId } from '../ids';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  summary: string;
}

const toJson = (value: unknown): string | null => (value === undefined ? null : JSON.stringify(value));

export function recordAudit(
  tx: DbOrTx,
  deps: Pick<Deps, 'clock' | 'env'>,
  ctx: CallContext,
  input: AuditInput,
): string {
  const id = newId();
  tx.insert(auditLog)
    .values({
      id,
      occurredAt: isoNow(deps.clock),
      userId: ctx.userId,
      channel: ctx.channel,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: toJson(input.before),
      after: toJson(input.after),
      summary: input.summary,
      apiTokenId: ctx.apiTokenId,
      ipAddress: ctx.ipAddress,
      requestId: ctx.requestId,
      environment: deps.env,
    })
    .run();
  return id;
}
```

- [ ] **Step 4: Trigger-Migration anlegen**

Run: `pnpm --filter @kompass/core db:generate --custom --name audit_log_immutable`
Expected: leere Datei `packages/core/src/db/migrations/0001_audit_log_immutable.sql` plus Journal-Eintrag.

Inhalt der Datei setzen:
```sql
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is immutable');
END;
```

- [ ] **Step 5: Tests ausführen**

Run: `pnpm --filter @kompass/core test`
Expected: alle grün (auch `db.test.ts`, da Trigger keine Tabelle ist).

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): append-only audit log with immutability triggers"
```

---

### Task 6: Einstellungen — Registry-Definitionen und Service

**Files:**
- Create: `packages/core/src/settings/core.ts`, `packages/core/src/settings/service.ts`
- Modify: `packages/core/src/core-module.ts` (Settings einhängen)
- Test: `packages/core/tests/settings.test.ts`

**Interfaces:**
- Consumes: `Registry.settingDefinitions`, `recordAudit`, `requirePermission`, `validate`.
- Produces:
  - `CORE_SETTINGS: SettingDefinition[]` mit den Keys `organization.name|legalForm|street|postalCode|city|country|registerCourt|registerNumber|taxNumber|taxOffice|exemptionNoticeType|exemptionNoticeDate|statutoryPurpose|email|website|phone|iban|bic|bankName`, `branding.logoAssetId|fontBody|fontHeading|activeTheme`, `modules.enabled`, `system.lastImportAt|lastImportSource|lastExportAt` (systemOnly). (`themes` kommt in Task 12.)
  - `readSetting<T>(deps, key): T` (wirft bei unbekanntem Key), `readAllSettings(deps): Record<string, unknown>`.
  - `setSetting(deps, ctx, input: { key: string; value: unknown }): Promise<Result<{ key: string; value: unknown }>>`.
  - `writeSettingInternal(tx, deps, ctx, key, value, action?)` — ohne Rechteprüfung, für Setup/Import/Theme-Service; validiert und protokolliert trotzdem.

- [ ] **Step 1: Test schreiben**

`packages/core/tests/settings.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { auditLog } from '../src/db/schema';
import { readAllSettings, readSetting, setSetting } from '../src/settings/service';
import { createTestDeps, ctxWith } from '../src/testing';

describe('settings service', () => {
  it('returns registered defaults when nothing is stored', () => {
    const deps = createTestDeps();
    expect(readSetting(deps, 'organization.country')).toBe('DE');
    expect(readSetting(deps, 'modules.enabled')).toEqual([]);
    expect(readAllSettings(deps)['branding.activeTheme']).toBe('default');
  });

  it('throws for unknown keys on read (programming error, not user error)', () => {
    const deps = createTestDeps();
    expect(() => readSetting(deps, 'nope.key')).toThrow(/unknown setting/);
  });

  it('stores a valid value and writes an audit entry with before/after', async () => {
    const deps = createTestDeps();
    const result = await setSetting(deps, ctxWith(['settings.manage']), {
      key: 'organization.name',
      value: 'Musterverein e.V.',
    });
    expect(result).toEqual({ ok: true, value: { key: 'organization.name', value: 'Musterverein e.V.' } });
    expect(readSetting(deps, 'organization.name')).toBe('Musterverein e.V.');
    const entries = deps.db.select().from(auditLog).all();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'settings.update',
      entityType: 'setting',
      entityId: 'organization.name',
      before: '"Neuer Verein"',
      after: '"Musterverein e.V."',
    });
  });

  it('rejects invalid values with field issues and stores nothing', async () => {
    const deps = createTestDeps();
    const result = await setSetting(deps, ctxWith(['settings.manage']), {
      key: 'organization.email',
      value: 'not-an-email',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('validation');
    expect(deps.db.select().from(auditLog).all()).toHaveLength(0);
  });

  it('rejects unknown keys as validation error and systemOnly keys as conflict', async () => {
    const deps = createTestDeps();
    const unknown = await setSetting(deps, ctxWith(['settings.manage']), { key: 'x.y', value: 1 });
    expect(unknown.ok === false && unknown.error.type === 'validation').toBe(true);
    const systemOnly = await setSetting(deps, ctxWith(['settings.manage']), {
      key: 'system.lastImportAt',
      value: '2026-01-01T00:00:00.000Z',
    });
    expect(systemOnly.ok === false && systemOnly.error.type === 'conflict' && systemOnly.error.code === 'settingSystemOnly').toBe(true);
  });

  it('requires settings.manage', async () => {
    const deps = createTestDeps();
    const result = await setSetting(deps, ctxWith(['users.manage']), { key: 'organization.name', value: 'X' });
    expect(result).toEqual({ ok: false, error: { type: 'forbidden', permission: 'settings.manage' } });
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core test tests/settings.test.ts`
Expected: FAIL — Module nicht gefunden.

- [ ] **Step 3: Definitionen schreiben**

`packages/core/src/settings/core.ts`:
```ts
import { z } from 'zod';
import type { SettingDefinition } from '../modules/manifest';

const shortText = z.string().trim().max(200);
const isoDateOrEmpty = z.union([z.literal(''), z.iso.date()]);

const organization: SettingDefinition[] = [
  { key: 'organization.name', schema: z.string().trim().min(1).max(200), default: 'Neuer Verein' },
  {
    key: 'organization.legalForm',
    schema: z.enum(['registeredAssociation', 'unregisteredAssociation']),
    default: 'registeredAssociation',
  },
  { key: 'organization.street', schema: shortText, default: '' },
  { key: 'organization.postalCode', schema: z.string().trim().max(10), default: '' },
  { key: 'organization.city', schema: shortText, default: '' },
  { key: 'organization.country', schema: z.string().trim().length(2).toUpperCase(), default: 'DE' },
  { key: 'organization.registerCourt', schema: shortText, default: '' },
  { key: 'organization.registerNumber', schema: shortText, default: '' },
  { key: 'organization.taxNumber', schema: shortText, default: '' },
  { key: 'organization.taxOffice', schema: shortText, default: '' },
  {
    key: 'organization.exemptionNoticeType',
    schema: z.enum(['none', 'exemptionNotice', 'corporateTaxNoticeAttachment', 'section60a']),
    default: 'none',
  },
  { key: 'organization.exemptionNoticeDate', schema: isoDateOrEmpty, default: '' },
  { key: 'organization.statutoryPurpose', schema: z.string().trim().max(500), default: '' },
  { key: 'organization.email', schema: z.union([z.literal(''), z.email()]), default: '' },
  { key: 'organization.website', schema: z.union([z.literal(''), z.url()]), default: '' },
  { key: 'organization.phone', schema: shortText, default: '' },
  { key: 'organization.iban', schema: z.string().trim().max(34), default: '' },
  { key: 'organization.bic', schema: z.string().trim().max(11), default: '' },
  { key: 'organization.bankName', schema: shortText, default: '' },
];

const branding: SettingDefinition[] = [
  { key: 'branding.logoAssetId', schema: z.string().nullable(), default: null },
  {
    key: 'branding.fontBody',
    schema: z.enum(['source-sans-3', 'public-sans', 'atkinson-hyperlegible']),
    default: 'source-sans-3',
  },
  { key: 'branding.fontHeading', schema: z.enum(['source-serif-4', 'same-as-body']), default: 'source-serif-4' },
  { key: 'branding.activeTheme', schema: z.string().min(1), default: 'default' },
];

const modules: SettingDefinition[] = [
  { key: 'modules.enabled', schema: z.array(z.string()), default: [] },
];

const system: SettingDefinition[] = [
  { key: 'system.lastImportAt', schema: z.string().nullable(), default: null, systemOnly: true },
  { key: 'system.lastImportSource', schema: z.string().nullable(), default: null, systemOnly: true },
  { key: 'system.lastExportAt', schema: z.string().nullable(), default: null, systemOnly: true },
];

export const CORE_SETTINGS: SettingDefinition[] = [...organization, ...branding, ...modules, ...system];
```

`packages/core/src/core-module.ts` anpassen:
```ts
import { defineModule } from './modules/manifest';
import { CORE_PERMISSIONS } from './permissions/core';
import { CORE_SETTINGS } from './settings/core';

export const coreModule = defineModule({
  key: 'core',
  version: '0.1.0',
  permissions: CORE_PERMISSIONS,
  settings: CORE_SETTINGS,
});
```

- [ ] **Step 4: Service schreiben**

`packages/core/src/settings/service.ts`:
```ts
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import { settings } from '../db/schema';
import type { Deps } from '../deps';
import type { SettingDefinition } from '../modules/manifest';
import { requirePermission } from '../permissions/check';
import { conflict, invalid, ok, type Result } from '../result';
import { validate } from '../validate';

function definitionOf(deps: Deps, key: string): SettingDefinition {
  const def = deps.registry.settingDefinitions.get(key);
  if (!def) throw new Error(`unknown setting: ${key}`);
  return def;
}

function readStored(db: DbOrTx, key: string): { found: true; value: unknown } | { found: false } {
  const row = db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get();
  return row ? { found: true, value: JSON.parse(row.value) } : { found: false };
}

export function readSetting<T = unknown>(deps: Deps, key: string): T {
  const def = definitionOf(deps, key);
  const stored = readStored(deps.db, key);
  return (stored.found ? stored.value : def.default) as T;
}

export function readAllSettings(deps: Deps): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of deps.registry.settingDefinitions.keys()) out[key] = readSetting(deps, key);
  return out;
}

/**
 * Schreibt ohne Rechteprüfung (für Setup, Import, Theme-Service), aber immer validiert
 * und protokolliert. Muss innerhalb einer Transaktion des Aufrufers laufen.
 */
export function writeSettingInternal(
  tx: DbOrTx,
  deps: Deps,
  ctx: CallContext,
  key: string,
  value: unknown,
  action: string = 'settings.update',
): Result<{ key: string; value: unknown }> {
  const def = definitionOf(deps, key);
  const parsed = validate(def.schema, value);
  if (!parsed.ok) return parsed;
  const previous = readStored(tx, key);
  const before = previous.found ? previous.value : def.default;
  tx.insert(settings)
    .values({ key, value: JSON.stringify(parsed.value), updatedAt: isoNow(deps.clock), updatedByUserId: ctx.userId })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: JSON.stringify(parsed.value), updatedAt: isoNow(deps.clock), updatedByUserId: ctx.userId },
    })
    .run();
  recordAudit(tx, deps, ctx, {
    action,
    entityType: 'setting',
    entityId: key,
    before,
    after: parsed.value,
    summary: `${key} geändert`,
  });
  return ok({ key, value: parsed.value });
}

const setSettingSchema = z.object({ key: z.string().min(1), value: z.unknown() });

export async function setSetting(
  deps: Deps,
  ctx: CallContext,
  input: unknown,
): Promise<Result<{ key: string; value: unknown }>> {
  const denied = requirePermission(ctx, 'settings.manage');
  if (denied) return denied;
  const parsed = validate(setSettingSchema, input);
  if (!parsed.ok) return parsed;
  const def = deps.registry.settingDefinitions.get(parsed.value.key);
  if (!def) return invalid([{ path: 'key', message: 'unknownSetting' }]);
  if (def.systemOnly) return conflict('settingSystemOnly', `${def.key} wird nur vom System gesetzt`);
  return deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctx, def.key, parsed.value.value));
}
```

- [ ] **Step 5: Tests ausführen**

Run: `pnpm --filter @kompass/core test && pnpm --filter @kompass/core typecheck`
Expected: alle grün. (Hinweis: Zod 4 kennt `z.email()`, `z.url()`, `z.iso.date()` als Top-Level-Funktionen.)

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): registered settings with validation, defaults and audited writes"
```

---

### Task 7: Passwörter — Hash, Regel, Startpasswort-Wortkette

**Files:**
- Create: `packages/core/src/auth/password.ts`, `packages/core/src/auth/wordlist.ts`
- Test: `packages/core/tests/password.test.ts`

**Interfaces:**
- Produces: `PASSWORD_MIN_LENGTH = 12`, `passwordSchema` (Zod), `hashPassword(plain): Promise<string>`, `verifyPassword(hash, plain): Promise<boolean>`, `generateStartPassword(random?: (maxExclusive: number) => number): string`, `START_PASSWORD_PATTERN`.

- [ ] **Step 1: Test schreiben**

`packages/core/tests/password.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  generateStartPassword,
  hashPassword,
  PASSWORD_MIN_LENGTH,
  passwordSchema,
  START_PASSWORD_PATTERN,
  verifyPassword,
} from '../src/auth/password';
import { WORDLIST } from '../src/auth/wordlist';

describe('password', () => {
  it('hashes with argon2id and verifies only the right password', async () => {
    const hash = await hashPassword('wiese-kanu-73-lampe');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'wiese-kanu-73-lampe')).toBe(true);
    expect(await verifyPassword(hash, 'wiese-kanu-73-lampf')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });

  it('enforces the 12-character minimum and nothing else', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(passwordSchema.safeParse('elf zeichen').success).toBe(false);
    expect(passwordSchema.safeParse('zwoelfzeichen').success).toBe(true);
    expect(passwordSchema.safeParse('nur kleinbuchstaben und leerzeichen').success).toBe(true);
  });

  it('generates speakable word chains that satisfy the policy', () => {
    for (let i = 0; i < 50; i += 1) {
      const pw = generateStartPassword();
      expect(pw).toMatch(START_PASSWORD_PATTERN);
      expect(pw.length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
      expect(passwordSchema.safeParse(pw).success).toBe(true);
    }
  });

  it('is deterministic given an injected random source', () => {
    const random = () => 0;
    expect(generateStartPassword(random)).toBe(`${WORDLIST[0]}-${WORDLIST[0]}-10-${WORDLIST[0]}`);
  });

  it('uses a wordlist of lowercase ascii words without umlauts', () => {
    expect(WORDLIST.length).toBeGreaterThanOrEqual(80);
    for (const word of WORDLIST) expect(word).toMatch(/^[a-z]{3,8}$/);
    expect(new Set(WORDLIST).size).toBe(WORDLIST.length);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core test tests/password.test.ts`
Expected: FAIL — Module nicht gefunden.

- [ ] **Step 3: Implementieren**

`packages/core/src/auth/wordlist.ts`:
```ts
/** Sprechbare deutsche Wörter ohne Umlaute/ß, 3–8 Buchstaben, für Startpasswörter. */
export const WORDLIST: readonly string[] = [
  'wiese', 'kanu', 'lampe', 'apfel', 'birne', 'wolke', 'fluss', 'berg', 'tal', 'sonne',
  'mond', 'stern', 'baum', 'blatt', 'wurzel', 'stein', 'sand', 'welle', 'segel', 'anker',
  'hafen', 'brot', 'honig', 'milch', 'kerze', 'fenster', 'garten', 'zaun', 'pfad', 'brief',
  'feder', 'tinte', 'buch', 'seite', 'tasse', 'teller', 'gabel', 'messer', 'topf', 'ofen',
  'tisch', 'stuhl', 'bank', 'regal', 'kiste', 'korb', 'leiter', 'hammer', 'nagel', 'draht',
  'seil', 'knoten', 'faden', 'nadel', 'knopf', 'mantel', 'schuh', 'hut', 'schal', 'mutze',
  'wagen', 'rad', 'reifen', 'motor', 'bahn', 'gleis', 'brucke', 'turm', 'burg', 'dorf',
  'stadt', 'markt', 'platz', 'strasse', 'ampel', 'laterne', 'bogen', 'pfeil', 'ziel', 'karte',
  'kompass', 'insel', 'kuste', 'meer', 'see', 'bach', 'quelle', 'regen', 'schnee', 'wind',
  'nebel', 'frost', 'sommer', 'winter', 'herbst', 'morgen', 'abend', 'nacht', 'woche', 'monat',
];
```

`packages/core/src/auth/password.ts`:
```ts
import { randomInt } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { z } from 'zod';
import { WORDLIST } from './wordlist';

export const PASSWORD_MIN_LENGTH = 12;

export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH, 'passwordTooShort').max(200, 'passwordTooLong');

const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}

export const START_PASSWORD_PATTERN = /^[a-z]{3,8}-[a-z]{3,8}-\d{2}-[a-z]{3,8}$/;

/** Wortkette wie `wiese-kanu-73-lampe`; `random(n)` liefert eine Ganzzahl in [0, n). */
export function generateStartPassword(random: (maxExclusive: number) => number = randomInt): string {
  const pick = () => WORDLIST[random(WORDLIST.length)] as string;
  for (;;) {
    const candidate = `${pick()}-${pick()}-${10 + random(90)}-${pick()}`;
    if (candidate.length >= PASSWORD_MIN_LENGTH) return candidate;
  }
}
```

- [ ] **Step 4: Tests ausführen**

Run: `pnpm --filter @kompass/core test tests/password.test.ts`
Expected: 5 passed. Falls `@node-rs/argon2` nicht lädt: `pnpm approve-builds` → freigeben → `pnpm install`.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): argon2id password hashing, policy and speakable start passwords"
```

---

### Task 8: Rollen-Service und effektive Rechte

**Files:**
- Create: `packages/core/src/roles/service.ts`, `packages/core/src/roles/effective.ts`
- Modify: `packages/core/src/testing/index.ts` (Helfer `insertUser`)
- Test: `packages/core/tests/roles.test.ts`

**Interfaces:**
- Consumes: `recordAudit`, `requirePermission`, `requireAnyPermission`, `validate`, `Registry.permissionKeys`.
- Produces:
  - `interface Role { id: string; name: string; description: string; isProtected: boolean; permissionKeys: string[]; userCount: number }`
  - `createRole(deps, ctx, { name, description? }) → Result<Role>`; `updateRole(deps, ctx, { id, name?, description? }) → Result<Role>`; `setRolePermissions(deps, ctx, { roleId, permissionKeys }) → Result<Role>`; `assignRole(deps, ctx, { userId, roleId }) → Result<void>`; `removeRole(deps, ctx, { userId, roleId }) → Result<void>`; `listRoles(deps, ctx) → Result<Role[]>`.
  - `getEffectivePermissions(dbOrTx, registry, userId): Set<string>`; `countActiveProtectedHolders(dbOrTx, { excludeUserId? }): number`.
  - Testing: `insertUser(deps, { id?, name?, email?, isActive?, passwordHash? }): string` und `insertRole(deps, { name, isProtected? }): string` (direkte Inserts für Tests; geschützte Rollen entstehen produktiv nur im Setup, Task 16).

- [ ] **Step 1: Test schreiben**

`packages/core/tests/roles.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { auditLog } from '../src/db/schema';
import { countActiveProtectedHolders, getEffectivePermissions } from '../src/roles/effective';
import { assignRole, createRole, listRoles, removeRole, setRolePermissions, updateRole } from '../src/roles/service';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith, insertRole, insertUser } from '../src/testing';

const admin = ctxWith(['roles.manage', 'users.manage']);

describe('roles service', () => {
  it('creates a role with no permissions and audits it', async () => {
    const deps = createTestDeps();
    const role = unwrap(await createRole(deps, admin, { name: 'Schatzmeisterin', description: 'Finanzen' }));
    expect(role).toMatchObject({ name: 'Schatzmeisterin', description: 'Finanzen', isProtected: false, permissionKeys: [], userCount: 0 });
    expect(deps.db.select().from(auditLog).all()[0]).toMatchObject({ action: 'roles.create', entityType: 'role', entityId: role.id });
  });

  it('rejects duplicate names, empty names and missing permission', async () => {
    const deps = createTestDeps();
    unwrap(await createRole(deps, admin, { name: 'Kassenprüfer' }));
    const dup = await createRole(deps, admin, { name: 'kassenprüfer ' });
    expect(dup.ok === false && dup.error.type === 'conflict' && dup.error.code === 'roleNameTaken').toBe(true);
    const empty = await createRole(deps, admin, { name: '  ' });
    expect(empty.ok === false && empty.error.type === 'validation').toBe(true);
    const denied = await createRole(deps, ctxWith(['users.manage']), { name: 'X' });
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
  });

  it('sets permissions, rejects unknown keys, audits before/after', async () => {
    const deps = createTestDeps();
    const role = unwrap(await createRole(deps, admin, { name: 'Kassenprüfer' }));
    const updated = unwrap(await setRolePermissions(deps, admin, { roleId: role.id, permissionKeys: ['documents.view', 'audit.view'] }));
    expect(updated.permissionKeys).toEqual(['audit.view', 'documents.view']);
    const bad = await setRolePermissions(deps, admin, { roleId: role.id, permissionKeys: ['finance.magic'] });
    expect(bad.ok === false && bad.error.type === 'validation' && bad.error.issues[0]?.path === 'permissionKeys.0').toBe(true);
    const entries = deps.db.select().from(auditLog).all();
    expect(entries.at(-1)).toMatchObject({ action: 'roles.setPermissions', before: '[]', after: '["audit.view","documents.view"]' });
  });

  it('protected roles cannot be edited or re-permissioned', async () => {
    const deps = createTestDeps();
    const roleId = insertRole(deps, { name: 'Administration', isProtected: true });
    const role = unwrap(await listRoles(deps, admin)).find((r) => r.id === roleId)!;
    expect(role.isProtected).toBe(true);
    const edit = await updateRole(deps, admin, { id: role.id, name: 'Admin' });
    expect(edit.ok === false && edit.error.type === 'conflict' && edit.error.code === 'roleProtected').toBe(true);
    const perms = await setRolePermissions(deps, admin, { roleId: role.id, permissionKeys: [] });
    expect(perms.ok === false && perms.error.type === 'conflict').toBe(true);
  });

  it('assigns and removes roles; effective permissions are the union, protected means all', async () => {
    const deps = createTestDeps();
    const userId = insertUser(deps, { email: 'mira@example.org' });
    const a = unwrap(await createRole(deps, admin, { name: 'A' }));
    const b = unwrap(await createRole(deps, admin, { name: 'B' }));
    unwrap(await setRolePermissions(deps, admin, { roleId: a.id, permissionKeys: ['audit.view'] }));
    unwrap(await setRolePermissions(deps, admin, { roleId: b.id, permissionKeys: ['documents.view'] }));
    unwrap(await assignRole(deps, admin, { userId, roleId: a.id }));
    unwrap(await assignRole(deps, admin, { userId, roleId: b.id }));
    expect([...getEffectivePermissions(deps.db, deps.registry, userId)].sort()).toEqual(['audit.view', 'documents.view']);
    unwrap(await removeRole(deps, admin, { userId, roleId: b.id }));
    expect([...getEffectivePermissions(deps.db, deps.registry, userId)]).toEqual(['audit.view']);

    const adminRoleId = insertRole(deps, { name: 'Administration', isProtected: true });
    unwrap(await assignRole(deps, admin, { userId, roleId: adminRoleId }));
    expect(getEffectivePermissions(deps.db, deps.registry, userId).size).toBe(deps.registry.permissionKeys.size);
    expect(countActiveProtectedHolders(deps.db)).toBe(1);
  });

  it('refuses to remove the protected role from its last active holder', async () => {
    const deps = createTestDeps();
    const only = insertUser(deps, { email: 'anna@example.org' });
    const adminRoleId = insertRole(deps, { name: 'Administration', isProtected: true });
    unwrap(await assignRole(deps, admin, { userId: only, roleId: adminRoleId }));
    const result = await removeRole(deps, admin, { userId: only, roleId: adminRoleId });
    expect(result.ok === false && result.error.type === 'conflict' && result.error.code === 'lastAdministrator').toBe(true);
    const second = insertUser(deps, { email: 'jonas@example.org' });
    unwrap(await assignRole(deps, admin, { userId: second, roleId: adminRoleId }));
    expect((await removeRole(deps, admin, { userId: only, roleId: adminRoleId })).ok).toBe(true);
  });

  it('lists roles with permission keys and user counts for users.manage or roles.manage', async () => {
    const deps = createTestDeps();
    const userId = insertUser(deps, {});
    const role = unwrap(await createRole(deps, admin, { name: 'A' }));
    unwrap(await assignRole(deps, admin, { userId, roleId: role.id }));
    const list = unwrap(await listRoles(deps, ctxWith(['users.manage'])));
    expect(list).toEqual([expect.objectContaining({ name: 'A', userCount: 1 })]);
    expect((await listRoles(deps, ctxWith(['audit.view']))).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core test tests/roles.test.ts`
Expected: FAIL — Module nicht gefunden / `insertUser` fehlt.

- [ ] **Step 3: Test-Helfer ergänzen**

In `packages/core/src/testing/index.ts` anhängen:
```ts
import { roles, users } from '../db/schema';
import { newId } from '../ids';

export function insertRole(deps: Deps, overrides: { name: string; isProtected?: boolean }): string {
  const id = newId();
  deps.db
    .insert(roles)
    .values({ id, name: overrides.name, description: '', isProtected: overrides.isProtected ?? false, createdAt: TEST_NOW })
    .run();
  return id;
}

export function insertUser(
  deps: Deps,
  overrides: { id?: string; name?: string; email?: string; isActive?: boolean; passwordHash?: string },
): string {
  const id = overrides.id ?? newId();
  deps.db
    .insert(users)
    .values({
      id,
      name: overrides.name ?? 'Test Person',
      email: overrides.email ?? `${id.toLowerCase()}@example.org`,
      passwordHash: overrides.passwordHash ?? '$argon2id$placeholder',
      isActive: overrides.isActive ?? true,
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
    })
    .run();
  return id;
}
```
(Imports oben in der Datei einsortieren, nicht mitten in der Datei.)

- [ ] **Step 4: Effektive Rechte implementieren**

`packages/core/src/roles/effective.ts`:
```ts
import { and, eq, ne, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { rolePermissions, roles, userRoles, users } from '../db/schema';
import type { Registry } from '../modules/registry';

export function getEffectivePermissions(db: DbOrTx, registry: Registry, userId: string): Set<string> {
  const held = db
    .select({ roleId: roles.id, isProtected: roles.isProtected })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId))
    .all();
  if (held.some((r) => r.isProtected)) return new Set(registry.permissionKeys);
  const result = new Set<string>();
  for (const { roleId } of held) {
    const keys = db
      .select({ key: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId))
      .all();
    for (const { key } of keys) if (registry.permissionKeys.has(key)) result.add(key);
  }
  return result;
}

export function countActiveProtectedHolders(db: DbOrTx, opts: { excludeUserId?: string } = {}): number {
  const conditions = [eq(roles.isProtected, true), eq(users.isActive, true)];
  if (opts.excludeUserId) conditions.push(ne(users.id, opts.excludeUserId));
  const row = db
    .select({ count: sql<number>`count(distinct ${users.id})` })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(...conditions))
    .get();
  return row?.count ?? 0;
}
```

- [ ] **Step 5: Rollen-Service implementieren**

`packages/core/src/roles/service.ts`:
```ts
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import { rolePermissions, roles, userRoles, users } from '../db/schema';
import type { Deps } from '../deps';
import { newId } from '../ids';
import { requireAnyPermission, requirePermission } from '../permissions/check';
import { conflict, invalid, notFound, ok, type Result } from '../result';
import { validate } from '../validate';
import { countActiveProtectedHolders } from './effective';

export interface Role {
  id: string;
  name: string;
  description: string;
  isProtected: boolean;
  permissionKeys: string[];
  userCount: number;
}

function loadRole(db: DbOrTx, id: string): Role | null {
  const row = db.select().from(roles).where(eq(roles.id, id)).get();
  if (!row) return null;
  const keys = db
    .select({ key: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, id))
    .all()
    .map((r) => r.key)
    .sort();
  const count = db
    .select({ count: sql<number>`count(*)` })
    .from(userRoles)
    .where(eq(userRoles.roleId, id))
    .get();
  return { id: row.id, name: row.name, description: row.description, isProtected: row.isProtected, permissionKeys: keys, userCount: count?.count ?? 0 };
}

const nameSchema = z.string().trim().min(1).max(80);
/** Geschützte Rollen entstehen nur im Setup (direktes Insert), nie über diese API. */
const createRoleSchema = z.object({
  name: nameSchema,
  description: z.string().trim().max(300).default(''),
});

function nameTaken(db: DbOrTx, name: string, exceptId?: string): boolean {
  const row = db
    .select({ id: roles.id })
    .from(roles)
    .where(sql`lower(${roles.name}) = lower(${name})`)
    .get();
  return !!row && row.id !== exceptId;
}

export async function createRole(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<Role>> {
  const denied = requirePermission(ctx, 'roles.manage');
  if (denied) return denied;
  const parsed = validate(createRoleSchema, input);
  if (!parsed.ok) return parsed;
  const { name, description } = parsed.value;
  if (nameTaken(deps.db, name)) return conflict('roleNameTaken', `Rolle „${name}" existiert bereits`);
  return deps.db.transaction((tx) => {
    const id = newId();
    tx.insert(roles).values({ id, name, description, isProtected: false, createdAt: isoNow(deps.clock) }).run();
    const role = loadRole(tx, id) as Role;
    recordAudit(tx, deps, ctx, { action: 'roles.create', entityType: 'role', entityId: id, after: role, summary: `Rolle „${name}" angelegt` });
    return ok(role);
  });
}

const updateRoleSchema = z.object({ id: z.string().min(1), name: nameSchema.optional(), description: z.string().trim().max(300).optional() });

export async function updateRole(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<Role>> {
  const denied = requirePermission(ctx, 'roles.manage');
  if (denied) return denied;
  const parsed = validate(updateRoleSchema, input);
  if (!parsed.ok) return parsed;
  const before = loadRole(deps.db, parsed.value.id);
  if (!before) return notFound('role', parsed.value.id);
  if (before.isProtected) return conflict('roleProtected', 'Geschützte Rolle kann nicht geändert werden');
  const name = parsed.value.name ?? before.name;
  if (nameTaken(deps.db, name, before.id)) return conflict('roleNameTaken', `Rolle „${name}" existiert bereits`);
  return deps.db.transaction((tx) => {
    tx.update(roles).set({ name, description: parsed.value.description ?? before.description }).where(eq(roles.id, before.id)).run();
    const after = loadRole(tx, before.id) as Role;
    recordAudit(tx, deps, ctx, { action: 'roles.update', entityType: 'role', entityId: before.id, before, after, summary: `Rolle „${after.name}" geändert` });
    return ok(after);
  });
}

const setPermissionsSchema = z.object({ roleId: z.string().min(1), permissionKeys: z.array(z.string()) });

export async function setRolePermissions(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<Role>> {
  const denied = requirePermission(ctx, 'roles.manage');
  if (denied) return denied;
  const parsed = validate(setPermissionsSchema, input);
  if (!parsed.ok) return parsed;
  const unknown = parsed.value.permissionKeys
    .map((key, index) => ({ key, index }))
    .filter(({ key }) => !deps.registry.permissionKeys.has(key));
  if (unknown.length > 0) return invalid(unknown.map(({ index }) => ({ path: `permissionKeys.${index}`, message: 'unknownPermission' })));
  const before = loadRole(deps.db, parsed.value.roleId);
  if (!before) return notFound('role', parsed.value.roleId);
  if (before.isProtected) return conflict('roleProtected', 'Geschützte Rolle hat immer alle Rechte');
  const next = [...new Set(parsed.value.permissionKeys)].sort();
  return deps.db.transaction((tx) => {
    tx.delete(rolePermissions).where(eq(rolePermissions.roleId, before.id)).run();
    if (next.length > 0) tx.insert(rolePermissions).values(next.map((permissionKey) => ({ roleId: before.id, permissionKey }))).run();
    const after = loadRole(tx, before.id) as Role;
    recordAudit(tx, deps, ctx, { action: 'roles.setPermissions', entityType: 'role', entityId: before.id, before: before.permissionKeys, after: next, summary: `Rechte der Rolle „${before.name}" geändert` });
    return ok(after);
  });
}

const assignmentSchema = z.object({ userId: z.string().min(1), roleId: z.string().min(1) });

export async function assignRole(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<void>> {
  const denied = requirePermission(ctx, 'users.manage');
  if (denied) return denied;
  const parsed = validate(assignmentSchema, input);
  if (!parsed.ok) return parsed;
  const { userId, roleId } = parsed.value;
  const user = deps.db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, userId)).get();
  if (!user) return notFound('user', userId);
  const role = loadRole(deps.db, roleId);
  if (!role) return notFound('role', roleId);
  return deps.db.transaction((tx) => {
    tx.insert(userRoles).values({ userId, roleId }).onConflictDoNothing().run();
    recordAudit(tx, deps, ctx, { action: 'users.assignRole', entityType: 'user', entityId: userId, after: { roleId, roleName: role.name }, summary: `Rolle „${role.name}" an ${user.name} vergeben` });
    return ok(undefined);
  });
}

export async function removeRole(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<void>> {
  const denied = requirePermission(ctx, 'users.manage');
  if (denied) return denied;
  const parsed = validate(assignmentSchema, input);
  if (!parsed.ok) return parsed;
  const { userId, roleId } = parsed.value;
  const user = deps.db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, userId)).get();
  if (!user) return notFound('user', userId);
  const role = loadRole(deps.db, roleId);
  if (!role) return notFound('role', roleId);
  if (role.isProtected && countActiveProtectedHolders(deps.db, { excludeUserId: userId }) === 0) {
    return conflict('lastAdministrator', 'Mindestens ein aktiver Nutzer muss die geschützte Rolle behalten');
  }
  return deps.db.transaction((tx) => {
    tx.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId))).run();
    recordAudit(tx, deps, ctx, { action: 'users.removeRole', entityType: 'user', entityId: userId, before: { roleId, roleName: role.name }, summary: `Rolle „${role.name}" von ${user.name} entfernt` });
    return ok(undefined);
  });
}

export async function listRoles(deps: Deps, ctx: CallContext): Promise<Result<Role[]>> {
  const denied = requireAnyPermission(ctx, ['roles.manage', 'users.manage']);
  if (denied) return denied;
  const ids = deps.db.select({ id: roles.id }).from(roles).orderBy(roles.name).all();
  return ok(ids.map(({ id }) => loadRole(deps.db, id) as Role));
}
```

- [ ] **Step 6: Tests ausführen**

Run: `pnpm --filter @kompass/core test && pnpm --filter @kompass/core typecheck`
Expected: alle grün.

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): roles with permission sets, protected admin role, effective permissions"
```

---

### Task 9: Nutzer-Service

**Files:**
- Create: `packages/core/src/users/service.ts`
- Test: `packages/core/tests/users.test.ts`

**Interfaces:**
- Consumes: `hashPassword`, `generateStartPassword`, `assignRole`-Logik (direkt in Transaktion: Insert in `userRoles`), `countActiveProtectedHolders`, `recordAudit`.
- Produces:
  - `interface UserSummary { id; name; email; isActive; mustChangePassword; status: 'active' | 'firstLoginPending' | 'inactive'; lastLoginAt: string | null; roles: { id: string; name: string }[] }`
  - `createUser(deps, ctx, { name, email, roleIds }) → Result<{ user: UserSummary; startPassword: string }>`
  - `listUsers(deps, ctx) → Result<UserSummary[]>`; `getUser(deps, ctx, id) → Result<UserSummary>`
  - `updateUser(deps, ctx, { id, name, email }) → Result<UserSummary>`
  - `setUserActive(deps, ctx, { id, isActive }) → Result<UserSummary>` (Deaktivieren löscht Sitzungen des Nutzers)
  - `resetStartPassword(deps, ctx, { id }) → Result<{ startPassword: string }>` (löscht Sitzungen)
  - intern exportiert: `loadUserSummary(dbOrTx, id)`, `normalizeEmail(email)`.

- [ ] **Step 1: Test schreiben**

`packages/core/tests/users.test.ts`:
```ts
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { START_PASSWORD_PATTERN, verifyPassword } from '../src/auth/password';
import { auditLog, sessions, users } from '../src/db/schema';
import { assignRole, createRole } from '../src/roles/service';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith, insertRole, insertUser } from '../src/testing';
import { createUser, listUsers, resetStartPassword, setUserActive, updateUser } from '../src/users/service';

const admin = ctxWith(['users.manage', 'roles.manage']);

describe('users service', () => {
  it('creates a user with a one-time start password, assigned roles and an audit entry without secrets', async () => {
    const deps = createTestDeps();
    const role = unwrap(await createRole(deps, admin, { name: 'Kassenprüfer' }));
    const { user, startPassword } = unwrap(
      await createUser(deps, admin, { name: 'Peter Lang', email: 'Peter.Lang@Example.org', roleIds: [role.id] }),
    );
    expect(startPassword).toMatch(START_PASSWORD_PATTERN);
    expect(user).toMatchObject({ name: 'Peter Lang', email: 'peter.lang@example.org', status: 'firstLoginPending', mustChangePassword: true, roles: [{ id: role.id, name: 'Kassenprüfer' }] });
    const row = deps.db.select().from(users).where(eq(users.id, user.id)).get();
    expect(await verifyPassword(row!.passwordHash, startPassword)).toBe(true);
    const audit = deps.db.select().from(auditLog).all().find((e) => e.action === 'users.create');
    expect(audit?.after).not.toContain(startPassword);
    expect(audit?.after).not.toContain('passwordHash');
  });

  it('rejects duplicate emails (case-insensitive), invalid emails, unknown roles and missing permission', async () => {
    const deps = createTestDeps();
    insertUser(deps, { email: 'anna@example.org' });
    const dup = await createUser(deps, admin, { name: 'A', email: 'ANNA@example.org', roleIds: [] });
    expect(dup.ok === false && dup.error.type === 'conflict' && dup.error.code === 'emailTaken').toBe(true);
    const bad = await createUser(deps, admin, { name: 'A', email: 'nope', roleIds: [] });
    expect(bad.ok === false && bad.error.type === 'validation').toBe(true);
    const role = await createUser(deps, admin, { name: 'A', email: 'b@example.org', roleIds: ['missing'] });
    expect(role.ok === false && role.error.type === 'notFound').toBe(true);
    const denied = await createUser(deps, ctxWith(['roles.manage']), { name: 'A', email: 'c@example.org', roleIds: [] });
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
  });

  it('lists users with derived status', async () => {
    const deps = createTestDeps();
    insertUser(deps, { name: 'Aktiv', email: 'a@example.org' });
    insertUser(deps, { name: 'Inaktiv', email: 'i@example.org', isActive: false });
    unwrap(await createUser(deps, admin, { name: 'Neu', email: 'n@example.org', roleIds: [] }));
    const list = unwrap(await listUsers(deps, admin));
    expect(list.map((u) => [u.name, u.status])).toEqual([
      ['Aktiv', 'active'],
      ['Inaktiv', 'inactive'],
      ['Neu', 'firstLoginPending'],
    ]);
  });

  it('updates name and email with audit diff', async () => {
    const deps = createTestDeps();
    const id = insertUser(deps, { name: 'Alt', email: 'alt@example.org' });
    const updated = unwrap(await updateUser(deps, admin, { id, name: 'Neu', email: 'neu@example.org' }));
    expect(updated).toMatchObject({ name: 'Neu', email: 'neu@example.org' });
    const entry = deps.db.select().from(auditLog).all().at(-1);
    expect(entry).toMatchObject({ action: 'users.update', entityId: id });
    expect(JSON.parse(entry!.before!)).toMatchObject({ name: 'Alt' });
    expect(JSON.parse(entry!.after!)).toMatchObject({ name: 'Neu' });
  });

  it('deactivation revokes sessions and refuses for the last active administrator', async () => {
    const deps = createTestDeps();
    const id = insertUser(deps, { email: 'anna@example.org' });
    deps.db.insert(sessions).values({ id: 'S1', userId: id, createdAt: 'x', expiresAt: '2099-01-01T00:00:00.000Z' }).run();
    const adminRoleId = insertRole(deps, { name: 'Administration', isProtected: true });
    unwrap(await assignRole(deps, admin, { userId: id, roleId: adminRoleId }));
    const refused = await setUserActive(deps, admin, { id, isActive: false });
    expect(refused.ok === false && refused.error.type === 'conflict' && refused.error.code === 'lastAdministrator').toBe(true);
    const second = insertUser(deps, { email: 'jonas@example.org' });
    unwrap(await assignRole(deps, admin, { userId: second, roleId: adminRoleId }));
    const done = unwrap(await setUserActive(deps, admin, { id, isActive: false }));
    expect(done.status).toBe('inactive');
    expect(deps.db.select().from(sessions).all()).toHaveLength(0);
  });

  it('resetStartPassword issues a new word chain, forces a change and revokes sessions', async () => {
    const deps = createTestDeps();
    const id = insertUser(deps, {});
    deps.db.insert(sessions).values({ id: 'S1', userId: id, createdAt: 'x', expiresAt: '2099-01-01T00:00:00.000Z' }).run();
    const { startPassword } = unwrap(await resetStartPassword(deps, admin, { id }));
    expect(startPassword).toMatch(START_PASSWORD_PATTERN);
    const row = deps.db.select().from(users).where(eq(users.id, id)).get();
    expect(row?.mustChangePassword).toBe(true);
    expect(await verifyPassword(row!.passwordHash, startPassword)).toBe(true);
    expect(deps.db.select().from(sessions).all()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core test tests/users.test.ts`
Expected: FAIL — Module nicht gefunden.

- [ ] **Step 3: Implementieren**

`packages/core/src/users/service.ts`:
```ts
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { generateStartPassword, hashPassword } from '../auth/password';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import { roles, sessions, userRoles, users } from '../db/schema';
import type { Deps } from '../deps';
import { newId } from '../ids';
import { requirePermission } from '../permissions/check';
import { conflict, notFound, ok, type Result } from '../result';
import { countActiveProtectedHolders } from '../roles/effective';
import { validate } from '../validate';

export type UserStatus = 'active' | 'firstLoginPending' | 'inactive';

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  mustChangePassword: boolean;
  status: UserStatus;
  lastLoginAt: string | null;
  roles: { id: string; name: string }[];
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export function loadUserSummary(db: DbOrTx, id: string): UserSummary | null {
  const row = db.select().from(users).where(eq(users.id, id)).get();
  if (!row) return null;
  const held = db
    .select({ id: roles.id, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, id))
    .orderBy(roles.name)
    .all();
  const status: UserStatus = !row.isActive ? 'inactive' : row.mustChangePassword && !row.lastLoginAt ? 'firstLoginPending' : 'active';
  return { id: row.id, name: row.name, email: row.email, isActive: row.isActive, mustChangePassword: row.mustChangePassword, status, lastLoginAt: row.lastLoginAt, roles: held };
}

function emailTaken(db: DbOrTx, email: string, exceptId?: string): boolean {
  const row = db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
  return !!row && row.id !== exceptId;
}

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().transform(normalizeEmail),
  roleIds: z.array(z.string().min(1)).default([]),
});

export async function createUser(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ user: UserSummary; startPassword: string }>> {
  const denied = requirePermission(ctx, 'users.manage');
  if (denied) return denied;
  const parsed = validate(createUserSchema, input);
  if (!parsed.ok) return parsed;
  const { name, email, roleIds } = parsed.value;
  if (emailTaken(deps.db, email)) return conflict('emailTaken', `E-Mail ${email} ist bereits vergeben`);
  for (const roleId of roleIds) {
    if (!deps.db.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId)).get()) return notFound('role', roleId);
  }
  const startPassword = generateStartPassword();
  const passwordHash = await hashPassword(startPassword);
  return deps.db.transaction((tx) => {
    const id = newId();
    const now = isoNow(deps.clock);
    tx.insert(users).values({ id, name, email, passwordHash, mustChangePassword: true, isActive: true, createdAt: now, updatedAt: now }).run();
    if (roleIds.length > 0) tx.insert(userRoles).values(roleIds.map((roleId) => ({ userId: id, roleId }))).run();
    const user = loadUserSummary(tx, id) as UserSummary;
    recordAudit(tx, deps, ctx, { action: 'users.create', entityType: 'user', entityId: id, after: user, summary: `Nutzer ${name} angelegt` });
    return ok({ user, startPassword });
  });
}

export async function listUsers(deps: Deps, ctx: CallContext): Promise<Result<UserSummary[]>> {
  const denied = requirePermission(ctx, 'users.manage');
  if (denied) return denied;
  const ids = deps.db.select({ id: users.id }).from(users).orderBy(sql`lower(${users.name})`).all();
  return ok(ids.map(({ id }) => loadUserSummary(deps.db, id) as UserSummary));
}

export async function getUser(deps: Deps, ctx: CallContext, id: string): Promise<Result<UserSummary>> {
  const denied = requirePermission(ctx, 'users.manage');
  if (denied) return denied;
  const user = loadUserSummary(deps.db, id);
  return user ? ok(user) : notFound('user', id);
}

const updateUserSchema = z.object({ id: z.string().min(1), name: z.string().trim().min(1).max(120), email: z.email().transform(normalizeEmail) });

export async function updateUser(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<UserSummary>> {
  const denied = requirePermission(ctx, 'users.manage');
  if (denied) return denied;
  const parsed = validate(updateUserSchema, input);
  if (!parsed.ok) return parsed;
  const { id, name, email } = parsed.value;
  const before = loadUserSummary(deps.db, id);
  if (!before) return notFound('user', id);
  if (emailTaken(deps.db, email, id)) return conflict('emailTaken', `E-Mail ${email} ist bereits vergeben`);
  return deps.db.transaction((tx) => {
    tx.update(users).set({ name, email, updatedAt: isoNow(deps.clock) }).where(eq(users.id, id)).run();
    const after = loadUserSummary(tx, id) as UserSummary;
    recordAudit(tx, deps, ctx, { action: 'users.update', entityType: 'user', entityId: id, before, after, summary: `Nutzer ${after.name} geändert` });
    return ok(after);
  });
}

const setActiveSchema = z.object({ id: z.string().min(1), isActive: z.boolean() });

export async function setUserActive(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<UserSummary>> {
  const denied = requirePermission(ctx, 'users.manage');
  if (denied) return denied;
  const parsed = validate(setActiveSchema, input);
  if (!parsed.ok) return parsed;
  const { id, isActive } = parsed.value;
  const before = loadUserSummary(deps.db, id);
  if (!before) return notFound('user', id);
  if (!isActive && before.isActive && countActiveProtectedHolders(deps.db, { excludeUserId: id }) === 0 && countActiveProtectedHolders(deps.db) > 0) {
    return conflict('lastAdministrator', 'Der letzte aktive Administrator kann nicht deaktiviert werden');
  }
  return deps.db.transaction((tx) => {
    tx.update(users).set({ isActive, updatedAt: isoNow(deps.clock) }).where(eq(users.id, id)).run();
    if (!isActive) tx.delete(sessions).where(eq(sessions.userId, id)).run();
    const after = loadUserSummary(tx, id) as UserSummary;
    recordAudit(tx, deps, ctx, { action: isActive ? 'users.activate' : 'users.deactivate', entityType: 'user', entityId: id, before, after, summary: `Nutzer ${after.name} ${isActive ? 'aktiviert' : 'deaktiviert'}` });
    return ok(after);
  });
}

const idSchema = z.object({ id: z.string().min(1) });

export async function resetStartPassword(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ startPassword: string }>> {
  const denied = requirePermission(ctx, 'users.manage');
  if (denied) return denied;
  const parsed = validate(idSchema, input);
  if (!parsed.ok) return parsed;
  const user = loadUserSummary(deps.db, parsed.value.id);
  if (!user) return notFound('user', parsed.value.id);
  const startPassword = generateStartPassword();
  const passwordHash = await hashPassword(startPassword);
  return deps.db.transaction((tx) => {
    tx.update(users).set({ passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null, updatedAt: isoNow(deps.clock) }).where(eq(users.id, user.id)).run();
    tx.delete(sessions).where(eq(sessions.userId, user.id)).run();
    recordAudit(tx, deps, ctx, { action: 'users.resetStartPassword', entityType: 'user', entityId: user.id, summary: `Startpasswort für ${user.name} neu gesetzt` });
    return ok({ startPassword });
  });
}
```

- [ ] **Step 4: Tests ausführen**

Run: `pnpm --filter @kompass/core test && pnpm --filter @kompass/core typecheck`
Expected: alle grün.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): user management with one-time start passwords and audited changes"
```

---

### Task 10: Sitzungen, Login mit Sperre, eigenes Passwort ändern

**Files:**
- Create: `packages/core/src/auth/sessions.ts`, `packages/core/src/auth/login.ts`
- Test: `packages/core/tests/auth.test.ts`

**Interfaces:**
- Consumes: `verifyPassword`, `hashPassword`, `passwordSchema`, `getEffectivePermissions`, `recordAudit`, `systemContext`.
- Produces:
  - `SESSION_TTL_MS`, `createSession(tx, deps, userId) → { id; expiresAt }`, `resolveSession(deps, sessionId, meta: { ipAddress: string | null; requestId: string }) → { ctx: CallContext; user: UserSummary; mustChangePassword: boolean } | null`, `revokeSession(deps, sessionId)`, `revokeUserSessions(tx, userId, exceptSessionId?)`.
  - `MAX_FAILED_LOGINS = 5`, `LOCK_MINUTES = 15`, `login(deps, { email, password, ipAddress, requestId }) → Result<{ sessionId; expiresAt; userId; mustChangePassword }>`.
  - `changeOwnPassword(deps, ctx, sessionId, { currentPassword, newPassword }) → Result<void>` (räumt `mustChangePassword`, beendet andere Sitzungen).

- [ ] **Step 1: Test schreiben**

`packages/core/tests/auth.test.ts`:
```ts
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { changeOwnPassword, LOCK_MINUTES, login, MAX_FAILED_LOGINS } from '../src/auth/login';
import { hashPassword } from '../src/auth/password';
import { resolveSession, revokeSession } from '../src/auth/sessions';
import { auditLog, sessions, users } from '../src/db/schema';
import { assignRole, createRole, setRolePermissions } from '../src/roles/service';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

const meta = { ipAddress: '10.0.0.5', requestId: 'REQ-1' };
const PASSWORD = 'wiese-kanu-73-lampe';

async function userWithPassword(deps: ReturnType<typeof createTestDeps>, overrides: Parameters<typeof insertUser>[1] = {}) {
  return insertUser(deps, { email: 'anna@example.org', passwordHash: await hashPassword(PASSWORD), ...overrides });
}

describe('login and sessions', () => {
  it('logs in with correct credentials, creates a session and resolves it to a context with effective permissions', async () => {
    const deps = createTestDeps();
    const userId = await userWithPassword(deps);
    const admin = ctxWith(['roles.manage', 'users.manage']);
    const role = unwrap(await createRole(deps, admin, { name: 'Prüfer' }));
    unwrap(await setRolePermissions(deps, admin, { roleId: role.id, permissionKeys: ['audit.view'] }));
    unwrap(await assignRole(deps, admin, { userId, roleId: role.id }));

    const result = unwrap(await login(deps, { email: 'Anna@Example.org', password: PASSWORD, ...meta }));
    expect(result.userId).toBe(userId);
    expect(result.mustChangePassword).toBe(false);

    const resolved = resolveSession(deps, result.sessionId, meta);
    expect(resolved?.ctx).toMatchObject({ userId, channel: 'ui', ipAddress: '10.0.0.5', requestId: 'REQ-1', apiTokenId: null });
    expect([...resolved!.ctx.permissions]).toEqual(['audit.view']);
    expect(deps.db.select().from(users).where(eq(users.id, userId)).get()?.lastLoginAt).toBe('2026-09-05T08:00:00.000Z');
    expect(deps.db.select().from(auditLog).all().some((e) => e.action === 'auth.login' && e.userId === userId)).toBe(true);
  });

  it('returns invalidCredentials with attempts left and locks after five failures with a system audit entry', async () => {
    const deps = createTestDeps();
    const userId = await userWithPassword(deps);
    for (let attempt = 1; attempt < MAX_FAILED_LOGINS; attempt += 1) {
      const r = await login(deps, { email: 'anna@example.org', password: 'falsch-falsch-00-falsch', ...meta });
      expect(r.ok === false && r.error.type === 'unauthorized' && r.error.reason === 'invalidCredentials' && r.error.attemptsLeft === MAX_FAILED_LOGINS - attempt).toBe(true);
    }
    const fifth = await login(deps, { email: 'anna@example.org', password: 'falsch-falsch-00-falsch', ...meta });
    expect(fifth.ok === false && fifth.error.type === 'unauthorized' && fifth.error.reason === 'locked').toBe(true);
    const locked = deps.db.select().from(auditLog).all().find((e) => e.action === 'auth.locked');
    expect(locked).toMatchObject({ channel: 'system', userId: null, entityType: 'user', entityId: userId });

    const stillLocked = await login(deps, { email: 'anna@example.org', password: PASSWORD, ...meta });
    expect(stillLocked.ok === false && stillLocked.error.type === 'unauthorized' && stillLocked.error.reason === 'locked').toBe(true);

    deps.clock.advance((LOCK_MINUTES + 1) * 60_000);
    expect((await login(deps, { email: 'anna@example.org', password: PASSWORD, ...meta })).ok).toBe(true);
  });

  it('does not reveal whether an email exists and refuses inactive users', async () => {
    const deps = createTestDeps();
    const unknown = await login(deps, { email: 'nobody@example.org', password: PASSWORD, ...meta });
    expect(unknown.ok === false && unknown.error.type === 'unauthorized' && unknown.error.reason === 'invalidCredentials' && unknown.error.attemptsLeft === undefined).toBe(true);
    await userWithPassword(deps, { isActive: false });
    const inactive = await login(deps, { email: 'anna@example.org', password: PASSWORD, ...meta });
    expect(inactive.ok === false && inactive.error.type === 'unauthorized' && inactive.error.reason === 'inactive').toBe(true);
  });

  it('expired or revoked sessions do not resolve', async () => {
    const deps = createTestDeps();
    await userWithPassword(deps);
    const { sessionId } = unwrap(await login(deps, { email: 'anna@example.org', password: PASSWORD, ...meta }));
    deps.clock.advance(15 * 24 * 60 * 60 * 1000);
    expect(resolveSession(deps, sessionId, meta)).toBeNull();
    const again = unwrap(await login(deps, { email: 'anna@example.org', password: PASSWORD, ...meta }));
    revokeSession(deps, again.sessionId);
    expect(resolveSession(deps, again.sessionId, meta)).toBeNull();
  });

  it('changeOwnPassword verifies the current password, applies the policy, clears the flag and ends other sessions', async () => {
    const deps = createTestDeps();
    const userId = await userWithPassword(deps);
    deps.db.update(users).set({ mustChangePassword: true }).where(eq(users.id, userId)).run();
    const first = unwrap(await login(deps, { email: 'anna@example.org', password: PASSWORD, ...meta }));
    expect(first.mustChangePassword).toBe(true);
    const other = unwrap(await login(deps, { email: 'anna@example.org', password: PASSWORD, ...meta }));
    const ctx = resolveSession(deps, first.sessionId, meta)!.ctx;

    const wrong = await changeOwnPassword(deps, ctx, first.sessionId, { currentPassword: 'nope-nope-00-nope', newPassword: 'neues-langes-passwort' });
    expect(wrong.ok === false && wrong.error.type === 'unauthorized').toBe(true);
    const short = await changeOwnPassword(deps, ctx, first.sessionId, { currentPassword: PASSWORD, newPassword: 'kurz' });
    expect(short.ok === false && short.error.type === 'validation').toBe(true);

    expect((await changeOwnPassword(deps, ctx, first.sessionId, { currentPassword: PASSWORD, newPassword: 'neues-langes-passwort' })).ok).toBe(true);
    expect(resolveSession(deps, first.sessionId, meta)?.mustChangePassword).toBe(false);
    expect(resolveSession(deps, other.sessionId, meta)).toBeNull();
    expect(deps.db.select().from(sessions).all()).toHaveLength(1);
    expect((await login(deps, { email: 'anna@example.org', password: 'neues-langes-passwort', ...meta })).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core test tests/auth.test.ts`
Expected: FAIL — Module nicht gefunden.

- [ ] **Step 3: Sessions implementieren**

`packages/core/src/auth/sessions.ts`:
```ts
import { randomBytes } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import { sessions } from '../db/schema';
import type { Deps } from '../deps';
import { getEffectivePermissions } from '../roles/effective';
import { loadUserSummary, type UserSummary } from '../users/service';

export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface RequestMeta {
  ipAddress: string | null;
  requestId: string;
}

export function createSession(tx: DbOrTx, deps: Pick<Deps, 'clock'>, userId: string): { id: string; expiresAt: string } {
  const id = randomBytes(32).toString('base64url');
  const now = deps.clock.now();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  tx.insert(sessions).values({ id, userId, createdAt: now.toISOString(), expiresAt }).run();
  return { id, expiresAt };
}

export interface ResolvedSession {
  ctx: CallContext;
  user: UserSummary;
  mustChangePassword: boolean;
}

export function resolveSession(deps: Deps, sessionId: string, meta: RequestMeta): ResolvedSession | null {
  const row = deps.db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!row) return null;
  if (row.expiresAt <= isoNow(deps.clock)) {
    deps.db.delete(sessions).where(eq(sessions.id, sessionId)).run();
    return null;
  }
  const user = loadUserSummary(deps.db, row.userId);
  if (!user || !user.isActive) return null;
  return {
    user,
    mustChangePassword: user.mustChangePassword,
    ctx: {
      userId: user.id,
      permissions: getEffectivePermissions(deps.db, deps.registry, user.id),
      channel: 'ui',
      apiTokenId: null,
      ipAddress: meta.ipAddress,
      requestId: meta.requestId,
    },
  };
}

export function revokeSession(deps: Pick<Deps, 'db'>, sessionId: string): void {
  deps.db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}

export function revokeUserSessions(tx: DbOrTx, userId: string, exceptSessionId?: string): void {
  const where = exceptSessionId ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId)) : eq(sessions.userId, userId);
  tx.delete(sessions).where(where).run();
}
```

- [ ] **Step 4: Login und Passwortwechsel implementieren**

`packages/core/src/auth/login.ts`:
```ts
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import { systemContext, type CallContext } from '../context';
import { users } from '../db/schema';
import type { Deps } from '../deps';
import { ok, unauthorized, type Result } from '../result';
import { normalizeEmail } from '../users/service';
import { validate } from '../validate';
import { hashPassword, passwordSchema, verifyPassword } from './password';
import { createSession, revokeUserSessions, type RequestMeta } from './sessions';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

const loginSchema = z.object({
  email: z.string().trim().min(1).transform(normalizeEmail),
  password: z.string().min(1),
  ipAddress: z.string().nullable(),
  requestId: z.string().min(1),
});

export interface LoginResult {
  sessionId: string;
  expiresAt: string;
  userId: string;
  mustChangePassword: boolean;
}

export async function login(deps: Deps, input: unknown): Promise<Result<LoginResult>> {
  const parsed = validate(loginSchema, input);
  if (!parsed.ok) return unauthorized('invalidCredentials');
  const { email, password, ipAddress, requestId } = parsed.value;
  const user = deps.db.select().from(users).where(eq(users.email, email)).get();
  if (!user) {
    await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', password); // gleiche Antwortzeit
    return unauthorized('invalidCredentials');
  }
  const now = isoNow(deps.clock);
  if (user.lockedUntil && user.lockedUntil > now) return unauthorized('locked', { lockedUntil: user.lockedUntil });
  if (!user.isActive) return unauthorized('inactive');

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    const failed = user.failedLoginCount + 1;
    if (failed >= MAX_FAILED_LOGINS) {
      const lockedUntil = new Date(deps.clock.now().getTime() + LOCK_MINUTES * 60_000).toISOString();
      deps.db.transaction((tx) => {
        tx.update(users).set({ failedLoginCount: 0, lockedUntil, updatedAt: now }).where(eq(users.id, user.id)).run();
        recordAudit(tx, deps, { ...systemContext(requestId), ipAddress }, {
          action: 'auth.locked',
          entityType: 'user',
          entityId: user.id,
          after: { lockedUntil },
          summary: `Konto ${user.email} nach ${MAX_FAILED_LOGINS} Fehlversuchen gesperrt`,
        });
      });
      return unauthorized('locked', { lockedUntil });
    }
    deps.db.update(users).set({ failedLoginCount: failed, updatedAt: now }).where(eq(users.id, user.id)).run();
    return unauthorized('invalidCredentials', { attemptsLeft: MAX_FAILED_LOGINS - failed });
  }

  return deps.db.transaction((tx) => {
    tx.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now, updatedAt: now }).where(eq(users.id, user.id)).run();
    const session = createSession(tx, deps, user.id);
    const ctx: CallContext = { userId: user.id, permissions: new Set(), channel: 'ui', apiTokenId: null, ipAddress, requestId };
    recordAudit(tx, deps, ctx, { action: 'auth.login', entityType: 'user', entityId: user.id, summary: `${user.email} angemeldet` });
    return ok({ sessionId: session.id, expiresAt: session.expiresAt, userId: user.id, mustChangePassword: user.mustChangePassword });
  });
}

const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });

export async function changeOwnPassword(deps: Deps, ctx: CallContext, sessionId: string, input: unknown): Promise<Result<void>> {
  if (!ctx.userId) return unauthorized('invalidCredentials');
  const parsed = validate(changePasswordSchema, input);
  if (!parsed.ok) return parsed;
  const user = deps.db.select().from(users).where(eq(users.id, ctx.userId)).get();
  if (!user) return unauthorized('invalidCredentials');
  if (!(await verifyPassword(user.passwordHash, parsed.value.currentPassword))) return unauthorized('invalidCredentials');
  const passwordHash = await hashPassword(parsed.value.newPassword);
  return deps.db.transaction((tx) => {
    tx.update(users).set({ passwordHash, mustChangePassword: false, updatedAt: isoNow(deps.clock) }).where(eq(users.id, user.id)).run();
    revokeUserSessions(tx, user.id, sessionId);
    recordAudit(tx, deps, ctx, { action: 'auth.changePassword', entityType: 'user', entityId: user.id, summary: `${user.email} hat das Passwort geändert` });
    return ok(undefined);
  });
}
```

- [ ] **Step 5: Tests ausführen**

Run: `pnpm --filter @kompass/core test && pnpm --filter @kompass/core typecheck`
Expected: alle grün. Hinweis: Der Dummy-Hash im Unbekannt-Zweig muss ein syntaktisch gültiger Argon2-String sein, damit `verify` rechnet statt sofort zu werfen; `verifyPassword` fängt beides ab.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): session login with lockout, session resolution and own password change"
```

---

### Task 11: API-Tokens für MCP

**Files:**
- Create: `packages/core/src/auth/tokens.ts`
- Test: `packages/core/tests/tokens.test.ts`

**Interfaces:**
- Consumes: `getEffectivePermissions`, `recordAudit`, `loadUserSummary`.
- Produces:
  - `interface ApiTokenSummary { id; name; prefix; createdAt; lastUsedAt: string | null; revokedAt: string | null }`
  - `createApiToken(deps, ctx, { name }) → Result<{ token: string; record: ApiTokenSummary }>` — Klartext genau einmal.
  - `resolveApiToken(deps, token, meta: RequestMeta) → CallContext | null` — setzt `channel: 'mcp'`, `apiTokenId`; aktualisiert `lastUsedAt`; `null` bei unbekannt, widerrufen, inaktivem Nutzer.
  - `revokeApiToken(deps, ctx, { id }) → Result<ApiTokenSummary>` — nur eigene Tokens.
  - `listApiTokens(deps, ctx) → Result<ApiTokenSummary[]>` — eigene, inklusive widerrufener.
  - `tokenPrefixFor(env): 'live' | 'test' | 'dev'`.

- [ ] **Step 1: Test schreiben**

`packages/core/tests/tokens.test.ts`:
```ts
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createApiToken, listApiTokens, resolveApiToken, revokeApiToken, tokenPrefixFor } from '../src/auth/tokens';
import { apiTokens, auditLog, users } from '../src/db/schema';
import { assignRole, createRole, setRolePermissions } from '../src/roles/service';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

const meta = { ipAddress: '10.0.0.7', requestId: 'REQ-MCP' };

describe('api tokens', () => {
  it('creates a token shown once, stores only a hash, and resolves to an mcp context with the owner permissions', async () => {
    const deps = createTestDeps();
    const userId = insertUser(deps, {});
    const admin = ctxWith(['roles.manage', 'users.manage']);
    const role = unwrap(await createRole(deps, admin, { name: 'Prüfer' }));
    unwrap(await setRolePermissions(deps, admin, { roleId: role.id, permissionKeys: ['audit.view'] }));
    unwrap(await assignRole(deps, admin, { userId, roleId: role.id }));

    const { token, record } = unwrap(await createApiToken(deps, ctxWith([], userId), { name: 'Buchhaltung Skript' }));
    expect(token).toMatch(/^akx_test_[A-Za-z0-9_-]{32,}$/);
    expect(record.prefix).toBe(token.slice(0, 12));
    const stored = deps.db.select().from(apiTokens).all()[0]!;
    expect(stored.tokenHash).not.toContain(token.slice(9));
    expect(deps.db.select().from(auditLog).all().at(-1)?.after).not.toContain(token);

    const ctx = resolveApiToken(deps, token, meta);
    expect(ctx).toMatchObject({ userId, channel: 'mcp', apiTokenId: record.id, ipAddress: '10.0.0.7', requestId: 'REQ-MCP' });
    expect([...ctx!.permissions]).toEqual(['audit.view']);
    expect(deps.db.select().from(apiTokens).all()[0]?.lastUsedAt).toBe('2026-09-05T08:00:00.000Z');
  });

  it('uses live/test/dev prefixes by environment', () => {
    expect(tokenPrefixFor('production')).toBe('live');
    expect(tokenPrefixFor('test')).toBe('test');
    expect(tokenPrefixFor('development')).toBe('dev');
  });

  it('rejects unknown, revoked and inactive-user tokens', async () => {
    const deps = createTestDeps();
    const userId = insertUser(deps, {});
    const ctx = ctxWith([], userId);
    const { token, record } = unwrap(await createApiToken(deps, ctx, { name: 'A' }));
    expect(resolveApiToken(deps, 'akx_test_nope', meta)).toBeNull();
    unwrap(await revokeApiToken(deps, ctx, { id: record.id }));
    expect(resolveApiToken(deps, token, meta)).toBeNull();
    const { token: second } = unwrap(await createApiToken(deps, ctx, { name: 'B' }));
    deps.db.update(users).set({ isActive: false }).where(eq(users.id, userId)).run();
    expect(resolveApiToken(deps, second, meta)).toBeNull();
  });

  it('lists own tokens including revoked ones and refuses to revoke someone else\'s token', async () => {
    const deps = createTestDeps();
    const a = insertUser(deps, { email: 'a@example.org' });
    const b = insertUser(deps, { email: 'b@example.org' });
    const { record } = unwrap(await createApiToken(deps, ctxWith([], a), { name: 'A1' }));
    unwrap(await createApiToken(deps, ctxWith([], b), { name: 'B1' }));
    unwrap(await revokeApiToken(deps, ctxWith([], a), { id: record.id }));
    const list = unwrap(await listApiTokens(deps, ctxWith([], a)));
    expect(list.map((t) => [t.name, t.revokedAt !== null])).toEqual([['A1', true]]);
    const foreign = await revokeApiToken(deps, ctxWith([], b), { id: record.id });
    expect(foreign.ok === false && foreign.error.type === 'notFound').toBe(true);
    const anon = await createApiToken(deps, ctxWith([], null), { name: 'X' });
    expect(anon.ok === false && anon.error.type === 'unauthorized').toBe(true);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core test tests/tokens.test.ts`
Expected: FAIL — Modul nicht gefunden.

- [ ] **Step 3: Implementieren**

`packages/core/src/auth/tokens.ts`:
```ts
import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import { apiTokens } from '../db/schema';
import type { AppEnv, Deps } from '../deps';
import { newId } from '../ids';
import { notFound, ok, unauthorized, type Result } from '../result';
import { getEffectivePermissions } from '../roles/effective';
import { loadUserSummary } from '../users/service';
import { validate } from '../validate';
import type { RequestMeta } from './sessions';

export interface ApiTokenSummary {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export function tokenPrefixFor(env: AppEnv): 'live' | 'test' | 'dev' {
  return env === 'production' ? 'live' : env === 'test' ? 'test' : 'dev';
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const toSummary = (row: typeof apiTokens.$inferSelect): ApiTokenSummary => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  createdAt: row.createdAt,
  lastUsedAt: row.lastUsedAt,
  revokedAt: row.revokedAt,
});

const createSchema = z.object({ name: z.string().trim().min(1).max(80) });

export async function createApiToken(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ token: string; record: ApiTokenSummary }>> {
  if (!ctx.userId) return unauthorized('invalidCredentials');
  const parsed = validate(createSchema, input);
  if (!parsed.ok) return parsed;
  const token = `akx_${tokenPrefixFor(deps.env)}_${randomBytes(24).toString('base64url')}`;
  const userId = ctx.userId;
  return deps.db.transaction((tx) => {
    const id = newId();
    tx.insert(apiTokens)
      .values({ id, userId, name: parsed.value.name, prefix: token.slice(0, 12), tokenHash: hashToken(token), createdAt: isoNow(deps.clock) })
      .run();
    const record = toSummary(tx.select().from(apiTokens).where(eq(apiTokens.id, id)).get()!);
    recordAudit(tx, deps, ctx, { action: 'apiTokens.create', entityType: 'apiToken', entityId: id, after: record, summary: `API-Token „${record.name}" erstellt` });
    return ok({ token, record });
  });
}

export function resolveApiToken(deps: Deps, token: string, meta: RequestMeta): CallContext | null {
  const row = deps.db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hashToken(token))).get();
  if (!row || row.revokedAt) return null;
  const user = loadUserSummary(deps.db, row.userId);
  if (!user || !user.isActive) return null;
  deps.db.update(apiTokens).set({ lastUsedAt: isoNow(deps.clock) }).where(eq(apiTokens.id, row.id)).run();
  return {
    userId: user.id,
    permissions: getEffectivePermissions(deps.db, deps.registry, user.id),
    channel: 'mcp',
    apiTokenId: row.id,
    ipAddress: meta.ipAddress,
    requestId: meta.requestId,
  };
}

const idSchema = z.object({ id: z.string().min(1) });

export async function revokeApiToken(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ApiTokenSummary>> {
  if (!ctx.userId) return unauthorized('invalidCredentials');
  const parsed = validate(idSchema, input);
  if (!parsed.ok) return parsed;
  const row = deps.db.select().from(apiTokens).where(and(eq(apiTokens.id, parsed.value.id), eq(apiTokens.userId, ctx.userId))).get();
  if (!row) return notFound('apiToken', parsed.value.id);
  if (row.revokedAt) return ok(toSummary(row));
  return deps.db.transaction((tx) => {
    tx.update(apiTokens).set({ revokedAt: isoNow(deps.clock) }).where(eq(apiTokens.id, row.id)).run();
    const after = toSummary(tx.select().from(apiTokens).where(eq(apiTokens.id, row.id)).get()!);
    recordAudit(tx, deps, ctx, { action: 'apiTokens.revoke', entityType: 'apiToken', entityId: row.id, before: toSummary(row), after, summary: `API-Token „${row.name}" widerrufen` });
    return ok(after);
  });
}

export async function listApiTokens(deps: Deps, ctx: CallContext): Promise<Result<ApiTokenSummary[]>> {
  if (!ctx.userId) return unauthorized('invalidCredentials');
  const rows = deps.db.select().from(apiTokens).where(eq(apiTokens.userId, ctx.userId)).orderBy(apiTokens.createdAt).all();
  return ok(rows.map(toSummary));
}
```

- [ ] **Step 4: Tests ausführen**

Run: `pnpm --filter @kompass/core test && pnpm --filter @kompass/core typecheck`
Expected: alle grün.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): personal API tokens resolving to audited MCP contexts"
```

---

### Task 12: Theme-Schema, Default-Theme, Kontrastprüfung

**Files:**
- Create: `packages/core/src/themes/tokens.ts`, `packages/core/src/themes/default-theme.ts`, `packages/core/src/themes/contrast.ts`
- Modify: `packages/core/src/settings/core.ts` (Setting `themes` ergänzen)
- Test: `packages/core/tests/themes-schema.test.ts`

**Interfaces:**
- Produces:
  - `THEME_TOKENS: readonly ThemeToken[]` (58 Token-Namen ohne `--`), `type ThemeToken`, `themeSchema` (Zod: `{ key, name, tokens: Record<ThemeToken, { light: string; dark: string }> }`, vollständig, keine Zusatzschlüssel), `type Theme`.
  - `DEFAULT_THEME: Theme` (Key `default`, Werte aus dem Token-Sheet).
  - `contrastRatio(hexA, hexB): number`, `CONTRAST_PAIRS`, `checkThemeContrast(theme): ContrastFinding[]` mit `{ fg, bg, mode, ratio, minimum }`.
  - Setting `themes` (`z.array(themeSchema).min(1)`, Default `[DEFAULT_THEME]`).

- [ ] **Step 1: Test schreiben**

`packages/core/tests/themes-schema.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { checkThemeContrast, CONTRAST_PAIRS, contrastRatio } from '../src/themes/contrast';
import { DEFAULT_THEME } from '../src/themes/default-theme';
import { THEME_TOKENS, themeSchema } from '../src/themes/tokens';
import { readSetting } from '../src/settings/service';
import { createTestDeps } from '../src/testing';

describe('theme schema', () => {
  it('defines 58 tokens including the design-round additions', () => {
    expect(THEME_TOKENS).toHaveLength(58);
    for (const token of ['color-primary', 'focus-ring', 'table-zebra', 'input-bg', 'overlay', 'shadow-md', 'font-mono', 'radius-full', 'row-h']) {
      expect(THEME_TOKENS).toContain(token);
    }
  });

  it('accepts the default theme and rejects incomplete or extended themes', () => {
    expect(themeSchema.safeParse(DEFAULT_THEME).success).toBe(true);
    const { 'row-h': _dropped, ...rest } = DEFAULT_THEME.tokens;
    expect(themeSchema.safeParse({ ...DEFAULT_THEME, tokens: rest }).success).toBe(false);
    expect(themeSchema.safeParse({ ...DEFAULT_THEME, tokens: { ...DEFAULT_THEME.tokens, extra: { light: '#000', dark: '#fff' } } }).success).toBe(false);
    expect(themeSchema.safeParse({ ...DEFAULT_THEME, key: 'Bad Key' }).success).toBe(false);
  });

  it('is registered as the `themes` setting default', () => {
    const deps = createTestDeps();
    const themes = readSetting<{ key: string }[]>(deps, 'themes');
    expect(themes.map((t) => t.key)).toEqual(['default']);
  });
});

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 1);
    expect(contrastRatio('#191C1F', '#F6F6F4')).toBeGreaterThan(15);
    expect(contrastRatio('#8B9199', '#FFFFFF')).toBeCloseTo(3.18, 1);
  });

  it('the default theme passes every checked pair in light and dark', () => {
    expect(CONTRAST_PAIRS.length).toBeGreaterThanOrEqual(20);
    expect(checkThemeContrast(DEFAULT_THEME)).toEqual([]);
  });

  it('reports failing pairs with ratio and mode', () => {
    const broken = { ...DEFAULT_THEME, tokens: { ...DEFAULT_THEME.tokens, muted: { light: '#DDDDDD', dark: '#9AA1A9' } } };
    const findings = checkThemeContrast(broken);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]).toMatchObject({ fg: 'muted', mode: 'light', minimum: 4.5 });
    expect(findings[0]!.ratio).toBeLessThan(4.5);
    expect(findings.every((f) => f.mode === 'light')).toBe(true);
  });

  it('skips non-hex values such as shadows and rgba overlays without throwing', () => {
    const theme = { ...DEFAULT_THEME, tokens: { ...DEFAULT_THEME.tokens, surface: { light: 'rgba(255,255,255,1)', dark: '#1B1E23' } } };
    expect(() => checkThemeContrast(theme)).not.toThrow();
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core test tests/themes-schema.test.ts`
Expected: FAIL — Module nicht gefunden.

- [ ] **Step 3: Token-Schema schreiben**

`packages/core/src/themes/tokens.ts`:
```ts
import { z } from 'zod';

export const THEME_TOKENS = [
  // Marke
  'color-primary', 'color-primary-ink', 'color-primary-soft',
  'color-accent', 'color-accent-deep', 'color-accent-soft',
  // Status
  'color-success', 'color-success-bg', 'color-warning', 'color-warning-bg',
  'color-error', 'color-error-bg', 'color-info', 'color-info-bg',
  // Flächen
  'bg', 'surface', 'surface-2', 'sidebar-bg', 'topbar-bg',
  // Schrift und Linien
  'ink', 'ink-2', 'muted', 'muted-2', 'on-primary', 'on-primary-muted', 'line', 'line-2', 'line-strong',
  // Interaktion
  'focus-ring', 'hover-surface', 'active-surface', 'selected-bg', 'selected-ink',
  'link', 'link-hover', 'disabled-ink', 'disabled-bg',
  // Tabellen und Felder
  'table-head-bg', 'table-zebra', 'table-row-hover', 'input-bg', 'input-placeholder', 'code-bg',
  'neutral-badge-bg', 'neutral-badge-ink', 'tooltip-bg', 'tooltip-ink',
  // Tiefe
  'overlay', 'shadow-sm', 'shadow-md',
  // Typografie und Form
  'font-body', 'font-heading', 'font-mono', 'radius-sm', 'radius-md', 'radius-lg', 'radius-full', 'row-h',
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];

const tokenValue = z.string().trim().min(1).max(160);
const pair = z.object({ light: tokenValue, dark: tokenValue }).strict();

export const themeTokensSchema = z
  .object(Object.fromEntries(THEME_TOKENS.map((token) => [token, pair])) as Record<ThemeToken, typeof pair>)
  .strict();

export const THEME_KEY_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

export const themeSchema = z
  .object({
    key: z.string().regex(THEME_KEY_PATTERN),
    name: z.string().trim().min(1).max(60),
    tokens: themeTokensSchema,
  })
  .strict();

export type ThemeTokens = z.infer<typeof themeTokensSchema>;
export type Theme = z.infer<typeof themeSchema>;
```

- [ ] **Step 4: Default-Theme schreiben (Seed-Daten aus Token-Sheet `1a`)**

`packages/core/src/themes/default-theme.ts`:
```ts
import type { Theme } from './tokens';

/**
 * Seed-Daten, kein Code: die einzigen Farbwerte im Kern. Quelle: Design-Handoff Token-Sheet 1a.
 * Ein Verein ersetzt dieses Theme über den Theme-Editor; der Code kennt nur die Token-Namen.
 */
export const DEFAULT_THEME: Theme = {
  key: 'default',
  name: 'Default',
  tokens: {
    'color-primary': { light: '#2F5D68', dark: '#74B4C0' },
    'color-primary-ink': { light: '#20454E', dark: '#A9D5DC' },
    'color-primary-soft': { light: '#E3EEF0', dark: '#1C3A40' },
    'color-accent': { light: '#9C5637', dark: '#D98B6A' },
    'color-accent-deep': { light: '#7A3F27', dark: '#EFB79D' },
    'color-accent-soft': { light: '#F6E8E0', dark: '#38241B' },
    'color-success': { light: '#2E6B47', dark: '#72C093' },
    'color-success-bg': { light: '#E5F1EA', dark: '#153020' },
    'color-warning': { light: '#8A5A05', dark: '#DFB45F' },
    'color-warning-bg': { light: '#FAF0DA', dark: '#33270F' },
    'color-error': { light: '#A32B2B', dark: '#E88C86' },
    'color-error-bg': { light: '#F9E7E6', dark: '#3A1D1C' },
    'color-info': { light: '#2B5488', dark: '#8FB6E8' },
    'color-info-bg': { light: '#E6EDF7', dark: '#17253A' },
    bg: { light: '#F6F6F4', dark: '#14161A' },
    surface: { light: '#FFFFFF', dark: '#1B1E23' },
    'surface-2': { light: '#F1F1EE', dark: '#22262C' },
    'sidebar-bg': { light: '#F1F1EE', dark: '#101216' },
    'topbar-bg': { light: '#FFFFFF', dark: '#1B1E23' },
    ink: { light: '#191C1F', dark: '#ECEDEE' },
    'ink-2': { light: '#3C4249', dark: '#C7CACE' },
    muted: { light: '#666D75', dark: '#9AA1A9' },
    'muted-2': { light: '#8B9199', dark: '#6F767E' },
    'on-primary': { light: '#FFFFFF', dark: '#0D1A1D' },
    'on-primary-muted': { light: '#C6DDE2', dark: '#2C4A50' },
    line: { light: '#E4E4E0', dark: '#2C3138' },
    'line-2': { light: '#EEEEEA', dark: '#22262C' },
    'line-strong': { light: '#C8C8C2', dark: '#414851' },
    'focus-ring': { light: '#2F5D68', dark: '#74B4C0' },
    'hover-surface': { light: '#EDEDE9', dark: '#262B31' },
    'active-surface': { light: '#E4E4DF', dark: '#2E343B' },
    'selected-bg': { light: '#E3EEF0', dark: '#1C3A40' },
    'selected-ink': { light: '#20454E', dark: '#A9D5DC' },
    link: { light: '#2F5D68', dark: '#74B4C0' },
    'link-hover': { light: '#20454E', dark: '#A9D5DC' },
    'disabled-ink': { light: '#A3A8AE', dark: '#5C636B' },
    'disabled-bg': { light: '#F1F1EE', dark: '#22262C' },
    'table-head-bg': { light: '#F1F1EE', dark: '#22262C' },
    'table-zebra': { light: '#FAFAF8', dark: '#1E2227' },
    'table-row-hover': { light: '#F3F3F0', dark: '#262B31' },
    'input-bg': { light: '#FFFFFF', dark: '#14161A' },
    'input-placeholder': { light: '#8B9199', dark: '#6F767E' },
    'code-bg': { light: '#F1F1EE', dark: '#22262C' },
    'neutral-badge-bg': { light: '#EEEEEA', dark: '#22262C' },
    'neutral-badge-ink': { light: '#3C4249', dark: '#C7CACE' },
    'tooltip-bg': { light: '#191C1F', dark: '#ECEDEE' },
    'tooltip-ink': { light: '#FFFFFF', dark: '#14161A' },
    overlay: { light: 'rgba(25,28,31,.42)', dark: 'rgba(5,6,8,.62)' },
    'shadow-sm': { light: '0 1px 2px rgba(25,28,31,.07)', dark: '0 1px 2px rgba(0,0,0,.4)' },
    'shadow-md': { light: '0 6px 18px -4px rgba(25,28,31,.14)', dark: '0 8px 22px -4px rgba(0,0,0,.55)' },
    'font-body': { light: '"Source Sans 3", system-ui, sans-serif', dark: '"Source Sans 3", system-ui, sans-serif' },
    'font-heading': { light: '"Source Serif 4", Georgia, serif', dark: '"Source Serif 4", Georgia, serif' },
    'font-mono': { light: '"IBM Plex Mono", ui-monospace, monospace', dark: '"IBM Plex Mono", ui-monospace, monospace' },
    'radius-sm': { light: '4px', dark: '4px' },
    'radius-md': { light: '6px', dark: '6px' },
    'radius-lg': { light: '10px', dark: '10px' },
    'radius-full': { light: '999px', dark: '999px' },
    'row-h': { light: '44px', dark: '44px' },
  },
};
```

- [ ] **Step 5: Kontrastprüfung schreiben**

`packages/core/src/themes/contrast.ts`:
```ts
import type { Theme, ThemeToken } from './tokens';

const HEX = /^#([0-9a-f]{6})$/i;

function relativeLuminance(hex: string): number | null {
  const match = HEX.exec(hex.trim());
  if (!match) return null;
  const channels = [0, 2, 4].map((offset) => parseInt(match[1]!.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x Kontrastverhältnis; wirft bei Nicht-Hex-Werten. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  if (a === null || b === null) throw new Error('contrastRatio expects #rrggbb values');
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

export interface ContrastPair {
  fg: ThemeToken;
  bg: ThemeToken;
  minimum: number;
}

/** Textpaare 4.5:1 (AA), Platzhalter und Fokusring 3:1. Alle Paare bestehen im Default-Theme. */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { fg: 'ink', bg: 'bg', minimum: 4.5 },
  { fg: 'ink', bg: 'surface', minimum: 4.5 },
  { fg: 'ink', bg: 'surface-2', minimum: 4.5 },
  { fg: 'ink', bg: 'code-bg', minimum: 4.5 },
  { fg: 'ink-2', bg: 'surface', minimum: 4.5 },
  { fg: 'ink-2', bg: 'bg', minimum: 4.5 },
  { fg: 'muted', bg: 'surface', minimum: 4.5 },
  { fg: 'muted', bg: 'bg', minimum: 4.5 },
  { fg: 'muted', bg: 'table-head-bg', minimum: 4.5 },
  { fg: 'on-primary', bg: 'color-primary', minimum: 4.5 },
  { fg: 'color-primary-ink', bg: 'color-primary-soft', minimum: 4.5 },
  { fg: 'color-accent-deep', bg: 'color-accent-soft', minimum: 4.5 },
  { fg: 'color-success', bg: 'color-success-bg', minimum: 4.5 },
  { fg: 'color-warning', bg: 'color-warning-bg', minimum: 4.5 },
  { fg: 'color-error', bg: 'color-error-bg', minimum: 4.5 },
  { fg: 'color-info', bg: 'color-info-bg', minimum: 4.5 },
  { fg: 'color-success', bg: 'surface', minimum: 4.5 },
  { fg: 'color-warning', bg: 'surface', minimum: 4.5 },
  { fg: 'color-error', bg: 'surface', minimum: 4.5 },
  { fg: 'color-info', bg: 'surface', minimum: 4.5 },
  { fg: 'selected-ink', bg: 'selected-bg', minimum: 4.5 },
  { fg: 'tooltip-ink', bg: 'tooltip-bg', minimum: 4.5 },
  { fg: 'neutral-badge-ink', bg: 'neutral-badge-bg', minimum: 4.5 },
  { fg: 'link', bg: 'surface', minimum: 4.5 },
  { fg: 'input-placeholder', bg: 'input-bg', minimum: 3 },
  { fg: 'focus-ring', bg: 'bg', minimum: 3 },
];

export interface ContrastFinding {
  fg: ThemeToken;
  bg: ThemeToken;
  mode: 'light' | 'dark';
  ratio: number;
  minimum: number;
}

export function checkThemeContrast(theme: Theme): ContrastFinding[] {
  const findings: ContrastFinding[] = [];
  for (const pair of CONTRAST_PAIRS) {
    for (const mode of ['light', 'dark'] as const) {
      const fg = theme.tokens[pair.fg][mode];
      const bg = theme.tokens[pair.bg][mode];
      if (relativeLuminance(fg) === null || relativeLuminance(bg) === null) continue;
      const ratio = contrastRatio(fg, bg);
      if (ratio < pair.minimum) findings.push({ fg: pair.fg, bg: pair.bg, mode, ratio: Math.round(ratio * 100) / 100, minimum: pair.minimum });
    }
  }
  return findings;
}
```

- [ ] **Step 6: Setting `themes` registrieren**

In `packages/core/src/settings/core.ts` oben importieren und in `branding` ergänzen:
```ts
import { DEFAULT_THEME } from '../themes/default-theme';
import { themeSchema } from '../themes/tokens';
// ...
const themes: SettingDefinition[] = [
  { key: 'themes', schema: z.array(themeSchema).min(1), default: [DEFAULT_THEME] },
];
export const CORE_SETTINGS: SettingDefinition[] = [...organization, ...branding, ...themes, ...modules, ...system];
```

- [ ] **Step 7: Tests ausführen**

Run: `pnpm --filter @kompass/core test && pnpm --filter @kompass/core typecheck`
Expected: alle grün. `checkThemeContrast(DEFAULT_THEME)` muss `[]` liefern — die Werte wurden vor dem Plan rechnerisch geprüft (schwächstes Paar: `input-placeholder`/`input-bg` hell 3,18:1 bei Minimum 3).

- [ ] **Step 8: Commit**

```bash
git add packages/core
git commit -m "feat(core): theme token schema, default theme seed data and WCAG contrast check"
```

---

### Task 13: Theme-Service

**Files:**
- Create: `packages/core/src/themes/service.ts`
- Test: `packages/core/tests/themes-service.test.ts`

**Interfaces:**
- Consumes: `readSetting`, `writeSettingInternal`, `themeSchema`, `checkThemeContrast`.
- Produces:
  - `listThemes(deps) → { themes: Theme[]; activeKey: string }`; `resolveActiveTheme(deps) → Theme` (fällt auf `default` zurück, wenn der aktive Key fehlt).
  - `createTheme(deps, ctx, theme) → Result<Theme>`; `updateTheme(deps, ctx, theme) → Result<Theme>`; `duplicateTheme(deps, ctx, { sourceKey, key, name }) → Result<Theme>`; `deleteTheme(deps, ctx, { key }) → Result<void>`; `activateTheme(deps, ctx, { key }) → Result<Theme>`.
  - Alle Schreibfunktionen: `settings.manage`; Fehlercodes `themeKeyTaken`, `themeReadOnly` (default), `themeActive` (löschen), `themeNotFound` via `notFound('theme', key)`.

- [ ] **Step 1: Test schreiben**

`packages/core/tests/themes-service.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { auditLog } from '../src/db/schema';
import { unwrap } from '../src/result';
import { readSetting } from '../src/settings/service';
import { createTestDeps, ctxWith } from '../src/testing';
import { DEFAULT_THEME } from '../src/themes/default-theme';
import { activateTheme, createTheme, deleteTheme, duplicateTheme, listThemes, resolveActiveTheme, updateTheme } from '../src/themes/service';

const admin = ctxWith(['settings.manage']);
const club = { ...DEFAULT_THEME, key: 'vereinsfarben', name: 'Vereinsfarben' };

describe('theme service', () => {
  it('starts with the default theme active', () => {
    const deps = createTestDeps();
    expect(listThemes(deps)).toEqual({ themes: [DEFAULT_THEME], activeKey: 'default' });
    expect(resolveActiveTheme(deps).key).toBe('default');
  });

  it('creates, updates and activates a theme with audit entries', async () => {
    const deps = createTestDeps();
    unwrap(await createTheme(deps, admin, club));
    const renamed = unwrap(await updateTheme(deps, admin, { ...club, name: 'Aluna' }));
    expect(renamed.name).toBe('Aluna');
    unwrap(await activateTheme(deps, admin, { key: 'vereinsfarben' }));
    expect(resolveActiveTheme(deps).name).toBe('Aluna');
    expect(readSetting(deps, 'branding.activeTheme')).toBe('vereinsfarben');
    const actions = deps.db.select().from(auditLog).all().map((e) => e.action);
    expect(actions).toEqual(['themes.create', 'themes.update', 'themes.activate']);
  });

  it('rejects duplicate keys, edits to default, invalid themes and missing permission', async () => {
    const deps = createTestDeps();
    unwrap(await createTheme(deps, admin, club));
    const dup = await createTheme(deps, admin, club);
    expect(dup.ok === false && dup.error.type === 'conflict' && dup.error.code === 'themeKeyTaken').toBe(true);
    const ro = await updateTheme(deps, admin, { ...DEFAULT_THEME, name: 'X' });
    expect(ro.ok === false && ro.error.type === 'conflict' && ro.error.code === 'themeReadOnly').toBe(true);
    const bad = await createTheme(deps, admin, { key: 'x', name: 'X', tokens: {} });
    expect(bad.ok === false && bad.error.type === 'validation').toBe(true);
    const denied = await createTheme(deps, ctxWith(['users.manage']), { ...club, key: 'y' });
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
  });

  it('duplicates with all token values prefilled', async () => {
    const deps = createTestDeps();
    const copy = unwrap(await duplicateTheme(deps, admin, { sourceKey: 'default', key: 'kopie', name: 'Kopie' }));
    expect(copy.tokens).toEqual(DEFAULT_THEME.tokens);
    expect(listThemes(deps).themes.map((t) => t.key)).toEqual(['default', 'kopie']);
  });

  it('deletes only inactive non-default themes', async () => {
    const deps = createTestDeps();
    unwrap(await createTheme(deps, admin, club));
    const def = await deleteTheme(deps, admin, { key: 'default' });
    expect(def.ok === false && def.error.type === 'conflict' && def.error.code === 'themeReadOnly').toBe(true);
    unwrap(await activateTheme(deps, admin, { key: 'vereinsfarben' }));
    const active = await deleteTheme(deps, admin, { key: 'vereinsfarben' });
    expect(active.ok === false && active.error.type === 'conflict' && active.error.code === 'themeActive').toBe(true);
    unwrap(await activateTheme(deps, admin, { key: 'default' }));
    unwrap(await deleteTheme(deps, admin, { key: 'vereinsfarben' }));
    expect(listThemes(deps).themes).toHaveLength(1);
    const missing = await deleteTheme(deps, admin, { key: 'vereinsfarben' });
    expect(missing.ok === false && missing.error.type === 'notFound').toBe(true);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core test tests/themes-service.test.ts`
Expected: FAIL — Modul nicht gefunden.

- [ ] **Step 3: Implementieren**

`packages/core/src/themes/service.ts`:
```ts
import { z } from 'zod';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import type { Deps } from '../deps';
import { requirePermission } from '../permissions/check';
import { conflict, notFound, ok, type Result } from '../result';
import { readSetting, writeSettingInternal } from '../settings/service';
import { validate } from '../validate';
import { DEFAULT_THEME } from './default-theme';
import { THEME_KEY_PATTERN, themeSchema, type Theme } from './tokens';

const DEFAULT_KEY = 'default';

export function listThemes(deps: Deps): { themes: Theme[]; activeKey: string } {
  return { themes: readSetting<Theme[]>(deps, 'themes'), activeKey: readSetting<string>(deps, 'branding.activeTheme') };
}

export function resolveActiveTheme(deps: Deps): Theme {
  const { themes, activeKey } = listThemes(deps);
  return themes.find((t) => t.key === activeKey) ?? themes.find((t) => t.key === DEFAULT_KEY) ?? DEFAULT_THEME;
}

function saveThemes(tx: DbOrTx, deps: Deps, ctx: CallContext, themes: Theme[], action: string): Result<Theme[]> {
  const written = writeSettingInternal(tx, deps, ctx, 'themes', themes, action);
  return written.ok ? ok(themes) : written;
}

export async function createTheme(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<Theme>> {
  const denied = requirePermission(ctx, 'settings.manage');
  if (denied) return denied;
  const parsed = validate(themeSchema, input);
  if (!parsed.ok) return parsed;
  const theme = parsed.value;
  const { themes } = listThemes(deps);
  if (themes.some((t) => t.key === theme.key)) return conflict('themeKeyTaken', `Theme „${theme.key}" existiert bereits`);
  return deps.db.transaction((tx) => {
    const saved = saveThemes(tx, deps, ctx, [...themes, theme], 'themes.create');
    return saved.ok ? ok(theme) : saved;
  });
}

export async function updateTheme(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<Theme>> {
  const denied = requirePermission(ctx, 'settings.manage');
  if (denied) return denied;
  const parsed = validate(themeSchema, input);
  if (!parsed.ok) return parsed;
  const theme = parsed.value;
  if (theme.key === DEFAULT_KEY) return conflict('themeReadOnly', 'Das Default-Theme ist schreibgeschützt');
  const { themes } = listThemes(deps);
  if (!themes.some((t) => t.key === theme.key)) return notFound('theme', theme.key);
  return deps.db.transaction((tx) => {
    const saved = saveThemes(tx, deps, ctx, themes.map((t) => (t.key === theme.key ? theme : t)), 'themes.update');
    return saved.ok ? ok(theme) : saved;
  });
}

const duplicateSchema = z.object({ sourceKey: z.string().min(1), key: z.string().regex(THEME_KEY_PATTERN), name: z.string().trim().min(1).max(60) });

export async function duplicateTheme(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<Theme>> {
  const denied = requirePermission(ctx, 'settings.manage');
  if (denied) return denied;
  const parsed = validate(duplicateSchema, input);
  if (!parsed.ok) return parsed;
  const { themes } = listThemes(deps);
  const source = themes.find((t) => t.key === parsed.value.sourceKey);
  if (!source) return notFound('theme', parsed.value.sourceKey);
  if (themes.some((t) => t.key === parsed.value.key)) return conflict('themeKeyTaken', `Theme „${parsed.value.key}" existiert bereits`);
  const copy: Theme = { key: parsed.value.key, name: parsed.value.name, tokens: structuredClone(source.tokens) };
  return deps.db.transaction((tx) => {
    const saved = saveThemes(tx, deps, ctx, [...themes, copy], 'themes.duplicate');
    return saved.ok ? ok(copy) : saved;
  });
}

const keySchema = z.object({ key: z.string().min(1) });

export async function deleteTheme(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<void>> {
  const denied = requirePermission(ctx, 'settings.manage');
  if (denied) return denied;
  const parsed = validate(keySchema, input);
  if (!parsed.ok) return parsed;
  const { key } = parsed.value;
  if (key === DEFAULT_KEY) return conflict('themeReadOnly', 'Das Default-Theme kann nicht gelöscht werden');
  const { themes, activeKey } = listThemes(deps);
  if (!themes.some((t) => t.key === key)) return notFound('theme', key);
  if (key === activeKey) return conflict('themeActive', 'Das aktive Theme kann nicht gelöscht werden');
  return deps.db.transaction((tx) => {
    const saved = saveThemes(tx, deps, ctx, themes.filter((t) => t.key !== key), 'themes.delete');
    return saved.ok ? ok(undefined) : saved;
  });
}

export async function activateTheme(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<Theme>> {
  const denied = requirePermission(ctx, 'settings.manage');
  if (denied) return denied;
  const parsed = validate(keySchema, input);
  if (!parsed.ok) return parsed;
  const { themes } = listThemes(deps);
  const theme = themes.find((t) => t.key === parsed.value.key);
  if (!theme) return notFound('theme', parsed.value.key);
  return deps.db.transaction((tx) => {
    const written = writeSettingInternal(tx, deps, ctx, 'branding.activeTheme', theme.key, 'themes.activate');
    return written.ok ? ok(theme) : written;
  });
}
```

- [ ] **Step 4: Tests ausführen**

Run: `pnpm --filter @kompass/core test && pnpm --filter @kompass/core typecheck`
Expected: alle grün.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): theme management with read-only default and delete guards"
```

---

### Task 14: Modul-Service und veröffentlichte Sichten

**Files:**
- Create: `packages/core/src/modules/service.ts`, `packages/core/src/published/view.ts`
- Test: `packages/core/tests/modules.test.ts`, `packages/core/tests/published-view.test.ts`

**Interfaces:**
- Consumes: `Registry`, `readSetting('modules.enabled')`, `writeSettingInternal`.
- Produces:
  - `interface ModuleStatus { key; version; enabled: boolean; locked: boolean; dependsOn: string[] }`
  - `listModules(deps) → ModuleStatus[]`; `isModuleEnabled(deps, key) → boolean` (`core` immer `true`); `enabledManifests(deps) → ModuleManifest[]`.
  - `setModuleEnabled(deps, ctx, { key, enabled }) → Result<ModuleStatus>` — `modules.manage`; Codes `moduleLocked` (core), `moduleDependencyInactive`, `moduleRequiredByOthers`; unbekannt → `notFound('module', key)`.
  - `definePublishedView<T>({ name, schema, load }) → PublishedView<T>` — `load` gibt nur Felder des Schemas zurück (Zod strip).

- [ ] **Step 1: Tests schreiben**

`packages/core/tests/modules.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { auditLog } from '../src/db/schema';
import { defineModule } from '../src/modules/manifest';
import { enabledManifests, isModuleEnabled, listModules, setModuleEnabled } from '../src/modules/service';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith } from '../src/testing';

const finance = defineModule({ key: 'finance', version: '0.1.0', permissions: ['finance.view'] });
const website = defineModule({ key: 'website', version: '0.1.0', permissions: ['website.view'], dependsOn: ['finance'] });
const admin = ctxWith(['modules.manage']);

describe('modules service', () => {
  it('lists installed modules with core locked and enabled', () => {
    const deps = createTestDeps({ manifests: [coreModule, finance, website] });
    expect(listModules(deps)).toEqual([
      { key: 'core', version: '0.1.0', enabled: true, locked: true, dependsOn: [] },
      { key: 'finance', version: '0.1.0', enabled: false, locked: false, dependsOn: [] },
      { key: 'website', version: '0.1.0', enabled: false, locked: false, dependsOn: ['finance'] },
    ]);
    expect(isModuleEnabled(deps, 'core')).toBe(true);
    expect(enabledManifests(deps).map((m) => m.key)).toEqual(['core']);
  });

  it('enables and disables modules with audit entries', async () => {
    const deps = createTestDeps({ manifests: [coreModule, finance, website] });
    expect(unwrap(await setModuleEnabled(deps, admin, { key: 'finance', enabled: true })).enabled).toBe(true);
    expect(enabledManifests(deps).map((m) => m.key)).toEqual(['core', 'finance']);
    unwrap(await setModuleEnabled(deps, admin, { key: 'finance', enabled: false }));
    expect(isModuleEnabled(deps, 'finance')).toBe(false);
    expect(deps.db.select().from(auditLog).all().map((e) => e.action)).toEqual(['modules.enable', 'modules.disable']);
  });

  it('guards core, dependencies, unknown keys and permission', async () => {
    const deps = createTestDeps({ manifests: [coreModule, finance, website] });
    const core = await setModuleEnabled(deps, admin, { key: 'core', enabled: false });
    expect(core.ok === false && core.error.type === 'conflict' && core.error.code === 'moduleLocked').toBe(true);
    const dep = await setModuleEnabled(deps, admin, { key: 'website', enabled: true });
    expect(dep.ok === false && dep.error.type === 'conflict' && dep.error.code === 'moduleDependencyInactive').toBe(true);
    unwrap(await setModuleEnabled(deps, admin, { key: 'finance', enabled: true }));
    unwrap(await setModuleEnabled(deps, admin, { key: 'website', enabled: true }));
    const required = await setModuleEnabled(deps, admin, { key: 'finance', enabled: false });
    expect(required.ok === false && required.error.type === 'conflict' && required.error.code === 'moduleRequiredByOthers').toBe(true);
    const unknown = await setModuleEnabled(deps, admin, { key: 'animals', enabled: true });
    expect(unknown.ok === false && unknown.error.type === 'notFound').toBe(true);
    const denied = await setModuleEnabled(deps, ctxWith(['settings.manage']), { key: 'finance', enabled: false });
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
  });
});
```

`packages/core/tests/published-view.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { definePublishedView } from '../src/published/view';
import { createTestDeps } from '../src/testing';

describe('published views', () => {
  it('only exposes fields declared in the public schema', () => {
    const view = definePublishedView({
      name: 'projects',
      schema: z.object({ id: z.string(), name: z.string() }),
      load: () => [{ id: 'P1', name: 'Futterhilfe', internalNote: 'nicht öffentlich', reserveCents: 12345 }],
    });
    const deps = createTestDeps();
    expect(view.load(deps)).toEqual([{ id: 'P1', name: 'Futterhilfe' }]);
    expect(JSON.stringify(view.load(deps))).not.toContain('internalNote');
  });

  it('throws when a loader returns rows that violate the public schema', () => {
    const view = definePublishedView({ name: 'x', schema: z.object({ id: z.string() }), load: () => [{ id: 42 }] });
    expect(() => view.load(createTestDeps())).toThrow();
  });
});
```

- [ ] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core test tests/modules.test.ts tests/published-view.test.ts`
Expected: FAIL — Module nicht gefunden.

- [ ] **Step 3: Implementieren**

`packages/core/src/modules/service.ts`:
```ts
import { z } from 'zod';
import type { CallContext } from '../context';
import type { Deps } from '../deps';
import { requirePermission } from '../permissions/check';
import { conflict, notFound, ok, type Result } from '../result';
import { readSetting, writeSettingInternal } from '../settings/service';
import { validate } from '../validate';
import type { ModuleManifest } from './manifest';

export const CORE_MODULE_KEY = 'core';

export interface ModuleStatus {
  key: string;
  version: string;
  enabled: boolean;
  locked: boolean;
  dependsOn: string[];
}

function enabledKeys(deps: Deps): Set<string> {
  return new Set([CORE_MODULE_KEY, ...readSetting<string[]>(deps, 'modules.enabled')]);
}

export function isModuleEnabled(deps: Deps, key: string): boolean {
  return enabledKeys(deps).has(key);
}

export function enabledManifests(deps: Deps): ModuleManifest[] {
  const keys = enabledKeys(deps);
  return deps.registry.manifests.filter((m) => keys.has(m.key));
}

export function listModules(deps: Deps): ModuleStatus[] {
  const keys = enabledKeys(deps);
  return deps.registry.manifests.map((m) => ({
    key: m.key,
    version: m.version,
    enabled: keys.has(m.key),
    locked: m.key === CORE_MODULE_KEY,
    dependsOn: [...(m.dependsOn ?? [])],
  }));
}

const setEnabledSchema = z.object({ key: z.string().min(1), enabled: z.boolean() });

export async function setModuleEnabled(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ModuleStatus>> {
  const denied = requirePermission(ctx, 'modules.manage');
  if (denied) return denied;
  const parsed = validate(setEnabledSchema, input);
  if (!parsed.ok) return parsed;
  const { key, enabled } = parsed.value;
  const manifest = deps.registry.module(key);
  if (!manifest) return notFound('module', key);
  if (key === CORE_MODULE_KEY) return conflict('moduleLocked', 'Der Kern kann nicht deaktiviert werden');
  const current = enabledKeys(deps);
  if (enabled) {
    const missing = (manifest.dependsOn ?? []).filter((dep) => !current.has(dep));
    if (missing.length > 0) return conflict('moduleDependencyInactive', `Benötigt aktive Module: ${missing.join(', ')}`);
  } else {
    const dependents = deps.registry.manifests.filter((m) => current.has(m.key) && (m.dependsOn ?? []).includes(key));
    if (dependents.length > 0) return conflict('moduleRequiredByOthers', `Wird benötigt von: ${dependents.map((m) => m.key).join(', ')}`);
  }
  const next = [...current].filter((k) => k !== CORE_MODULE_KEY && k !== key);
  if (enabled) next.push(key);
  next.sort();
  return deps.db.transaction((tx) => {
    const written = writeSettingInternal(tx, deps, ctx, 'modules.enabled', next, enabled ? 'modules.enable' : 'modules.disable');
    if (!written.ok) return written;
    return ok(listModules(deps).find((m) => m.key === key) as ModuleStatus);
  });
}
```

`packages/core/src/published/view.ts`:
```ts
import type { z } from 'zod';
import type { Deps } from '../deps';
import type { PublishedView } from '../modules/manifest';

/**
 * Eine veröffentlichte Sicht liefert ausschließlich Felder ihres öffentlichen Schemas.
 * Der Loader darf intern mehr laden; alles Undeklarierte wird beim Parsen entfernt.
 */
export function definePublishedView<T extends Record<string, unknown>>(def: {
  name: string;
  schema: z.ZodObject<z.ZodRawShape>;
  load: (deps: Deps) => unknown[];
}): PublishedView<T> {
  return {
    name: def.name,
    schema: def.schema as unknown as z.ZodType<T>,
    load: (deps) => def.load(deps).map((row) => def.schema.parse(row) as T),
  };
}
```

- [ ] **Step 4: Tests ausführen**

Run: `pnpm --filter @kompass/core test && pnpm --filter @kompass/core typecheck`
Expected: alle grün. Hinweis: `listModules(deps)` innerhalb der Transaktion liest über `deps.db`; better-sqlite3 sieht in derselben Verbindung die eigene ungeschriebene Transaktion, daher ist das Ergebnis korrekt.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): module enable/disable with dependency guards and published views"
```

---

### Task 15: Änderungsprotokoll abfragen

**Files:**
- Create: `packages/core/src/audit/query.ts`
- Test: `packages/core/tests/audit-query.test.ts`

**Interfaces:**
- Consumes: Tabelle `auditLog`, `users` (für Nutzernamen), `requirePermission('audit.view')`.
- Produces:
  - `interface AuditEntry { id; occurredAt; userId; userName: string | null; channel; action; entityType; entityId; before: unknown; after: unknown; summary; apiTokenId; ipAddress; requestId; environment }`
  - `queryAudit(deps, ctx, { userId?, channel?, action?, entityType?, entityId?, from?, to?, text?, limit?, offset? }) → Result<{ entries: AuditEntry[]; total: number }>` — neueste zuerst, `limit` 1–200 (Default 50).
  - `getAuditEntry(deps, ctx, id) → Result<AuditEntry>`.

- [ ] **Step 1: Test schreiben**

`packages/core/tests/audit-query.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { recordAudit } from '../src/audit/log';
import { getAuditEntry, queryAudit } from '../src/audit/query';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith, insertUser, systemContext } from '../src/testing';

describe('audit query', () => {
  function seed(deps: ReturnType<typeof createTestDeps>) {
    const anna = insertUser(deps, { name: 'Anna Berger', email: 'anna@example.org' });
    recordAudit(deps.db, deps, ctxWith([], anna), { action: 'settings.update', entityType: 'setting', entityId: 'organization.name', before: 'A', after: 'B', summary: 'organization.name geändert' });
    deps.clock.advance(1000);
    recordAudit(deps.db, deps, { ...ctxWith([], anna), channel: 'mcp', apiTokenId: 'T1' }, { action: 'roles.create', entityType: 'role', entityId: 'R1', summary: 'Rolle angelegt' });
    deps.clock.advance(1000);
    recordAudit(deps.db, deps, systemContext('REQ-S'), { action: 'auth.locked', entityType: 'user', entityId: anna, summary: 'Konto gesperrt' });
    return anna;
  }

  it('returns newest first with user names and parsed payloads', () => {
    const deps = createTestDeps();
    seed(deps);
    const { entries, total } = unwrap(queryAudit(deps, ctxWith(['audit.view']), {}));
    expect(total).toBe(3);
    expect(entries.map((e) => e.action)).toEqual(['auth.locked', 'roles.create', 'settings.update']);
    expect(entries[2]).toMatchObject({ userName: 'Anna Berger', before: 'A', after: 'B' });
    expect(entries[0]?.userName).toBeNull();
  });

  it('filters by channel, user, action, entity, time range and text', () => {
    const deps = createTestDeps();
    const anna = seed(deps);
    const view = ctxWith(['audit.view']);
    expect(unwrap(queryAudit(deps, view, { channel: 'mcp' })).entries.map((e) => e.action)).toEqual(['roles.create']);
    expect(unwrap(queryAudit(deps, view, { userId: anna })).total).toBe(2);
    expect(unwrap(queryAudit(deps, view, { action: 'auth.locked' })).total).toBe(1);
    expect(unwrap(queryAudit(deps, view, { entityType: 'setting', entityId: 'organization.name' })).total).toBe(1);
    expect(unwrap(queryAudit(deps, view, { from: '2026-09-05T08:00:01.000Z' })).total).toBe(2);
    expect(unwrap(queryAudit(deps, view, { to: '2026-09-05T08:00:01.000Z' })).total).toBe(2);
    expect(unwrap(queryAudit(deps, view, { text: 'gesperrt' })).total).toBe(1);
    expect(unwrap(queryAudit(deps, view, { limit: 1, offset: 1 })).entries.map((e) => e.action)).toEqual(['roles.create']);
  });

  it('requires audit.view and validates limits', () => {
    const deps = createTestDeps();
    seed(deps);
    expect(queryAudit(deps, ctxWith(['users.manage']), {}).ok).toBe(false);
    const tooMany = queryAudit(deps, ctxWith(['audit.view']), { limit: 5000 });
    expect(tooMany.ok === false && tooMany.error.type === 'validation').toBe(true);
    const id = unwrap(queryAudit(deps, ctxWith(['audit.view']), {})).entries[0]!.id;
    expect(unwrap(getAuditEntry(deps, ctxWith(['audit.view']), id)).action).toBe('auth.locked');
    expect(getAuditEntry(deps, ctxWith(['audit.view']), 'nope').ok).toBe(false);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core test tests/audit-query.test.ts`
Expected: FAIL — Modul nicht gefunden.

- [ ] **Step 3: Implementieren**

`packages/core/src/audit/query.ts`:
```ts
import { and, desc, eq, getTableColumns, gte, like, lte, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { CallContext } from '../context';
import { auditLog, users } from '../db/schema';
import type { Deps } from '../deps';
import { requirePermission } from '../permissions/check';
import { notFound, ok, type Result } from '../result';
import { validate } from '../validate';

export interface AuditEntry {
  id: string;
  occurredAt: string;
  userId: string | null;
  userName: string | null;
  channel: 'ui' | 'mcp' | 'system';
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  summary: string;
  apiTokenId: string | null;
  ipAddress: string | null;
  requestId: string;
  environment: string;
}

const querySchema = z.object({
  userId: z.string().optional(),
  channel: z.enum(['ui', 'mcp', 'system']).optional(),
  action: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  text: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

const parseJson = (value: string | null): unknown => (value === null ? null : JSON.parse(value));

type Row = typeof auditLog.$inferSelect & { userName: string | null };

const toEntry = (row: Row): AuditEntry => ({
  id: row.id,
  occurredAt: row.occurredAt,
  userId: row.userId,
  userName: row.userName,
  channel: row.channel,
  action: row.action,
  entityType: row.entityType,
  entityId: row.entityId,
  before: parseJson(row.before),
  after: parseJson(row.after),
  summary: row.summary,
  apiTokenId: row.apiTokenId,
  ipAddress: row.ipAddress,
  requestId: row.requestId,
  environment: row.environment,
});

export function queryAudit(deps: Deps, ctx: CallContext, input: unknown): Result<{ entries: AuditEntry[]; total: number }> {
  const denied = requirePermission(ctx, 'audit.view');
  if (denied) return denied;
  const parsed = validate(querySchema, input);
  if (!parsed.ok) return parsed;
  const q = parsed.value;
  const conditions: SQL[] = [];
  if (q.userId) conditions.push(eq(auditLog.userId, q.userId));
  if (q.channel) conditions.push(eq(auditLog.channel, q.channel));
  if (q.action) conditions.push(eq(auditLog.action, q.action));
  if (q.entityType) conditions.push(eq(auditLog.entityType, q.entityType));
  if (q.entityId) conditions.push(eq(auditLog.entityId, q.entityId));
  if (q.from) conditions.push(gte(auditLog.occurredAt, q.from));
  if (q.to) conditions.push(lte(auditLog.occurredAt, q.to));
  if (q.text) {
    const pattern = `%${q.text}%`;
    conditions.push(or(like(auditLog.summary, pattern), like(auditLog.entityId, pattern), like(auditLog.after, pattern), like(auditLog.before, pattern)) as SQL);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const total = deps.db.select({ count: sql<number>`count(*)` }).from(auditLog).where(where).get()?.count ?? 0;
  const rows = deps.db
    .select({ ...getTableColumns(auditLog), userName: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(where)
    .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
    .limit(q.limit)
    .offset(q.offset)
    .all();
  return ok({ entries: rows.map((row) => toEntry(row as Row)), total });
}

export function getAuditEntry(deps: Deps, ctx: CallContext, id: string): Result<AuditEntry> {
  const denied = requirePermission(ctx, 'audit.view');
  if (denied) return denied;
  const row = deps.db
    .select({ ...getTableColumns(auditLog), userName: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(eq(auditLog.id, id))
    .get();
  return row ? ok(toEntry(row as Row)) : notFound('auditEntry', id);
}
```

- [ ] **Step 4: Tests ausführen**

Run: `pnpm --filter @kompass/core test && pnpm --filter @kompass/core typecheck`
Expected: alle grün.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): filterable audit log queries with user names and parsed diffs"
```

---

### Task 16: Setup, Composition Root, Seed und öffentliche Exporte

**Files:**
- Create: `packages/core/src/setup/service.ts`, `packages/core/src/app.ts`, `packages/core/src/seed/seed.ts`, `packages/core/src/seed/cli.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/setup.test.ts`, `packages/core/tests/app.test.ts`, `packages/core/tests/seed.test.ts`

**Interfaces:**
- Consumes: alles Bisherige.
- Produces:
  - `isSetupRequired(deps) → boolean`; `completeSetup(deps, { organizationName, name, email, password, requestId, ipAddress }) → Result<{ userId; sessionId; expiresAt }>` — Code `setupAlreadyDone`.
  - `createDeps({ databasePath, env, modules?, clock? }) → Deps & { close(): void }` (öffnet DB, migriert, baut Registry).
  - `readEnv(source?) → { env: AppEnv; databasePath; mediaPath; port; sessionSecret }` mit Zod-Validierung (`APP_ENV`, `DATABASE_PATH`, `MEDIA_PATH`, `PORT`, `SESSION_SECRET`).
  - `seedDevelopment(deps) → { adminEmail; adminPassword }` — idempotent, wirft außerhalb `development`/`test`.
  - `src/index.ts` exportiert alle Services, Typen und `coreModule`.

- [ ] **Step 1: Tests schreiben**

`packages/core/tests/setup.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { resolveSession } from '../src/auth/sessions';
import { auditLog, roles } from '../src/db/schema';
import { unwrap } from '../src/result';
import { readSetting } from '../src/settings/service';
import { completeSetup, isSetupRequired } from '../src/setup/service';
import { createTestDeps } from '../src/testing';

const input = { organizationName: 'Musterverein e.V.', name: 'Anna Berger', email: 'anna@example.org', password: 'ein-langes-merkbares-passwort', requestId: 'REQ-SETUP', ipAddress: '10.0.0.2' };

describe('setup', () => {
  it('is required on an empty database and creates the protected admin role, the user, the org name and a session', async () => {
    const deps = createTestDeps();
    expect(isSetupRequired(deps)).toBe(true);
    const result = unwrap(await completeSetup(deps, input));
    expect(isSetupRequired(deps)).toBe(false);
    const role = deps.db.select().from(roles).all()[0]!;
    expect(role).toMatchObject({ name: 'Administration', isProtected: true });
    const resolved = resolveSession(deps, result.sessionId, { ipAddress: null, requestId: 'R' });
    expect(resolved?.user.email).toBe('anna@example.org');
    expect(resolved?.mustChangePassword).toBe(false);
    expect(resolved?.ctx.permissions.size).toBe(deps.registry.permissionKeys.size);
    expect(readSetting(deps, 'organization.name')).toBe('Musterverein e.V.');
    const actions = deps.db.select().from(auditLog).all().map((e) => e.action);
    expect(actions).toContain('setup.complete');
    expect(deps.db.select().from(auditLog).all().every((e) => e.userId === result.userId)).toBe(true);
  });

  it('refuses a second setup and validates input', async () => {
    const deps = createTestDeps();
    unwrap(await completeSetup(deps, input));
    const again = await completeSetup(deps, { ...input, email: 'other@example.org' });
    expect(again.ok === false && again.error.type === 'conflict' && again.error.code === 'setupAlreadyDone').toBe(true);
    const fresh = createTestDeps();
    const short = await completeSetup(fresh, { ...input, password: 'kurz' });
    expect(short.ok === false && short.error.type === 'validation').toBe(true);
    expect(isSetupRequired(fresh)).toBe(true);
  });
});
```

`packages/core/tests/app.test.ts`:
```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDeps, readEnv } from '../src/app';
import { isSetupRequired } from '../src/setup/service';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('createDeps', () => {
  it('opens a file database, migrates it and can be reopened', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kompass-'));
    dirs.push(dir);
    const file = path.join(dir, 'kompass.db');
    const first = createDeps({ databasePath: file, env: 'test' });
    expect(isSetupRequired(first)).toBe(true);
    expect(first.registry.module('core')).toBeDefined();
    first.close();
    const second = createDeps({ databasePath: file, env: 'test' });
    expect(isSetupRequired(second)).toBe(true);
    second.close();
  });
});

describe('readEnv', () => {
  const base = { APP_ENV: 'production', DATABASE_PATH: '/data/kompass.db', MEDIA_PATH: '/media', PORT: '3000', SESSION_SECRET: 'x'.repeat(32) };

  it('parses a complete environment', () => {
    expect(readEnv(base)).toEqual({ env: 'production', databasePath: '/data/kompass.db', mediaPath: '/media', port: 3000, sessionSecret: 'x'.repeat(32) });
  });

  it('defaults to development with local paths when only the secret is set', () => {
    const env = readEnv({ SESSION_SECRET: 'y'.repeat(32) });
    expect(env.env).toBe('development');
    expect(env.databasePath).toBe('./data/kompass.db');
    expect(env.port).toBe(3000);
  });

  it('rejects unknown APP_ENV and short secrets', () => {
    expect(() => readEnv({ ...base, APP_ENV: 'staging' })).toThrow(/APP_ENV/);
    expect(() => readEnv({ ...base, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });
});
```

`packages/core/tests/seed.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { login } from '../src/auth/login';
import { roles, users } from '../src/db/schema';
import { seedDevelopment } from '../src/seed/seed';
import { createTestDeps } from '../src/testing';

describe('seedDevelopment', () => {
  it('creates an admin, example roles and users, and is idempotent', async () => {
    const deps = createTestDeps({ env: 'development' });
    const first = await seedDevelopment(deps);
    const second = await seedDevelopment(deps);
    expect(second).toEqual(first);
    expect(deps.db.select().from(roles).all().map((r) => r.name).sort()).toEqual(['Administration', 'Kassenprüfer', 'Schatzmeisterin', 'Schriftführung']);
    expect(deps.db.select().from(users).all()).toHaveLength(4);
    const session = await login(deps, { email: first.adminEmail, password: first.adminPassword, ipAddress: null, requestId: 'R' });
    expect(session.ok).toBe(true);
  });

  it('refuses to run in production', async () => {
    const deps = createTestDeps({ env: 'production' });
    await expect(seedDevelopment(deps)).rejects.toThrow(/production/);
  });
});
```

- [ ] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core test tests/setup.test.ts tests/app.test.ts tests/seed.test.ts`
Expected: FAIL — Module nicht gefunden.

- [ ] **Step 3: Setup implementieren**

`packages/core/src/setup/service.ts`:
```ts
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { hashPassword, passwordSchema } from '../auth/password';
import { createSession } from '../auth/sessions';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import { roles, userRoles, users } from '../db/schema';
import type { Deps } from '../deps';
import { newId } from '../ids';
import { conflict, ok, type Result } from '../result';
import { writeSettingInternal } from '../settings/service';
import { normalizeEmail } from '../users/service';
import { validate } from '../validate';

export const PROTECTED_ROLE_NAME = 'Administration';

export function isSetupRequired(deps: Deps): boolean {
  const row = deps.db.select({ count: sql<number>`count(*)` }).from(users).get();
  return (row?.count ?? 0) === 0;
}

const setupSchema = z.object({
  organizationName: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(120),
  email: z.email().transform(normalizeEmail),
  password: passwordSchema,
  requestId: z.string().min(1),
  ipAddress: z.string().nullable(),
});

export async function completeSetup(deps: Deps, input: unknown): Promise<Result<{ userId: string; sessionId: string; expiresAt: string }>> {
  if (!isSetupRequired(deps)) return conflict('setupAlreadyDone', 'Die Einrichtung wurde bereits abgeschlossen');
  const parsed = validate(setupSchema, input);
  if (!parsed.ok) return parsed;
  const { organizationName, name, email, password, requestId, ipAddress } = parsed.value;
  const passwordHash = await hashPassword(password);
  return deps.db.transaction((tx) => {
    const now = isoNow(deps.clock);
    const userId = newId();
    const roleId = newId();
    tx.insert(users).values({ id: userId, name, email, passwordHash, mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now }).run();
    tx.insert(roles).values({ id: roleId, name: PROTECTED_ROLE_NAME, description: 'Alle Rechte. Wird beim Setup angelegt und ist geschützt.', isProtected: true, createdAt: now }).run();
    tx.insert(userRoles).values({ userId, roleId }).run();
    const ctx: CallContext = { userId, permissions: new Set(deps.registry.permissionKeys), channel: 'ui', apiTokenId: null, ipAddress, requestId };
    const org = writeSettingInternal(tx, deps, ctx, 'organization.name', organizationName, 'setup.organizationName');
    if (!org.ok) return org;
    const session = createSession(tx, deps, userId);
    tx.update(users).set({ lastLoginAt: now }).where(eq(users.id, userId)).run();
    recordAudit(tx, deps, ctx, { action: 'setup.complete', entityType: 'user', entityId: userId, after: { name, email, role: PROTECTED_ROLE_NAME }, summary: `Einrichtung abgeschlossen durch ${name}` });
    return ok({ userId, sessionId: session.id, expiresAt: session.expiresAt });
  });
}
```

- [ ] **Step 4: Composition Root implementieren**

`packages/core/src/app.ts`:
```ts
import { z } from 'zod';
import { systemClock, type Clock } from './clock';
import { coreModule } from './core-module';
import { openDatabase, runMigrations } from './db/client';
import type { AppEnv, Deps } from './deps';
import type { ModuleManifest } from './modules/manifest';
import { createRegistry } from './modules/registry';

export interface CreateDepsOptions {
  databasePath: string;
  env: AppEnv;
  modules?: ModuleManifest[];
  clock?: Clock;
}

export function createDeps(opts: CreateDepsOptions): Deps & { close(): void } {
  const { db, sqlite } = openDatabase(opts.databasePath);
  runMigrations(db);
  return {
    db,
    clock: opts.clock ?? systemClock,
    env: opts.env,
    registry: createRegistry([coreModule, ...(opts.modules ?? [])]),
    close: () => sqlite.close(),
  };
}

const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_PATH: z.string().min(1).default('./data/kompass.db'),
  MEDIA_PATH: z.string().min(1).default('./media'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SESSION_SECRET: z.string().min(32),
});

export interface RuntimeEnv {
  env: AppEnv;
  databasePath: string;
  mediaPath: string;
  port: number;
  sessionSecret: string;
}

export function readEnv(source: Record<string, string | undefined> = process.env): RuntimeEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`invalid environment: ${names}`);
  }
  const v = parsed.data;
  return { env: v.APP_ENV, databasePath: v.DATABASE_PATH, mediaPath: v.MEDIA_PATH, port: v.PORT, sessionSecret: v.SESSION_SECRET };
}
```

- [ ] **Step 5: Seed implementieren**

`packages/core/src/seed/seed.ts`:
```ts
import { eq } from 'drizzle-orm';
import type { CallContext } from '../context';
import { roles, users } from '../db/schema';
import type { Deps } from '../deps';
import { unwrap } from '../result';
import { createRole, setRolePermissions } from '../roles/service';
import { completeSetup, isSetupRequired } from '../setup/service';
import { createUser } from '../users/service';

export const SEED_ADMIN_EMAIL = 'admin@kompass.local';
export const SEED_ADMIN_PASSWORD = 'kompass-entwicklung-2026';

const EXAMPLE_ROLES: { name: string; description: string; permissions: string[] }[] = [
  { name: 'Schatzmeisterin', description: 'Finanzen und Dokumente', permissions: ['documents.create', 'documents.view', 'media.upload', 'audit.view', 'backup.export'] },
  { name: 'Kassenprüfer', description: 'Nur lesen', permissions: ['audit.view', 'documents.view'] },
  { name: 'Schriftführung', description: 'Dokumente erzeugen', permissions: ['documents.create', 'documents.view'] },
];

const EXAMPLE_USERS: { name: string; email: string; role: string }[] = [
  { name: 'Jonas Feld', email: 'jonas@kompass.local', role: 'Schatzmeisterin' },
  { name: 'Mira Klein', email: 'mira@kompass.local', role: 'Kassenprüfer' },
  { name: 'Peter Lang', email: 'peter@kompass.local', role: 'Schriftführung' },
];

export async function seedDevelopment(deps: Deps): Promise<{ adminEmail: string; adminPassword: string }> {
  if (deps.env === 'production') throw new Error('seedDevelopment must not run in production');
  if (isSetupRequired(deps)) {
    unwrap(await completeSetup(deps, { organizationName: 'Musterverein e.V.', name: 'Anna Berger', email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD, requestId: 'SEED', ipAddress: null }));
  }
  const admin = deps.db.select({ id: users.id }).from(users).where(eq(users.email, SEED_ADMIN_EMAIL)).get();
  if (!admin) throw new Error('seed admin missing');
  const ctx: CallContext = { userId: admin.id, permissions: new Set(deps.registry.permissionKeys), channel: 'system', apiTokenId: null, ipAddress: null, requestId: 'SEED' };

  const roleIds = new Map<string, string>();
  for (const role of EXAMPLE_ROLES) {
    const created = await createRole(deps, ctx, { name: role.name, description: role.description });
    if (created.ok) {
      unwrap(await setRolePermissions(deps, ctx, { roleId: created.value.id, permissionKeys: role.permissions }));
      roleIds.set(role.name, created.value.id);
    } else {
      const existing = deps.db.select({ id: roles.id }).from(roles).where(eq(roles.name, role.name)).get();
      if (existing) roleIds.set(role.name, existing.id);
    }
  }
  for (const person of EXAMPLE_USERS) {
    const exists = deps.db.select({ id: users.id }).from(users).where(eq(users.email, person.email)).get();
    if (exists) continue;
    const roleId = roleIds.get(person.role);
    unwrap(await createUser(deps, ctx, { name: person.name, email: person.email, roleIds: roleId ? [roleId] : [] }));
  }
  return { adminEmail: SEED_ADMIN_EMAIL, adminPassword: SEED_ADMIN_PASSWORD };
}
```

`packages/core/src/seed/cli.ts`:
```ts
import { createDeps, readEnv } from '../app';
import { seedDevelopment } from './seed';

const runtime = readEnv({ SESSION_SECRET: 'seed-only-not-a-real-secret-value-0000', ...process.env });
const deps = createDeps({ databasePath: runtime.databasePath, env: runtime.env });
try {
  const { adminEmail, adminPassword } = await seedDevelopment(deps);
  console.log(`Seed abgeschlossen. Login: ${adminEmail} / ${adminPassword}`);
} finally {
  deps.close();
}
```

- [ ] **Step 6: Öffentliche Exporte**

`packages/core/src/index.ts` vollständig ersetzen:
```ts
export const CORE_VERSION = '0.1.0';

export * from './result';
export * from './clock';
export { newId, ID_PATTERN } from './ids';
export * from './context';
export type { AppEnv, Deps } from './deps';
export { validate } from './validate';
export * as schema from './db/schema';
export type { Db, DbOrTx } from './db/client';
export { openDatabase, runMigrations } from './db/client';
export * from './permissions/core';
export * from './permissions/check';
export * from './modules/manifest';
export * from './modules/registry';
export * from './modules/service';
export { coreModule } from './core-module';
export * from './audit/log';
export * from './audit/query';
export * from './settings/service';
export { CORE_SETTINGS } from './settings/core';
export * from './auth/password';
export * from './auth/sessions';
export * from './auth/login';
export * from './auth/tokens';
export * from './roles/service';
export * from './roles/effective';
export * from './users/service';
export * from './themes/tokens';
export * from './themes/default-theme';
export * from './themes/contrast';
export * from './themes/service';
export * from './published/view';
export * from './setup/service';
export * from './app';
export * from './seed/seed';
```

- [ ] **Step 7: Tests, Typecheck, Seed-CLI ausprobieren**

Run: `pnpm --filter @kompass/core test && pnpm --filter @kompass/core typecheck`
Expected: alle grün (etwa 70 Tests).

Run: `mkdir -p packages/core/data && cd packages/core && APP_ENV=development DATABASE_PATH=./data/kompass.db pnpm seed && cd ../..`
Expected: `Seed abgeschlossen. Login: admin@kompass.local / kompass-entwicklung-2026`; die Datei `packages/core/data/kompass.db` ist git-ignoriert.

- [ ] **Step 8: Commit**

```bash
git add packages/core
git commit -m "feat(core): first-run setup, composition root, env parsing and development seed"
```

---

## Abschluss dieses Plans

Nach Task 16 existiert der komplette Kern mit Tests. Was bewusst **nicht** in diesem Plan ist und in den Folgeplänen kommt:

- **`fundament-2-oberflaeche`**: `apps/kompass` (Next.js), App-Shell, Login/Setup-Seiten, Admin-Seiten, Theme-Editor, Befehlspalette, Fehlerseiten, i18n `messages/de.json`, Tailwind/shadcn auf Theme-Tokens, Umgebungsbalken, Playwright-Pfade.
- **`fundament-3-betrieb`**: `packages/documents` (Typst, Briefbogen, Protokoll-Export, `documents`-Service mit Nummernkreis und Storno), `packages/mcp` (Streamable HTTP, Tools auf die Kern-Services), Media-Speicher (`mediaAssets`-Service mit `MEDIA_PATH`), Backup-Export/-Import, Dockerfile, Compose, GitHub Actions, Lint-Regel gegen Farbliterale.

## Self-Review (durchgeführt beim Schreiben)

**Spec-Abdeckung (Abschnitte 4–6, Kern-Teile von 8):**
- Repo-Struktur, pnpm, TS strict, Drizzle/SQLite, Migrationen beim Start → Task 1, 3, 16 (`createDeps`).
- `users` inkl. `mustChangePassword`, Sperre, Startpasswort, Passwortregel, Sitzungsende bei Passwortwechsel → Task 7, 9, 10.
- `sessions`, `apiTokens` (Hash, Prefix, einmalige Anzeige, Widerruf, Kanal `mcp`) → Task 10, 11.
- `roles` mit `isProtected`, keine Löschung, letzter Admin → Task 8, 9, 16.
- `settings` als Registry mit Zod, `systemOnly`, Audit → Task 6.
- `auditLog` mit Token, IP, Vorgangs-ID, Umgebung, nur INSERT (Trigger) → Task 5, Abfrage Task 15.
- `mediaAssets`, `documents` (Schema inkl. Nummer, Storno) → Task 3 (Services in Plan 3).
- Modul-Manifest, Registry, `modules.enabled`, Core gesperrt, Abhängigkeiten → Task 4, 14.
- Service-Signatur, `Result`-Fehlertypen, Audit in derselben Transaktion → Task 2, alle Services.
- Veröffentlichte Sichten (Schnittstelle + Test) → Task 14.
- Theme-Token-Schema (58 Tokens), Default-Theme als Seed, keine Vererbung, Default schreibgeschützt, aktiv/Default nicht löschbar, Kontrastprüfung → Task 12, 13.
- Setup-Seite-Logik (genau einmal Admin) → Task 16. Seed → Task 16.
- Testing: Service-Tests gegen frische SQLite, Regeltests (kein Löschpfad, Audit unveränderbar, Sichten strippen) → Task 5, 9, 14. Playwright/Adapter-Tests folgen mit den Adaptern in Plan 2/3.

**Placeholder-Scan:** keine TBD/TODO; jede Code-Task enthält Test- und Implementierungscode.

**Typkonsistenz geprüft:** `Deps`/`CallContext`/`Result` überall gleich; `recordAudit(tx, deps, ctx, input)`; `writeSettingInternal(tx, deps, ctx, key, value, action)`; `loadUserSummary`, `normalizeEmail` aus `users/service` in `auth/*` und `setup` wiederverwendet; `countActiveProtectedHolders(db, { excludeUserId })` in `roles` und `users`; `RequestMeta` aus `auth/sessions` in `auth/tokens`.
