import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * Dieselbe Suite wie `playwright.config.ts`, nur gegen das gebaute Image
 * statt gegen `next dev`.
 *
 * Der Unterschied ist nicht die Oberfläche, sondern die Verpackung: gebündelter
 * Code, ein `/data`-Volume, das mitgelieferte Basis-Template und die
 * Modulauflösung, die der Entrypoint anlegt. Genau dort lagen drei der vier
 * Fehlschläge vom 7. September, und keiner davon konnte im Entwicklungsmodus
 * auffallen.
 *
 * Voraussetzung: ein gebautes `kompass-local` (`pnpm image`).
 */
const IMAGE = process.env.E2E_IMAGE ?? 'kompass-local';
const CONTAINER = 'kompass-e2e';
const PORT = 3200;

// Bewusst ausserhalb von `e2e/`: Der Entrypoint legt das Basis-Template ins
// Volume, und dessen eigene Vitest-Dateien würde Playwright sonst als Testfälle
// einsammeln.
const tmp = path.resolve(import.meta.dirname, '.e2e-container');
const data = path.join(tmp, 'data');
const media = path.join(tmp, 'media');
const deploy = path.join(tmp, 'deploy');

// Der Publish-Test sieht auf dem Wirt nach, was im Container geschrieben wurde.
process.env.E2E_SITE_TARGET = deploy;

/**
 * `docker run` ist nur ein Client: Beendet Playwright ihn, läuft der Container
 * weiter und hält den Port. Playwright prüft den Port aber, bevor es den
 * Startbefehl ausführt — ein Rest aus einem abgebrochenen Lauf muss also hier
 * weg. Nur im Hauptprozess: Die Worker lesen diese Datei erneut ein, und ein
 * Aufräumen von dort träfe den gerade laufenden Container.
 */
if (process.env.TEST_WORKER_INDEX === undefined) {
  try {
    execFileSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
  } catch {
    // war nicht da
  }
}

const env: Record<string, string> = {
  APP_ENV: 'test',
  SESSION_SECRET: 'e2e-session-secret-0123456789abcdef0123456789',
  E2E_RESET_TOKEN: 'e2e-reset',
  SITE_PUBLIC_URL: 'https://staging.example.org',
  SITE_STAGING: '1',
  SITE_DEPLOY_HOST: '',
  SITE_DEPLOY_USER: '',
  SITE_DEPLOY_PATH: '/deploy',
  SITE_DEPLOY_KEY_FILE: '',
};

/**
 * Aufräumen und Starten gehören in denselben Befehl, nicht ins Laden dieser
 * Datei: Playwright liest die Konfiguration in jedem Worker erneut ein. Ein
 * `rm` an dieser Stelle riss dem laufenden Container seine Volumes unter den
 * Füssen weg, und jeder Test scheiterte an ECONNREFUSED.
 */
const run = [
  // Beim Beenden mitnehmen, sonst ueberlebt der Container den Lauf.
  `trap "docker rm -f ${CONTAINER} >/dev/null 2>&1" EXIT INT TERM`,
  // Ein frisches Volume je Lauf; sonst prüft der zweite Lauf eine
  // Installation, die der erste eingerichtet hat, und die Erstinbetriebnahme
  // bliebe ungetestet. Geleert statt gelöscht: Docker Desktop reicht ein
  // eben erst angelegtes Verzeichnis nicht schnell genug in seine VM weiter,
  // und der Start scheiterte an „error while creating mount source path".
  `mkdir -p '${data}' '${media}' '${deploy}'`,
  `find '${data}' '${media}' '${deploy}' -mindepth 1 -delete`,
  [
    'docker run --rm',
    `--name ${CONTAINER}`,
    `-p ${PORT}:3000`,
    ...Object.entries(env).map(([key, value]) => `-e ${key}='${value}'`),
    `-v '${data}:/data'`,
    `-v '${media}:/media'`,
    `-v '${deploy}:/deploy'`,
    IMAGE,
  ].join(' '),
].join('; ');

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Im Container läuft der Astro-Build gegen ein Volume und ohne warmen
  // Dev-Cache; 30 Sekunden wie im Entwicklungsmodus reichen dafür nicht.
  timeout: 240_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-container' }]],
  outputDir: 'test-results-container',
  use: { baseURL: `http://localhost:${PORT}`, locale: 'de-DE', viewport: { width: 1280, height: 800 }, trace: 'retain-on-failure' },
  webServer: {
    // Playwright startet den Befehl ohnehin in einer Shell; ein zusaetzliches
    // `sh -c "…"` wuerde nur die Anfuehrungszeichen des `trap` zerlegen.
    command: run,
    // Nicht /login: Auf einer frischen Datenbank leitet die Anwendung dorthin
    // erst weiter, wenn die Einrichtung steht. Die Gesundheitsprüfung antwortet
    // ab dem ersten Moment.
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
