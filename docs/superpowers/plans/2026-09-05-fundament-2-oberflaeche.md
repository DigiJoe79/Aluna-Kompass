# Fundament Teil 2: Oberfläche (`apps/kompass`) — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Next.js-Admin-Oberfläche des Fundaments bauen: Ersteinrichtung, Login, Pflicht-Passwortwechsel, App-Shell mit Umgebungsbalken, Startseite, Nutzer, Rollen mit Rechte-Matrix, Einstellungen, Theme-Editor, Module, Änderungsprotokoll, Profil mit API-Tokens, Befehlspalette und Fehlerseiten — vollständig auf Theme-Tokens, deutsch über i18n, mit Playwright-Tests als treibende Tests je Screen.

**Architecture:** `apps/kompass` ist ein reiner Adapter auf `packages/core`: Server Components lesen über Kern-Services, Server Actions rufen Kern-Services mit einem aus Session-Cookie und Request-Headern gebauten `CallContext` und übersetzen `Result`-Fehler in i18n-Texte. Es gibt keine Fachlogik in der App. Farben, Schriften und Radien kommen ausschließlich als CSS-Custom-Properties aus dem aktiven Theme, das der Root-Layout zur Laufzeit injiziert; Tailwind-Utilities sind auf diese Variablen gemappt, die Standardpalette ist entfernt.

**Tech Stack:** Next.js 16.3 (App Router, Turbopack, `proxy.ts`, async Request-APIs) · React 19.2 · TypeScript 6 · Tailwind 4.3 + shadcn (CLI 4) · next-intl 4.14 (Single Locale, ohne Routing) · lucide-react · @fontsource (self-hosted) · Vitest 5 (Adapter und reine Helfer) · Playwright 1.63 (E2E gegen `next dev`).

**Spec:** `docs/superpowers/specs/2026-09-05-fundament-design.md` — Abschnitte 6 („Themes", „Oberfläche"), 8 (Umgebungen, E2E-Tests) und 8a (Design-Referenz). Design-Handoff: `docs/design/fundament/design_handoff_aluna_kompass_fundament/README.md` (Artboards `1c`–`1p`, `2a`–`2f`, Maße und Copy dort sind verbindlich).

**Voraussetzung:** Plan `2026-09-05-fundament-1-kern.md` ist vollständig umgesetzt (`pnpm --filter @kompass/core test` grün). Task 1 gleicht die angenommenen Kern-Schnittstellen mit dem tatsächlichen Stand ab.

## Global Constraints

- **Kein Farb-, Schatten- oder Radius-Literal in `apps/kompass/src`** außer in `src/components/shell/env-banner.tsx` (die vier Umgebungsbalken-Farben, markiert mit `// theme-exception: environment banner`). Ein Vitest-Test (Task 2) scannt den Quellbaum und schlägt sonst fehl. Tailwind-Standardpalette ist entfernt: `bg-red-500` existiert nicht.
- **Kein hartcodierter UI-Text.** Jede sichtbare Zeichenkette kommt aus `messages/de.json` über `useTranslations`/`getTranslations`. Anrede Sie-Form. Fehlercodes des Kerns werden über `errors.*`-Schlüssel übersetzt.
- **Ein Weg zu den Daten:** Seiten und Actions importieren nur aus `@kompass/core` und `@/lib/*`. Kein Drizzle-Import in `apps/kompass` außer in `src/lib/deps.ts`.
- **Rechte:** Jede Seite prüft serverseitig `requirePermission` und rendert bei Verstoß die 403-Karte innerhalb der Shell; jede Action prüft über den Kern-Service. UI blendet Aktionen ohne Recht aus, verlässt sich aber nie darauf.
- **Kein Löschen-Knopf** für Nutzer, Rollen, Einstellungen, Protokoll, Dokumente, Module. Themes dürfen gelöscht werden (außer aktiv/Default).
- **Umgebungsbalken** bei `APP_ENV !== 'production'`, 28 px, schiebt die App nach unten, nicht schließbar, theme-unabhängig.
- **Async Request-APIs:** `await cookies()`, `await headers()`, `await props.params`, `await props.searchParams`.
- **Maße aus dem Handoff** (Sidebar 248/56 px, Topbar 56 px, Zeilen `var(--row-h)`, Drawer unter 1180 px, Formulare einspaltig unter 1024 px).
- **TDD:** Reine Helfer und Adapter mit Vitest zuerst; jeder Screen beginnt mit einem fehlschlagenden Playwright-Test gegen die laufende App.
- **Versionen** (Stand 2026-09-05): `next ^16.3.4`, `react ^19.2.8`, `react-dom ^19.2.8`, `@types/react ^19.2.18`, `next-intl ^4.14.2`, `tailwindcss ^4.3.3`, `@tailwindcss/postcss ^4.3.3`, `shadcn` CLI 4.21 (per `pnpm dlx`), `lucide-react ^1.41.0`, `sonner ^2.0.8`, `class-variance-authority ^0.7.1`, `tailwind-merge ^3.6.0`, `@fontsource/source-sans-3 ^5.3.0`, `@fontsource/source-serif-4 ^5.3.0`, `@fontsource/ibm-plex-mono ^5.3.0`, `@playwright/test ^1.63.0`, `vitest ^5.0.0`, `typescript ^6.0.3`.

---

## Dateistruktur (Ergebnis dieses Plans)

```
apps/kompass/
  package.json  next.config.ts  tsconfig.json  postcss.config.mjs  components.json
  vitest.config.ts  playwright.config.ts  .env.example
  proxy.ts                                 Cookie-Gate: ohne Session → /login
  messages/de.json                         einzige Sprachdatei
  src/i18n/request.ts                      next-intl Single Locale
  src/app/globals.css                      @import tailwindcss, Token-Mapping, Basisstile
  src/app/layout.tsx                       Theme-CSS injizieren, Fonts, Provider, Toaster
  src/app/setup/page.tsx  actions.ts       Ersteinrichtung (1c)
  src/app/login/page.tsx  actions.ts       Login (1d, 2f)
  src/app/password/page.tsx  actions.ts    Pflichtwechsel (2f)
  src/app/logout/route.ts
  src/app/__e2e/reset/route.ts             nur APP_ENV=test: DB zurücksetzen/seeden
  src/app/(shell)/layout.tsx               Session-Gate, Umgebungsbalken, Sidebar, Topbar, Palette
  src/app/(shell)/page.tsx                 Startseite (1e)
  src/app/(shell)/not-found.tsx  error.tsx Fehlerseiten 404/500 (2d)
  src/app/(shell)/admin/users/             page.tsx, actions.ts, user-table.tsx, create-user-dialog.tsx, start-password-dialog.tsx
  src/app/(shell)/admin/roles/             page.tsx, actions.ts, role-editor.tsx
  src/app/(shell)/admin/settings/          page.tsx, actions.ts, settings-form.tsx
  src/app/(shell)/admin/themes/            page.tsx, actions.ts, theme-editor.tsx, theme-preview.tsx
  src/app/(shell)/admin/modules/           page.tsx, actions.ts, module-card.tsx
  src/app/(shell)/admin/audit/             page.tsx, audit-table.tsx, audit-detail.tsx
  src/app/(shell)/admin/documents/page.tsx Platzhalter bis Plan 3
  src/app/(shell)/admin/backup/page.tsx    Platzhalter bis Plan 3
  src/app/(shell)/profile/                 page.tsx, actions.ts, password-form.tsx, api-tokens.tsx
  src/components/ui/*                      shadcn-Komponenten (CLI), auf Tokens umgestellt
  src/components/shell/                    env-banner.tsx, sidebar.tsx, topbar.tsx, user-menu.tsx, command-palette.tsx, shell-frame.tsx
  src/components/forms/                    form-field.tsx, save-bar.tsx, submit-button.tsx, field-error.tsx
  src/components/status-badge.tsx  forbidden-card.tsx  empty-state.tsx  page-header.tsx
  src/lib/deps.ts                          Deps-Singleton (createDeps + readEnv), reset für E2E
  src/lib/request-context.ts               requireSession, optionalSession, requestMeta
  src/lib/actions.ts                       ActionState, toActionState, Fehlercodes → i18n
  src/lib/theme-css.ts                     themeToCss (rein)
  src/lib/env-banner.ts                    bannerFor (rein)
  src/lib/navigation.ts                    Nav-Struktur aus Manifesten (rein)
  src/lib/command-index.ts                 Befehlspaletten-Index (rein)
  src/lib/setup-progress.ts                Fortschrittskarten (rein)
  src/lib/audit-diff.ts                    Feld-Diff aus before/after (rein)
  src/lib/preferences.ts                   Client: Sidebar-Zustand, Hell/Dunkel, Zeilendichte (localStorage)
  tests/*.test.ts                          Vitest
  e2e/helpers.ts  e2e/*.spec.ts            Playwright
```

---

### Task 1: Next-App-Gerüst, Kern-Abgleich, i18n-Skelett

**Files:**
- Create: `apps/kompass/package.json`, `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `.env.example`, `src/app/layout.tsx`, `src/app/page.tsx` (temporär), `src/app/globals.css` (temporär), `src/i18n/request.ts`, `messages/de.json`, `vitest.config.ts`
- Modify: `.gitignore` (Root), `package.json` (Root: Skript `dev`)
- Test: `apps/kompass/tests/core-contract.test.ts`

**Interfaces:**
- Consumes aus `@kompass/core` (Namen müssen exakt existieren, sonst Task 1 anpassen und im Plan notieren): `createDeps`, `readEnv`, `isSetupRequired`, `completeSetup`, `login`, `resolveSession`, `revokeSession`, `changeOwnPassword`, `createUser`, `listUsers`, `updateUser`, `setUserActive`, `resetStartPassword`, `listRoles`, `createRole`, `updateRole`, `setRolePermissions`, `assignRole`, `removeRole`, `readSetting`, `readAllSettings`, `setSetting`, `listThemes`, `resolveActiveTheme`, `createTheme`, `updateTheme`, `duplicateTheme`, `deleteTheme`, `activateTheme`, `checkThemeContrast`, `THEME_TOKENS`, `listModules`, `setModuleEnabled`, `enabledManifests`, `queryAudit`, `getAuditEntry`, `createApiToken`, `listApiTokens`, `revokeApiToken`, `seedDevelopment`, `CORE_PERMISSIONS`, `requirePermission`, `newId`.
- Produces: laufende Next-App unter `apps/kompass`, `pnpm dev` am Root, `pnpm --filter @kompass/app test`.

- [x] **Step 1: Kern-Vertragstest schreiben**

`apps/kompass/tests/core-contract.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import * as core from '@kompass/core';

const REQUIRED = [
  'createDeps', 'readEnv', 'isSetupRequired', 'completeSetup', 'login', 'resolveSession', 'revokeSession', 'changeOwnPassword',
  'createUser', 'listUsers', 'updateUser', 'setUserActive', 'resetStartPassword',
  'listRoles', 'createRole', 'updateRole', 'setRolePermissions', 'assignRole', 'removeRole',
  'readSetting', 'readAllSettings', 'setSetting',
  'listThemes', 'resolveActiveTheme', 'createTheme', 'updateTheme', 'duplicateTheme', 'deleteTheme', 'activateTheme', 'checkThemeContrast', 'THEME_TOKENS',
  'listModules', 'setModuleEnabled', 'enabledManifests',
  'queryAudit', 'getAuditEntry',
  'createApiToken', 'listApiTokens', 'revokeApiToken',
  'seedDevelopment', 'CORE_PERMISSIONS', 'requirePermission', 'newId',
] as const;

describe('core contract', () => {
  it('exports every service the app relies on', () => {
    const missing = REQUIRED.filter((name) => !(name in core));
    expect(missing).toEqual([]);
  });
});
```

- [x] **Step 2: App anlegen**

Run (vom Repo-Root):
```bash
pnpm dlx create-next-app@16 apps/kompass --ts --app --src-dir --tailwind --eslint --import-alias "@/*" --use-pnpm --skip-install --yes
```
Erwartet: Ordner `apps/kompass` mit `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `next.config.ts`, `postcss.config.mjs`, `tsconfig.json`, `eslint.config.mjs`. In `tsconfig.json` muss `"paths": { "@/*": ["./src/*"] }` stehen.

`apps/kompass/package.json` (Name, Skripte und Abhängigkeiten auf diesen Stand bringen; von create-next-app erzeugte Versionen für `next`, `react`, `react-dom` dürfen höher sein):
```json
{
  "name": "@kompass/app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@fontsource/ibm-plex-mono": "^5.3.0",
    "@fontsource/source-sans-3": "^5.3.0",
    "@fontsource/source-serif-4": "^5.3.0",
    "@kompass/core": "workspace:*",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^1.41.0",
    "next": "^16.3.4",
    "next-intl": "^4.14.2",
    "react": "^19.2.8",
    "react-dom": "^19.2.8",
    "sonner": "^2.0.8",
    "tailwind-merge": "^3.6.0",
    "zod": "^4.5.4"
  },
  "devDependencies": {
    "@playwright/test": "^1.63.0",
    "@tailwindcss/postcss": "^4.3.3",
    "@types/node": "^26.4.1",
    "@types/react": "^19.2.18",
    "@types/react-dom": "^19.2.18",
    "eslint": "^10.10.0",
    "eslint-config-next": "^16.3.4",
    "tailwindcss": "^4.3.3",
    "typescript": "^6.0.3",
    "vitest": "^5.0.0"
  }
}
```

`apps/kompass/next.config.ts`:
```ts
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  transpilePackages: ['@kompass/core'],
  serverExternalPackages: ['better-sqlite3', '@node-rs/argon2'],
  output: 'standalone',
};

export default withNextIntl(nextConfig);
```

`apps/kompass/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "jsx": "preserve",
    "noEmit": true,
    "incremental": true,
    "allowJs": true,
    "isolatedModules": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", ".next", "e2e/.tmp"]
}
```

`apps/kompass/vitest.config.ts`:
```ts
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
```

`apps/kompass/.env.example`:
```
APP_ENV=development
DATABASE_PATH=./data/kompass.db
MEDIA_PATH=./media
PORT=3000
SESSION_SECRET=bitte-durch-32-zufaellige-zeichen-ersetzen
```

Root `package.json` Skripte ergänzen:
```json
"dev": "pnpm --filter @kompass/app dev",
"e2e": "pnpm --filter @kompass/app e2e"
```

Root `.gitignore` ergänzen:
```
apps/kompass/e2e/.tmp/
apps/kompass/test-results/
apps/kompass/playwright-report/
next-env.d.ts
```

- [x] **Step 3: i18n-Skelett**

`apps/kompass/src/i18n/request.ts`:
```ts
import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async () => ({
  locale: 'de',
  timeZone: 'Europe/Berlin',
  messages: (await import('../../messages/de.json')).default,
}));
```

`apps/kompass/messages/de.json` (Startbestand; jede Task ergänzt ihren Namensraum):
```json
{
  "app": { "name": "Aluna Kompass" },
  "common": {
    "save": "Speichern",
    "cancel": "Abbrechen",
    "discard": "Verwerfen",
    "close": "Schließen",
    "copy": "Kopieren",
    "copied": "Kopiert",
    "loading": "Wird geladen …",
    "yes": "Ja",
    "no": "Nein",
    "none": "—",
    "changesPending": "{count, plural, one {# Änderung noch nicht gespeichert} other {# Änderungen noch nicht gespeichert}}",
    "lastSaved": "zuletzt gespeichert am {date} von {name}",
    "audited": "Wird protokolliert."
  },
  "errors": {
    "forbidden": "Dafür fehlt Ihrer Rolle das Recht {permission}.",
    "validation": "Bitte prüfen Sie die markierten Felder.",
    "notFound": "Der Eintrag wurde nicht gefunden.",
    "unauthorized": "Bitte melden Sie sich erneut an.",
    "technical": "Der Vorgang wurde abgebrochen. Es wurde nichts gespeichert.",
    "conflict": {
      "emailTaken": "Diese E-Mail-Adresse ist bereits vergeben.",
      "roleNameTaken": "Eine Rolle mit diesem Namen existiert bereits.",
      "roleProtected": "Die Rolle „Administration“ kann nicht geändert werden.",
      "lastAdministrator": "Mindestens ein aktiver Nutzer muss die Rolle „Administration“ behalten.",
      "settingSystemOnly": "Diese Einstellung setzt nur das System.",
      "themeKeyTaken": "Ein Theme mit diesem Schlüssel existiert bereits.",
      "themeReadOnly": "Das Default-Theme ist schreibgeschützt.",
      "themeActive": "Das aktive Theme kann nicht gelöscht werden.",
      "moduleLocked": "Der Kern kann nicht deaktiviert werden.",
      "moduleDependencyInactive": "Benötigte Module sind nicht aktiv: {detail}",
      "moduleRequiredByOthers": "Wird von aktiven Modulen benötigt: {detail}",
      "setupAlreadyDone": "Die Einrichtung wurde bereits abgeschlossen.",
      "default": "Der Vorgang ist nicht möglich: {detail}"
    },
    "fields": {
      "required": "Pflichtfeld.",
      "email": "Bitte eine gültige E-Mail-Adresse eingeben.",
      "passwordTooShort": "Mindestens 12 Zeichen.",
      "unknownPermission": "Unbekanntes Recht.",
      "unknownSetting": "Unbekannte Einstellung.",
      "invalid": "Ungültiger Wert."
    }
  }
}
```

Temporäres `src/app/page.tsx` (wird in Task 5 durch die Shell ersetzt):
```tsx
import { getTranslations } from 'next-intl/server';

export default async function Page() {
  const t = await getTranslations('app');
  return <main>{t('name')}</main>;
}
```

`src/app/layout.tsx` (Minimalfassung, Task 2 baut sie aus):
```tsx
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import './globals.css';

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
```

- [x] **Step 4: Installieren, Vertragstest, Dev-Server**

Run: `pnpm install && pnpm --filter @kompass/app test`
Expected: `core contract` grün. Schlägt er fehl, fehlende Namen in `packages/core/src/index.ts` nachziehen (Plan 1 definiert sie alle) — nicht den Test aufweichen.

Run: `cd apps/kompass && cp .env.example .env && sed -i '' 's/bitte-durch-32-zufaellige-zeichen-ersetzen/'"$(openssl rand -hex 24)"'/' .env && cd ../..`
(Linux: `sed -i` ohne `''`.)

Run: `pnpm dev` (im Hintergrund) und `curl -s http://localhost:3000 | grep -o 'Aluna Kompass'`
Expected: `Aluna Kompass`. Dev-Server danach beenden. Hinweis: `next dev` legt in Next ≥ 16.2 einen verwalteten Block in `AGENTS.md` an (im Verzeichnis, aus dem das `next`-Paket sichtbar ist — hier voraussichtlich `apps/kompass/AGENTS.md`). Diese Datei wird committet, nicht gelöscht.

Run: `pnpm --filter @kompass/app typecheck`
Expected: keine Fehler.

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(app): scaffold Next.js admin app with next-intl and core contract test"
```

---

### Task 2: Theme-Injektion, Token-Mapping, Fonts, Literal-Scanner

**Files:**
- Create: `src/lib/theme-css.ts`, `src/lib/env-banner.ts`, `src/components/shell/env-banner.tsx`, `src/lib/deps.ts`
- Replace: `src/app/globals.css`, `src/app/layout.tsx`
- Create: `components.json` (per CLI), `src/components/ui/*` (per CLI), `src/lib/utils.ts` (per CLI)
- Test: `tests/theme-css.test.ts`, `tests/env-banner.test.ts`, `tests/no-color-literals.test.ts`, `e2e/theme.spec.ts`

**Interfaces:**
- Produces:
  - `themeToCss(theme: Theme): string` — erzeugt `:root{...}` (light) und `:root[data-color-scheme="dark"]{...}` (dark) mit allen 58 Tokens als `--<token>: <value>`.
  - `bannerFor(env: AppEnv, ctx: { lastImportAt: string | null; migrationCount: number }): { kind: 'test' | 'development'; label: 'TESTUMGEBUNG' | 'ENTWICKLUNG' } | null`.
  - `getDeps(): Deps & { close(); reset(mode) }` — Singleton über `globalThis`.
  - Tailwind-Utilities (Namen → Token): siehe `globals.css`.

- [x] **Step 1: Tests schreiben**

`tests/theme-css.test.ts`:
```ts
import { DEFAULT_THEME, THEME_TOKENS } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { themeToCss } from '@/lib/theme-css';

describe('themeToCss', () => {
  it('emits every token for light on :root and for dark on the data attribute', () => {
    const css = themeToCss(DEFAULT_THEME);
    expect(css.startsWith(':root{')).toBe(true);
    expect(css).toContain(':root[data-color-scheme="dark"]{');
    for (const token of THEME_TOKENS) {
      expect(css).toContain(`--${token}:`);
    }
    expect(css).toContain('--color-primary:#2F5D68');
    expect(css).toContain('--color-primary:#74B4C0');
  });

  it('escapes nothing dangerous: values with braces or semicolons are rejected', () => {
    const theme = { ...DEFAULT_THEME, tokens: { ...DEFAULT_THEME.tokens, bg: { light: '#fff}body{color:red', dark: '#000' } } };
    expect(() => themeToCss(theme)).toThrow(/invalid token value/);
  });
});
```

`tests/env-banner.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { bannerFor } from '@/lib/env-banner';

describe('bannerFor', () => {
  it('is absent in production', () => {
    expect(bannerFor('production', { lastImportAt: null, migrationCount: 3 })).toBeNull();
  });
  it('labels test and development', () => {
    expect(bannerFor('test', { lastImportAt: '2026-09-02T09:00:00.000Z', migrationCount: 3 })).toEqual({ kind: 'test', label: 'TESTUMGEBUNG' });
    expect(bannerFor('development', { lastImportAt: null, migrationCount: 3 })).toEqual({ kind: 'development', label: 'ENTWICKLUNG' });
  });
});
```

`tests/no-color-literals.test.ts`:
```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../src');
const ALLOWED = new Set(['components/shell/env-banner.tsx']);
const PATTERN = /(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\()/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('no color literals in app source', () => {
  it('finds none outside the environment banner', () => {
    const offenders = walk(ROOT)
      .filter((f) => /\.(tsx?|css)$/.test(f))
      .filter((f) => !ALLOWED.has(path.relative(ROOT, f)))
      .filter((f) => PATTERN.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
```

`e2e/theme.spec.ts`:
```ts
import { expect, test } from '@playwright/test';

test('theme tokens reach computed styles and dark mode switches values', async ({ page }) => {
  await page.goto('/login');
  const button = page.getByRole('button', { name: 'Anmelden' });
  await expect(button).toHaveCSS('background-color', 'rgb(47, 93, 104)'); // #2F5D68 aus dem Default-Theme
  await page.evaluate(() => document.documentElement.setAttribute('data-color-scheme', 'dark'));
  await expect(button).toHaveCSS('background-color', 'rgb(116, 180, 192)'); // #74B4C0
});
```

- [x] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app test`
Expected: FAIL — `@/lib/theme-css` fehlt; `no-color-literals` schlägt fehl, weil das von create-next-app erzeugte `globals.css` Literale enthält.

- [x] **Step 3: shadcn initialisieren und Komponenten holen**

Run (in `apps/kompass`):
```bash
pnpm dlx shadcn@latest init --defaults --base-color neutral --css-variables
pnpm dlx shadcn@latest add button input label textarea select checkbox switch badge dialog sheet tabs table tooltip dropdown-menu command separator alert progress skeleton sonner
```
Expected: `components.json`, `src/lib/utils.ts` (`cn`), Komponenten unter `src/components/ui/`. Die CLI schreibt Farbliterale in `globals.css` — Step 4 ersetzt die Datei vollständig. Die Komponenten selbst nutzen nur semantische Klassen (`bg-primary`, `text-muted-foreground`, `border-input`, `ring-ring`, …), die Step 4 auf Tokens mappt.

- [x] **Step 4: globals.css ersetzen**

`src/app/globals.css`:
```css
@import "tailwindcss";

/*
 * Tailwind-Standardpalette entfernen: es gibt keine bg-red-500 mehr.
 * Alle Utilities unten verweisen auf Theme-Tokens, die das Root-Layout
 * zur Laufzeit aus dem aktiven Theme in :root injiziert (siehe lib/theme-css.ts).
 */
@theme {
  --color-*: initial;
  --shadow-*: initial;
  --radius-*: initial;
  --font-*: initial;
}

@theme inline reference {
  /* App-Namen (eigene Utilities) */
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-sidebar: var(--sidebar-bg);
  --color-topbar: var(--topbar-bg);
  --color-ink: var(--ink);
  --color-ink-2: var(--ink-2);
  --color-muted-ink: var(--muted);
  --color-muted-ink-2: var(--muted-2);
  --color-line: var(--line);
  --color-line-2: var(--line-2);
  --color-line-strong: var(--line-strong);
  --color-brand: var(--color-primary);
  --color-brand-ink: var(--color-primary-ink);
  --color-brand-soft: var(--color-primary-soft);
  --color-on-brand: var(--on-primary);
  --color-on-brand-muted: var(--on-primary-muted);
  --color-brand-accent: var(--color-accent);
  --color-brand-accent-deep: var(--color-accent-deep);
  --color-brand-accent-soft: var(--color-accent-soft);
  --color-success: var(--color-success);
  --color-success-bg: var(--color-success-bg);
  --color-warning: var(--color-warning);
  --color-warning-bg: var(--color-warning-bg);
  --color-error: var(--color-error);
  --color-error-bg: var(--color-error-bg);
  --color-info: var(--color-info);
  --color-info-bg: var(--color-info-bg);
  --color-hover: var(--hover-surface);
  --color-active: var(--active-surface);
  --color-selected: var(--selected-bg);
  --color-selected-ink: var(--selected-ink);
  --color-link: var(--link);
  --color-link-hover: var(--link-hover);
  --color-disabled: var(--disabled-bg);
  --color-disabled-ink: var(--disabled-ink);
  --color-table-head: var(--table-head-bg);
  --color-zebra: var(--table-zebra);
  --color-row-hover: var(--table-row-hover);
  --color-field: var(--input-bg);
  --color-placeholder: var(--input-placeholder);
  --color-code: var(--code-bg);
  --color-badge: var(--neutral-badge-bg);
  --color-badge-ink: var(--neutral-badge-ink);
  --color-tooltip: var(--tooltip-bg);
  --color-tooltip-ink: var(--tooltip-ink);
  --color-focus: var(--focus-ring);
  --color-overlay: var(--overlay);

  /* shadcn-Namen (von den generierten Komponenten erwartet) */
  --color-background: var(--bg);
  --color-foreground: var(--ink);
  --color-card: var(--surface);
  --color-card-foreground: var(--ink);
  --color-popover: var(--surface);
  --color-popover-foreground: var(--ink);
  --color-primary: var(--color-primary);
  --color-primary-foreground: var(--on-primary);
  --color-secondary: var(--surface-2);
  --color-secondary-foreground: var(--ink-2);
  --color-muted: var(--surface-2);
  --color-muted-foreground: var(--muted);
  --color-accent: var(--hover-surface);
  --color-accent-foreground: var(--ink);
  --color-destructive: var(--color-error);
  --color-destructive-foreground: var(--on-primary);
  --color-border: var(--line);
  --color-input: var(--line-strong);
  --color-ring: var(--focus-ring);

  --shadow-sm: var(--shadow-sm);
  --shadow-md: var(--shadow-md);
  --radius-sm: var(--radius-sm);
  --radius-md: var(--radius-md);
  --radius-lg: var(--radius-lg);
  --radius-full: var(--radius-full);
  --font-body: var(--font-body);
  --font-heading: var(--font-heading);
  --font-mono: var(--font-mono);
}

@layer base {
  * { border-color: var(--line); }
  html { color-scheme: light; }
  html[data-color-scheme="dark"] { color-scheme: dark; }
  body {
    background: var(--bg);
    color: var(--ink);
    font-family: var(--font-body);
    font-size: 14px;
    line-height: 1.5;
  }
  h1, h2, h3 { font-family: var(--font-heading); line-height: 1.2; }
  :focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  ::placeholder { color: var(--input-placeholder); }
  [data-density="compact"] { --row-h: 36px; }
  [data-density="comfortable"] { --row-h: 56px; }
}
```

Hinweis zur Zyklusgefahr: Token-Variablen (`--color-primary` in `:root`) und Tailwind-Theme-Variablen (`--color-primary` im `@theme`-Block) tragen denselben Namen. `@theme inline reference` sorgt dafür, dass Tailwind **keine** `:root`-Deklarationen für diese Namen ausgibt und die Utilities direkt `var(--color-primary)` verwenden. Der E2E-Test in Step 1 prüft genau das (berechnete Buttonfarbe = Theme-Wert). Schlägt er mit `rgba(0, 0, 0, 0)` fehl, hat Tailwind doch Variablen emittiert: dann im `@theme inline reference`-Block alle Token-Referenzen auf ein Präfix umstellen (`--color-primary: var(--kp-color-primary)`) **und** `themeToCss` so ändern, dass es Tokens zusätzlich mit Präfix `--kp-` schreibt. Beide Varianten bleiben spec-konform (Tokens sind CSS-Custom-Properties, Werte nur im Theme).

- [x] **Step 5: Reine Helfer und Deps-Singleton**

`src/lib/theme-css.ts`:
```ts
import { THEME_TOKENS, type Theme } from '@kompass/core';

const SAFE_VALUE = /^[^{};<>]+$/;

function block(selector: string, theme: Theme, mode: 'light' | 'dark'): string {
  const declarations = THEME_TOKENS.map((token) => {
    const value = theme.tokens[token][mode];
    if (!SAFE_VALUE.test(value)) throw new Error(`invalid token value for ${token}`);
    return `--${token}:${value}`;
  });
  return `${selector}{${declarations.join(';')}}`;
}

export function themeToCss(theme: Theme): string {
  return `${block(':root', theme, 'light')}\n${block(':root[data-color-scheme="dark"]', theme, 'dark')}`;
}
```

`src/lib/env-banner.ts`:
```ts
import type { AppEnv } from '@kompass/core';

export interface BannerContext {
  lastImportAt: string | null;
  migrationCount: number;
}

export type Banner = { kind: 'test'; label: 'TESTUMGEBUNG' } | { kind: 'development'; label: 'ENTWICKLUNG' };

export function bannerFor(env: AppEnv, _ctx: BannerContext): Banner | null {
  if (env === 'production') return null;
  return env === 'test' ? { kind: 'test', label: 'TESTUMGEBUNG' } : { kind: 'development', label: 'ENTWICKLUNG' };
}
```

`src/components/shell/env-banner.tsx`:
```tsx
import { useTranslations } from 'next-intl';
import type { Banner, BannerContext } from '@/lib/env-banner';

// theme-exception: environment banner — die einzigen Farbwerte, die kein Theme überschreiben darf.
const COLORS = {
  test: { bg: '#1A1A1A', fg: '#F2C200', stripe: 120 },
  development: { bg: '#B3261E', fg: '#FFFFFF', stripe: 80 },
} as const;

export function EnvBanner({ banner, context }: { banner: Banner; context: BannerContext }) {
  const t = useTranslations('shell.envBanner');
  const c = COLORS[banner.kind];
  const stripe = (angle: number) => `repeating-linear-gradient(${angle}deg, ${c.fg} 0 8px, ${c.bg} 8px 16px)`;
  const detail =
    banner.kind === 'test'
      ? t('testContext', { date: context.lastImportAt ? new Date(context.lastImportAt).toLocaleDateString('de-DE') : t('noImport') })
      : t('devContext', { migrations: context.migrationCount });
  return (
    <div role="status" data-testid="env-banner" style={{ background: c.bg, color: c.fg, height: 28 }} className="relative flex items-center justify-center gap-3 overflow-hidden text-[12px] font-bold tracking-[.18em]">
      <div aria-hidden style={{ background: stripe(135), width: c.stripe, opacity: 0.9 }} className="absolute inset-y-0 left-0" />
      <div aria-hidden style={{ background: stripe(45), width: c.stripe, opacity: 0.9 }} className="absolute inset-y-0 right-0" />
      <span className="relative z-[1]">{banner.label}</span>
      <span className="relative z-[1] text-[11px] font-normal tracking-normal">{detail}</span>
    </div>
  );
}
```

`src/lib/deps.ts`:
```ts
import { rmSync } from 'node:fs';
import { createDeps, readEnv, seedDevelopment, type Deps } from '@kompass/core';

export type AppDeps = Deps & { migrationCount: number; close(): void };

interface Holder {
  deps: AppDeps | null;
}

const holder: Holder = ((globalThis as unknown as { __kompass?: Holder }).__kompass ??= { deps: null });

export function runtimeEnv() {
  return readEnv();
}

export function getDeps(): AppDeps {
  if (!holder.deps) {
    const env = readEnv();
    holder.deps = createDeps({ databasePath: env.databasePath, env: env.env });
  }
  return holder.deps;
}

/** Nur für E2E-Tests (APP_ENV=test): Datenbank verwerfen und neu aufsetzen. */
export async function resetDeps(mode: 'empty' | 'seeded'): Promise<void> {
  const env = readEnv();
  if (env.env !== 'test') throw new Error('resetDeps is only available in the test environment');
  holder.deps?.close();
  holder.deps = null;
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${env.databasePath}${suffix}`, { force: true });
  const deps = getDeps();
  if (mode === 'seeded') await seedDevelopment(deps);
}
```

- [x] **Step 6: Root-Layout mit Theme-Injektion und Fonts**

`src/app/layout.tsx`:
```tsx
import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/600.css';
import '@fontsource/source-sans-3/700.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './globals.css';
import { resolveActiveTheme } from '@kompass/core';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { getDeps } from '@/lib/deps';
import { themeToCss } from '@/lib/theme-css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app');
  return { title: t('name') };
}

const PREFERENCE_BOOTSTRAP = `(function(){try{var s=localStorage.getItem('kompass.colorScheme');if(!s){s=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.setAttribute('data-color-scheme',s);var d=localStorage.getItem('kompass.density');if(d){document.documentElement.setAttribute('data-density',d)}}catch(e){}})();`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = resolveActiveTheme(getDeps());
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <style id="theme-tokens" dangerouslySetInnerHTML={{ __html: themeToCss(theme) }} />
        <script dangerouslySetInnerHTML={{ __html: PREFERENCE_BOOTSTRAP }} />
      </head>
      <body className="min-h-screen bg-bg text-ink antialiased">
        <NextIntlClientProvider>
          {children}
          <Toaster position="bottom-right" />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

`messages/de.json` ergänzen (Namensraum `shell.envBanner`):
```json
"shell": {
  "envBanner": {
    "testContext": "Daten vom {date} · Änderungen hier haben keine Wirkung",
    "noImport": "kein Import",
    "devContext": "localhost · Migrationsstand {migrations}"
  }
}
```

- [x] **Step 7: Playwright einrichten**

`apps/kompass/playwright.config.ts`:
```ts
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const dbPath = path.resolve(import.meta.dirname, 'e2e/.tmp/kompass.db');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: { baseURL: 'http://localhost:3100', locale: 'de-DE', viewport: { width: 1280, height: 800 } },
  webServer: {
    command: 'pnpm exec next dev -p 3100',
    url: 'http://localhost:3100/login',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      APP_ENV: 'test',
      DATABASE_PATH: dbPath,
      MEDIA_PATH: path.resolve(import.meta.dirname, 'e2e/.tmp/media'),
      SESSION_SECRET: 'e2e-session-secret-0123456789abcdef0123456789',
      E2E_RESET_TOKEN: 'e2e-reset',
    },
  },
});
```

`apps/kompass/e2e/helpers.ts`:
```ts
import { expect, type Page } from '@playwright/test';

export const ADMIN = { email: 'admin@kompass.local', password: 'kompass-entwicklung-2026' };

export async function resetDatabase(page: Page, mode: 'empty' | 'seeded'): Promise<void> {
  const response = await page.request.post(`/__e2e/reset?mode=${mode}`, { headers: { 'x-e2e-token': 'e2e-reset' } });
  expect(response.ok()).toBe(true);
}

export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(ADMIN.email);
  await page.getByLabel('Passwort').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL('/');
}
```

`src/app/__e2e/reset/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { resetDeps, runtimeEnv } from '@/lib/deps';

export async function POST(request: Request): Promise<Response> {
  if (runtimeEnv().env !== 'test' || request.headers.get('x-e2e-token') !== process.env.E2E_RESET_TOKEN) {
    return new NextResponse(null, { status: 404 });
  }
  const mode = new URL(request.url).searchParams.get('mode') === 'seeded' ? 'seeded' : 'empty';
  await resetDeps(mode);
  return NextResponse.json({ ok: true, mode });
}
```

Run: `pnpm --filter @kompass/app exec playwright install chromium`

Da `/login` erst in Task 4 entsteht, für den E2E-Lauf dieser Task ein temporäres `src/app/login/page.tsx` anlegen, das nur einen Primärbutton „Anmelden" rendert:
```tsx
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';

export default async function LoginPage() {
  const t = await getTranslations('auth.login');
  return <main className="p-8"><Button>{t('submit')}</Button></main>;
}
```
und in `messages/de.json`: `"auth": { "login": { "submit": "Anmelden" } }` (Task 4 erweitert den Namensraum).

- [x] **Step 8: Tests ausführen**

Run: `pnpm --filter @kompass/app test && pnpm --filter @kompass/app typecheck && pnpm --filter @kompass/app e2e e2e/theme.spec.ts`
Expected: Vitest grün (inkl. Literal-Scanner), E2E `theme.spec.ts` grün.

- [x] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(app): runtime theme injection, token-mapped tailwind, fonts, env banner, e2e harness"
```

---

### Task 3: Request-Kontext, Session-Cookie, Action-Adapter, Proxy

**Files:**
- Create: `src/lib/request-context.ts`, `src/lib/actions.ts`, `proxy.ts`, `src/app/logout/route.ts`
- Test: `tests/actions.test.ts`

**Interfaces:**
- Produces:
  - `SESSION_COOKIE = 'kompass_session'`; `requestMeta(): Promise<{ ipAddress: string | null; requestId: string }>`.
  - `optionalSession(): Promise<ResolvedSession | null>`; `requireSession(): Promise<{ deps; ctx; user; sessionId }>` — leitet ohne Session auf `/login`, bei `mustChangePassword` auf `/password` um (außer wenn `allowPasswordChange: true`).
  - `setSessionCookie(sessionId, expiresAt)`, `clearSessionCookie()`.
  - `type ActionState = { status: 'idle' } | { status: 'success'; message?: string; data?: unknown } | { status: 'error'; message: string; fieldErrors: Record<string, string> }`; `toActionState(result, t, successMessage?)` — reine Abbildung; `fieldMessage(issueMessage, t)`.

- [x] **Step 1: Test schreiben**

`tests/actions.test.ts`:
```ts
import { conflict, forbidden, invalid, notFound, ok, unauthorized } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { toActionState } from '@/lib/actions';

const t = (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key);

describe('toActionState', () => {
  it('maps success with optional message and data', () => {
    expect(toActionState(ok({ id: 1 }), t, 'saved')).toEqual({ status: 'success', message: 'saved', data: { id: 1 } });
  });
  it('maps forbidden with the permission key', () => {
    expect(toActionState(forbidden('users.manage'), t)).toEqual({ status: 'error', message: 'errors.forbidden:{"permission":"users.manage"}', fieldErrors: {} });
  });
  it('maps validation issues to field errors with translated messages', () => {
    const state = toActionState(invalid([{ path: 'email', message: 'Invalid email' }, { path: 'password', message: 'passwordTooShort' }]), t);
    expect(state).toEqual({
      status: 'error',
      message: 'errors.validation',
      fieldErrors: { email: 'errors.fields.email', password: 'errors.fields.passwordTooShort' },
    });
  });
  it('maps conflicts by code, notFound and unauthorized', () => {
    expect(toActionState(conflict('emailTaken', 'x'), t).message).toBe('errors.conflict.emailTaken');
    expect(toActionState(conflict('weird', 'Detail'), t).message).toBe('errors.conflict.default:{"detail":"Detail"}');
    expect(toActionState(notFound('user', '1'), t).message).toBe('errors.notFound');
    expect(toActionState(unauthorized('locked'), t).message).toBe('errors.unauthorized');
  });
});
```

- [x] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app test tests/actions.test.ts`
Expected: FAIL — `@/lib/actions` fehlt.

- [x] **Step 3: Implementieren**

`src/lib/actions.ts`:
```ts
import type { Result, ServiceError } from '@kompass/core';

export type ActionState =
  | { status: 'idle' }
  | { status: 'success'; message?: string; data?: unknown }
  | { status: 'error'; message: string; fieldErrors: Record<string, string> };

export const idleState: ActionState = { status: 'idle' };

type Translate = (key: string, values?: Record<string, unknown>) => string;

const KNOWN_CONFLICTS = new Set([
  'emailTaken', 'roleNameTaken', 'roleProtected', 'lastAdministrator', 'settingSystemOnly',
  'themeKeyTaken', 'themeReadOnly', 'themeActive', 'moduleLocked', 'moduleDependencyInactive',
  'moduleRequiredByOthers', 'setupAlreadyDone',
]);

export function fieldMessage(issueMessage: string, t: Translate): string {
  const lower = issueMessage.toLowerCase();
  if (issueMessage === 'passwordTooShort' || issueMessage === 'unknownPermission' || issueMessage === 'unknownSetting') return t(`errors.fields.${issueMessage}`);
  if (lower.includes('email')) return t('errors.fields.email');
  if (lower.includes('too small') || lower.includes('required') || lower.includes('expected string') || lower.includes('at least 1')) return t('errors.fields.required');
  return t('errors.fields.invalid');
}

function errorMessage(error: ServiceError, t: Translate): string {
  switch (error.type) {
    case 'forbidden':
      return t('errors.forbidden', { permission: error.permission });
    case 'validation':
      return t('errors.validation');
    case 'notFound':
      return t('errors.notFound');
    case 'unauthorized':
      return t('errors.unauthorized');
    case 'conflict': {
      const detail = error.message.includes(':') ? error.message.slice(error.message.indexOf(':') + 1).trim() : error.message;
      if (error.code === 'moduleDependencyInactive' || error.code === 'moduleRequiredByOthers') return t(`errors.conflict.${error.code}`, { detail });
      return KNOWN_CONFLICTS.has(error.code) ? t(`errors.conflict.${error.code}`) : t('errors.conflict.default', { detail: error.message });
    }
  }
}

export function toActionState<T>(result: Result<T>, t: Translate, successMessage?: string): ActionState {
  if (result.ok) return { status: 'success', ...(successMessage ? { message: successMessage } : {}), data: result.value };
  const fieldErrors: Record<string, string> = {};
  if (result.error.type === 'validation') {
    for (const issue of result.error.issues) fieldErrors[issue.path] ??= fieldMessage(issue.message, t);
  }
  return { status: 'error', message: errorMessage(result.error, t), fieldErrors };
}
```

`src/lib/request-context.ts`:
```ts
import 'server-only';
import { newId, resolveSession, revokeSession, type CallContext, type ResolvedSession } from '@kompass/core';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDeps } from './deps';

export const SESSION_COOKIE = 'kompass_session';

export async function requestMeta(): Promise<{ ipAddress: string | null; requestId: string }> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  return {
    ipAddress: forwarded ? (forwarded.split(',')[0]?.trim() ?? null) : (h.get('x-real-ip') ?? null),
    requestId: h.get('x-request-id') ?? newId(),
  };
}

export async function optionalSession(): Promise<(ResolvedSession & { sessionId: string }) | null> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;
  const resolved = resolveSession(getDeps(), sessionId, await requestMeta());
  return resolved ? { ...resolved, sessionId } : null;
}

export interface SessionScope {
  deps: ReturnType<typeof getDeps>;
  ctx: CallContext;
  user: ResolvedSession['user'];
  sessionId: string;
}

export async function requireSession(opts: { allowPasswordChange?: boolean } = {}): Promise<SessionScope> {
  const session = await optionalSession();
  if (!session) redirect('/login');
  if (session.mustChangePassword && !opts.allowPasswordChange) redirect('/password');
  return { deps: getDeps(), ctx: session.ctx, user: session.user, sessionId: session.sessionId };
}

export async function setSessionCookie(sessionId: string, expiresAt: string): Promise<void> {
  const store = await cookies();
  // secure: false — die App läuft ausschließlich im LAN ohne TLS (Spec, Abschnitt 3 und 8).
  store.set({ name: SESSION_COOKIE, value: sessionId, httpOnly: true, sameSite: 'lax', secure: false, path: '/', expires: new Date(expiresAt) });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (sessionId) revokeSession(getDeps(), sessionId);
  store.delete(SESSION_COOKIE);
}
```

`apps/kompass/proxy.ts`:
```ts
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PREFIXES = ['/login', '/setup', '/__e2e', '/_next', '/favicon.ico'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!request.cookies.get('kompass_session')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!api/).*)'] };
```

`src/app/logout/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/request-context';

export async function POST(request: Request): Promise<Response> {
  await clearSessionCookie();
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
```

Run: `pnpm --filter @kompass/app add server-only`

- [x] **Step 4: Tests ausführen**

Run: `pnpm --filter @kompass/app test && pnpm --filter @kompass/app typecheck`
Expected: grün.

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(app): session cookie handling, request context, action state mapping, proxy gate"
```

---

### Task 4: Ersteinrichtung, Login, Pflicht-Passwortwechsel

**Files:**
- Create: `src/components/forms/form-field.tsx`, `src/components/forms/submit-button.tsx`, `src/components/forms/field-error.tsx`, `src/components/auth-card.tsx`, `src/lib/password-strength.ts`
- Create: `src/app/setup/page.tsx`, `src/app/setup/actions.ts`, `src/app/setup/setup-form.tsx`
- Replace: `src/app/login/page.tsx`; Create: `src/app/login/actions.ts`, `src/app/login/login-form.tsx`
- Create: `src/app/password/page.tsx`, `src/app/password/actions.ts`, `src/app/password/password-form.tsx`
- Test: `e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `isSetupRequired`, `completeSetup`, `login`, `changeOwnPassword`, `requireSession`, `setSessionCookie`, `toActionState`.
- Produces: Routen `/setup`, `/login`, `/password`; Komponenten `FormField`, `SubmitButton`, `FieldError`, `AuthCard`.

- [x] **Step 1: E2E-Test schreiben**

`e2e/auth.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { ADMIN, loginAsAdmin, resetDatabase } from './helpers';

test.describe('first run and login', () => {
  test('empty database redirects to setup, creates the admin and lands on the home page', async ({ page }) => {
    await resetDatabase(page, 'empty');
    await page.goto('/login');
    await expect(page).toHaveURL('/setup');
    await expect(page.getByRole('heading', { name: 'Erste Einrichtung' })).toBeVisible();
    await page.getByLabel('Vereinsname').fill('Musterverein e.V.');
    await page.getByLabel('Ihr Name').fill('Anna Berger');
    await page.getByLabel('E-Mail').fill('anna@example.org');
    await page.getByLabel('Passwort').fill('kurz');
    await page.getByRole('button', { name: 'Konto anlegen und starten' }).click();
    await expect(page.getByText('Mindestens 12 Zeichen.')).toBeVisible();
    await page.getByLabel('Passwort').fill('ein-langes-merkbares-passwort');
    await page.getByRole('button', { name: 'Konto anlegen und starten' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByText('Guten Tag, Anna.')).toBeVisible();
    await page.goto('/setup');
    await expect(page).toHaveURL('/login');
  });

  test('login rejects wrong credentials with remaining attempts and locks after five', async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await page.goto('/login');
    for (let i = 4; i >= 1; i -= 1) {
      await page.getByLabel('E-Mail').fill(ADMIN.email);
      await page.getByLabel('Passwort').fill('falsch-falsch-00-falsch');
      await page.getByRole('button', { name: 'Anmelden' }).click();
      await expect(page.getByRole('alert')).toContainText('E-Mail oder Passwort stimmt nicht.');
      await expect(page.getByRole('alert')).toContainText(`Noch ${i} Versuch`);
    }
    await page.getByLabel('Passwort').fill('falsch-falsch-00-falsch');
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page.getByRole('alert')).toContainText('für 15 Minuten gesperrt');
  });

  test('a user with a start password must set a new one before seeing the shell', async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Nutzer anlegen' }).click();
    await page.getByLabel('Name').fill('Rita Sommer');
    await page.getByLabel('E-Mail').fill('rita@example.org');
    await page.getByRole('dialog').getByRole('button', { name: 'Nutzer anlegen' }).click();
    const startPassword = (await page.getByTestId('start-password').textContent())!.trim();
    await page.getByRole('button', { name: 'Ich habe die Daten notiert' }).click();
    await page.request.post('/logout');

    await page.goto('/login');
    await page.getByLabel('E-Mail').fill('rita@example.org');
    await page.getByLabel('Passwort').fill(startPassword);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL('/password');
    await expect(page.getByRole('heading', { name: 'Neues Passwort festlegen' })).toBeVisible();
    await page.goto('/');
    await expect(page).toHaveURL('/password');
    await page.getByLabel('Startpasswort').fill(startPassword);
    await page.getByLabel('Neues Passwort', { exact: true }).fill('rita-hat-ein-neues-passwort');
    await page.getByLabel('Passwort wiederholen').fill('rita-hat-ein-neues-passwort');
    await page.getByRole('button', { name: 'Passwort setzen und fortfahren' }).click();
    await expect(page).toHaveURL('/');
  });
});
```
(Der dritte Test benötigt die Nutzerseite aus Task 7; er wird in dieser Task mit `test.fixme` markiert und in Task 7 aktiviert.)

- [x] **Step 2: E2E ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app e2e e2e/auth.spec.ts`
Expected: FAIL — `/setup` existiert nicht, Überschriften fehlen.

- [x] **Step 3: Formular-Bausteine**

`src/components/forms/field-error.tsx`:
```tsx
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <p id={id} role="alert" className="mt-1 text-[12px] font-semibold text-error">{message}</p>;
}
```

`src/components/forms/form-field.tsx`:
```tsx
import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { FieldError } from './field-error';

export function FormField({ id, label, hint, error, className, children }: { id: string; label: string; hint?: string; error?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id} className="text-[13px] font-semibold text-ink-2">{label}</Label>
      {children}
      {hint && !error ? <p className="text-[12px] text-muted-ink">{hint}</p> : null}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}
```

`src/components/forms/submit-button.tsx`:
```tsx
'use client';

import { useFormStatus } from 'react-dom';
import { Button, type ButtonProps } from '@/components/ui/button';

export function SubmitButton({ children, ...props }: ButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending} {...props}>
      {children}
    </Button>
  );
}
```
(Falls die shadcn-Button-Datei keinen `ButtonProps`-Typ exportiert, `React.ComponentProps<typeof Button>` verwenden.)

`src/components/auth-card.tsx`:
```tsx
import type { ReactNode } from 'react';

export function AuthCard({ brand, organization, title, width = 400, children, footer }: { brand: string; organization?: string; title: string; width?: number; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-bg p-6">
      <div className="flex items-center gap-3">
        <div className="flex size-[34px] items-center justify-center rounded-md border border-brand bg-brand-soft font-heading text-[15px] font-bold text-brand-ink">AK</div>
        <div className="leading-tight">
          {organization ? <div className="text-[15px] font-semibold">{organization}</div> : null}
          <div className={organization ? 'text-[12px] text-muted-ink' : 'font-heading text-[18px]'}>{brand}</div>
        </div>
      </div>
      <section style={{ width }} className="flex max-w-full flex-col gap-5 rounded-lg border border-line bg-surface p-7 shadow-sm">
        <h1 className="font-heading text-[22px]">{title}</h1>
        {children}
      </section>
      {footer ? <p className="max-w-[520px] text-center text-[13px] text-muted-ink">{footer}</p> : null}
    </main>
  );
}
```

- [x] **Step 4: Ersteinrichtung**

`src/app/setup/actions.ts`:
```ts
'use server';

import { completeSetup } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { toActionState, type ActionState } from '@/lib/actions';
import { getDeps } from '@/lib/deps';
import { requestMeta, setSessionCookie } from '@/lib/request-context';

export async function completeSetupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const meta = await requestMeta();
  const result = await completeSetup(getDeps(), {
    organizationName: formData.get('organizationName'),
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    ...meta,
  });
  if (!result.ok) return toActionState(result, t);
  await setSessionCookie(result.value.sessionId, result.value.expiresAt);
  redirect('/');
}
```

`src/app/setup/setup-form.tsx`:
```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormField } from '@/components/forms/form-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { completeSetupAction } from './actions';

export function SetupForm() {
  const t = useTranslations('auth.setup');
  const [state, action] = useActionState(completeSetupAction, idleState);
  const errors = state.status === 'error' ? state.fieldErrors : {};
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.status === 'error' && Object.keys(errors).length === 0 ? <p role="alert" className="rounded-md border border-error bg-error-bg p-3 text-[13px] text-error">{state.message}</p> : null}
      <FormField id="organizationName" label={t('organizationName')} error={errors.organizationName}>
        <Input id="organizationName" name="organizationName" required autoComplete="organization" />
      </FormField>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField id="name" label={t('name')} error={errors.name}>
          <Input id="name" name="name" required autoComplete="name" />
        </FormField>
        <FormField id="email" label={t('email')} error={errors.email}>
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </FormField>
      </div>
      <FormField id="password" label={t('password')} hint={t('passwordHint')} error={errors.password}>
        <Input id="password" name="password" type="password" required autoComplete="new-password" minLength={12} />
      </FormField>
      <SubmitButton className="h-10 w-full">{t('submit')}</SubmitButton>
    </form>
  );
}
```

`src/app/setup/page.tsx`:
```tsx
import { isSetupRequired } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { getDeps } from '@/lib/deps';
import { SetupForm } from './setup-form';

export default async function SetupPage() {
  if (!isSetupRequired(getDeps())) redirect('/login');
  const t = await getTranslations('auth.setup');
  const app = await getTranslations('app');
  return (
    <AuthCard brand={app('name')} title={t('title')} width={520} footer={t('footer')}>
      <p className="text-[14px] leading-[1.55] text-ink-2">{t('intro')}</p>
      <SetupForm />
    </AuthCard>
  );
}
```

- [x] **Step 5: Login**

`src/app/login/actions.ts`:
```ts
'use server';

import { login } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ActionState } from '@/lib/actions';
import { getDeps } from '@/lib/deps';
import { requestMeta, setSessionCookie } from '@/lib/request-context';

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations('auth.login');
  const meta = await requestMeta();
  const result = await login(getDeps(), { email: formData.get('email'), password: formData.get('password'), ...meta });
  if (!result.ok) {
    const error = result.error;
    if (error.type === 'unauthorized' && error.reason === 'locked') return { status: 'error', message: t('locked'), fieldErrors: {} };
    if (error.type === 'unauthorized' && error.reason === 'inactive') return { status: 'error', message: t('inactive'), fieldErrors: {} };
    const attempts = error.type === 'unauthorized' && error.attemptsLeft !== undefined ? t('attemptsLeft', { count: error.attemptsLeft }) : '';
    return { status: 'error', message: `${t('invalid')} ${attempts}`.trim(), fieldErrors: {} };
  }
  await setSessionCookie(result.value.sessionId, result.value.expiresAt);
  redirect(result.value.mustChangePassword ? '/password' : '/');
}
```

`src/app/login/login-form.tsx`:
```tsx
'use client';

import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormField } from '@/components/forms/form-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { loginAction } from './actions';

export function LoginForm({ imported }: { imported: boolean }) {
  const t = useTranslations('auth.login');
  const [state, action] = useActionState(loginAction, idleState);
  const invalid = state.status === 'error';
  return (
    <form action={action} className="flex flex-col gap-4">
      {imported ? (
        <p role="status" className="rounded-md border border-info bg-info-bg p-3 text-[13px] text-ink-2"><span className="font-semibold text-info">{t('importedTitle')}</span> {t('importedText')}</p>
      ) : null}
      {invalid ? (
        <p role="alert" className="flex gap-2 rounded-md border border-error bg-error-bg p-3 text-[13px] text-ink-2"><Info className="size-4 shrink-0 text-error" aria-hidden /><span>{state.message}</span></p>
      ) : null}
      <FormField id="email" label={t('email')}>
        <Input id="email" name="email" type="email" required autoComplete="email" aria-invalid={invalid || undefined} />
      </FormField>
      <FormField id="password" label={t('password')}>
        <Input id="password" name="password" type="password" required autoComplete="current-password" aria-invalid={invalid || undefined} />
      </FormField>
      <SubmitButton className="h-10 w-full">{t('submit')}</SubmitButton>
    </form>
  );
}
```

`src/app/login/page.tsx`:
```tsx
import { isSetupRequired, readSetting } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';
import { LoginForm } from './login-form';

export default async function LoginPage(props: { searchParams: Promise<{ imported?: string }> }) {
  const deps = getDeps();
  if (isSetupRequired(deps)) redirect('/setup');
  if (await optionalSession()) redirect('/');
  const { imported } = await props.searchParams;
  const t = await getTranslations('auth.login');
  const app = await getTranslations('app');
  return (
    <AuthCard brand={app('name')} organization={readSetting<string>(deps, 'organization.name')} title={t('title')} footer={t('footer')}>
      <LoginForm imported={imported === '1'} />
    </AuthCard>
  );
}
```

- [x] **Step 6: Pflicht-Passwortwechsel**

`src/app/password/actions.ts`:
```ts
'use server';

import { changeOwnPassword } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function setPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx, sessionId } = await requireSession({ allowPasswordChange: true });
  const newPassword = String(formData.get('newPassword') ?? '');
  if (newPassword !== String(formData.get('repeat') ?? '')) {
    return { status: 'error', message: t('errors.validation'), fieldErrors: { repeat: t('auth.password.mismatch') } };
  }
  const result = await changeOwnPassword(deps, ctx, sessionId, { currentPassword: formData.get('currentPassword'), newPassword });
  if (!result.ok) return toActionState(result, t);
  redirect('/');
}
```
Der Kern verlangt für jeden Passwortwechsel das bisherige Passwort. Deshalb fragt die Seite das Startpasswort einmal ab (Feld „Startpasswort").

`src/lib/password-strength.ts` (von beiden Passwortformularen genutzt):
```ts
export function strengthSegments(password: string): number {
  if (password.length === 0) return 0;
  if (password.length < 12) return 1;
  if (password.length < 16) return 2;
  if (password.length < 20) return 3;
  return 4;
}
```

`src/app/password/password-form.tsx`:
```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { FormField } from '@/components/forms/form-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { strengthSegments } from '@/lib/password-strength';
import { setPasswordAction } from './actions';

export function PasswordForm() {
  const t = useTranslations('auth.password');
  const [state, action] = useActionState(setPasswordAction, idleState);
  const [value, setValue] = useState('');
  const errors = state.status === 'error' ? state.fieldErrors : {};
  const filled = strengthSegments(value);
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.status === 'error' && Object.keys(errors).length === 0 ? <p role="alert" className="rounded-md border border-error bg-error-bg p-3 text-[13px] text-error">{state.message}</p> : null}
      <FormField id="currentPassword" label={t('current')} error={errors.currentPassword}>
        <Input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" />
      </FormField>
      <FormField id="newPassword" label={t('new')} error={errors.newPassword} hint={t('strength', { count: value.length })}>
        <Input id="newPassword" name="newPassword" type="password" required minLength={12} autoComplete="new-password" value={value} onChange={(e) => setValue(e.target.value)} />
        <div className="mt-1 flex gap-1" aria-hidden>
          {[1, 2, 3, 4].map((n) => <span key={n} className={`h-1 flex-1 rounded-full ${n <= filled ? 'bg-success' : 'bg-line-strong'}`} />)}
        </div>
      </FormField>
      <FormField id="repeat" label={t('repeat')} error={errors.repeat}>
        <Input id="repeat" name="repeat" type="password" required autoComplete="new-password" />
      </FormField>
      <SubmitButton className="h-10 w-full">{t('submit')}</SubmitButton>
    </form>
  );
}
```

`src/app/password/page.tsx`:
```tsx
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { requireSession } from '@/lib/request-context';
import { PasswordForm } from './password-form';

export default async function PasswordPage() {
  const { user } = await requireSession({ allowPasswordChange: true });
  if (!user.mustChangePassword) redirect('/');
  const t = await getTranslations('auth.password');
  const app = await getTranslations('app');
  return (
    <AuthCard brand={app('name')} title={t('title')} width={360} footer={t('footer')}>
      <p className="text-[14px] leading-[1.55] text-ink-2">{t('intro')}</p>
      <PasswordForm />
    </AuthCard>
  );
}
```

`messages/de.json` — Namensraum `auth` vollständig:
```json
"auth": {
  "setup": {
    "title": "Erste Einrichtung",
    "intro": "Legen Sie das erste Vorstandskonto an. Danach werden weitere Nutzer in der Verwaltung angelegt — dieser Schritt erscheint nicht wieder.",
    "organizationName": "Vereinsname",
    "name": "Ihr Name",
    "email": "E-Mail",
    "password": "Passwort",
    "passwordHint": "Mindestens 12 Zeichen. Ein Merksatz ist besser als ein kurzes Sonderzeichen-Passwort.",
    "submit": "Konto anlegen und starten",
    "footer": "Dieses Konto erhält die Rolle „Administration“ mit allen Rechten. Weitere Rollen legen Sie später unter Verwaltung → Rollen an."
  },
  "login": {
    "title": "Anmelden",
    "email": "E-Mail",
    "password": "Passwort",
    "submit": "Anmelden",
    "invalid": "E-Mail oder Passwort stimmt nicht.",
    "attemptsLeft": "{count, plural, one {Noch # Versuch, danach ist das Konto für 15 Minuten gesperrt.} other {Noch # Versuche, danach ist das Konto für 15 Minuten gesperrt.}}",
    "locked": "Das Konto ist nach fünf Fehlversuchen für 15 Minuten gesperrt. Ein Admin kann ein neues Startpasswort setzen.",
    "inactive": "Dieses Konto ist deaktiviert.",
    "importedTitle": "Import abgeschlossen",
    "importedText": "Alle Sitzungen wurden beendet. Melden Sie sich mit den Zugangsdaten aus dem eingelesenen Bestand an.",
    "footer": "Zugänge werden vom Vorstand angelegt. Bei Problemen wendet man sich an die Administration des Vereins."
  },
  "password": {
    "title": "Neues Passwort festlegen",
    "intro": "Sie haben sich mit einem Startpasswort angemeldet. Legen Sie ein eigenes fest, um fortzufahren.",
    "current": "Startpasswort",
    "new": "Neues Passwort",
    "repeat": "Passwort wiederholen",
    "strength": "{count} Zeichen — mindestens 12 sind nötig.",
    "mismatch": "Die Passwörter stimmen nicht überein.",
    "submit": "Passwort setzen und fortfahren",
    "footer": "Kein Überspringen, kein Abmelden-Knopf: ohne eigenes Passwort gibt es keinen Zugang. Der Wechsel wird protokolliert."
  }
}
```

- [x] **Step 7: E2E ausführen**

Den dritten Test in `e2e/auth.spec.ts` vorerst mit `test.fixme(...)` markieren (Nutzerseite kommt in Task 7). Run: `pnpm --filter @kompass/app e2e e2e/auth.spec.ts`
Expected: Test 1 und 2 grün. Test 1 erwartet „Guten Tag, Anna." — das ist die Startseite aus Task 6; bis dahin liefert das temporäre `src/app/page.tsx` den Text `Guten Tag, {name}.` aus der Session (Zwischenstand):
```tsx
import { requireSession } from '@/lib/request-context';

export default async function Page() {
  const { user } = await requireSession();
  return <main className="p-8">Guten Tag, {user.name.split(' ')[0]}.</main>;
}
```
(Task 6 ersetzt diese Datei vollständig und verschiebt sie in die Shell-Gruppe.)

Run: `pnpm --filter @kompass/app test && pnpm --filter @kompass/app typecheck`
Expected: grün (Literal-Scanner bleibt grün).

- [x] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(app): first-run setup, login with lockout feedback, forced password change"
```

---

### Task 5: App-Shell — Sidebar, Topbar, Umgebungsbalken, Nutzermenü, Präferenzen

**Files:**
- Create: `src/lib/navigation.ts`, `src/lib/preferences.ts`, `src/components/shell/shell-frame.tsx`, `src/components/shell/sidebar.tsx`, `src/components/shell/topbar.tsx`, `src/components/shell/user-menu.tsx`, `src/components/page-header.tsx`, `src/components/forbidden-card.tsx`
- Create: `src/app/(shell)/layout.tsx`; Move: `src/app/page.tsx` → `src/app/(shell)/page.tsx` (Zwischenstand)
- Test: `tests/navigation.test.ts`, `e2e/shell.spec.ts`

**Interfaces:**
- Produces:
  - `buildNavigation({ manifests, enabledKeys, permissions }) → NavGroup[]` mit `{ key, labelKey, disabled, items: { key, href, icon, labelKey, disabled, visible }[] }`. Kern-Gruppe `admin` mit Einträgen `users, roles, settings, themes, modules, audit, documents, backup`; jedes installierte Nicht-Kern-Modul wird zur Gruppe (deaktiviert, wenn nicht aktiv).
  - Client-Präferenzen: `usePreference('sidebarCollapsed' | 'colorScheme' | 'density')` mit localStorage-Schlüsseln `kompass.sidebarCollapsed`, `kompass.colorScheme`, `kompass.density`.
  - `ForbiddenCard({ permission })`, `PageHeader({ title, breadcrumb, actions })`.
  - `(shell)/layout.tsx`: Session-Gate + Umgebungsbalken + Frame.

- [x] **Step 1: Tests schreiben**

`tests/navigation.test.ts`:
```ts
import { coreModule, defineModule } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { buildNavigation } from '@/lib/navigation';

const finance = defineModule({
  key: 'finance',
  version: '0.1.0',
  permissions: ['finance.view'],
  navigation: [{ key: 'finance.ledger', href: '/finance', icon: 'euro', group: 'finance', permission: 'finance.view' }],
});

describe('buildNavigation', () => {
  it('builds the admin group with all eight core entries, filtered by permission', () => {
    const groups = buildNavigation({ manifests: [coreModule], enabledKeys: new Set(['core']), permissions: new Set(['users.manage', 'audit.view']) });
    const admin = groups.find((g) => g.key === 'admin')!;
    expect(admin.items.map((i) => i.key)).toEqual(['users', 'roles', 'settings', 'themes', 'modules', 'audit', 'documents', 'backup']);
    expect(admin.items.filter((i) => i.visible).map((i) => i.key)).toEqual(['users', 'audit']);
  });

  it('renders installed but inactive modules as disabled groups', () => {
    const groups = buildNavigation({ manifests: [coreModule, finance], enabledKeys: new Set(['core']), permissions: new Set(['finance.view']) });
    const group = groups.find((g) => g.key === 'finance')!;
    expect(group.disabled).toBe(true);
    expect(group.items[0]).toMatchObject({ key: 'finance.ledger', href: '/finance', disabled: true });
  });

  it('enables module groups once the module is active', () => {
    const groups = buildNavigation({ manifests: [coreModule, finance], enabledKeys: new Set(['core', 'finance']), permissions: new Set(['finance.view']) });
    expect(groups.find((g) => g.key === 'finance')?.disabled).toBe(false);
  });
});
```

`e2e/shell.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('app shell', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('shows the environment banner, organisation name and admin navigation', async ({ page }) => {
    await expect(page.getByTestId('env-banner')).toContainText('TESTUMGEBUNG');
    const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
    await expect(nav.getByText('Musterverein e.V.')).toBeVisible();
    for (const label of ['Startseite', 'Nutzer', 'Rollen', 'Einstellungen', 'Themes', 'Module', 'Änderungsprotokoll', 'Dokumente', 'Backup']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
  });

  test('collapses the sidebar with [ and remembers it', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
    await expect(nav).toHaveCSS('width', '248px');
    await page.keyboard.press('[');
    await expect(nav).toHaveCSS('width', '56px');
    await page.reload();
    await expect(nav).toHaveCSS('width', '56px');
    await nav.getByRole('link', { name: 'Nutzer' }).hover();
    await expect(page.getByRole('tooltip')).toContainText('Nutzer');
  });

  test('switches colour scheme from the user menu and logs out', async ({ page }) => {
    await page.getByRole('button', { name: 'Nutzermenü' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Dunkles Design' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark');
    await page.getByRole('button', { name: 'Nutzermenü' }).click();
    await page.getByRole('menuitem', { name: 'Abmelden' }).click();
    await expect(page).toHaveURL('/login');
  });

  test('turns into a drawer below 1180px', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeHidden();
    await page.getByRole('button', { name: 'Navigation öffnen' }).click();
    await expect(page.getByRole('dialog').getByRole('link', { name: 'Nutzer' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });
});
```

- [x] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app test tests/navigation.test.ts`
Expected: FAIL — `@/lib/navigation` fehlt.

- [x] **Step 3: Navigation und Präferenzen**

`src/lib/navigation.ts`:
```ts
import type { ModuleManifest } from '@kompass/core';

export interface NavItem {
  key: string;
  href: string;
  icon: string;
  labelKey: string;
  permission?: string;
  disabled: boolean;
  visible: boolean;
}

export interface NavGroup {
  key: string;
  labelKey: string;
  disabled: boolean;
  items: NavItem[];
}

const CORE_ADMIN: { key: string; href: string; icon: string; permission?: string }[] = [
  { key: 'users', href: '/admin/users', icon: 'users', permission: 'users.manage' },
  { key: 'roles', href: '/admin/roles', icon: 'shield', permission: 'roles.manage' },
  { key: 'settings', href: '/admin/settings', icon: 'sliders', permission: 'settings.manage' },
  { key: 'themes', href: '/admin/themes', icon: 'droplet', permission: 'settings.manage' },
  { key: 'modules', href: '/admin/modules', icon: 'grid', permission: 'modules.manage' },
  { key: 'audit', href: '/admin/audit', icon: 'clock', permission: 'audit.view' },
  { key: 'documents', href: '/admin/documents', icon: 'file-text', permission: 'documents.view' },
  { key: 'backup', href: '/admin/backup', icon: 'database', permission: 'backup.export' },
];

export function buildNavigation(input: { manifests: readonly ModuleManifest[]; enabledKeys: ReadonlySet<string>; permissions: ReadonlySet<string> }): NavGroup[] {
  const visible = (permission?: string) => !permission || input.permissions.has(permission);
  const admin: NavGroup = {
    key: 'admin',
    labelKey: 'nav.groups.admin',
    disabled: false,
    items: CORE_ADMIN.map((item) => ({ ...item, labelKey: `nav.${item.key}`, disabled: false, visible: visible(item.permission) })),
  };
  const modules: NavGroup[] = input.manifests
    .filter((m) => m.key !== 'core' && (m.navigation?.length ?? 0) > 0)
    .map((m) => {
      const enabled = input.enabledKeys.has(m.key);
      return {
        key: m.key,
        labelKey: `nav.groups.${m.key}`,
        disabled: !enabled,
        items: (m.navigation ?? []).map((item) => ({
          key: item.key,
          href: item.href,
          icon: item.icon,
          labelKey: `nav.${item.key}`,
          permission: item.permission,
          disabled: !enabled,
          visible: visible(item.permission),
        })),
      };
    });
  return [admin, ...modules];
}
```

`src/lib/preferences.ts`:
```ts
'use client';

import { useCallback, useEffect, useState } from 'react';

type Prefs = { sidebarCollapsed: boolean; colorScheme: 'light' | 'dark'; density: 'compact' | 'default' | 'comfortable' };
const DEFAULTS: Prefs = { sidebarCollapsed: false, colorScheme: 'light', density: 'default' };

function read<K extends keyof Prefs>(key: K): Prefs[K] {
  try {
    const raw = localStorage.getItem(`kompass.${key}`);
    return raw === null ? DEFAULTS[key] : (JSON.parse(raw) as Prefs[K]);
  } catch {
    return DEFAULTS[key];
  }
}

function apply<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  if (key === 'colorScheme') document.documentElement.setAttribute('data-color-scheme', String(value));
  if (key === 'density') document.documentElement.setAttribute('data-density', String(value));
}

export function usePreference<K extends keyof Prefs>(key: K): [Prefs[K], (value: Prefs[K]) => void] {
  const [value, setValue] = useState<Prefs[K]>(DEFAULTS[key]);
  useEffect(() => {
    if (key === 'colorScheme') {
      const attr = document.documentElement.getAttribute('data-color-scheme');
      setValue((attr === 'dark' ? 'dark' : 'light') as Prefs[K]);
      return;
    }
    setValue(read(key));
  }, [key]);
  const update = useCallback(
    (next: Prefs[K]) => {
      setValue(next);
      try {
        localStorage.setItem(`kompass.${key}`, JSON.stringify(next));
      } catch {
        /* privater Modus: Präferenz gilt nur für diese Sitzung */
      }
      apply(key, next);
    },
    [key],
  );
  return [value, update];
}
```

- [x] **Step 4: Shell-Komponenten**

`src/components/shell/sidebar.tsx`:
```tsx
'use client';

import { ChevronUp, Clock, Database, Droplet, Euro, FileText, Grid2x2, Home, PanelLeft, Shield, SlidersHorizontal, Users, X, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { NavGroup } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { UserMenu, type UserMenuProps } from './user-menu';

const ICONS: Record<string, LucideIcon> = { users: Users, shield: Shield, sliders: SlidersHorizontal, droplet: Droplet, grid: Grid2x2, clock: Clock, 'file-text': FileText, database: Database, euro: Euro, home: Home };

export interface SidebarProps {
  organization: string;
  groups: NavGroup[];
  collapsed: boolean;
  onToggle: () => void;
  onClose?: () => void;
  user: UserMenuProps['user'];
}

export function Sidebar({ organization, groups, collapsed, onToggle, onClose, user }: SidebarProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const width = collapsed ? 56 : 248;

  const item = (href: string, icon: string, label: string, disabled: boolean, group?: string) => {
    const Icon = ICONS[icon] ?? Home;
    const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
    const link = (
      <Link
        href={disabled ? '#' : href}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
        aria-current={active ? 'page' : undefined}
        onClick={(e) => { if (disabled) e.preventDefault(); onClose?.(); }}
        className={cn(
          'flex items-center gap-2.5 rounded-md text-[14px]',
          collapsed ? 'mx-auto h-[34px] w-9 justify-center' : 'h-[34px] px-2.5',
          disabled ? 'cursor-default text-disabled-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
          active && 'bg-brand-soft font-semibold text-brand-ink shadow-[inset_2px_0_0_var(--color-primary)]',
        )}
      >
        <Icon className={cn('shrink-0', collapsed ? 'size-[17px]' : 'size-4', active ? 'text-brand-ink' : disabled ? 'text-disabled-ink' : 'text-muted-ink')} aria-hidden />
        {collapsed ? <span className="sr-only">{label}</span> : <span className="truncate">{label}</span>}
      </Link>
    );
    if (!collapsed) return link;
    return (
      <Tooltip delayDuration={400}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right" className="bg-tooltip text-tooltip-ink shadow-md">
          <span className="text-[13px] font-semibold">{label}</span>
          {group ? <span className="ml-2 text-[11px] opacity-70">{group}</span> : null}
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <nav aria-label={t('nav.aria')} style={{ width }} className="flex h-full shrink-0 flex-col border-r border-line bg-sidebar transition-[width]">
      <div className={cn('flex h-14 items-center border-b border-line', collapsed ? 'justify-center' : 'gap-2.5 pl-4 pr-3')}>
        <div className="flex size-7 shrink-0 items-center justify-center rounded-sm border border-dashed border-line-strong text-[9px] text-muted-ink-2" aria-hidden>LOGO</div>
        {collapsed ? null : (
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[14px] font-semibold">{organization}</div>
            <div className="text-[11px] text-muted-ink">{t('app.name')}</div>
          </div>
        )}
        {onClose ? (
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="rounded-sm p-1 hover:bg-hover"><X className="size-4" /></button>
        ) : collapsed ? null : (
          <button type="button" onClick={onToggle} aria-label={t('nav.collapse')} className="rounded-sm p-1 hover:bg-hover"><PanelLeft className="size-4" /></button>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {item('/', 'home', t('nav.home'), false)}
        {groups.map((group) => (
          <div key={group.key} className="flex flex-col gap-0.5">
            {collapsed ? (
              <div className="mx-auto my-1.5 h-px w-6 bg-line-strong" aria-hidden />
            ) : (
              <div className={cn('flex items-center gap-2 px-2.5 pb-1.5 pt-3.5 text-[11px] font-bold uppercase tracking-[.09em]', group.disabled ? 'text-disabled-ink' : 'text-muted-ink')}>
                {t(group.labelKey)}
                {group.disabled ? <span className="rounded-sm border border-line bg-disabled px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-disabled-ink">{t('nav.moduleInactive')}</span> : null}
              </div>
            )}
            {group.items.filter((i) => i.visible || group.disabled).map((i) => item(i.href, i.icon, t(i.labelKey), i.disabled, t(group.labelKey)))}
            {group.disabled && !collapsed ? <p className="px-2.5 pt-1 text-[11px] text-muted-ink">{t('nav.moduleHint')}</p> : null}
          </div>
        ))}
      </div>
      <div className="border-t border-line p-2">
        <UserMenu user={user} collapsed={collapsed} trigger={<ChevronUp className="size-3.5" aria-hidden />} />
      </div>
    </nav>
  );
}
```

`src/components/shell/user-menu.tsx`:
```tsx
'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { usePreference } from '@/lib/preferences';
import { cn } from '@/lib/utils';

export interface UserMenuProps {
  user: { name: string; roleNames: string[] };
  collapsed: boolean;
  trigger?: ReactNode;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

export function UserMenu({ user, collapsed, trigger }: UserMenuProps) {
  const t = useTranslations('shell.userMenu');
  const [scheme, setScheme] = usePreference('colorScheme');
  const [density, setDensity] = usePreference('density');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={t('aria')} className={cn('flex w-full items-center gap-2.5 rounded-md p-2 hover:bg-hover', collapsed && 'justify-center')}>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand text-[12px] font-bold text-on-brand">{initials(user.name)}</span>
          {collapsed ? null : (
            <span className="min-w-0 flex-1 text-left leading-tight">
              <span className="block truncate text-[13px] font-semibold">{user.name}</span>
              <span className="block truncate text-[11px] text-muted-ink">{user.roleNames.join(', ') || t('noRole')}</span>
            </span>
          )}
          {collapsed ? null : trigger}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56 bg-surface shadow-md">
        <DropdownMenuItem asChild><Link href="/profile">{t('profile')}</Link></DropdownMenuItem>
        <DropdownMenuCheckboxItem checked={scheme === 'dark'} onCheckedChange={(checked) => setScheme(checked ? 'dark' : 'light')}>{t('dark')}</DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={density} onValueChange={(v) => setDensity(v as typeof density)}>
          <DropdownMenuRadioItem value="compact">{t('densityCompact')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="default">{t('densityDefault')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="comfortable">{t('densityComfortable')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <form action="/logout" method="post">
          <DropdownMenuItem asChild><button type="submit" className="w-full text-left">{t('logout')}</button></DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

`src/components/shell/topbar.tsx`:
```tsx
'use client';

import { Menu, PanelLeft, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { initials } from './user-menu';

export function Topbar({ breadcrumb, title, userName, collapsed, drawer, onExpand, onOpenDrawer, onSearch }: { breadcrumb: string; title: string; userName: string; collapsed: boolean; drawer: boolean; onExpand: () => void; onOpenDrawer: () => void; onSearch: () => void }) {
  const t = useTranslations('shell.topbar');
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b border-line bg-topbar px-5">
      {drawer ? (
        <button type="button" onClick={onOpenDrawer} aria-label={t('openNav')} className="rounded-sm border border-line-strong p-1"><Menu className="size-4" /></button>
      ) : collapsed ? (
        <button type="button" onClick={onExpand} aria-label={t('expandNav')} className="rounded-sm border border-line-strong p-1"><PanelLeft className="size-4" /></button>
      ) : null}
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-[11px] text-muted-ink">{breadcrumb}</div>
        <h1 className="truncate font-heading text-[18px]">{title}</h1>
      </div>
      <button type="button" onClick={onSearch} className="flex h-8 w-60 items-center gap-2 rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-placeholder">
        <Search className="size-3.5" aria-hidden />
        <span className="flex-1 text-left">{t('search')}</span>
        <kbd className="rounded-[3px] border border-line px-1 font-mono text-[11px]">⌘K</kbd>
      </button>
      <span className="flex size-[30px] items-center justify-center rounded-full bg-brand text-[12px] font-bold text-on-brand" aria-hidden>{initials(userName)}</span>
    </header>
  );
}
```

`src/components/shell/shell-frame.tsx`:
```tsx
'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { NavGroup } from '@/lib/navigation';
import { usePreference } from '@/lib/preferences';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

export const DRAWER_BREAKPOINT = 1180;

function titleFor(pathname: string, groups: NavGroup[], t: (k: string) => string): { title: string; group: string } {
  if (pathname === '/') return { title: t('nav.home'), group: '' };
  if (pathname.startsWith('/profile')) return { title: t('nav.profile'), group: '' };
  for (const group of groups) {
    const hit = group.items.find((i) => pathname.startsWith(i.href));
    if (hit) return { title: t(hit.labelKey), group: t(group.labelKey) };
  }
  return { title: '', group: '' };
}

export function ShellFrame({ organization, groups, user, permissions, children }: { organization: string; groups: NavGroup[]; user: { name: string; roleNames: string[] }; permissions: string[]; children: ReactNode }) {
  void permissions; // ab Task 14 an die Befehlspalette durchgereicht
  const t = useTranslations();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = usePreference('sidebarCollapsed');
  const [drawer, setDrawer] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const media = matchMedia(`(max-width: ${DRAWER_BREAKPOINT - 1}px)`);
    const sync = () => setDrawer(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '[' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) setCollapsed(!collapsed);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [collapsed, setCollapsed]);

  const { title, group } = titleFor(pathname, groups, t);
  const breadcrumb = [organization, group].filter(Boolean).join(' / ');
  const openPalette = () => window.dispatchEvent(new CustomEvent('kompass:command-palette'));

  return (
    <TooltipProvider>
      <div className="flex min-h-0 flex-1">
        {drawer ? (
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetContent side="left" className="w-[280px] p-0 shadow-md">
              <SheetTitle className="sr-only">{t('nav.aria')}</SheetTitle>
              <Sidebar organization={organization} groups={groups} collapsed={false} onToggle={() => {}} onClose={() => setDrawerOpen(false)} user={user} />
            </SheetContent>
          </Sheet>
        ) : (
          <Sidebar organization={organization} groups={groups} collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} user={user} />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar breadcrumb={breadcrumb} title={title} userName={user.name} collapsed={collapsed} drawer={drawer} onExpand={() => setCollapsed(false)} onOpenDrawer={() => setDrawerOpen(true)} onSearch={openPalette} />
          <main className="flex-1 overflow-auto p-6">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}
```

`src/components/page-header.tsx`:
```tsx
import type { ReactNode } from 'react';

export function PageHeader({ title, description, actions }: { title?: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        {title ? <h2 className="font-heading text-[22px]">{title}</h2> : null}
        {description ? <p className="mt-1 text-[14px] text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
```

`src/components/forbidden-card.tsx`:
```tsx
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function ForbiddenCard({ permission }: { permission: string }) {
  const t = useTranslations('errors.pages.forbidden');
  return (
    <section className="flex min-h-[320px] max-w-[720px] flex-col gap-3 rounded-lg border border-line bg-surface p-7">
      <div className="flex items-center gap-2 text-[12px]">
        <span className="rounded-sm bg-warning-bg px-1.5 py-0.5 font-mono font-semibold text-warning">403</span>
        <span className="text-muted-ink">{t('kicker')}</span>
      </div>
      <h2 className="font-heading text-[20px]">{t('title')}</h2>
      <p className="text-[14px] leading-[1.55] text-ink-2">{t('text')}</p>
      <code className="w-fit rounded-md bg-code px-2 py-1 font-mono text-[12px]">{permission}</code>
      <div className="mt-auto flex items-center gap-3">
        <Button asChild><Link href="/">{t('home')}</Link></Button>
        <span className="text-[12px] text-muted-ink">{t('footnote')}</span>
      </div>
    </section>
  );
}
```

- [x] **Step 5: Shell-Layout**

`src/app/(shell)/layout.tsx`:
```tsx
import { enabledManifests, readSetting } from '@kompass/core';
import type { ReactNode } from 'react';
import { EnvBanner } from '@/components/shell/env-banner';
import { ShellFrame } from '@/components/shell/shell-frame';
import { runtimeEnv } from '@/lib/deps';
import { bannerFor } from '@/lib/env-banner';
import { buildNavigation } from '@/lib/navigation';
import { requireSession } from '@/lib/request-context';

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const { deps, ctx, user } = await requireSession();
  const env = runtimeEnv();
  const context = { lastImportAt: readSetting<string | null>(deps, 'system.lastImportAt'), migrationCount: deps.migrationCount };
  const banner = bannerFor(env.env, context);
  const groups = buildNavigation({ manifests: deps.registry.manifests, enabledKeys: new Set(enabledManifests(deps).map((m) => m.key)), permissions: ctx.permissions });
  return (
    <div className="flex min-h-screen flex-col">
      {banner ? <EnvBanner banner={banner} context={context} /> : null}
      <ShellFrame organization={readSetting<string>(deps, 'organization.name')} groups={groups} user={{ name: user.name, roleNames: user.roles.map((r) => r.name) }} permissions={[...ctx.permissions]}>
        {children}
      </ShellFrame>
    </div>
  );
}
```

Kern-Erweiterung dafür (TDD im Kern): In `packages/core/tests/app.test.ts` im Test „opens a file database" die Zeile `expect(first.migrationCount).toBeGreaterThanOrEqual(2);` ergänzen, Test rot sehen, dann in `packages/core/src/app.ts` das Rückgabeobjekt von `createDeps` um `migrationCount` erweitern:
```ts
  runMigrations(db);
  const migrationCount = (sqlite.prepare('select count(*) as n from __drizzle_migrations').get() as { n: number }).n;
  return { db, clock: opts.clock ?? systemClock, env: opts.env, registry: createRegistry([coreModule, ...(opts.modules ?? [])]), migrationCount, close: () => sqlite.close() };
```
und den Rückgabetyp auf `Deps & { migrationCount: number; close(): void }` setzen; `AppDeps` in `src/lib/deps.ts` entsprechend `Deps & { migrationCount: number; close(): void }`. `ShellFrame` erhält das Prop `permissions: string[]` (in Task 14 von der Befehlspalette genutzt; bis dahin unbenutzt durchgereicht).

`src/app/page.tsx` nach `src/app/(shell)/page.tsx` verschieben (Inhalt unverändert bis Task 6).

`messages/de.json` ergänzen:
```json
"nav": {
  "aria": "Hauptnavigation",
  "home": "Startseite",
  "profile": "Profil",
  "collapse": "Navigation einklappen",
  "moduleInactive": "Modul nicht aktiv",
  "moduleHint": "Module werden unter Verwaltung → Module aktiviert.",
  "groups": { "admin": "Verwaltung", "finance": "Finanzen", "members": "Mitglieder", "animals": "Tiere", "website": "Webseite" },
  "users": "Nutzer", "roles": "Rollen", "settings": "Einstellungen", "themes": "Themes", "modules": "Module",
  "audit": "Änderungsprotokoll", "documents": "Dokumente", "backup": "Backup"
},
"shell": {
  "envBanner": { "testContext": "Daten vom {date} · Änderungen hier haben keine Wirkung", "noImport": "kein Import", "devContext": "localhost · Migrationsstand {migrations}" },
  "topbar": { "search": "Suchen", "openNav": "Navigation öffnen", "expandNav": "Navigation aufklappen" },
  "userMenu": { "aria": "Nutzermenü", "profile": "Profil", "dark": "Dunkles Design", "densityCompact": "Kompakte Zeilen", "densityDefault": "Normale Zeilen", "densityComfortable": "Komfortable Zeilen", "logout": "Abmelden", "noRole": "Keine Rolle" }
},
"errors": { "pages": { "forbidden": { "kicker": "Kein Recht", "title": "Diese Seite ist für Ihre Rolle nicht freigegeben.", "text": "Das nötige Recht steht unten. Damit kann die Administration Ihre Rolle anpassen.", "home": "Zurück zur Startseite", "footnote": "Rechte ändert die Administration unter Rollen." } } }
```
(`errors.pages` in den bestehenden `errors`-Block einfügen, nicht doppelt anlegen.)

- [x] **Step 6: Tests ausführen**

Run: `pnpm --filter @kompass/app test && pnpm --filter @kompass/app typecheck && pnpm --filter @kompass/app e2e e2e/shell.spec.ts e2e/auth.spec.ts`
Expected: grün. Falls `toHaveCSS('width', '248px')` an Transition-Timing scheitert, `await expect(...)` behält Retries; nicht die Transition entfernen.

- [x] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(app): app shell with sidebar, topbar, env banner, user menu and preferences"
```

---

### Task 6: Startseite mit Fortschrittskarten

**Files:**
- Create: `src/lib/setup-progress.ts`
- Replace: `src/app/(shell)/page.tsx`
- Test: `tests/setup-progress.test.ts`, `e2e/home.spec.ts`

**Interfaces:**
- Produces: `computeSetupProgress({ settings, roleCount, modules }) → { settings: { done, total, missing: string[] }, roles: { done, total }, modules: { done, total } }`. Pflichtfelder für „vollständig": `organization.name, street, postalCode, city, registerCourt, registerNumber, taxNumber, taxOffice, exemptionNoticeType (≠ none), exemptionNoticeDate` (10 Felder; das Design zeigt „4 von 9" — die Spec verlangt zusätzlich den Bescheidtyp). Rollen-Ziel: 3 (Administration + zwei empfohlene). Module: installierte Nicht-Kern-Module.

- [x] **Step 1: Tests schreiben**

`tests/setup-progress.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { computeSetupProgress, REQUIRED_SETTINGS } from '@/lib/setup-progress';

describe('computeSetupProgress', () => {
  it('counts filled required settings and lists the missing ones', () => {
    const settings: Record<string, unknown> = { 'organization.name': 'X', 'organization.street': 'S', 'organization.postalCode': '1', 'organization.city': 'C', 'organization.exemptionNoticeType': 'none' };
    const p = computeSetupProgress({ settings, roleCount: 1, modules: [{ key: 'core', enabled: true }, { key: 'finance', enabled: false }] });
    expect(p.settings).toEqual({ done: 4, total: REQUIRED_SETTINGS.length, missing: ['organization.registerCourt', 'organization.registerNumber', 'organization.taxNumber', 'organization.taxOffice', 'organization.exemptionNoticeType', 'organization.exemptionNoticeDate'] });
    expect(p.roles).toEqual({ done: 1, total: 3 });
    expect(p.modules).toEqual({ done: 0, total: 1 });
  });
  it('caps roles at the target and ignores core in modules', () => {
    const p = computeSetupProgress({ settings: {}, roleCount: 5, modules: [{ key: 'core', enabled: true }] });
    expect(p.roles).toEqual({ done: 3, total: 3 });
    expect(p.modules).toEqual({ done: 0, total: 0 });
  });
});
```

`e2e/home.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test('home page greets by first name and shows three progress cards', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await expect(page.getByRole('heading', { name: 'Guten Tag, Anna.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Einstellungen vervollständigen' })).toBeVisible();
  await expect(page.getByText('1 von 10')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rollen anlegen' })).toBeVisible();
  await expect(page.getByText('3 von 3')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Module aktivieren' })).toBeVisible();
  await page.getByRole('link', { name: 'Zu den Einstellungen' }).click();
  await expect(page).toHaveURL('/admin/settings');
});
```

- [x] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app test tests/setup-progress.test.ts`
Expected: FAIL — Modul fehlt.

- [x] **Step 3: Implementieren**

`src/lib/setup-progress.ts`:
```ts
export const REQUIRED_SETTINGS = [
  'organization.name', 'organization.street', 'organization.postalCode', 'organization.city',
  'organization.registerCourt', 'organization.registerNumber', 'organization.taxNumber', 'organization.taxOffice',
  'organization.exemptionNoticeType', 'organization.exemptionNoticeDate',
] as const;

export const ROLE_TARGET = 3;

function filled(key: string, value: unknown): boolean {
  if (key === 'organization.exemptionNoticeType') return typeof value === 'string' && value !== 'none';
  return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;
}

export function computeSetupProgress(input: { settings: Record<string, unknown>; roleCount: number; modules: { key: string; enabled: boolean }[] }) {
  const missing = REQUIRED_SETTINGS.filter((key) => !filled(key, input.settings[key]));
  const nonCore = input.modules.filter((m) => m.key !== 'core');
  return {
    settings: { done: REQUIRED_SETTINGS.length - missing.length, total: REQUIRED_SETTINGS.length, missing: [...missing] },
    roles: { done: Math.min(input.roleCount, ROLE_TARGET), total: ROLE_TARGET },
    modules: { done: nonCore.filter((m) => m.enabled).length, total: nonCore.length },
  };
}
```

`src/app/(shell)/page.tsx`:
```tsx
import { listModules, listRoles, readAllSettings, readSetting } from '@kompass/core';
import { Info } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { computeSetupProgress } from '@/lib/setup-progress';
import { requireSession } from '@/lib/request-context';

function Card({ title, counter, text, hint, percent, href, cta }: { title: string; counter: string; text: string; hint: string; percent: number; href: string; cta: string }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-[18px]">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-heading text-[17px]">{title}</h3>
        <span className="font-mono text-[12px] text-muted-ink">{counter}</span>
      </div>
      <p className="min-h-[63px] text-[14px] leading-[1.5] text-ink-2">{text}</p>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden><div className="h-full bg-brand" style={{ width: `${percent}%` }} /></div>
      <p className="text-[12px] text-muted-ink">{hint}</p>
      <Button asChild variant="secondary" className="w-fit"><Link href={href}>{cta}</Link></Button>
    </section>
  );
}

export default async function HomePage() {
  const { deps, ctx, user } = await requireSession();
  const t = await getTranslations('home');
  const roles = await listRoles(deps, ctx);
  const progress = computeSetupProgress({ settings: readAllSettings(deps), roleCount: roles.ok ? roles.value.length : 0, modules: listModules(deps) });
  const pct = (d: number, tot: number) => (tot === 0 ? 0 : Math.round((d / tot) * 100));
  const firstName = user.name.split(' ')[0] ?? user.name;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-heading text-[26px]">{t('greeting', { name: firstName })}</h2>
        <p className="mt-1 text-[15px] leading-[1.55] text-ink-2">{t('intro')}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card title={t('settings.title')} counter={t('counter', { done: progress.settings.done, total: progress.settings.total })} text={t('settings.text')} hint={t('settings.hint', { count: progress.settings.missing.length })} percent={pct(progress.settings.done, progress.settings.total)} href="/admin/settings" cta={t('settings.cta')} />
        <Card title={t('roles.title')} counter={t('counter', { done: progress.roles.done, total: progress.roles.total })} text={t('roles.text')} hint={t('roles.hint')} percent={pct(progress.roles.done, progress.roles.total)} href="/admin/roles" cta={t('roles.cta')} />
        <Card title={t('modules.title')} counter={t('counter', { done: progress.modules.done, total: progress.modules.total })} text={progress.modules.total === 0 ? t('modules.none') : t('modules.text')} hint={t('modules.hint')} percent={pct(progress.modules.done, progress.modules.total)} href="/admin/modules" cta={t('modules.cta')} />
      </div>
      <p className="flex max-w-[820px] gap-2 rounded-md border border-info bg-info-bg p-3 text-[13px] leading-[1.55] text-ink-2">
        <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <span>{readSetting<string | null>(deps, 'system.lastExportAt') ? t('backupDone') : t('backupMissing')}</span>
      </p>
    </div>
  );
}
```

`messages/de.json` — Namensraum `home`:
```json
"home": {
  "greeting": "Guten Tag, {name}.",
  "intro": "Der Verein ist angelegt. Drei Dinge fehlen noch, bevor Sie mit der Verwaltung arbeiten können.",
  "counter": "{done} von {total}",
  "settings": { "title": "Einstellungen vervollständigen", "text": "Steuernummer, Finanzamt und Freistellungsbescheid fehlen. Ohne diese Angaben lassen sich keine Zuwendungsbestätigungen erzeugen.", "hint": "{count, plural, =0 {Alle Pflichtfelder gefüllt} one {# Feld offen} other {# Felder offen}}", "cta": "Zu den Einstellungen" },
  "roles": { "title": "Rollen anlegen", "text": "Es gibt nur die Rolle „Administration“. Für Kassenprüfung und Schriftführung sind eigene Rollen mit weniger Rechten sinnvoll.", "hint": "Empfohlen: Schatzmeisterin, Kassenprüfer", "cta": "Rollen öffnen" },
  "modules": { "title": "Module aktivieren", "text": "Module sind installiert, aber inaktiv. Aktivieren Sie nur, was der Verein wirklich führt.", "none": "In dieser Installation sind noch keine Fachmodule enthalten. Der Kern ist immer aktiv.", "hint": "Kern ist immer aktiv", "cta": "Module öffnen" },
  "backupMissing": "Diese Installation läuft im Vereinsnetz. Ein Backup wurde noch nicht erstellt — der erste Export dauert unter einer Minute.",
  "backupDone": "Diese Installation läuft im Vereinsnetz. Das letzte Backup ist vorhanden."
}
```

- [x] **Step 4: Tests ausführen**

Run: `pnpm --filter @kompass/app test && pnpm --filter @kompass/app e2e e2e/home.spec.ts`
Expected: grün. Der Seed setzt nur `organization.name`, daher „1 von 10"; er legt vier Rollen an, daher „3 von 3".

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(app): home page with setup progress cards"
```

---

### Task 7: Nutzerverwaltung

**Files:**
- Create: `src/app/(shell)/admin/users/page.tsx`, `actions.ts`, `user-table.tsx`, `create-user-dialog.tsx`, `start-password-dialog.tsx`, `src/components/status-badge.tsx`, `src/components/forms/confirm-dialog.tsx`
- Modify: `e2e/auth.spec.ts` (fixme entfernen)
- Test: `e2e/users.spec.ts`

**Interfaces:**
- Consumes: `listUsers`, `createUser`, `updateUser`, `setUserActive`, `resetStartPassword`, `listRoles`, `assignRole`, `removeRole`.
- Produces: Actions `createUserAction`, `setUserActiveAction`, `resetStartPasswordAction`, `updateUserAction`, `setUserRolesAction`; Komponenten `StatusBadge`, `ConfirmDialog`, `StartPasswordDialog`.

- [x] **Step 1: E2E-Test schreiben**

`e2e/users.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('users', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
    await page.goto('/admin/users');
  });

  test('lists seeded users with roles and status', async ({ page }) => {
    const table = page.getByRole('table');
    await expect(table.getByRole('row')).toHaveCount(5); // Kopf + 4
    const jonas = table.getByRole('row', { name: /Jonas Feld/ });
    await expect(jonas).toContainText('Schatzmeisterin');
    await expect(jonas).toContainText('Aktiv');
    await expect(page.getByText('4 Nutzer, davon 0 inaktiv')).toBeVisible();
  });

  test('creates a user, shows the start password once and marks first login pending', async ({ page }) => {
    await page.getByRole('button', { name: 'Nutzer anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Rita Sommer');
    await dialog.getByLabel('E-Mail').fill('rita@example.org');
    await dialog.getByLabel('Kassenprüfer').check();
    await dialog.getByRole('button', { name: 'Nutzer anlegen' }).click();
    await expect(page.getByRole('dialog', { name: /Nutzer „Rita Sommer“ angelegt/ })).toBeVisible();
    await expect(page.getByTestId('start-password')).toHaveText(/^[a-z]+-[a-z]+-\d{2}-[a-z]+$/);
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Schließen' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Ich habe die Daten notiert' }).click();
    const row = page.getByRole('row', { name: /Rita Sommer/ });
    await expect(row).toContainText('Erstlogin offen');
    await expect(row).toContainText('Kassenprüfer');
  });

  test('rejects a duplicate e-mail inside the dialog', async ({ page }) => {
    await page.getByRole('button', { name: 'Nutzer anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Doppelt');
    await dialog.getByLabel('E-Mail').fill('jonas@kompass.local');
    await dialog.getByRole('button', { name: 'Nutzer anlegen' }).click();
    await expect(dialog.getByRole('alert')).toContainText('bereits vergeben');
  });

  test('deactivates a user after confirmation and refuses for the last administrator', async ({ page }) => {
    await page.getByRole('row', { name: /Jonas Feld/ }).getByRole('button', { name: 'Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Deaktivieren' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Jonas Feld kann sich danach nicht mehr anmelden.');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Deaktivieren' }).click();
    await expect(page.getByRole('row', { name: /Jonas Feld/ })).toContainText('Inaktiv');

    await page.getByRole('row', { name: /Anna Berger/ }).getByRole('button', { name: 'Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Deaktivieren' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Deaktivieren' }).click();
    await expect(page.getByRole('status')).toContainText('Mindestens ein aktiver Nutzer muss die Rolle „Administration“ behalten.');
  });

  test('is forbidden for a role without users.manage', async ({ page }) => {
    // Mira Klein (Kassenprüfer) hat nur audit.view und documents.view; Startpasswort per Reset holen.
    await page.getByRole('row', { name: /Mira Klein/ }).getByRole('button', { name: 'Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Neues Startpasswort' }).click();
    const startPassword = (await page.getByTestId('start-password').textContent())!.trim();
    await page.getByRole('button', { name: 'Ich habe die Daten notiert' }).click();
    await page.request.post('/logout');
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill('mira@kompass.local');
    await page.getByLabel('Passwort').fill(startPassword);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.getByLabel('Startpasswort').fill(startPassword);
    await page.getByLabel('Neues Passwort', { exact: true }).fill('mira-hat-ein-neues-passwort');
    await page.getByLabel('Passwort wiederholen').fill('mira-hat-ein-neues-passwort');
    await page.getByRole('button', { name: 'Passwort setzen und fortfahren' }).click();
    await page.goto('/admin/users');
    await expect(page.getByText('403')).toBeVisible();
    await expect(page.getByText('users.manage')).toBeVisible();
  });
});
```

- [x] **Step 2: E2E ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app e2e e2e/users.spec.ts`
Expected: FAIL — 404 für `/admin/users`.

- [x] **Step 3: Gemeinsame Bausteine**

`src/components/status-badge.tsx`:
```tsx
import { cn } from '@/lib/utils';

export type BadgeTone = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'brand' | 'accent';

const TONES: Record<BadgeTone, string> = {
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  error: 'bg-error-bg text-error',
  info: 'bg-info-bg text-info',
  neutral: 'bg-badge text-badge-ink',
  brand: 'bg-brand-soft text-brand-ink',
  accent: 'bg-brand-accent-soft text-brand-accent-deep',
};

export function StatusBadge({ tone, dot, children, className }: { tone: BadgeTone; dot?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-[12px] font-semibold', TONES[tone], className)}>
      {dot ? <span className="size-[7px] rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}
```

`src/components/forms/confirm-dialog.tsx`:
```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import type { ActionState } from '@/lib/actions';

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, destructive, action, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; confirmLabel: string; destructive?: boolean; action: () => Promise<ActionState>; children?: ReactNode }) {
  const t = useTranslations('common');
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent role="alertdialog" className="bg-surface shadow-md">
        <DialogTitle className="font-heading text-[19px]">{title}</DialogTitle>
        <DialogDescription className="text-[14px] text-ink-2">{description}</DialogDescription>
        {children}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
          <Button variant={destructive ? 'destructive' : 'default'} disabled={pending} onClick={() => start(async () => {
            const state = await action();
            if (state.status === 'error') toast.error(state.message);
            else if (state.status === 'success' && state.message) toast.success(state.message);
            onOpenChange(false);
          })}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```
Hinweis: Sonner rendert Toasts mit `role="status"`; der E2E-Test liest die Fehlermeldung daraus.

`src/app/(shell)/admin/users/start-password-dialog.tsx`:
```tsx
'use client';

import { Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

export function StartPasswordDialog({ open, onClose, name, email, startPassword }: { open: boolean; onClose: () => void; name: string; email: string; startPassword: string }) {
  const t = useTranslations('users.startPassword');
  const c = useTranslations('common');
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent showCloseButton={false} onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()} className="w-[520px] bg-surface shadow-md">
        <DialogTitle className="font-heading text-[19px]">{t('title', { name })}</DialogTitle>
        <DialogDescription className="text-[14px] text-ink-2">{t('text')}</DialogDescription>
        <div className="rounded-md border border-line-strong bg-code p-3 font-mono">
          <div className="text-[11px] font-semibold tracking-[.06em] text-muted-ink">E-MAIL</div>
          <div className="text-[13px]">{email}</div>
          <div className="mt-2 text-[11px] font-semibold tracking-[.06em] text-muted-ink">STARTPASSWORT</div>
          <div data-testid="start-password" className="text-[15px] font-medium">{startPassword}</div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={async () => { await navigator.clipboard.writeText(`${email}\n${startPassword}`); setCopied(true); }}><Copy className="size-4" aria-hidden />{copied ? c('copied') : t('copyBoth')}</Button>
        </div>
        <p className="rounded-md border border-info bg-info-bg p-3 text-[13px] text-ink-2">{t('info', { name })}</p>
        <Button onClick={onClose}>{t('done')}</Button>
      </DialogContent>
    </Dialog>
  );
}
```
(Wenn die generierte `DialogContent`-Komponente kein `showCloseButton`-Prop hat, dort ein optionales Prop ergänzen, das das `×` bei `false` nicht rendert.)

- [x] **Step 4: Actions**

`src/app/(shell)/admin/users/actions.ts`:
```ts
'use server';

import { assignRole, createUser, listRoles, removeRole, resetStartPassword, setUserActive, updateUser } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function createUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await createUser(deps, ctx, {
    name: formData.get('name'),
    email: formData.get('email'),
    roleIds: formData.getAll('roleIds').map(String),
  });
  revalidatePath('/admin/users');
  return toActionState(result, t);
}

export async function setUserActiveAction(id: string, isActive: boolean): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setUserActive(deps, ctx, { id, isActive });
  revalidatePath('/admin/users');
  return toActionState(result, t, t(isActive ? 'users.toast.activated' : 'users.toast.deactivated'));
}

export async function resetStartPasswordAction(id: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await resetStartPassword(deps, ctx, { id });
  revalidatePath('/admin/users');
  return toActionState(result, t);
}

export async function updateUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await updateUser(deps, ctx, { id: formData.get('id'), name: formData.get('name'), email: formData.get('email') });
  revalidatePath('/admin/users');
  return toActionState(result, t, t('users.toast.saved'));
}

/** Nur Differenzen schreiben: assignRole für neue, removeRole für entfernte Rollen — kein Protokoll-Rauschen. */
export async function setUserRolesAction(userId: string, roleIds: string[], previousRoleIds: string[]): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const add = roleIds.filter((id) => !previousRoleIds.includes(id));
  const remove = previousRoleIds.filter((id) => !roleIds.includes(id));
  for (const roleId of add) {
    const r = await assignRole(deps, ctx, { userId, roleId });
    if (!r.ok) { revalidatePath('/admin/users'); return toActionState(r, t); }
  }
  for (const roleId of remove) {
    const r = await removeRole(deps, ctx, { userId, roleId });
    if (!r.ok) { revalidatePath('/admin/users'); return toActionState(r, t); }
  }
  revalidatePath('/admin/users');
  return { status: 'success', message: t('users.toast.rolesSaved') };
}
```


- [x] **Step 5: Dialog, Tabelle, Seite**

`src/app/(shell)/admin/users/create-user-dialog.tsx`:
```tsx
'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { FormField } from '@/components/forms/form-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { idleState } from '@/lib/actions';
import { createUserAction } from './actions';
import { StartPasswordDialog } from './start-password-dialog';

type Created = { user: { name: string; email: string }; startPassword: string };

export function CreateUserDialog({ roles }: { roles: { id: string; name: string }[] }) {
  const t = useTranslations('users.create');
  const c = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [state, action] = useActionState(createUserAction, idleState);
  const errors = state.status === 'error' ? state.fieldErrors : {};

  useEffect(() => {
    if (state.status === 'success' && state.data) {
      setCreated(state.data as Created);
      setOpen(false);
    }
  }, [state]);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild><Button><Plus className="size-3.5" aria-hidden />{t('button')}</Button></DialogTrigger>
        <DialogContent className="w-[560px] bg-surface p-0 shadow-md">
          <form action={action}>
            <div className="p-6">
              <DialogTitle className="font-heading text-[19px]">{t('title')}</DialogTitle>
              <DialogDescription className="text-[13px] text-muted-ink">{t('subtitle')}</DialogDescription>
              {state.status === 'error' && Object.keys(errors).length === 0 ? <p role="alert" className="mt-3 rounded-md border border-error bg-error-bg p-3 text-[13px] text-error">{state.message}</p> : null}
              <fieldset className="mt-4 rounded-md border border-line bg-surface-2 px-3 py-2.5">
                <legend className="px-1 text-[13px] font-semibold text-ink-2">{t('roles')}</legend>
                <div className="flex flex-wrap gap-4">
                  {roles.map((role) => (
                    <div key={role.id} className="flex items-center gap-2">
                      <Checkbox id={`role-${role.id}`} name="roleIds" value={role.id} />
                      <Label htmlFor={`role-${role.id}`}>{role.name}</Label>
                    </div>
                  ))}
                </div>
              </fieldset>
              <div className="mt-4 grid gap-3.5 md:grid-cols-2">
                <FormField id="name" label={t('name')} error={errors.name}><Input id="name" name="name" required /></FormField>
                <FormField id="email" label={t('email')} error={errors.email}><Input id="email" name="email" type="email" required /></FormField>
              </div>
            </div>
            <DialogFooter className="items-center border-t border-line bg-surface-2 px-6 py-3">
              <span className="mr-auto text-[12px] text-muted-ink">{c('audited')}</span>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{c('cancel')}</Button>
              <SubmitButton>{t('submit')}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {created ? <StartPasswordDialog open onClose={() => setCreated(null)} name={created.user.name} email={created.user.email} startPassword={created.startPassword} /> : null}
    </>
  );
}
```

`src/app/(shell)/admin/users/user-table.tsx`:
```tsx
'use client';

import type { UserSummary } from '@kompass/core';
import { MoreHorizontal } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { resetStartPasswordAction, setUserActiveAction, setUserRolesAction } from './actions';
import { StartPasswordDialog } from './start-password-dialog';

export function UserTable({ users, roles }: { users: UserSummary[]; roles: { id: string; name: string }[] }) {
  const t = useTranslations('users');
  const format = useFormatter();
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  const [confirm, setConfirm] = useState<UserSummary | null>(null);
  const [reset, setReset] = useState<{ user: UserSummary; startPassword: string } | null>(null);
  const [editRoles, setEditRoles] = useState<UserSummary | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const rows = useMemo(() => users.filter((u) => (showInactive || u.isActive) && `${u.name} ${u.email}`.toLowerCase().includes(query.toLowerCase())), [users, showInactive, query]);
  const inactive = users.filter((u) => !u.isActive).length;
  const tone = { active: 'success', firstLoginPending: 'warning', inactive: 'neutral' } as const;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Input aria-label={t('filter.search')} placeholder={t('filter.search')} value={query} onChange={(e) => setQuery(e.target.value)} className="h-[34px] w-[260px]" />
        <div className="flex items-center gap-2"><Switch id="show-inactive" checked={showInactive} onCheckedChange={setShowInactive} /><Label htmlFor="show-inactive">{t('filter.showInactive')}</Label></div>
        <span className="ml-auto text-[13px] text-muted-ink">{t('filter.count', { count: users.length, inactive })}</span>
      </div>
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <Table>
          <TableHeader className="bg-table-head"><TableRow><TableHead>{t('columns.name')}</TableHead><TableHead>{t('columns.email')}</TableHead><TableHead>{t('columns.roles')}</TableHead><TableHead>{t('columns.status')}</TableHead><TableHead>{t('columns.lastLogin')}</TableHead><TableHead className="w-11" /></TableRow></TableHeader>
          <TableBody>
            {rows.map((u, i) => (
              <TableRow key={u.id} className={cn('h-[var(--row-h)] hover:bg-row-hover', i % 2 === 1 && 'bg-zebra')}>
                <TableCell className={cn('font-semibold', !u.isActive && 'text-disabled-ink')}>{u.name}</TableCell>
                <TableCell className={cn('text-ink-2', !u.isActive && 'text-disabled-ink')}>{u.email}</TableCell>
                <TableCell><div className="flex flex-wrap gap-1.5">{u.roles.map((r) => <StatusBadge key={r.id} tone="brand">{r.name}</StatusBadge>)}</div></TableCell>
                <TableCell><StatusBadge tone={tone[u.status]} dot>{t(`status.${u.status}`)}</StatusBadge></TableCell>
                <TableCell className="font-mono text-[13px] text-ink-2">{u.lastLoginAt ? format.dateTime(new Date(u.lastLoginAt), { dateStyle: 'short', timeStyle: 'short' }) : '—'}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={t('actions.menu')}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-surface shadow-md">
                      <DropdownMenuItem onSelect={() => { setSelectedRoles(u.roles.map((r) => r.id)); setEditRoles(u); }}>{t('actions.roles')}</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => start(async () => { const s = await resetStartPasswordAction(u.id); if (s.status === 'success') setReset({ user: u, startPassword: (s.data as { startPassword: string }).startPassword }); else if (s.status === 'error') toast.error(s.message); })}>{t('actions.resetPassword')}</DropdownMenuItem>
                      {u.isActive ? <DropdownMenuItem onSelect={() => setConfirm(u)}>{t('actions.deactivate')}</DropdownMenuItem> : <DropdownMenuItem onSelect={() => start(async () => { const s = await setUserActiveAction(u.id, true); if (s.status === 'error') toast.error(s.message); })}>{t('actions.activate')}</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {confirm ? <ConfirmDialog open onOpenChange={(o) => { if (!o) setConfirm(null); }} title={t('deactivate.title')} description={t('deactivate.text', { name: confirm.name })} confirmLabel={t('actions.deactivate')} destructive action={() => setUserActiveAction(confirm.id, false)} /> : null}
      {reset ? <StartPasswordDialog open onClose={() => setReset(null)} name={reset.user.name} email={reset.user.email} startPassword={reset.startPassword} /> : null}
      {editRoles ? (
        <Dialog open onOpenChange={(o) => { if (!o) setEditRoles(null); }}>
          <DialogContent className="bg-surface shadow-md">
            <DialogTitle className="font-heading text-[19px]">{t('roles.title', { name: editRoles.name })}</DialogTitle>
            <div className="flex flex-col gap-2">
              {roles.map((r) => (
                <div key={r.id} className="flex items-center gap-2">
                  <Checkbox id={`edit-role-${r.id}`} checked={selectedRoles.includes(r.id)} onCheckedChange={(c) => setSelectedRoles((prev) => (c ? [...prev, r.id] : prev.filter((x) => x !== r.id)))} />
                  <Label htmlFor={`edit-role-${r.id}`}>{r.name}</Label>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditRoles(null)}>{t('roles.cancel')}</Button>
              <Button disabled={pending} onClick={() => start(async () => { const s = await setUserRolesAction(editRoles.id, selectedRoles, editRoles.roles.map((r) => r.id)); if (s.status === 'error') toast.error(s.message); else toast.success(s.status === 'success' ? s.message ?? '' : ''); setEditRoles(null); })}>{t('roles.save')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
```

`src/app/(shell)/admin/users/page.tsx`:
```tsx
import { listRoles, listUsers, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { CreateUserDialog } from './create-user-dialog';
import { UserTable } from './user-table';

export default async function UsersPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'users.manage')) return <ForbiddenCard permission="users.manage" />;
  const t = await getTranslations('users');
  const users = await listUsers(deps, ctx);
  const roles = await listRoles(deps, ctx);
  if (!users.ok || !roles.ok) return <ForbiddenCard permission="users.manage" />;
  const roleOptions = roles.value.map((r) => ({ id: r.id, name: r.name }));
  return (
    <>
      <PageHeader title={t('title')} actions={<CreateUserDialog roles={roleOptions} />} />
      <UserTable users={users.value} roles={roleOptions} />
    </>
  );
}
```

`messages/de.json` — Namensraum `users`:
```json
"users": {
  "title": "Nutzer",
  "filter": { "search": "Name oder E-Mail", "showInactive": "Inaktive anzeigen", "count": "{count} Nutzer, davon {inactive} inaktiv" },
  "columns": { "name": "Name", "email": "E-Mail", "roles": "Rollen", "status": "Status", "lastLogin": "Letzte Anmeldung" },
  "status": { "active": "Aktiv", "firstLoginPending": "Erstlogin offen", "inactive": "Inaktiv" },
  "actions": { "menu": "Aktionen", "roles": "Rollen ändern", "resetPassword": "Neues Startpasswort", "deactivate": "Deaktivieren", "activate": "Aktivieren" },
  "deactivate": { "title": "Nutzer deaktivieren?", "text": "{name} kann sich danach nicht mehr anmelden. Bereits protokollierte Vorgänge bleiben erhalten und bleiben ihm zugeordnet." },
  "create": { "button": "Nutzer anlegen", "title": "Nutzer anlegen", "subtitle": "Nach dem Anlegen zeigt das System einmalig ein Startpasswort. Der Nutzer muss es beim ersten Login ändern.", "roles": "Rollen", "name": "Name", "email": "E-Mail", "submit": "Nutzer anlegen" },
  "startPassword": { "title": "Nutzer „{name}“ angelegt", "text": "Geben Sie diese Zugangsdaten weiter. Das Startpasswort wird nach dem Schließen nicht mehr angezeigt; ein neues können Sie jederzeit setzen.", "copyBoth": "Beides kopieren", "info": "Beim ersten Login muss {name} ein eigenes Passwort setzen. Bis dahin steht in der Liste „Erstlogin offen“.", "done": "Ich habe die Daten notiert" },
  "roles": { "title": "Rollen für {name}", "cancel": "Abbrechen", "save": "Rollen speichern" },
  "toast": { "activated": "Nutzer aktiviert.", "deactivated": "Nutzer deaktiviert.", "saved": "Nutzer gespeichert.", "rolesSaved": "Rollen gespeichert." }
}
```

- [x] **Step 6: E2E ausführen**

In `e2e/auth.spec.ts` das `test.fixme` des dritten Tests entfernen.

Run: `pnpm --filter @kompass/app test && pnpm --filter @kompass/app typecheck && pnpm --filter @kompass/app e2e e2e/users.spec.ts e2e/auth.spec.ts`
Expected: grün.

- [x] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(app): user management with one-time start password dialogs"
```

---

### Task 8: Rollen mit Rechte-Matrix

**Files:**
- Create: `src/app/(shell)/admin/roles/page.tsx`, `actions.ts`, `role-editor.tsx`, `src/lib/permission-groups.ts`, `src/components/forms/save-bar.tsx`
- Test: `tests/permission-groups.test.ts`, `e2e/roles.spec.ts`

**Interfaces:**
- Consumes: `listRoles`, `createRole`, `updateRole`, `setRolePermissions`, `CORE_PERMISSIONS`, `Registry.manifests`.
- Produces: `groupPermissions(manifests) → { key: string; labelKey: string; keys: string[] }[]` (Kern in drei Gruppen `core.admin`, `core.accountability`, `core.data`; jedes Modul eine Gruppe); `SaveBar`.

- [x] **Step 1: Tests schreiben**

`tests/permission-groups.test.ts`:
```ts
import { coreModule, defineModule } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { groupPermissions } from '@/lib/permission-groups';

describe('groupPermissions', () => {
  it('splits core permissions into three labelled groups in design order', () => {
    const groups = groupPermissions([coreModule]);
    expect(groups.map((g) => [g.key, g.keys])).toEqual([
      ['core.admin', ['users.manage', 'roles.manage', 'settings.manage', 'modules.manage']],
      ['core.accountability', ['audit.view', 'documents.view']],
      ['core.data', ['documents.create', 'media.upload', 'backup.export', 'backup.import']],
    ]);
  });
  it('adds one group per module', () => {
    const finance = defineModule({ key: 'finance', version: '1', permissions: ['finance.view', 'finance.edit'] });
    expect(groupPermissions([coreModule, finance]).at(-1)).toEqual({ key: 'finance', labelKey: 'permissions.groups.finance', keys: ['finance.view', 'finance.edit'] });
  });
});
```

`e2e/roles.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('roles', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
    await page.goto('/admin/roles');
  });

  test('lists roles with counts and shows the protected role locked', async ({ page }) => {
    const list = page.getByRole('list', { name: 'Rollen' });
    await expect(list.getByRole('listitem')).toHaveCount(4);
    await expect(list.getByRole('listitem', { name: /Administration/ })).toContainText('Alle Rechte');
    await list.getByRole('button', { name: /Administration/ }).click();
    await expect(page.getByLabel('Rollenname')).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: 'Nutzer verwalten' })).toBeDisabled();
  });

  test('edits permissions with a pending counter and saves', async ({ page }) => {
    await page.getByRole('button', { name: /Kassenprüfer/ }).click();
    await expect(page.getByRole('checkbox', { name: 'Änderungsprotokoll einsehen' })).toBeChecked();
    await page.getByRole('checkbox', { name: 'Backup exportieren' }).check();
    await page.getByRole('checkbox', { name: 'Dokumente ansehen' }).uncheck();
    await expect(page.getByText('2 Änderungen noch nicht gespeichert')).toBeVisible();
    await page.getByRole('button', { name: 'Rolle speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Rolle gespeichert.');
    await page.reload();
    await page.getByRole('button', { name: /Kassenprüfer/ }).click();
    await expect(page.getByRole('checkbox', { name: 'Backup exportieren' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Dokumente ansehen' })).not.toBeChecked();
    await expect(page.getByText('backup.export')).toBeVisible();
  });

  test('creates a role and rejects a duplicate name', async ({ page }) => {
    await page.getByRole('button', { name: 'Rolle anlegen' }).click();
    await page.getByRole('dialog').getByLabel('Rollenname').fill('Beisitz');
    await page.getByRole('dialog').getByRole('button', { name: 'Anlegen' }).click();
    await expect(page.getByRole('list', { name: 'Rollen' }).getByRole('listitem', { name: /Beisitz/ })).toBeVisible();
    await page.getByRole('button', { name: 'Rolle anlegen' }).click();
    await page.getByRole('dialog').getByLabel('Rollenname').fill('beisitz');
    await page.getByRole('dialog').getByRole('button', { name: 'Anlegen' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('existiert bereits');
  });
});
```

- [x] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app test tests/permission-groups.test.ts`
Expected: FAIL — Modul fehlt.

- [x] **Step 3: Gruppierung und SaveBar**

`src/lib/permission-groups.ts`:
```ts
import type { ModuleManifest } from '@kompass/core';

export interface PermissionGroup {
  key: string;
  labelKey: string;
  keys: string[];
}

const CORE_GROUPS: { key: string; keys: string[] }[] = [
  { key: 'core.admin', keys: ['users.manage', 'roles.manage', 'settings.manage', 'modules.manage'] },
  { key: 'core.accountability', keys: ['audit.view', 'documents.view'] },
  { key: 'core.data', keys: ['documents.create', 'media.upload', 'backup.export', 'backup.import'] },
];

export function groupPermissions(manifests: readonly ModuleManifest[]): PermissionGroup[] {
  const groups: PermissionGroup[] = CORE_GROUPS.map((g) => ({ key: g.key, labelKey: `permissions.groups.${g.key}`, keys: [...g.keys] }));
  for (const m of manifests) {
    if (m.key === 'core') continue;
    groups.push({ key: m.key, labelKey: `permissions.groups.${m.key}`, keys: [...m.permissions] });
  }
  return groups;
}
```

`src/components/forms/save-bar.tsx`:
```tsx
'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export function SaveBar({ pendingCount, info, onDiscard, onSave, saving, saveLabel }: { pendingCount: number; info?: string; onDiscard: () => void; onSave: () => void; saving?: boolean; saveLabel?: string }) {
  const t = useTranslations('common');
  return (
    <div className="sticky bottom-0 mt-4 flex items-center gap-3 border-t border-line bg-surface-2 px-6 py-3">
      <span className={pendingCount > 0 ? 'text-[13px] font-semibold text-warning' : 'text-[13px] text-ink-2'}>{pendingCount > 0 ? t('changesPending', { count: pendingCount }) : info ?? ''}</span>
      <div className="ml-auto flex gap-2">
        <Button variant="ghost" onClick={onDiscard} disabled={pendingCount === 0 || saving}>{t('discard')}</Button>
        <Button onClick={onSave} disabled={pendingCount === 0 || saving}>{saveLabel ?? t('save')}</Button>
      </div>
    </div>
  );
}
```

- [x] **Step 4: Actions, Editor, Seite**

`src/app/(shell)/admin/roles/actions.ts`:
```ts
'use server';

import { createRole, setRolePermissions, updateRole } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function createRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await createRole(deps, ctx, { name: formData.get('name'), description: formData.get('description') ?? '' });
  revalidatePath('/admin/roles');
  return toActionState(result, t, t('roles.toast.created'));
}

export async function saveRoleAction(input: { id: string; name: string; description: string; permissionKeys: string[] }): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const meta = await updateRole(deps, ctx, { id: input.id, name: input.name, description: input.description });
  if (!meta.ok) return toActionState(meta, t);
  const perms = await setRolePermissions(deps, ctx, { roleId: input.id, permissionKeys: input.permissionKeys });
  revalidatePath('/admin/roles');
  return toActionState(perms, t, t('roles.toast.saved'));
}
```

`src/app/(shell)/admin/roles/role-editor.tsx`:
```tsx
'use client';

import type { Role } from '@kompass/core';
import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { SaveBar } from '@/components/forms/save-bar';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import type { PermissionGroup } from '@/lib/permission-groups';
import { cn } from '@/lib/utils';
import { createRoleAction, saveRoleAction } from './actions';

export function RoleEditor({ roles, groups, allPermissionKeys }: { roles: Role[]; groups: PermissionGroup[]; allPermissionKeys: string[] }) {
  const t = useTranslations('roles');
  const p = useTranslations('permissions');
  const [selectedId, setSelectedId] = useState(roles[0]?.id ?? '');
  const selected = roles.find((r) => r.id === selectedId) ?? roles[0];
  const [draft, setDraft] = useState<{ name: string; description: string; keys: Set<string> } | null>(null);
  const [saving, start] = useTransition();
  const [createState, createAction] = useActionState(createRoleAction, idleState);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => { setDraft(null); }, [selectedId, roles]);
  useEffect(() => { if (createState.status === 'success') setCreateOpen(false); }, [createState]);
  const pendingCount = useMemo(() => {
    if (!draft || !selected) return 0;
    let n = 0;
    if (draft.name !== selected.name) n += 1;
    if (draft.description !== selected.description) n += 1;
    for (const key of allPermissionKeys) if (draft.keys.has(key) !== selected.permissionKeys.includes(key)) n += 1;
    return n;
  }, [draft, selected, allPermissionKeys]);

  if (!selected) return null;
  const effectiveKeys = selected.isProtected ? new Set(allPermissionKeys) : draft?.keys ?? new Set(selected.permissionKeys);
  const name = draft?.name ?? selected.name;
  const description = draft?.description ?? selected.description;

  const edit = (patch: Partial<{ name: string; description: string; keys: Set<string> }>) => setDraft((d) => ({ name: d?.name ?? selected.name, description: d?.description ?? selected.description, keys: d?.keys ?? new Set(selected.permissionKeys), ...patch }));
  const toggle = (key: string, on: boolean) => { const keys = new Set(effectiveKeys); if (on) keys.add(key); else keys.delete(key); edit({ keys }); };

  return (
    <div className="grid min-h-[560px] grid-cols-[280px_minmax(0,1fr)] overflow-hidden rounded-lg border border-line bg-surface">
      <aside className="flex flex-col border-r border-line p-3">
        <ul aria-label={t('listAria')} className="flex flex-col gap-0.5">
          {roles.map((role) => (
            <li key={role.id} aria-label={role.name}>
              <button type="button" onClick={() => setSelectedId(role.id)} className={cn('flex w-full flex-col items-start rounded-md px-3 py-2.5 text-left hover:bg-hover', role.id === selected.id && 'bg-selected text-selected-ink shadow-[inset_2px_0_0_var(--color-primary)]')}>
                <span className="flex items-center gap-1.5 text-[14px] font-semibold">{role.name}{role.isProtected ? <Lock className="size-3" aria-hidden /> : null}</span>
                <span className="text-[12px] text-muted-ink">{role.isProtected ? t('meta.protected', { users: role.userCount }) : t('meta.normal', { permissions: role.permissionKeys.length, users: role.userCount })}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 px-3 text-[12px] text-muted-ink">{t('noDelete')}</p>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild><Button variant="outline" className="mt-auto border-dashed">{t('create.button')}</Button></DialogTrigger>
          <DialogContent className="bg-surface shadow-md">
            <form action={createAction} className="flex flex-col gap-4">
              <DialogTitle className="font-heading text-[19px]">{t('create.title')}</DialogTitle>
              {createState.status === 'error' ? <p role="alert" className="rounded-md border border-error bg-error-bg p-3 text-[13px] text-error">{createState.message}</p> : null}
              <FormField id="new-role-name" label={t('fields.name')}><Input id="new-role-name" name="name" required /></FormField>
              <FormField id="new-role-description" label={t('fields.description')}><Input id="new-role-description" name="description" /></FormField>
              <DialogFooter><SubmitButton>{t('create.submit')}</SubmitButton></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </aside>
      <section className="flex min-w-0 flex-col">
        <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-4 border-b border-line px-6 pb-4 pt-5">
          <FormField id="role-name" label={t('fields.name')}><Input id="role-name" value={name} disabled={selected.isProtected} onChange={(e) => edit({ name: e.target.value })} /></FormField>
          <FormField id="role-description" label={t('fields.description')}><Input id="role-description" value={description} disabled={selected.isProtected} onChange={(e) => edit({ description: e.target.value })} /></FormField>
        </div>
        <div className="flex-1 overflow-auto">
          {groups.map((group) => {
            const active = group.keys.filter((k) => effectiveKeys.has(k)).length;
            const state = active === 0 ? 'none' : active === group.keys.length ? 'all' : 'some';
            return (
              <div key={group.key}>
                <div className="flex items-center gap-3 border-b border-line bg-table-head px-6 py-2.5">
                  <Checkbox aria-label={p(group.labelKey)} checked={state === 'all' ? true : state === 'some' ? 'indeterminate' : false} disabled={selected.isProtected} onCheckedChange={(c) => { const keys = new Set(effectiveKeys); for (const k of group.keys) { if (c === true) keys.add(k); else keys.delete(k); } edit({ keys }); }} />
                  <span className="text-[12px] font-bold uppercase tracking-[.08em] text-ink-2">{p(group.labelKey)}</span>
                  <span className="text-[12px] text-muted-ink">{t('groupCount', { active, total: group.keys.length })}</span>
                </div>
                {group.keys.map((key) => (
                  <label key={key} className="grid cursor-pointer grid-cols-[26px_260px_minmax(0,1fr)] items-center gap-3 border-b border-line-2 px-6 py-2.5 hover:bg-row-hover">
                    <Checkbox aria-label={p(`keys.${key}.label`)} checked={effectiveKeys.has(key)} disabled={selected.isProtected} onCheckedChange={(c) => toggle(key, c === true)} />
                    <span><span className="block text-[14px] font-semibold">{p(`keys.${key}.label`)}</span><span className="block font-mono text-[11px] text-muted-ink">{key}</span></span>
                    <span className="text-[13px] text-ink-2">{p(`keys.${key}.description`)}</span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
        {selected.isProtected ? null : (
          <SaveBar pendingCount={pendingCount} saving={saving} onDiscard={() => setDraft(null)} saveLabel={t('save')} onSave={() => start(async () => {
            const s = await saveRoleAction({ id: selected.id, name, description, permissionKeys: [...effectiveKeys] });
            if (s.status === 'error') toast.error(s.message); else { toast.success(s.status === 'success' ? s.message ?? '' : ''); setDraft(null); }
          })} />
        )}
      </section>
    </div>
  );
}
```
`src/app/(shell)/admin/roles/page.tsx`:
```tsx
import { listRoles, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { groupPermissions } from '@/lib/permission-groups';
import { requireSession } from '@/lib/request-context';
import { RoleEditor } from './role-editor';

export default async function RolesPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'roles.manage')) return <ForbiddenCard permission="roles.manage" />;
  const t = await getTranslations('roles');
  const roles = await listRoles(deps, ctx);
  if (!roles.ok) return <ForbiddenCard permission="roles.manage" />;
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <RoleEditor roles={roles.value} groups={groupPermissions(deps.registry.manifests)} allPermissionKeys={[...deps.registry.permissionKeys]} />
    </>
  );
}
```

`messages/de.json` — Namensräume `roles` und `permissions`:
```json
"roles": {
  "title": "Rollen",
  "description": "Rollennamen sind freier Text. Rechte werden je Rolle vergeben; Nutzer erhalten die Vereinigung ihrer Rollen.",
  "listAria": "Rollen",
  "meta": { "protected": "Alle Rechte · {users, plural, one {# Nutzer} other {# Nutzer}} · gesperrt", "normal": "{permissions, plural, one {# Recht} other {# Rechte}} · {users, plural, one {# Nutzer} other {# Nutzer}}" },
  "noDelete": "Löschen gibt es nicht — eine nicht mehr benötigte Rolle wird von allen Nutzern entfernt und bleibt leer stehen.",
  "fields": { "name": "Rollenname", "description": "Beschreibung" },
  "groupCount": "{active} von {total} aktiv",
  "save": "Rolle speichern",
  "create": { "button": "Rolle anlegen", "title": "Rolle anlegen", "submit": "Anlegen" },
  "toast": { "created": "Rolle angelegt.", "saved": "Rolle gespeichert." }
},
"permissions": {
  "groups": { "core.admin": "Kern — Verwaltung", "core.accountability": "Kern — Rechenschaft", "core.data": "Kern — Erzeugen und Daten", "finance": "Finanzen", "members": "Mitglieder", "animals": "Tiere", "website": "Webseite" },
  "keys": {
    "users.manage": { "label": "Nutzer verwalten", "description": "Nutzer anlegen, bearbeiten, deaktivieren und Rollen zuweisen." },
    "roles.manage": { "label": "Rollen verwalten", "description": "Rollen anlegen und deren Rechte ändern." },
    "settings.manage": { "label": "Einstellungen verwalten", "description": "Vereinsdaten, Steuerangaben, Bankverbindung und Branding ändern." },
    "modules.manage": { "label": "Module verwalten", "description": "Module aktivieren und deaktivieren." },
    "audit.view": { "label": "Änderungsprotokoll einsehen", "description": "Alle protokollierten Vorgänge lesen und als PDF exportieren." },
    "documents.view": { "label": "Dokumente ansehen", "description": "Erzeugte PDFs öffnen und herunterladen." },
    "documents.create": { "label": "Dokumente erzeugen", "description": "PDFs aus Vorlagen erstellen; das Ergebnis wird protokolliert." },
    "media.upload": { "label": "Dateien hochladen", "description": "Logo, Anhänge und Belege in die Mediathek legen." },
    "backup.export": { "label": "Backup exportieren", "description": "Vollständigen Datenexport herunterladen." },
    "backup.import": { "label": "Backup importieren", "description": "Bestand überschreiben. Nur für die Administration sinnvoll." }
  }
}
```

- [x] **Step 5: Tests ausführen**

Run: `pnpm --filter @kompass/app test && pnpm --filter @kompass/app typecheck && pnpm --filter @kompass/app e2e e2e/roles.spec.ts`
Expected: grün.

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(app): role editor with permission matrix and pending-change save bar"
```

---

### Task 9: Einstellungen mit Reitern und Validierung

**Files:**
- Create: `src/lib/settings-fields.ts`, `src/app/(shell)/admin/settings/page.tsx`, `actions.ts`, `settings-form.tsx`
- Test: `tests/settings-fields.test.ts`, `e2e/settings.spec.ts`

**Interfaces:**
- Consumes: `readAllSettings`, `setSetting`, `listThemes`.
- Produces: `SETTINGS_TABS: { key: 'organization' | 'tax' | 'bank' | 'branding'; fields: SettingsField[] }[]` mit `SettingsField = { key; kind: 'text' | 'mono' | 'textarea' | 'select' | 'date' | 'theme' | 'font-body' | 'font-heading'; span?: 'full'; options?: string[]; maxLength? }`; `saveSettingsAction(changes: Record<string, unknown>) → ActionState` (Feldfehler nach Key).

- [x] **Step 1: Tests schreiben**

`tests/settings-fields.test.ts`:
```ts
import { CORE_SETTINGS } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { SETTINGS_TABS } from '@/lib/settings-fields';

describe('SETTINGS_TABS', () => {
  it('covers every organization and branding setting exactly once', () => {
    const covered = SETTINGS_TABS.flatMap((tab) => tab.fields.map((f) => f.key));
    const expected = CORE_SETTINGS.map((s) => s.key).filter((k) => k.startsWith('organization.') || k.startsWith('branding.'));
    expect([...covered].sort()).toEqual([...expected].sort());
    expect(new Set(covered).size).toBe(covered.length);
  });
  it('places tax fields on the tax tab', () => {
    const tax = SETTINGS_TABS.find((t) => t.key === 'tax')!;
    expect(tax.fields.map((f) => f.key)).toEqual(['organization.taxNumber', 'organization.taxOffice', 'organization.exemptionNoticeType', 'organization.exemptionNoticeDate', 'organization.statutoryPurpose']);
  });
});
```

`e2e/settings.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('settings', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
    await page.goto('/admin/settings');
  });

  test('saves changed fields, shows the pending counter and audits', async ({ page }) => {
    await page.getByLabel('Vereinsname').fill('Aluna Musterverein e.V.');
    await page.getByLabel('Ort').fill('Jülich');
    await expect(page.getByText('2 Änderungen noch nicht gespeichert')).toBeVisible();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Einstellungen gespeichert');
    await page.reload();
    await expect(page.getByLabel('Vereinsname')).toHaveValue('Aluna Musterverein e.V.');
    await page.goto('/admin/audit');
    await expect(page.getByRole('row', { name: /organization.name/ }).first()).toBeVisible();
  });

  test('marks the tab with a validation error and keeps the input', async ({ page }) => {
    await page.getByRole('tab', { name: 'Verein' }).click();
    await page.getByLabel('Kontakt-E-Mail').fill('keine-mail');
    await page.getByRole('tab', { name: 'Bank' }).click();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('tab', { name: /Verein/ })).toHaveAttribute('data-invalid', 'true');
    await page.getByRole('tab', { name: /Verein/ }).click();
    await expect(page.getByText('Bitte eine gültige E-Mail-Adresse eingeben.')).toBeVisible();
    await expect(page.getByLabel('Kontakt-E-Mail')).toHaveValue('keine-mail');
  });

  test('tax tab shows the incomplete alert and the purpose counter', async ({ page }) => {
    await page.getByRole('tab', { name: 'Steuer & Bescheide' }).click();
    await expect(page.getByRole('alert')).toContainText('Zuwendungsbestätigungen');
    await page.getByLabel('Satzungszweck').fill('Förderung des Tierschutzes');
    await expect(page.getByText('26 von 500 Zeichen')).toBeVisible();
  });
});
```

- [x] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app test tests/settings-fields.test.ts`
Expected: FAIL.

- [x] **Step 3: Feldkonfiguration**

`src/lib/settings-fields.ts`:
```ts
export type FieldKind = 'text' | 'mono' | 'textarea' | 'select' | 'date' | 'theme' | 'font-body' | 'font-heading';

export interface SettingsField {
  key: string;
  kind: FieldKind;
  span?: 'full';
  options?: string[];
  maxLength?: number;
  hintKey?: string;
}

export interface SettingsTab {
  key: 'organization' | 'tax' | 'bank' | 'branding';
  fields: SettingsField[];
}

export const SETTINGS_TABS: SettingsTab[] = [
  {
    key: 'organization',
    fields: [
      { key: 'organization.name', kind: 'text' },
      { key: 'organization.legalForm', kind: 'select', options: ['registeredAssociation', 'unregisteredAssociation'] },
      { key: 'organization.street', kind: 'text', span: 'full' },
      { key: 'organization.postalCode', kind: 'mono' },
      { key: 'organization.city', kind: 'text' },
      { key: 'organization.country', kind: 'text' },
      { key: 'organization.registerCourt', kind: 'text' },
      { key: 'organization.registerNumber', kind: 'mono', hintKey: 'registerNumberHint' },
      { key: 'organization.email', kind: 'text' },
      { key: 'organization.phone', kind: 'mono' },
      { key: 'organization.website', kind: 'text' },
    ],
  },
  {
    key: 'tax',
    fields: [
      { key: 'organization.taxNumber', kind: 'mono' },
      { key: 'organization.taxOffice', kind: 'text' },
      { key: 'organization.exemptionNoticeType', kind: 'select', options: ['none', 'exemptionNotice', 'corporateTaxNoticeAttachment', 'section60a'] },
      { key: 'organization.exemptionNoticeDate', kind: 'date' },
      { key: 'organization.statutoryPurpose', kind: 'textarea', span: 'full', maxLength: 500, hintKey: 'statutoryPurposeHint' },
    ],
  },
  {
    key: 'bank',
    fields: [
      { key: 'organization.iban', kind: 'mono' },
      { key: 'organization.bic', kind: 'mono' },
      { key: 'organization.bankName', kind: 'text' },
    ],
  },
  {
    key: 'branding',
    fields: [
      { key: 'branding.logoAssetId', kind: 'text', hintKey: 'logoHint' },
      { key: 'branding.fontBody', kind: 'font-body', options: ['source-sans-3', 'public-sans', 'atkinson-hyperlegible'] },
      { key: 'branding.fontHeading', kind: 'font-heading', options: ['source-serif-4', 'same-as-body'] },
      { key: 'branding.activeTheme', kind: 'theme' },
    ],
  },
];

export const TAX_REQUIRED = ['organization.taxNumber', 'organization.taxOffice', 'organization.exemptionNoticeType', 'organization.exemptionNoticeDate'] as const;
```
Hinweis: Der Logo-Upload (Dropzone, Media-Speicher) gehört zu Plan 3. Bis dahin ist `branding.logoAssetId` ein schreibgeschütztes Textfeld mit Hinweis „Logo-Upload folgt".

- [x] **Step 4: Action, Formular, Seite**

`src/app/(shell)/admin/settings/actions.ts`:
```ts
'use server';

import { setSetting } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function saveSettingsAction(changes: Record<string, unknown>): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const fieldErrors: Record<string, string> = {};
  let message: string | null = null;
  for (const [key, value] of Object.entries(changes)) {
    const result = await setSetting(deps, ctx, { key, value });
    if (!result.ok) {
      const state = toActionState(result, t);
      if (state.status === 'error') {
        if (result.error.type === 'validation') fieldErrors[key] = state.fieldErrors.value ?? state.fieldErrors[''] ?? t('errors.fields.invalid');
        else message = state.message;
      }
    }
  }
  revalidatePath('/', 'layout');
  if (message) return { status: 'error', message, fieldErrors };
  if (Object.keys(fieldErrors).length > 0) return { status: 'error', message: t('errors.validation'), fieldErrors };
  return { status: 'success', message: t('settings.toast.saved') };
}
```
Hinweis: `setSetting` validiert unter dem Pfad `value` (Zod-Issue-Pfad ist leer oder `value`), deshalb die doppelte Auflösung.

`src/app/(shell)/admin/settings/settings-form.tsx`:
```tsx
'use client';

import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { SaveBar } from '@/components/forms/save-bar';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { SETTINGS_TABS, TAX_REQUIRED, type SettingsField } from '@/lib/settings-fields';
import { cn } from '@/lib/utils';
import { saveSettingsAction } from './actions';

type Values = Record<string, unknown>;

export function SettingsForm({ initial, themes, lastSaved }: { initial: Values; themes: { key: string; name: string }[]; lastSaved: string | null }) {
  const t = useTranslations('settings');
  const c = useTranslations('common');
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, start] = useTransition();

  const changes = useMemo(() => Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== initial[k])), [values, initial]);
  const pendingCount = Object.keys(changes).length;
  const invalidTabs = new Set(SETTINGS_TABS.filter((tab) => tab.fields.some((f) => errors[f.key])).map((tab) => tab.key));
  const taxMissing = TAX_REQUIRED.filter((k) => !values[k] || values[k] === 'none').length;

  const set = (key: string, value: unknown) => { setValues((v) => ({ ...v, [key]: value })); setErrors((e) => { const { [key]: _drop, ...rest } = e; return rest; }); };

  const render = (field: SettingsField) => {
    const label = t(`fields.${field.key}`);
    const value = values[field.key];
    const id = field.key.replace('.', '-');
    const common = { id, className: cn('h-9', field.kind === 'mono' && 'font-mono') };
    const hint = field.hintKey ? t(`hints.${field.hintKey}`) : undefined;
    const wrap = (node: React.ReactNode, extraHint?: string) => (
      <FormField key={field.key} id={id} label={label} hint={extraHint ?? hint} error={errors[field.key]} className={field.span === 'full' ? 'md:col-span-2' : undefined}>{node}</FormField>
    );
    switch (field.kind) {
      case 'textarea': {
        const text = String(value ?? '');
        return wrap(<Textarea id={id} rows={4} maxLength={field.maxLength} value={text} onChange={(e) => set(field.key, e.target.value)} aria-invalid={!!errors[field.key] || undefined} />, `${t('counter', { count: text.length, max: field.maxLength ?? 0 })} ${hint ?? ''}`.trim());
      }
      case 'select':
      case 'font-body':
      case 'font-heading':
        return wrap(
          <Select value={String(value ?? '')} onValueChange={(v) => set(field.key, v)}>
            <SelectTrigger id={id} aria-label={label}><SelectValue /></SelectTrigger>
            <SelectContent className="bg-surface">{(field.options ?? []).map((o) => <SelectItem key={o} value={o}>{t(`options.${field.key}.${o}`)}</SelectItem>)}</SelectContent>
          </Select>,
        );
      case 'theme':
        return wrap(
          <Select value={String(value ?? 'default')} onValueChange={(v) => set(field.key, v)}>
            <SelectTrigger id={id} aria-label={label}><SelectValue /></SelectTrigger>
            <SelectContent className="bg-surface">{themes.map((th) => <SelectItem key={th.key} value={th.key}>{th.name}</SelectItem>)}</SelectContent>
          </Select>,
          t('hints.themeHint'),
        );
      case 'date':
        return wrap(<Input {...common} type="date" value={String(value ?? '')} onChange={(e) => set(field.key, e.target.value)} className="h-9 font-mono" aria-invalid={!!errors[field.key] || undefined} />);
      default:
        return wrap(<Input {...common} value={value === null || value === undefined ? '' : String(value)} readOnly={field.key === 'branding.logoAssetId'} onChange={(e) => set(field.key, e.target.value)} aria-invalid={!!errors[field.key] || undefined} />);
    }
  };

  const save = () => start(async () => {
    const state = await saveSettingsAction(changes);
    if (state.status === 'error') { setErrors(state.fieldErrors); toast.error(state.message); return; }
    toast.success(state.status === 'success' ? state.message ?? '' : '');
    setErrors({});
  });

  return (
    <Tabs defaultValue="organization">
      <TabsList className="border-b border-line bg-surface px-6">
        {SETTINGS_TABS.map((tab) => (
          <TabsTrigger key={tab.key} value={tab.key} data-invalid={invalidTabs.has(tab.key) ? 'true' : undefined} className="gap-2 data-[state=active]:font-semibold data-[state=active]:shadow-[inset_0_-2px_0_var(--color-primary)]">
            {t(`tabs.${tab.key}`)}
            {invalidTabs.has(tab.key) ? <span className="size-[7px] rounded-full bg-error" aria-label={t('tabInvalid')} /> : null}
          </TabsTrigger>
        ))}
      </TabsList>
      {SETTINGS_TABS.map((tab) => (
        <TabsContent key={tab.key} value={tab.key} className="p-6">
          {tab.key === 'tax' && taxMissing > 0 ? (
            <p role="alert" className="mb-4 flex gap-2 rounded-md border border-warning bg-warning-bg p-3 text-[13px] text-ink-2"><Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /><span><span className="font-semibold text-warning">{t('taxIncomplete', { count: taxMissing })}</span> {t('taxIncompleteText')}</span></p>
          ) : null}
          <div className="grid gap-x-6 gap-y-4 rounded-lg border border-line bg-surface p-6 md:grid-cols-2">{tab.fields.map(render)}</div>
        </TabsContent>
      ))}
      <SaveBar pendingCount={pendingCount} saving={saving} info={lastSaved ? c('lastSaved', { date: lastSaved, name: '' }) : undefined} onDiscard={() => { setValues(initial); setErrors({}); }} onSave={save} />
    </Tabs>
  );
}
```

`src/app/(shell)/admin/settings/page.tsx`:
```tsx
import { listThemes, readAllSettings, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { SettingsForm } from './settings-form';

export default async function SettingsPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'settings.manage')) return <ForbiddenCard permission="settings.manage" />;
  const t = await getTranslations('settings');
  const all = readAllSettings(deps);
  const editable = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith('organization.') || k.startsWith('branding.')));
  return (
    <>
      <PageHeader title={t('title')} />
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <SettingsForm initial={editable} themes={listThemes(deps).themes.map((th) => ({ key: th.key, name: th.name }))} lastSaved={null} />
      </div>
    </>
  );
}
```

`messages/de.json` — Namensraum `settings`:
```json
"settings": {
  "title": "Einstellungen",
  "tabs": { "organization": "Verein", "tax": "Steuer & Bescheide", "bank": "Bank", "branding": "Branding" },
  "tabInvalid": "Enthält Fehler",
  "counter": "{count} von {max} Zeichen",
  "taxIncomplete": "{count, plural, one {# Angabe ist unvollständig.} other {# Angaben sind unvollständig.}}",
  "taxIncompleteText": "Ohne Steuernummer und Freistellungsbescheid lassen sich keine Zuwendungsbestätigungen erzeugen.",
  "fields": {
    "organization.name": "Vereinsname", "organization.legalForm": "Rechtsform", "organization.street": "Straße und Hausnummer", "organization.postalCode": "PLZ", "organization.city": "Ort", "organization.country": "Land",
    "organization.registerCourt": "Registergericht", "organization.registerNumber": "Registernummer", "organization.email": "Kontakt-E-Mail", "organization.phone": "Telefon", "organization.website": "Webseite",
    "organization.taxNumber": "Steuernummer", "organization.taxOffice": "Finanzamt", "organization.exemptionNoticeType": "Art des Bescheids", "organization.exemptionNoticeDate": "Datum des Bescheids", "organization.statutoryPurpose": "Satzungszweck",
    "organization.iban": "IBAN", "organization.bic": "BIC", "organization.bankName": "Bankname",
    "branding.logoAssetId": "Logo", "branding.fontBody": "Schrift Fließtext", "branding.fontHeading": "Schrift Überschriften", "branding.activeTheme": "Aktives Theme"
  },
  "hints": { "registerNumberHint": "Erscheint im Briefbogen-Fuß.", "statutoryPurposeHint": "Wird wörtlich in Zuwendungsbestätigungen übernommen.", "logoHint": "Logo-Upload folgt mit der Mediathek.", "themeHint": "Themes werden unter Verwaltung → Themes bearbeitet." },
  "options": {
    "organization.legalForm": { "registeredAssociation": "Eingetragener Verein (e.V.)", "unregisteredAssociation": "Nicht eingetragener Verein" },
    "organization.exemptionNoticeType": { "none": "Noch kein Bescheid", "exemptionNotice": "Freistellungsbescheid", "corporateTaxNoticeAttachment": "Anlage zum Körperschaftsteuerbescheid", "section60a": "Feststellung nach § 60a AO" },
    "branding.fontBody": { "source-sans-3": "Source Sans 3 (Standard)", "public-sans": "Public Sans", "atkinson-hyperlegible": "Atkinson Hyperlegible" },
    "branding.fontHeading": { "source-serif-4": "Source Serif 4 (Standard)", "same-as-body": "Wie Fließtext" }
  },
  "toast": { "saved": "Einstellungen gespeichert. Änderungen sind im Protokoll vermerkt." }
}
```

- [x] **Step 5: Tests ausführen**

Run: `pnpm --filter @kompass/app test && pnpm --filter @kompass/app typecheck && pnpm --filter @kompass/app e2e e2e/settings.spec.ts`
Expected: grün. (Der Audit-Teil des ersten E2E-Tests setzt Task 12 voraus; bis dahin die letzten zwei Zeilen mit `test.step`-Kommentar auslassen und in Task 12 aktivieren.)

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(app): settings tabs with per-field validation and audited saves"
```

---

### Task 10: Theme-Editor mit Live-Vorschau und Kontrastwarnung

**Files:**
- Modify: `packages/core/package.json` (Subpfad-Export `./themes`), Create: `packages/core/src/themes/index.ts`
- Create: `src/app/(shell)/admin/themes/page.tsx`, `actions.ts`, `theme-editor.tsx`, `theme-preview.tsx`
- Test: `e2e/themes.spec.ts`

**Interfaces:**
- Consumes: `listThemes`, `createTheme`, `updateTheme`, `duplicateTheme`, `deleteTheme`, `activateTheme`; client-seitig `@kompass/core/themes` → `THEME_TOKENS`, `checkThemeContrast`, `contrastRatio`, `DEFAULT_THEME`.
- Produces: Actions `saveThemeAction(theme)`, `duplicateThemeAction({ sourceKey, key, name })`, `deleteThemeAction(key)`, `activateThemeAction(key)`.

- [x] **Step 1: E2E-Test schreiben**

`e2e/themes.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('themes', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
    await page.goto('/admin/themes');
  });

  test('default is read-only and active; duplicating creates an editable copy', async ({ page }) => {
    await expect(page.getByRole('listitem', { name: /Default/ })).toContainText('Aktiv');
    await expect(page.getByRole('button', { name: 'Löschen' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Duplizieren' }).click();
    await page.getByRole('dialog').getByLabel('Schlüssel').fill('vereinsfarben');
    await page.getByRole('dialog').getByLabel('Name').fill('Vereinsfarben');
    await page.getByRole('dialog').getByRole('button', { name: 'Duplizieren' }).click();
    await expect(page.getByRole('listitem', { name: /Vereinsfarben/ })).toBeVisible();
    await expect(page.getByLabel('color-primary hell')).toHaveValue('#2F5D68');
  });

  test('edits a token, warns on low contrast, saves and activates', async ({ page }) => {
    await page.getByRole('button', { name: 'Duplizieren' }).click();
    await page.getByRole('dialog').getByLabel('Schlüssel').fill('test');
    await page.getByRole('dialog').getByLabel('Name').fill('Test');
    await page.getByRole('dialog').getByRole('button', { name: 'Duplizieren' }).click();
    await page.getByRole('button', { name: /^Test/ }).click();
    await page.getByLabel('muted hell').fill('#DDDDDD');
    await expect(page.getByRole('alert')).toContainText('Kontrast unter AA');
    await page.getByLabel('muted hell').fill('#666D75');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByLabel('color-primary hell').fill('#8A2C2C');
    await expect(page.getByTestId('preview-primary-button')).toHaveCSS('background-color', 'rgb(138, 44, 44)');
    await page.getByRole('button', { name: 'Theme speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Theme gespeichert');
    await page.getByRole('button', { name: 'Aktivieren' }).click();
    await page.goto('/login');
    // Nach Aktivierung liefert das Root-Layout das neue Theme: der Anmelden-Button (nach Logout) hat die neue Primärfarbe.
    await page.request.post('/logout');
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Anmelden' })).toHaveCSS('background-color', 'rgb(138, 44, 44)');
  });

  test('cannot delete the active theme, can delete an inactive one', async ({ page }) => {
    await page.getByRole('button', { name: 'Duplizieren' }).click();
    await page.getByRole('dialog').getByLabel('Schlüssel').fill('kopie');
    await page.getByRole('dialog').getByLabel('Name').fill('Kopie');
    await page.getByRole('dialog').getByRole('button', { name: 'Duplizieren' }).click();
    await page.getByRole('button', { name: /^Kopie/ }).click();
    await page.getByRole('button', { name: 'Aktivieren' }).click();
    await expect(page.getByRole('button', { name: 'Löschen' })).toHaveCount(0);
    await page.getByRole('button', { name: /^Default/ }).click();
    await page.getByRole('button', { name: 'Aktivieren' }).click();
    await page.getByRole('button', { name: /^Kopie/ }).click();
    await page.getByRole('button', { name: 'Löschen' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();
    await expect(page.getByRole('listitem', { name: /Kopie/ })).toHaveCount(0);
  });
});
```

- [x] **Step 2: E2E ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app e2e e2e/themes.spec.ts`
Expected: FAIL — 404.

- [x] **Step 3: Client-sicherer Kern-Subpfad**

`packages/core/src/themes/index.ts`:
```ts
export * from './tokens';
export * from './default-theme';
export * from './contrast';
```

In `packages/core/package.json` unter `exports` ergänzen: `"./themes": "./src/themes/index.ts"`. Diese Dateien importieren weder `better-sqlite3` noch Node-APIs und sind damit im Browser-Bundle nutzbar. Kern-Test dafür (`packages/core/tests/themes-schema.test.ts` ergänzen):
```ts
it('the themes subpath stays free of database imports', async () => {
  const mod = await import('../src/themes/index');
  expect(Object.keys(mod)).toEqual(expect.arrayContaining(['THEME_TOKENS', 'DEFAULT_THEME', 'checkThemeContrast']));
});
```

- [x] **Step 4: Actions**

`src/app/(shell)/admin/themes/actions.ts`:
```ts
'use server';

import { activateTheme, deleteTheme, duplicateTheme, updateTheme } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

async function run(fn: (scope: Awaited<ReturnType<typeof requireSession>>) => Promise<import('@kompass/core').Result<unknown>>, successKey: string): Promise<ActionState> {
  const t = await getTranslations();
  const scope = await requireSession();
  const result = await fn(scope);
  revalidatePath('/', 'layout');
  return toActionState(result, t, t(successKey));
}

export const saveThemeAction = (theme: unknown) => run(({ deps, ctx }) => updateTheme(deps, ctx, theme), 'themes.toast.saved');
export const duplicateThemeAction = (input: { sourceKey: string; key: string; name: string }) => run(({ deps, ctx }) => duplicateTheme(deps, ctx, input), 'themes.toast.duplicated');
export const deleteThemeAction = (key: string) => run(({ deps, ctx }) => deleteTheme(deps, ctx, { key }), 'themes.toast.deleted');
export const activateThemeAction = (key: string) => run(({ deps, ctx }) => activateTheme(deps, ctx, { key }), 'themes.toast.activated');
```

- [x] **Step 5: Vorschau und Editor**

`src/app/(shell)/admin/themes/theme-preview.tsx`:
```tsx
'use client';

import type { Theme } from '@kompass/core/themes';
import { THEME_TOKENS } from '@kompass/core/themes';
import { useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';

export function ThemePreview({ theme, mode }: { theme: Theme; mode: 'light' | 'dark' }) {
  const t = useTranslations('themes.preview');
  const style = Object.fromEntries(THEME_TOKENS.map((token) => [`--${token}`, theme.tokens[token][mode]])) as CSSProperties;
  return (
    <div style={style} className="flex flex-col gap-3 rounded-md border border-line bg-bg p-3 text-ink">
      <div className="rounded-md border border-line bg-sidebar p-2">
        <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-[.09em] text-muted-ink">{t('group')}</div>
        <div className="rounded-md bg-brand-soft px-2 py-1.5 text-[13px] font-semibold text-brand-ink shadow-[inset_2px_0_0_var(--color-primary)]">{t('activeItem')}</div>
        <div className="px-2 py-1.5 text-[13px] text-ink-2">{t('item')}</div>
      </div>
      <div className="flex gap-2">
        <button type="button" data-testid="preview-primary-button" className="rounded-md bg-brand px-3 py-1.5 text-[13px] font-semibold text-on-brand">{t('primary')}</button>
        <button type="button" className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-semibold text-ink-2">{t('secondary')}</button>
        <button type="button" className="rounded-md border border-error px-3 py-1.5 text-[13px] font-semibold text-error">{t('destructive')}</button>
      </div>
      <div className="flex flex-wrap gap-1.5 text-[12px] font-semibold">
        <span className="rounded-sm bg-success-bg px-2 py-0.5 text-success">{t('badgeActive')}</span>
        <span className="rounded-sm bg-warning-bg px-2 py-0.5 text-warning">{t('badgeOpen')}</span>
        <span className="rounded-sm bg-error-bg px-2 py-0.5 text-error">{t('badgeError')}</span>
        <span className="rounded-sm bg-badge px-2 py-0.5 text-badge-ink">{t('badgeInactive')}</span>
      </div>
      <input readOnly value={t('inputValue')} className="h-8 rounded-md border border-line-strong bg-field px-2 text-[13px] text-ink" />
      <table className="w-full overflow-hidden rounded-md border border-line text-[12px]">
        <thead className="bg-table-head text-muted-ink"><tr><th className="px-2 py-1 text-left">{t('col1')}</th><th className="px-2 py-1 text-left">{t('col2')}</th></tr></thead>
        <tbody>
          <tr className="bg-surface"><td className="px-2 py-1">{t('row')} 1</td><td className="px-2 py-1 font-mono">1.234,00 €</td></tr>
          <tr className="bg-zebra"><td className="px-2 py-1">{t('row')} 2</td><td className="px-2 py-1 font-mono">56,00 €</td></tr>
          <tr className="bg-row-hover"><td className="px-2 py-1">{t('row')} 3</td><td className="px-2 py-1 font-mono">7,00 €</td></tr>
        </tbody>
      </table>
    </div>
  );
}
```

`src/app/(shell)/admin/themes/theme-editor.tsx`:
```tsx
'use client';

import { checkThemeContrast, THEME_TOKENS, type Theme } from '@kompass/core/themes';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormField } from '@/components/forms/form-field';
import { SaveBar } from '@/components/forms/save-bar';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { activateThemeAction, deleteThemeAction, duplicateThemeAction, saveThemeAction } from './actions';
import { ThemePreview } from './theme-preview';

const HEX = /^#[0-9a-fA-F]{6}$/;

export function ThemeEditor({ themes, activeKey }: { themes: Theme[]; activeKey: string }) {
  const t = useTranslations('themes');
  const [selectedKey, setSelectedKey] = useState(activeKey);
  const selected = themes.find((th) => th.key === selectedKey) ?? themes[0]!;
  const [draft, setDraft] = useState<Theme | null>(null);
  const [mode, setMode] = useState<'light' | 'dark'>('light');
  const [dup, setDup] = useState(false);
  const [del, setDel] = useState(false);
  const [saving, start] = useTransition();
  const [dupForm, setDupForm] = useState({ key: '', name: '' });

  const current = draft && draft.key === selected.key ? draft : selected;
  const readOnly = selected.key === 'default';
  const findings = useMemo(() => checkThemeContrast(current), [current]);
  const pendingCount = useMemo(() => (draft ? THEME_TOKENS.filter((k) => draft.tokens[k].light !== selected.tokens[k].light || draft.tokens[k].dark !== selected.tokens[k].dark).length + (draft.name !== selected.name ? 1 : 0) : 0), [draft, selected]);

  const setToken = (token: (typeof THEME_TOKENS)[number], m: 'light' | 'dark', value: string) =>
    setDraft((d) => { const base = d && d.key === selected.key ? d : selected; return { ...base, tokens: { ...base.tokens, [token]: { ...base.tokens[token], [m]: value } } }; });

  const select = (key: string) => { setSelectedKey(key); setDraft(null); };
  const chips = (th: Theme) => (['color-primary', 'color-accent', 'bg', 'ink'] as const).map((k) => <span key={k} className="size-3.5 rounded-[3px] border border-line-strong" style={{ background: th.tokens[k].light }} aria-hidden />);

  return (
    <div className="grid min-h-[640px] grid-cols-[220px_minmax(0,1fr)_400px] overflow-hidden rounded-lg border border-line bg-surface">
      <aside className="flex flex-col gap-2 border-r border-line p-3">
        <ul aria-label={t('listAria')} className="flex flex-col gap-0.5">
          {themes.map((th) => (
            <li key={th.key} aria-label={th.name}>
              <button type="button" onClick={() => select(th.key)} className={cn('flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left hover:bg-hover', th.key === selected.key && 'bg-selected text-selected-ink shadow-[inset_2px_0_0_var(--color-primary)]')}>
                <span className="flex items-center gap-2 text-[14px] font-semibold">{th.name}{th.key === activeKey ? <StatusBadge tone="success">{t('active')}</StatusBadge> : null}</span>
                <span className="flex gap-1">{chips(th)}</span>
                <span className="text-[11px] text-muted-ink">{th.key === 'default' ? t('readOnly') : th.key}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-auto text-[11px] text-muted-ink">{t('deleteHint')}</p>
      </aside>
      <section className="flex min-w-0 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <FormField id="theme-name" label={t('name')} className="w-64"><Input id="theme-name" value={current.name} disabled={readOnly} onChange={(e) => setDraft({ ...current, name: e.target.value })} /></FormField>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={() => { setDupForm({ key: '', name: '' }); setDup(true); }}>{t('duplicate')}</Button>
            {readOnly || selected.key === activeKey ? null : <Button variant="outline" className="border-error text-error" onClick={() => setDel(true)}>{t('delete')}</Button>}
            {selected.key === activeKey ? null : <Button onClick={() => start(async () => { const s = await activateThemeAction(selected.key); if (s.status === 'error') toast.error(s.message); else toast.success(s.status === 'success' ? s.message ?? '' : ''); })}>{t('activate')}</Button>}
          </div>
        </div>
        {findings.length > 0 ? (
          <div role="alert" className="m-5 mb-0 flex gap-2 rounded-md border border-warning bg-warning-bg p-3 text-[13px] text-ink-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <div>
              <div className="font-semibold text-warning">{t('contrastTitle', { ratio: findings[0]!.ratio.toFixed(1).replace('.', ',') })}</div>
              <ul className="mt-1 list-disc pl-4">{findings.map((f) => <li key={`${f.fg}-${f.bg}-${f.mode}`}>{t('contrastPair', { fg: f.fg, bg: f.bg, mode: t(`mode.${f.mode}`), ratio: f.ratio.toFixed(2).replace('.', ','), minimum: f.minimum })}</li>)}</ul>
            </div>
          </div>
        ) : null}
        <div className="flex-1 overflow-auto">
          <div className="grid grid-cols-[minmax(0,1fr)_128px_128px] gap-3 bg-table-head px-5 py-2.5 text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink"><span>{t('columns.token')}</span><span>{t('mode.light')}</span><span>{t('mode.dark')}</span></div>
          {THEME_TOKENS.map((token) => (
            <div key={token} className="grid grid-cols-[minmax(0,1fr)_128px_128px] items-center gap-3 border-b border-line-2 px-5 py-2">
              <div><div className="font-mono text-[12px]">{token}</div><div className="text-[11px] text-muted-ink">{t(`tokens.${token}`)}</div></div>
              {(['light', 'dark'] as const).map((m) => {
                const value = current.tokens[token][m];
                const isHex = HEX.test(value);
                return (
                  <div key={m} className="flex items-center gap-1.5 rounded-sm border border-line-strong bg-field px-1.5 py-1">
                    {isHex ? <span className="size-4 rounded-[3px] border border-line-strong" style={{ background: value }} aria-hidden /> : null}
                    <input aria-label={`${token} ${t(`mode.${m}`).toLowerCase()}`} value={value} disabled={readOnly} onChange={(e) => setToken(token, m, e.target.value)} className="w-full bg-transparent font-mono text-[11px] outline-none" />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <p className="px-5 py-2 text-[11px] text-muted-ink">{t('noInheritance')}</p>
        {readOnly ? null : (
          <SaveBar pendingCount={pendingCount} saving={saving} onDiscard={() => setDraft(null)} saveLabel={t('save')} onSave={() => start(async () => { const s = await saveThemeAction(current); if (s.status === 'error') toast.error(s.message); else { toast.success(s.status === 'success' ? s.message ?? '' : ''); setDraft(null); } })} />
        )}
      </section>
      <aside className="flex flex-col gap-3 border-l border-line bg-surface-2 p-4">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold">{t('preview.title')}</span>
          <div className="flex overflow-hidden rounded-md border border-line-strong text-[12px]">
            {(['light', 'dark'] as const).map((m) => <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={cn('px-3 py-1', mode === m ? 'bg-brand text-on-brand' : 'bg-surface text-ink-2')}>{t(`mode.${m}`)}</button>)}
          </div>
        </div>
        <ThemePreview theme={current} mode={mode} />
      </aside>

      <Dialog open={dup} onOpenChange={setDup}>
        <DialogContent className="bg-surface shadow-md">
          <DialogTitle className="font-heading text-[19px]">{t('duplicateTitle', { name: selected.name })}</DialogTitle>
          <FormField id="dup-key" label={t('key')} hint={t('keyHint')}><Input id="dup-key" value={dupForm.key} onChange={(e) => setDupForm({ ...dupForm, key: e.target.value })} /></FormField>
          <FormField id="dup-name" label={t('name')}><Input id="dup-name" value={dupForm.name} onChange={(e) => setDupForm({ ...dupForm, name: e.target.value })} /></FormField>
          <DialogFooter>
            <Button disabled={saving} onClick={() => start(async () => { const s = await duplicateThemeAction({ sourceKey: selected.key, ...dupForm }); if (s.status === 'error') toast.error(s.message); else { setDup(false); select(dupForm.key); } })}>{t('duplicate')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={del} onOpenChange={setDel} title={t('deleteTitle', { name: selected.name })} description={t('deleteText')} confirmLabel={t('delete')} destructive action={async () => { const s = await deleteThemeAction(selected.key); if (s.status === 'success') select('default'); return s; }} />
    </div>
  );
}
```

`src/app/(shell)/admin/themes/page.tsx`:
```tsx
import { listThemes, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { ThemeEditor } from './theme-editor';

export default async function ThemesPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'settings.manage')) return <ForbiddenCard permission="settings.manage" />;
  const t = await getTranslations('themes');
  const { themes, activeKey } = listThemes(deps);
  return (
    <>
      <PageHeader title={t('title')} />
      <ThemeEditor themes={themes} activeKey={activeKey} />
    </>
  );
}
```

`messages/de.json` — Namensraum `themes` (die 58 Token-Beschreibungen sind Teil dieser Task; sie stammen aus der Spalte „Verwendung" des Token-Sheets):
```json
"themes": {
  "title": "Themes",
  "listAria": "Themes",
  "active": "Aktiv",
  "readOnly": "Schreibgeschützt",
  "deleteHint": "Themes dürfen gelöscht werden — außer dem aktiven und dem Default. Module werden nie gelöscht, nur deaktiviert.",
  "name": "Name", "key": "Schlüssel", "keyHint": "Kleinbuchstaben, Ziffern und Bindestrich.",
  "duplicate": "Duplizieren", "delete": "Löschen", "activate": "Aktivieren", "save": "Theme speichern",
  "duplicateTitle": "„{name}“ duplizieren", "deleteTitle": "Theme „{name}“ löschen?", "deleteText": "Das Theme wird entfernt. Es ist weder aktiv noch das Default-Theme.",
  "noInheritance": "Jedes Theme enthält alle Tokens vollständig — keine Vererbung, damit eine Änderung am Default kein anderes Theme verschiebt. „Duplizieren“ füllt die Werte des Ausgangsthemes vor.",
  "contrastTitle": "Kontrast unter AA: {ratio}:1",
  "contrastPair": "{fg} auf {bg} ({mode}): {ratio}:1, nötig {minimum}:1",
  "mode": { "light": "Hell", "dark": "Dunkel" },
  "columns": { "token": "Token" },
  "preview": { "title": "Live-Vorschau", "group": "Verwaltung", "activeItem": "Nutzer", "item": "Rollen", "primary": "Speichern", "secondary": "Abbrechen", "destructive": "Widerrufen", "badgeActive": "Aktiv", "badgeOpen": "Offen", "badgeError": "Fehler", "badgeInactive": "Inaktiv", "inputValue": "Musterverein e.V.", "col1": "Position", "col2": "Betrag", "row": "Zeile" },
  "toast": { "saved": "Theme gespeichert.", "duplicated": "Theme dupliziert.", "deleted": "Theme gelöscht.", "activated": "Theme aktiviert." },
  "tokens": {
    "color-primary": "Primäre Aktion, aktiver Navigationseintrag", "color-primary-ink": "Hover/Pressed auf Primary, Text auf -soft", "color-primary-soft": "Aktive Nav-Fläche, Rollen-Badge, Auswahl",
    "color-accent": "Zweitakzent: MCP-Badge, Akzentflächen", "color-accent-deep": "Text auf color-accent-soft", "color-accent-soft": "Hintergrund für Akzentflächen",
    "color-success": "Aktiv, gespeichert, erfolgreicher Export", "color-success-bg": "Fläche hinter Erfolg", "color-warning": "Unvollständig, Kontrast unter AA, Import", "color-warning-bg": "Fläche hinter Warnung",
    "color-error": "Validierungsfehler, destruktive Aktion", "color-error-bg": "Fläche hinter Fehler, fehlerhaftes Feld", "color-info": "Neutrale Hinweise, Kanal Oberfläche", "color-info-bg": "Fläche hinter Hinweis",
    "bg": "Fensterhintergrund, Login, Inhaltsbereich", "surface": "Karte, Tabelle, Dialog", "surface-2": "Speicherleiste, eingebettete Blöcke", "sidebar-bg": "Sidebar", "topbar-bg": "Topbar",
    "ink": "Primärtext, Titel", "ink-2": "Labels, Sekundärtext", "muted": "Hilfetext, Tabellenkopf", "muted-2": "Nur Icons, Trennzeichen — nicht für Text", "on-primary": "Text/Icon auf Primary", "on-primary-muted": "Sekundärtext auf Primary-Flächen",
    "line": "Standardrahmen", "line-2": "Zeilentrenner", "line-strong": "Feldrahmen, sekundärer Button, Switch aus",
    "focus-ring": "Fokusring, getrennt von Primary", "hover-surface": "Hover auf Nav, Menü, sekundärem Button", "active-surface": "Gedrückter Zustand", "selected-bg": "Ausgewählter Listeneintrag/Zeile", "selected-ink": "Text in der Auswahl",
    "link": "Inline-Link", "link-hover": "Link-Hover", "disabled-ink": "Deaktivierte Texte und Steuerelemente", "disabled-bg": "Fläche deaktivierter Steuerelemente",
    "table-head-bg": "Tabellenkopf", "table-zebra": "Zebrastreifen", "table-row-hover": "Zeilen-Hover", "input-bg": "Feldfläche", "input-placeholder": "Platzhaltertext", "code-bg": "Permission-Keys, IBAN, Token-Klartext, Diff-Werte",
    "neutral-badge-bg": "Neutrales Badge", "neutral-badge-ink": "Text im neutralen Badge", "tooltip-bg": "Tooltip-Fläche", "tooltip-ink": "Tooltip-Text",
    "overlay": "Abdunklung hinter Dialog und Drawer", "shadow-sm": "Leichter Schatten", "shadow-md": "Dialog, Toast, Menü, Seitenleiste",
    "font-body": "Fließtext und Oberfläche", "font-heading": "Überschriften", "font-mono": "Beträge, IBAN, Keys, Zeitstempel", "radius-sm": "Badge, Checkbox, Farbfeld", "radius-md": "Feld, Button, Tabellenrahmen", "radius-lg": "Karte, Dialog", "radius-full": "Switch, Avatar, Balken", "row-h": "Tabellenzeilenhöhe"
  }
}
```

- [x] **Step 6: Tests ausführen**

Run: `pnpm --filter @kompass/core test && pnpm --filter @kompass/app test && pnpm --filter @kompass/app typecheck && pnpm --filter @kompass/app e2e e2e/themes.spec.ts`
Expected: grün. Hinweis zum Literal-Scanner: `theme-editor.tsx` enthält den Regex `HEX` mit `#` und `[0-9a-fA-F]{6}` — das Muster des Scanners (`#[0-9a-fA-F]{3,8}\b`) trifft darauf nicht, weil auf `#` eine eckige Klammer folgt.

- [x] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(app): theme editor with live preview, contrast warnings and activation"
```

---

### Task 11: Module

**Files:**
- Create: `src/app/(shell)/admin/modules/page.tsx`, `actions.ts`, `module-card.tsx`
- Test: `e2e/modules.spec.ts`

**Interfaces:**
- Consumes: `listModules`, `setModuleEnabled`, `Registry.manifests`.
- Produces: `setModuleEnabledAction(key, enabled)`.

- [x] **Step 1: E2E-Test schreiben**

`e2e/modules.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test('module page shows the locked core and the count', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/admin/modules');
  await expect(page.getByText('Beim Deaktivieren bleiben alle Daten des Moduls erhalten.')).toBeVisible();
  const core = page.getByRole('region', { name: 'Kern' });
  await expect(core).toContainText('Immer aktiv');
  await expect(core.getByRole('switch')).toBeDisabled();
  await expect(core).toContainText('core');
  await expect(page.getByText('1 von 1 aktiv')).toBeVisible();
});
```

- [x] **Step 2: E2E ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app e2e e2e/modules.spec.ts`
Expected: FAIL — 404.

- [x] **Step 3: Implementieren**

`src/app/(shell)/admin/modules/actions.ts`:
```ts
'use server';

import { setModuleEnabled } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function setModuleEnabledAction(key: string, enabled: boolean): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setModuleEnabled(deps, ctx, { key, enabled });
  revalidatePath('/', 'layout');
  return toActionState(result, t, t(enabled ? 'modules.toast.enabled' : 'modules.toast.disabled'));
}
```

`src/app/(shell)/admin/modules/module-card.tsx`:
```tsx
'use client';

import type { ModuleStatus } from '@kompass/core';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/status-badge';
import { Switch } from '@/components/ui/switch';
import { setModuleEnabledAction } from './actions';

export function ModuleCard({ module }: { module: ModuleStatus }) {
  const t = useTranslations('modules');
  const [pending, start] = useTransition();
  const name = t.has(`names.${module.key}`) ? t(`names.${module.key}`) : module.key;
  return (
    <section aria-label={name} className="grid grid-cols-[minmax(0,1fr)_190px] gap-4 rounded-lg border border-line bg-surface px-[18px] py-4">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-heading text-[17px]">{name}</h3>
          {module.locked ? <StatusBadge tone="brand">{t('alwaysActive')}</StatusBadge> : <StatusBadge tone={module.enabled ? 'success' : 'neutral'}>{module.enabled ? t('enabled') : t('disabled')}</StatusBadge>}
          <span className="font-mono text-[11px] text-muted-ink">{module.key}</span>
        </div>
        <p className="mt-1 max-w-[640px] text-[14px] leading-[1.5] text-ink-2">{t.has(`descriptions.${module.key}`) ? t(`descriptions.${module.key}`) : t('noDescription')}</p>
        <p className="mt-1 text-[12px] text-muted-ink">{t('meta', { version: module.version })}{module.dependsOn.length > 0 ? ` · ${t('dependsOn', { list: module.dependsOn.join(', ') })}` : ''}</p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <span>{module.locked ? t('locked') : module.enabled ? t('enabled') : t('disabled')}</span>
          <Switch checked={module.enabled} disabled={module.locked || pending} aria-label={t('toggle', { name })} onCheckedChange={(next) => start(async () => { const s = await setModuleEnabledAction(module.key, next); if (s.status === 'error') toast.error(s.message); else toast.success(s.status === 'success' ? s.message ?? '' : ''); })} />
        </div>
        <span className="text-right text-[11px] text-muted-ink">{module.locked ? t('coreNote') : t.has(`notes.${module.key}`) ? t(`notes.${module.key}`) : ''}</span>
      </div>
    </section>
  );
}
```

`src/app/(shell)/admin/modules/page.tsx`:
```tsx
import { listModules, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { ModuleCard } from './module-card';

export default async function ModulesPage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'modules.manage')) return <ForbiddenCard permission="modules.manage" />;
  const t = await getTranslations('modules');
  const modules = listModules(deps);
  return (
    <>
      <PageHeader title={t('title')} actions={<span className="text-[13px] text-muted-ink">{t('count', { active: modules.filter((m) => m.enabled).length, total: modules.length })}</span>} />
      <p className="mb-4 rounded-md border border-line bg-surface-2 p-3 text-[13px] text-ink-2">{t('hint')}</p>
      <div className="flex flex-col gap-3">{modules.map((m) => <ModuleCard key={m.key} module={m} />)}</div>
    </>
  );
}
```

`messages/de.json` — Namensraum `modules`:
```json
"modules": {
  "title": "Module",
  "count": "{active} von {total} aktiv",
  "hint": "Beim Deaktivieren bleiben alle Daten des Moduls erhalten. Die Navigationsgruppe verschwindet, Berichte und protokollierte Vorgänge bleiben lesbar. Aktivieren stellt den Zustand unverändert wieder her.",
  "alwaysActive": "Immer aktiv", "enabled": "Aktiv", "disabled": "Inaktiv", "locked": "Gesperrt",
  "meta": "Version {version}", "dependsOn": "benötigt {list}", "toggle": "{name} aktivieren oder deaktivieren",
  "coreNote": "Ein Verein ohne Kern hätte keine Anmeldung.", "noDescription": "Keine Beschreibung hinterlegt.",
  "names": { "core": "Kern", "finance": "Finanzen", "members": "Mitglieder", "animals": "Tiere", "website": "Webseite" },
  "descriptions": { "core": "Anmeldung, Rollen, Einstellungen, Änderungsprotokoll, Dokumente und Backup.", "finance": "Konten, Buchungen, Rücklagen, Zuwendungsbestätigungen.", "members": "Mitgliederstamm, Beiträge, Versammlungen.", "animals": "Tiere, Vermittlung, Patenschaften.", "website": "Inhalte und statischer Website-Build." },
  "notes": { "finance": "Voraussetzung für Zuwendungsbestätigungen." },
  "toast": { "enabled": "Modul aktiviert.", "disabled": "Modul deaktiviert." }
}
```

- [x] **Step 4: Tests ausführen**

Run: `pnpm --filter @kompass/app typecheck && pnpm --filter @kompass/app e2e e2e/modules.spec.ts`
Expected: grün.

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(app): module cards with enable/disable and locked core"
```

---

### Task 12: Änderungsprotokoll mit Filtern, Seitenleiste und Feld-Diff

**Files:**
- Create: `src/lib/audit-diff.ts`, `src/app/(shell)/admin/audit/page.tsx`, `audit-table.tsx`, `audit-detail.tsx`, `audit-filters.tsx`
- Test: `tests/audit-diff.test.ts`, `e2e/audit.spec.ts`

**Interfaces:**
- Consumes: `queryAudit`, `getAuditEntry`, `listUsers`.
- Produces: `diffFields(before, after) → { key: string; before: string | null; after: string | null }[]` (nur geänderte Felder; Primitive als ein Eintrag `value`; Arrays als JSON-Zeilen).

- [x] **Step 1: Tests schreiben**

`tests/audit-diff.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { diffFields } from '@/lib/audit-diff';

describe('diffFields', () => {
  it('lists only changed keys of two objects', () => {
    expect(diffFields({ name: 'Alt', email: 'a@x', isActive: true }, { name: 'Neu', email: 'a@x', isActive: true })).toEqual([{ key: 'name', before: 'Alt', after: 'Neu' }]);
  });
  it('handles added and removed keys and nested values as JSON', () => {
    expect(diffFields({ roles: [{ id: '1' }] }, { roles: [{ id: '1' }, { id: '2' }], note: 'x' })).toEqual([
      { key: 'roles', before: '[{"id":"1"}]', after: '[{"id":"1"},{"id":"2"}]' },
      { key: 'note', before: null, after: 'x' },
    ]);
  });
  it('treats primitives as a single value row and null sides as create/delete', () => {
    expect(diffFields('Alt', 'Neu')).toEqual([{ key: 'value', before: 'Alt', after: 'Neu' }]);
    expect(diffFields(null, { name: 'Neu' })).toEqual([{ key: 'name', before: null, after: 'Neu' }]);
    expect(diffFields(undefined, undefined)).toEqual([]);
  });
});
```

`e2e/audit.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('audit log', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('lists entries newest first, filters by channel and opens the field diff', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.getByLabel('Vereinsname').fill('Geänderter Verein e.V.');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status')).toContainText('gespeichert');
    await page.goto('/admin/audit');
    const rows = page.getByRole('table').getByRole('row');
    await expect(rows.nth(1)).toContainText('settings.update');
    await expect(rows.nth(1)).toContainText('Oberfläche');
    await page.getByLabel('Kanal').selectOption('system');
    await expect(page.getByRole('table').getByRole('row').nth(1)).toContainText('System');
    await page.getByLabel('Kanal').selectOption('');
    await rows.nth(1).click();
    const detail = page.getByRole('dialog');
    await expect(detail).toContainText('organization.name');
    await expect(detail.getByText('Musterverein e.V.')).toHaveCSS('text-decoration-line', 'line-through');
    await expect(detail.getByText('Geänderter Verein e.V.')).toBeVisible();
    await expect(detail).toContainText('Einträge können nicht geändert werden.');
  });

  test('requires audit.view', async ({ page }) => {
    // Schriftführung (documents.create, documents.view) hat kein audit.view
    await page.goto('/admin/users');
    await page.getByRole('row', { name: /Peter Lang/ }).getByRole('button', { name: 'Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Neues Startpasswort' }).click();
    const startPassword = (await page.getByTestId('start-password').textContent())!.trim();
    await page.getByRole('button', { name: 'Ich habe die Daten notiert' }).click();
    await page.request.post('/logout');
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill('peter@kompass.local');
    await page.getByLabel('Passwort').fill(startPassword);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.getByLabel('Startpasswort').fill(startPassword);
    await page.getByLabel('Neues Passwort', { exact: true }).fill('peter-hat-ein-neues-passwort');
    await page.getByLabel('Passwort wiederholen').fill('peter-hat-ein-neues-passwort');
    await page.getByRole('button', { name: 'Passwort setzen und fortfahren' }).click();
    await page.goto('/admin/audit');
    await expect(page.getByText('audit.view')).toBeVisible();
  });
});
```

- [x] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app test tests/audit-diff.test.ts`
Expected: FAIL.

- [x] **Step 3: Diff-Helfer**

`src/lib/audit-diff.ts`:
```ts
export interface DiffRow {
  key: string;
  before: string | null;
  after: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const show = (v: unknown): string | null => (v === undefined || v === null ? null : typeof v === 'string' ? v : JSON.stringify(v));

export function diffFields(before: unknown, after: unknown): DiffRow[] {
  if (before === undefined && after === undefined) return [];
  if (!isObject(before) && !isObject(after)) {
    if (before === null && after === null) return [];
    return [{ key: 'value', before: show(before), after: show(after) }];
  }
  const b = isObject(before) ? before : {};
  const a = isObject(after) ? after : {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return keys.filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k])).map((k) => ({ key: k, before: show(b[k]), after: show(a[k]) }));
}
```

- [x] **Step 4: Filter, Tabelle, Detail, Seite**

`src/app/(shell)/admin/audit/audit-filters.tsx`:
```tsx
'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';

export function AuditFilters({ users, actions, total }: { users: { id: string; name: string }[]; actions: string[]; total: number }) {
  const t = useTranslations('audit.filters');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    next.delete('entry');
    next.delete('offset');
    router.replace(`${pathname}?${next.toString()}`);
  };
  const select = 'h-8 rounded-md border border-line-strong bg-field px-2 text-[13px]';
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-4">
      <Input aria-label={t('text')} placeholder={t('text')} defaultValue={params.get('text') ?? ''} onBlur={(e) => update('text', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') update('text', (e.target as HTMLInputElement).value); }} className="h-8 w-[200px]" />
      <select aria-label={t('user')} className={select} value={params.get('userId') ?? ''} onChange={(e) => update('userId', e.target.value)}>
        <option value="">{t('allUsers')}</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <select aria-label={t('channel')} className={select} value={params.get('channel') ?? ''} onChange={(e) => update('channel', e.target.value)}>
        <option value="">{t('allChannels')}</option><option value="ui">{t('channels.ui')}</option><option value="mcp">{t('channels.mcp')}</option><option value="system">{t('channels.system')}</option>
      </select>
      <select aria-label={t('action')} className={select} value={params.get('action') ?? ''} onChange={(e) => update('action', e.target.value)}>
        <option value="">{t('allActions')}</option>{actions.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <Input aria-label={t('from')} type="date" defaultValue={params.get('from') ?? ''} onChange={(e) => update('from', e.target.value)} className="h-8 w-[150px] font-mono" />
      <Input aria-label={t('to')} type="date" defaultValue={params.get('to') ?? ''} onChange={(e) => update('to', e.target.value)} className="h-8 w-[150px] font-mono" />
      <span className="ml-auto text-[13px] text-muted-ink">{t('count', { count: total })}</span>
    </div>
  );
}
```

`src/app/(shell)/admin/audit/audit-table.tsx`:
```tsx
import type { AuditEntry } from '@kompass/core';
import { getFormatter, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { StatusBadge } from '@/components/status-badge';
import { cn } from '@/lib/utils';

export async function AuditTable({ entries, selectedId, query }: { entries: AuditEntry[]; selectedId: string | null; query: string }) {
  const t = await getTranslations('audit');
  const format = await getFormatter();
  const tone = { ui: 'info', mcp: 'accent', system: 'neutral' } as const;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[14px]">
        <thead className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">
          <tr className="h-9"><th className="px-4">{t('columns.time')}</th><th className="px-4">{t('columns.user')}</th><th className="px-4">{t('columns.channel')}</th><th className="px-4">{t('columns.action')}</th><th className="px-4">{t('columns.entity')}</th><th className="px-4">{t('columns.summary')}</th></tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={e.id} className={cn('h-[var(--row-h)] border-b border-line-2 hover:bg-row-hover', i % 2 === 1 && 'bg-zebra', e.id === selectedId && 'bg-selected')}>
              <td className="px-4 font-mono text-[12px]"><Link href={`?${query}${query ? '&' : ''}entry=${e.id}`} className="block">{format.dateTime(new Date(e.occurredAt), { dateStyle: 'short', timeStyle: 'medium' })}</Link></td>
              <td className="px-4 text-ink-2">{e.userName ?? '—'}</td>
              <td className="px-4"><StatusBadge tone={tone[e.channel]}>{t(`filters.channels.${e.channel}`)}</StatusBadge></td>
              <td className="px-4 font-mono text-[12px]">{e.action}</td>
              <td className="px-4 text-ink-2">{e.entityType}{e.entityId ? ` · ${e.entityId}` : ''}</td>
              <td className="max-w-[320px] truncate px-4 text-ink-2">{e.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

`src/app/(shell)/admin/audit/audit-detail.tsx`:
```tsx
'use client';

import type { AuditEntry } from '@kompass/core';
import { useFormatter, useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { diffFields } from '@/lib/audit-diff';

export function AuditDetail({ entry }: { entry: AuditEntry }) {
  const t = useTranslations('audit.detail');
  const f = useTranslations('audit.filters.channels');
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const close = () => { const next = new URLSearchParams(params.toString()); next.delete('entry'); router.replace(`${pathname}?${next.toString()}`); };
  const rows = diffFields(entry.before, entry.after);
  return (
    <Sheet open onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent side="right" className="w-[420px] bg-surface shadow-md">
        <SheetTitle className="font-heading text-[17px]">{entry.action}</SheetTitle>
        <p className="font-mono text-[12px] text-muted-ink">{format.dateTime(new Date(entry.occurredAt), { dateStyle: 'medium', timeStyle: 'medium' })}</p>
        <div className="mt-4 flex flex-col gap-2">
          {rows.length === 0 ? <p className="text-[13px] text-muted-ink">{t('noDiff')}</p> : null}
          {rows.map((row) => (
            <div key={row.key} className="rounded-md border border-line bg-surface-2 px-3 py-2.5">
              <div className="font-mono text-[11px] text-muted-ink">{row.key}</div>
              <div className="mt-1 grid grid-cols-[38px_minmax(0,1fr)] gap-1 font-mono text-[12px]">
                <span className="text-muted-ink">{t('before')}</span><span className="rounded-sm bg-code px-1.5 text-muted-ink line-through">{row.before ?? '—'}</span>
                <span className="text-muted-ink">{t('after')}</span><span className="rounded-sm bg-success-bg px-1.5 font-semibold text-success">{row.after ?? '—'}</span>
              </div>
            </div>
          ))}
        </div>
        <dl className="mt-4 grid grid-cols-[110px_minmax(0,1fr)] gap-y-1 text-[13px]">
          <dt className="text-muted-ink">{t('user')}</dt><dd>{entry.userName ?? '—'}</dd>
          <dt className="text-muted-ink">{t('channel')}</dt><dd>{f(entry.channel)}{entry.apiTokenId ? ` · ${entry.apiTokenId}` : ''}</dd>
          <dt className="text-muted-ink">{t('origin')}</dt><dd className="font-mono">{entry.ipAddress ?? '—'}</dd>
          <dt className="text-muted-ink">{t('request')}</dt><dd className="font-mono">{entry.requestId}</dd>
          <dt className="text-muted-ink">{t('environment')}</dt><dd>{entry.environment}</dd>
          <dt className="text-muted-ink">{t('summary')}</dt><dd>{entry.summary}</dd>
        </dl>
        <p className="mt-6 text-[12px] text-muted-ink">{t('immutable')}</p>
      </SheetContent>
    </Sheet>
  );
}
```

`src/app/(shell)/admin/audit/page.tsx`:
```tsx
import { getAuditEntry, listUsers, queryAudit, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { requireSession } from '@/lib/request-context';
import { AuditDetail } from './audit-detail';
import { AuditFilters } from './audit-filters';
import { AuditTable } from './audit-table';

const PAGE = 50;

export default async function AuditPage(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'audit.view')) return <ForbiddenCard permission="audit.view" />;
  const t = await getTranslations('audit');
  const sp = await props.searchParams;
  const offset = Number(sp.offset ?? 0) || 0;
  const result = queryAudit(deps, ctx, {
    userId: sp.userId || undefined,
    channel: sp.channel || undefined,
    action: sp.action || undefined,
    text: sp.text || undefined,
    from: sp.from ? `${sp.from}T00:00:00.000Z` : undefined,
    to: sp.to ? `${sp.to}T23:59:59.999Z` : undefined,
    limit: PAGE,
    offset,
  });
  if (!result.ok) return <ForbiddenCard permission="audit.view" />;
  const users = await listUsers(deps, ctx);
  const recent = queryAudit(deps, ctx, { limit: 200 });
  const actions = recent.ok ? [...new Set(recent.value.entries.map((e) => e.action))].sort() : [];
  const selected = sp.entry ? getAuditEntry(deps, ctx, sp.entry) : null;
  const query = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== 'entry' && k !== 'offset') as [string, string][]).toString();
  return (
    <>
      <PageHeader title={t('title')} actions={<Button variant="secondary" disabled title={t('exportSoon')}>{t('export')}</Button>} />
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <AuditFilters users={users.ok ? users.value.map((u) => ({ id: u.id, name: u.name })) : []} actions={actions} total={result.value.total} />
        <AuditTable entries={result.value.entries} selectedId={sp.entry ?? null} query={query} />
        <div className="flex items-center justify-between px-5 py-3 text-[13px] text-muted-ink">
          <span>{t('range', { from: Math.min(offset + 1, result.value.total), to: Math.min(offset + PAGE, result.value.total), total: result.value.total })}</span>
          <div className="flex gap-2">
            {offset > 0 ? <Button asChild variant="ghost" size="sm"><Link href={`?${query}&offset=${Math.max(0, offset - PAGE)}`}>{t('prev')}</Link></Button> : null}
            {offset + PAGE < result.value.total ? <Button asChild variant="ghost" size="sm"><Link href={`?${query}&offset=${offset + PAGE}`}>{t('next')}</Link></Button> : null}
          </div>
        </div>
      </div>
      {selected?.ok ? <AuditDetail entry={selected.value} /> : null}
    </>
  );
}
```
Der PDF-Export des Protokolls ist in Plan 3 (Dokumenten-Engine); der Button ist bis dahin deaktiviert mit Tooltip.

`messages/de.json` — Namensraum `audit`:
```json
"audit": {
  "title": "Änderungsprotokoll",
  "export": "Als PDF exportieren", "exportSoon": "Folgt mit der Dokumenten-Engine.",
  "range": "{from}–{to} von {total}", "prev": "Zurück", "next": "Weiter",
  "columns": { "time": "Zeitpunkt", "user": "Nutzer", "channel": "Kanal", "action": "Aktion", "entity": "Objekt", "summary": "Zusammenfassung" },
  "filters": { "text": "Objekt oder Wert", "user": "Nutzer", "allUsers": "Alle Nutzer", "channel": "Kanal", "allChannels": "Alle Kanäle", "action": "Aktion", "allActions": "Alle Aktionen", "from": "Von", "to": "Bis", "count": "{count, plural, one {# Eintrag} other {# Einträge}}", "channels": { "ui": "Oberfläche", "mcp": "MCP", "system": "System" } },
  "detail": { "before": "vorher", "after": "nachher", "noDiff": "Kein Feld-Diff für diesen Eintrag.", "user": "Nutzer", "channel": "Kanal", "origin": "Herkunft", "request": "Vorgang", "environment": "Umgebung", "summary": "Zusammenfassung", "immutable": "Einträge können nicht geändert werden." }
}
```

- [x] **Step 5: Tests ausführen**

In `e2e/settings.spec.ts` die in Task 9 zurückgestellten Audit-Zeilen aktivieren.
Run: `pnpm --filter @kompass/app test && pnpm --filter @kompass/app typecheck && pnpm --filter @kompass/app e2e e2e/audit.spec.ts e2e/settings.spec.ts`
Expected: grün.

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(app): audit log with filters, pagination and field diff side sheet"
```

---

### Task 13: Profil — Passwort ändern und API-Tokens

**Files:**
- Create: `src/app/(shell)/profile/page.tsx`, `actions.ts`, `password-form.tsx`, `api-tokens.tsx`
- Test: `e2e/profile.spec.ts`

**Interfaces:**
- Consumes: `changeOwnPassword`, `createApiToken`, `listApiTokens`, `revokeApiToken`.
- Produces: `changePasswordAction`, `createTokenAction`, `revokeTokenAction`.

- [x] **Step 1: E2E-Test schreiben**

`e2e/profile.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { ADMIN, loginAsAdmin, resetDatabase } from './helpers';

test.describe('profile', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
    await page.goto('/profile');
  });

  test('creates an API token shown once, lists it and revokes it', async ({ page }) => {
    await page.getByRole('button', { name: 'Token erstellen' }).click();
    await page.getByRole('dialog').getByLabel('Name').fill('Buchhaltung Skript');
    await page.getByRole('dialog').getByRole('button', { name: 'Erstellen' }).click();
    const token = (await page.getByTestId('api-token-plaintext').textContent())!.trim();
    expect(token).toMatch(/^akx_test_/);
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Schließen' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Ich habe das Token gespeichert' }).click();
    const row = page.getByRole('row', { name: /Buchhaltung Skript/ });
    await expect(row).toContainText(token.slice(0, 12));
    await row.getByRole('button', { name: 'Widerrufen' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Widerrufen' }).click();
    await expect(page.getByRole('row', { name: /Buchhaltung Skript/ })).toContainText('widerrufen');
  });

  test('changes the own password and ends other sessions', async ({ browser, page }) => {
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await loginAsAdmin(otherPage);
    await page.getByLabel('Aktuelles Passwort').fill(ADMIN.password);
    await page.getByLabel('Neues Passwort', { exact: true }).fill('ganz-neues-admin-passwort');
    await page.getByLabel('Passwort wiederholen').fill('ganz-neues-admin-passwort');
    await page.getByRole('button', { name: 'Passwort ändern' }).click();
    await expect(page.getByRole('status')).toContainText('Passwort geändert');
    await otherPage.reload();
    await expect(otherPage).toHaveURL('/login');
    await other.close();
  });
});
```

- [x] **Step 2: E2E ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app e2e e2e/profile.spec.ts`
Expected: FAIL — 404.

- [x] **Step 3: Implementieren**

`src/app/(shell)/profile/actions.ts`:
```ts
'use server';

import { changeOwnPassword, createApiToken, revokeApiToken } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx, sessionId } = await requireSession();
  const newPassword = String(formData.get('newPassword') ?? '');
  if (newPassword !== String(formData.get('repeat') ?? '')) return { status: 'error', message: t('errors.validation'), fieldErrors: { repeat: t('auth.password.mismatch') } };
  const result = await changeOwnPassword(deps, ctx, sessionId, { currentPassword: formData.get('currentPassword'), newPassword });
  if (!result.ok && result.error.type === 'unauthorized') return { status: 'error', message: t('profile.password.wrongCurrent'), fieldErrors: { currentPassword: t('profile.password.wrongCurrent') } };
  return toActionState(result, t, t('profile.password.changed'));
}

export async function createTokenAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await createApiToken(deps, ctx, { name: formData.get('name') });
  revalidatePath('/profile');
  return toActionState(result, t);
}

export async function revokeTokenAction(id: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await revokeApiToken(deps, ctx, { id });
  revalidatePath('/profile');
  return toActionState(result, t, t('profile.tokens.revoked'));
}
```

`src/app/(shell)/profile/password-form.tsx`:
```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { strengthSegments } from '@/lib/password-strength';
import { changePasswordAction } from './actions';

export function ProfilePasswordForm() {
  const t = useTranslations('profile.password');
  const [state, action] = useActionState(changePasswordAction, idleState);
  const [value, setValue] = useState('');
  const errors = state.status === 'error' ? state.fieldErrors : {};
  useEffect(() => { if (state.status === 'success' && state.message) toast.success(state.message); }, [state]);
  const filled = strengthSegments(value);
  return (
    <form action={action} className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <h3 className="font-heading text-[17px]">{t('title')}</h3>
      <FormField id="currentPassword" label={t('current')} error={errors.currentPassword}><Input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" /></FormField>
      <FormField id="newPassword" label={t('new')} error={errors.newPassword} hint={t('strength', { count: value.length })}>
        <Input id="newPassword" name="newPassword" type="password" required minLength={12} autoComplete="new-password" value={value} onChange={(e) => setValue(e.target.value)} />
        <div className="mt-1 flex gap-1" aria-hidden>{[1, 2, 3, 4].map((n) => <span key={n} className={`h-1 flex-1 rounded-full ${n <= filled ? 'bg-success' : 'bg-line-strong'}`} />)}</div>
      </FormField>
      <FormField id="repeat" label={t('repeat')} error={errors.repeat}><Input id="repeat" name="repeat" type="password" required autoComplete="new-password" /></FormField>
      <SubmitButton className="w-fit">{t('submit')}</SubmitButton>
      <p className="text-[12px] text-muted-ink">{t('footnote')}</p>
    </form>
  );
}
```
`src/app/(shell)/profile/api-tokens.tsx`:
```tsx
'use client';

import type { ApiTokenSummary } from '@kompass/core';
import { Copy } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormField } from '@/components/forms/form-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { cn } from '@/lib/utils';
import { createTokenAction, revokeTokenAction } from './actions';

export function ApiTokens({ tokens }: { tokens: ApiTokenSummary[] }) {
  const t = useTranslations('profile.tokens');
  const c = useTranslations('common');
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(createTokenAction, idleState);
  const [created, setCreated] = useState<{ token: string; record: ApiTokenSummary } | null>(null);
  const [revoke, setRevoke] = useState<ApiTokenSummary | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (state.status === 'success' && state.data) { setCreated(state.data as { token: string; record: ApiTokenSummary }); setOpen(false); } }, [state]);
  const daysSince = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null);
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div><h3 className="font-heading text-[17px]">{t('title')}</h3><p className="mt-1 text-[13px] text-ink-2">{t('intro')}</p></div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button>{t('create')}</Button></DialogTrigger>
          <DialogContent className="bg-surface shadow-md">
            <form action={action} className="flex flex-col gap-4">
              <DialogTitle className="font-heading text-[19px]">{t('createTitle')}</DialogTitle>
              {state.status === 'error' ? <p role="alert" className="rounded-md border border-error bg-error-bg p-3 text-[13px] text-error">{state.message}</p> : null}
              <FormField id="token-name" label={t('name')} hint={t('nameHint')}><Input id="token-name" name="name" required /></FormField>
              <DialogFooter><SubmitButton>{t('createSubmit')}</SubmitButton></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <table className="w-full text-[14px]">
        <thead className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink"><tr className="h-9"><th className="px-3">{t('columns.name')}</th><th className="px-3">{t('columns.created')}</th><th className="px-3">{t('columns.lastUsed')}</th><th className="px-3" /></tr></thead>
        <tbody>
          {tokens.map((token) => {
            const days = daysSince(token.lastUsedAt);
            return (
              <tr key={token.id} className="h-[52px] border-b border-line-2">
                <td className={cn('px-3', token.revokedAt && 'text-disabled-ink')}><div className="font-semibold">{token.name}</div><div className="font-mono text-[11px] text-muted-ink">{token.prefix}…</div></td>
                <td className="px-3 font-mono text-[12px]">{format.dateTime(new Date(token.createdAt), { dateStyle: 'short' })}</td>
                <td className={cn('px-3 font-mono text-[12px]', !token.revokedAt && (days === null || days > 90) && 'text-warning')}>{token.revokedAt ? t('revokedAt', { date: format.dateTime(new Date(token.revokedAt), { dateStyle: 'short' }) }) : days === null ? t('neverUsed') : t('lastUsedDays', { days })}</td>
                <td className="px-3 text-right">{token.revokedAt ? null : <Button variant="outline" size="sm" className="border-error text-error" onClick={() => setRevoke(token)}>{t('revoke')}</Button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-[12px] text-muted-ink">{t('footnote')}</p>
      {created ? (
        <Dialog open onOpenChange={() => {}}>
          <DialogContent showCloseButton={false} onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()} className="w-[520px] bg-surface shadow-md">
            <DialogTitle className="font-heading text-[19px]">{t('createdTitle', { name: created.record.name })}</DialogTitle>
            <DialogDescription className="text-[14px] text-ink-2">{t('createdText')}</DialogDescription>
            <div className="flex items-center gap-2 rounded-md border border-line-strong bg-code p-3">
              <code data-testid="api-token-plaintext" className="flex-1 break-all font-mono text-[13px]">{created.token}</code>
              <Button variant="secondary" size="sm" onClick={async () => { await navigator.clipboard.writeText(created.token); setCopied(true); }}><Copy className="size-3.5" aria-hidden />{copied ? c('copied') : c('copy')}</Button>
            </div>
            <p className="rounded-md border border-info bg-info-bg p-3 text-[13px] text-ink-2">{t('createdInfo')}</p>
            <Button onClick={() => { setCreated(null); setCopied(false); }}>{t('createdDone')}</Button>
          </DialogContent>
        </Dialog>
      ) : null}
      {revoke ? <ConfirmDialog open onOpenChange={(o) => { if (!o) setRevoke(null); }} title={t('revokeTitle', { name: revoke.name })} description={t('revokeText')} confirmLabel={t('revoke')} destructive action={() => revokeTokenAction(revoke.id)} /> : null}
    </section>
  );
}
```

`src/app/(shell)/profile/page.tsx`:
```tsx
import { listApiTokens } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { StatusBadge } from '@/components/status-badge';
import { PageHeader } from '@/components/page-header';
import { initials } from '@/components/shell/user-menu';
import { requireSession } from '@/lib/request-context';
import { ApiTokens } from './api-tokens';
import { ProfilePasswordForm } from './password-form';

export default async function ProfilePage() {
  const { deps, ctx, user } = await requireSession();
  const t = await getTranslations('profile');
  const tokens = await listApiTokens(deps, ctx);
  return (
    <>
      <PageHeader title={t('title')} />
      <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-full bg-brand text-[15px] font-bold text-on-brand">{initials(user.name)}</span>
              <div><div className="text-[15px] font-semibold">{user.name}</div><div className="text-[13px] text-muted-ink">{user.email}</div></div>
            </div>
            <div className="flex flex-wrap gap-1.5">{user.roles.map((r) => <StatusBadge key={r.id} tone="brand">{r.name}</StatusBadge>)}</div>
            <p className="text-[12px] text-muted-ink">{t('identityHint')}</p>
          </section>
          <ProfilePasswordForm />
        </div>
        <ApiTokens tokens={tokens.ok ? tokens.value : []} />
      </div>
    </>
  );
}
```

`messages/de.json` — Namensraum `profile`:
```json
"profile": {
  "title": "Profil",
  "identityHint": "Name und E-Mail ändert die Administration unter Verwaltung → Nutzer.",
  "password": { "title": "Passwort ändern", "current": "Aktuelles Passwort", "new": "Neues Passwort", "repeat": "Passwort wiederholen", "strength": "{count} Zeichen — mindestens 12 sind nötig.", "submit": "Passwort ändern", "footnote": "Alle anderen Sitzungen werden abgemeldet, API-Tokens bleiben gültig.", "changed": "Passwort geändert.", "wrongCurrent": "Das aktuelle Passwort stimmt nicht." },
  "tokens": {
    "title": "API-Tokens (MCP-Zugang)", "intro": "Ein Token wirkt mit Ihren Rechten. Vorgänge über MCP erscheinen im Änderungsprotokoll mit dem Kanal „MCP“ und dem Namen des Tokens.",
    "create": "Token erstellen", "createTitle": "Token erstellen", "name": "Name", "nameHint": "Wofür das Token verwendet wird, z. B. „Buchhaltung Skript“.", "createSubmit": "Erstellen",
    "columns": { "name": "Name", "created": "Erstellt", "lastUsed": "Zuletzt genutzt" },
    "neverUsed": "noch nie genutzt", "lastUsedDays": "{days, plural, =0 {heute} one {vor # Tag} other {vor # Tagen}}", "revokedAt": "widerrufen {date}",
    "revoke": "Widerrufen", "revokeTitle": "Token „{name}“ widerrufen?", "revokeText": "Aufrufe mit diesem Token werden sofort abgewiesen. Der Eintrag bleibt mit Datum in der Liste.", "revoked": "Token widerrufen.",
    "createdTitle": "Token „{name}“ erstellt", "createdText": "Kopieren Sie das Token jetzt. Es wird nach dem Schließen dieses Dialogs nicht mehr angezeigt und kann nur widerrufen und neu erstellt werden.", "createdInfo": "Gültig ohne Ablauf, Rechte wie Ihr Konto. Bei Verdacht auf Weitergabe sofort widerrufen.", "createdDone": "Ich habe das Token gespeichert",
    "footnote": "Widerrufene Tokens bleiben mit Datum in der Liste, damit Protokolleinträge zuordenbar bleiben."
  }
}
```

- [x] **Step 4: Tests ausführen**

Run: `pnpm --filter @kompass/app test && pnpm --filter @kompass/app typecheck && pnpm --filter @kompass/app e2e e2e/profile.spec.ts`
Expected: grün.

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(app): profile with password change and one-time API token dialog"
```

---

### Task 14: Befehlspalette, Fehlerseiten, Ladezustände, Platzhalterseiten, Gesamtlauf

**Files:**
- Create: `src/lib/command-index.ts`, `src/components/shell/command-palette.tsx`, `src/app/(shell)/not-found.tsx`, `src/app/(shell)/error.tsx`, `src/app/(shell)/loading.tsx`, `src/app/(shell)/admin/documents/page.tsx`, `src/app/(shell)/admin/backup/page.tsx`, `src/components/empty-state.tsx`
- Modify: `src/components/shell/shell-frame.tsx` (Palette einhängen)
- Test: `tests/command-index.test.ts`, `e2e/palette-and-errors.spec.ts`

**Interfaces:**
- Produces: `buildCommandIndex({ groups, settingsFields, permissions, t }) → CommandEntry[]` mit `{ id; group: 'navigation' | 'settings' | 'actions'; label; hint; href; disabled; disabledReason?; permission? }`.

- [x] **Step 1: Tests schreiben**

`tests/command-index.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildCommandIndex } from '@/lib/command-index';
import type { NavGroup } from '@/lib/navigation';

const groups: NavGroup[] = [
  { key: 'admin', labelKey: 'nav.groups.admin', disabled: false, items: [
    { key: 'users', href: '/admin/users', icon: 'users', labelKey: 'nav.users', permission: 'users.manage', disabled: false, visible: true },
    { key: 'roles', href: '/admin/roles', icon: 'shield', labelKey: 'nav.roles', permission: 'roles.manage', disabled: false, visible: false },
  ] },
  { key: 'finance', labelKey: 'nav.groups.finance', disabled: true, items: [
    { key: 'finance.ledger', href: '/finance', icon: 'euro', labelKey: 'nav.finance.ledger', permission: 'finance.view', disabled: true, visible: true },
  ] },
];
const t = (k: string) => k;

describe('buildCommandIndex', () => {
  it('lists visible navigation targets, hides entries without permission and greys out inactive modules with a reason', () => {
    const index = buildCommandIndex({ groups, settingsFields: [], permissions: new Set(['users.manage', 'finance.view']), t });
    expect(index.map((e) => [e.id, e.disabled])).toEqual([['nav:users', false], ['nav:finance.ledger', true]]);
    expect(index[1]?.disabledReason).toBe('palette.moduleInactive');
  });
  it('adds settings fields as entries pointing at the settings page', () => {
    const index = buildCommandIndex({ groups: [], settingsFields: [{ key: 'organization.taxNumber', tab: 'tax' }], permissions: new Set(['settings.manage']), t });
    expect(index[0]).toMatchObject({ id: 'setting:organization.taxNumber', href: '/admin/settings?tab=tax', group: 'settings' });
  });
});
```

`e2e/palette-and-errors.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('command palette and error pages', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('opens with Ctrl+K, filters and navigates', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Befehlspalette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill('Rollen');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/admin/roles');
  });

  test('renders 404 inside the shell and the documents placeholder', async ({ page }) => {
    await page.goto('/admin/gibt-es-nicht');
    await expect(page.getByText('404')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible();
    await page.goto('/admin/documents');
    await expect(page.getByText('Folgt mit der Dokumenten-Engine')).toBeVisible();
  });
});
```

- [x] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app test tests/command-index.test.ts`
Expected: FAIL.

- [x] **Step 3: Index und Palette**

`src/lib/command-index.ts`:
```ts
import type { NavGroup } from './navigation';

export interface CommandEntry {
  id: string;
  group: 'navigation' | 'settings' | 'actions';
  label: string;
  hint: string;
  href: string;
  disabled: boolean;
  disabledReason?: string;
  permission?: string;
}

export function buildCommandIndex(input: { groups: NavGroup[]; settingsFields: { key: string; tab: string }[]; permissions: ReadonlySet<string>; t: (key: string) => string }): CommandEntry[] {
  const { t } = input;
  const entries: CommandEntry[] = [];
  for (const group of input.groups) {
    for (const item of group.items) {
      if (item.permission && !input.permissions.has(item.permission)) continue;
      entries.push({ id: `nav:${item.key}`, group: 'navigation', label: t(item.labelKey), hint: t(group.labelKey), href: item.href, disabled: item.disabled, disabledReason: item.disabled ? 'palette.moduleInactive' : undefined, permission: item.permission });
    }
  }
  if (input.permissions.has('settings.manage')) {
    for (const field of input.settingsFields) {
      entries.push({ id: `setting:${field.key}`, group: 'settings', label: t(`settings.fields.${field.key}`), hint: `${t('nav.settings')} / ${t(`settings.tabs.${field.tab}`)}`, href: `/admin/settings?tab=${field.tab}`, disabled: false, permission: 'settings.manage' });
    }
  }
  return entries;
}
```

`src/components/shell/command-palette.tsx`:
```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { buildCommandIndex } from '@/lib/command-index';
import type { NavGroup } from '@/lib/navigation';
import { SETTINGS_TABS } from '@/lib/settings-fields';

export function CommandPalette({ groups, permissions }: { groups: NavGroup[]; permissions: string[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const entries = useMemo(() => buildCommandIndex({ groups, settingsFields: SETTINGS_TABS.flatMap((tab) => tab.fields.map((f) => ({ key: f.key, tab: tab.key }))), permissions: new Set(permissions), t }), [groups, permissions, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); } };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('kompass:command-palette', onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('kompass:command-palette', onOpen); };
  }, []);

  const groupsOf = (g: 'navigation' | 'settings' | 'actions') => entries.filter((e) => e.group === g);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-24 w-[600px] translate-y-0 bg-surface p-0 shadow-md">
        <DialogTitle className="sr-only">{t('palette.aria')}</DialogTitle>
        <Command label={t('palette.aria')}>
          <CommandInput placeholder={t('palette.placeholder')} />
          <CommandList>
            <CommandEmpty>{t('palette.empty')}</CommandEmpty>
            {(['navigation', 'settings'] as const).filter((g) => groupsOf(g).length > 0).map((g) => (
              <CommandGroup key={g} heading={t(`palette.groups.${g}`)}>
                {groupsOf(g).map((e) => (
                  <CommandItem key={e.id} value={`${e.label} ${e.hint}`} disabled={e.disabled} onSelect={() => { setOpen(false); router.push(e.href); }} className="flex items-center gap-3 data-[selected=true]:bg-selected data-[selected=true]:text-selected-ink">
                    <span className="flex-1">{e.label}</span>
                    <span className="text-[12px] text-muted-ink">{e.disabled && e.disabledReason ? t(e.disabledReason, { module: e.hint }) : e.hint}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          <div className="flex items-center gap-4 border-t border-line bg-surface-2 px-3 py-2 text-[11px] text-muted-ink">
            <span>↑↓ {t('palette.select')}</span><span>↵ {t('palette.open')}</span><span>esc {t('palette.close')}</span><span className="ml-auto">{t('palette.permissionsOnly')}</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
```

In `src/components/shell/shell-frame.tsx` die Zeile `void permissions;` entfernen und `<CommandPalette groups={groups} permissions={permissions} />` innerhalb des `TooltipProvider` rendern (das Prop wird seit Task 5 vom Layout übergeben).

- [x] **Step 4: Fehler-, Lade- und Platzhalterseiten**

`src/app/(shell)/not-found.tsx`:
```tsx
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default async function NotFound() {
  const t = await getTranslations('errors.pages.notFound');
  return (
    <section className="flex min-h-[320px] max-w-[720px] flex-col gap-3 rounded-lg border border-line bg-surface p-7">
      <div className="flex items-center gap-2 text-[12px]"><span className="rounded-sm bg-badge px-1.5 py-0.5 font-mono font-semibold text-badge-ink">404</span><span className="text-muted-ink">{t('kicker')}</span></div>
      <h2 className="font-heading text-[20px]">{t('title')}</h2>
      <p className="text-[14px] leading-[1.55] text-ink-2">{t('text')}</p>
      <div className="mt-auto flex gap-2"><Button asChild><Link href="/">{t('home')}</Link></Button><Button asChild variant="secondary"><Link href="/admin/audit">{t('audit')}</Link></Button></div>
    </section>
  );
}
```

`src/app/(shell)/error.tsx`:
```tsx
'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function ShellError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('errors.pages.technical');
  return (
    <section className="flex min-h-[320px] max-w-[720px] flex-col gap-3 rounded-lg border border-error bg-surface p-7">
      <div className="flex items-center gap-2 text-[12px]"><span className="rounded-sm bg-error-bg px-1.5 py-0.5 font-mono font-semibold text-error">500</span><span className="text-muted-ink">{t('kicker')}</span></div>
      <h2 className="font-heading text-[20px]">{t('title')}</h2>
      <p className="text-[14px] leading-[1.55] text-ink-2">{t('text')}</p>
      {error.digest ? <code className="w-fit rounded-md bg-code px-2 py-1 font-mono text-[12px]">{error.digest}</code> : null}
      <div className="mt-auto flex gap-2"><Button onClick={reset}>{t('retry')}</Button><Button asChild variant="secondary"><Link href="/">{t('home')}</Link></Button></div>
    </section>
  );
}
```

`src/app/(shell)/loading.tsx`:
```tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <Skeleton className="h-7 w-64 bg-surface-2" />
      <Skeleton className="h-10 w-full bg-surface-2" />
      <Skeleton className="h-[var(--row-h)] w-full bg-surface-2" />
      <Skeleton className="h-[var(--row-h)] w-full bg-surface-2" />
      <Skeleton className="h-[var(--row-h)] w-full bg-surface-2" />
    </div>
  );
}
```

`src/components/empty-state.tsx`:
```tsx
export function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <section className="flex min-h-[240px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong bg-surface p-7 text-center">
      <h3 className="font-heading text-[17px]">{title}</h3>
      <p className="max-w-[480px] text-[14px] text-ink-2">{text}</p>
    </section>
  );
}
```

`src/app/(shell)/admin/documents/page.tsx`:
```tsx
import { requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';

export default async function DocumentsPage() {
  const { ctx } = await requireSession();
  if (requirePermission(ctx, 'documents.view')) return <ForbiddenCard permission="documents.view" />;
  const t = await getTranslations('placeholders.documents');
  return (<><PageHeader title={t('title')} /><EmptyState title={t('emptyTitle')} text={t('emptyText')} /></>);
}
```

`src/app/(shell)/admin/backup/page.tsx`: identisch mit `backup.export`, Namensraum `placeholders.backup`.

`messages/de.json` ergänzen:
```json
"palette": { "aria": "Befehlspalette", "placeholder": "Seite, Einstellung oder Aktion suchen …", "empty": "Keine Treffer.", "groups": { "navigation": "Navigation", "settings": "Einstellungen", "actions": "Aktionen" }, "moduleInactive": "Modul {module} nicht aktiv", "select": "wählen", "open": "öffnen", "close": "schließen", "permissionsOnly": "Nur Einträge, für die Sie Rechte haben." },
"placeholders": {
  "documents": { "title": "Dokumente", "emptyTitle": "Folgt mit der Dokumenten-Engine", "emptyText": "Erzeugte PDFs, Nummernkreise und Storno erscheinen hier, sobald Plan 3 (Betrieb) umgesetzt ist." },
  "backup": { "title": "Backup", "emptyTitle": "Folgt mit der Dokumenten-Engine", "emptyText": "Export und Import des Bestands erscheinen hier, sobald Plan 3 (Betrieb) umgesetzt ist." }
},
"errors": { "pages": {
  "notFound": { "kicker": "Nicht gefunden", "title": "Diesen Eintrag gibt es nicht mehr.", "text": "Protokollierte Daten werden nicht gelöscht — wenn Sie einen Vorgang suchen, hilft das Änderungsprotokoll.", "home": "Startseite", "audit": "Protokoll öffnen" },
  "technical": { "kicker": "Technischer Fehler", "title": "Der Vorgang wurde abgebrochen.", "text": "Es wurde nichts gespeichert. Die Vorgangsnummer erscheint identisch im Serverprotokoll.", "retry": "Erneut versuchen", "home": "Startseite" }
} }
```
(`errors.pages.forbidden` aus Task 5 bleibt daneben bestehen.)

- [x] **Step 5: Gesamtlauf**

Run: `pnpm test && pnpm typecheck && pnpm --filter @kompass/app e2e`
Expected: alle Vitest-Suites (Kern + App) und alle E2E-Specs grün. Falls einzelne E2E-Tests an Timing scheitern (`toHaveCSS` auf Transition, Toast-Sichtbarkeit), `expect`-Retries nutzen und Selektoren schärfen — keine `waitForTimeout`.

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(app): command palette, in-shell error pages, loading skeleton and placeholders"
```

---

## Abschluss dieses Plans

Nach Task 14 ist die Oberfläche des Fundaments vollständig, bis auf drei Stellen, die Plan 3 (`fundament-3-betrieb`) füllt: die Seiten **Dokumente** und **Backup** (heute Platzhalter), der **PDF-Export** des Protokolls (Button deaktiviert) und der **Logo-Upload** (Feld schreibgeschützt). Plan 3 bringt außerdem den MCP-Server, den Media-Speicher, Dockerfile/Compose/CI und die Kopie Prod → Test.

## Self-Review (durchgeführt beim Schreiben)

**Spec-Abdeckung (Abschnitte 6 „Themes"/„Oberfläche", 8 E2E, 8a):**
- Theme-Tokens zur Laufzeit in `:root`, Hell/Dunkel per Attribut, Tailwind nur auf Tokens, Standardpalette entfernt, Literal-Scanner, Umgebungsbalken als markierte Ausnahme → Task 2.
- Sidebar aus Manifesten, 248/56 px, Drawer < 1180 px, `[`-Kürzel, Tooltip, Nutzermenü mit Hell/Dunkel und Zeilendichte pro Nutzer im Browser → Task 5.
- Einrichtungsseite genau einmal, Login ohne Reset-Link mit Versuchs-Hinweis und Sperre, Pflichtwechsel ohne Shell, „Import abgeschlossen"-Status → Task 4.
- Startseite mit drei Fortschrittskarten → Task 6. Nutzer inkl. Startpasswort-Dialog ohne ×, Deaktivieren statt Löschen, letzter Admin → Task 7. Rollen mit Rechte-Matrix, sichtbare Keys, geschützte Rolle → Task 8. Einstellungen mit vier Reitern, Fehlerpunkt, Speicherleiste → Task 9. Theme-Editor Hell/Dunkel nebeneinander, Live-Vorschau, Kontrastwarnung, Default schreibgeschützt, Duplizieren/Löschen/Aktivieren → Task 10. Module mit gesperrtem Kern → Task 11. Protokoll mit Filtern, Seitenleiste, Feld-Diff, Kanal-Badges → Task 12. Profil mit Passwortwechsel (andere Sitzungen beendet) und API-Tokens (einmalige Anzeige, Widerruf bleibt sichtbar) → Task 13. Befehlspalette (Navigation, Einstellungsfelder, ausgegraute Modul-Einträge), Fehlerseiten 403/404/500 in der Shell, Ladezustände → Task 14 (403 bereits ab Task 5).
- Playwright-Pfade Login, Rolle anlegen/zuweisen, Einstellung ändern, Umgebungsbalken → Tasks 4, 5, 8, 9. „Dokument erzeugen" folgt in Plan 3.

**Placeholder-Scan:** keine TBD/TODO. Drei bewusst benannte Nachfolge-Stellen (Dokumente, Backup, Logo-Upload, Protokoll-PDF) mit Verweis auf Plan 3.

**Typkonsistenz:** `ActionState` und `toActionState` überall gleich; `requireSession()` liefert `{ deps, ctx, user, sessionId }`; `StartPasswordDialog(open, onClose, name, email, startPassword)` in Task 7 zweimal identisch verwendet; `SaveBar(pendingCount, onDiscard, onSave, saving, saveLabel, info)` in Tasks 8, 9, 10; `StatusBadge(tone, dot)` in 7, 10, 11, 12, 13; `ConfirmDialog(action: () => Promise<ActionState>)` in 7, 10, 13.

**Kern-Erweiterungen, die dieser Plan verlangt (klein, mit Tests):** `createDeps` liefert `migrationCount` (Task 5); Subpfad-Export `@kompass/core/themes` (Task 10).
