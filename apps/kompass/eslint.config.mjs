import parser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Bis zum 2026-09-15 gab es keine Konfiguration: `pnpm lint` brach mit
 * „couldn't find an eslint.config.*" ab, und die `eslint-disable`-Zeilen im
 * Code unterdrückten damit eine Prüfung, die niemand ausführte — ausgerechnet
 * `react-hooks/exhaustive-deps`, aus deren Gegenstand die E2E-Wackler kamen.
 *
 * Bewusst schmal: Die Architekturregeln dieses Projekts stehen in eigenen
 * Wächter-Tests (`no-hardcoded-ui-text`, `no-color-literals`, `mcp-tools`,
 * `handbook-complete`, …), die inhaltlich mehr prüfen, als ein Linter könnte.
 * Was hier steht, ist das, was ein Test nicht sieht: die Regeln über
 * React-Hooks.
 *
 * Das volle Preset von `eslint-config-next` läuft nicht: Es zieht
 * `eslint-plugin-react` 7.37.5, das unter ESLint 10 beim Laden der ersten
 * Regel abbricht (`contextOrFilename.getFilename is not a function`). Sobald
 * das Plugin nachzieht, kann das Preset hier einziehen — die Hook-Regeln
 * blieben dieselben.
 */
export default [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      // Das Entwicklungsvolume: dort liegt das eingelesene Template des
      // Betreibers samt Astro-Erzeugnissen, das ist fremder Code.
      'data/**',
      'test-results*/**',
      'playwright-report*/**',
      '.e2e-container/**',
      'next-env.d.ts',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    // Meldet eine `eslint-disable`-Zeile, die nichts mehr unterdrueckt. Ohne
    // das bliebe eine Ausnahme stehen, nachdem ihr Grund weggefallen ist —
    // und die naechste Person haelt sie fuer noetig.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
];
