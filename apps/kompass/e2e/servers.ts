import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Ein Server je Playwright-Worker.
 *
 * Die Suite lief bis zum 26.09. mit einem Worker gegen einen Server: Der
 * Reset-Endpunkt gehört dem Server, und zwei Worker auf derselben Datenbank
 * hätten sich gegenseitig den Bestand weggeräumt. Statt den Reset zu teilen,
 * bekommt jeder Worker seinen eigenen Server — eigener Port, eigener
 * Datenpfad, eigenes Build-Verzeichnis (Next 16 hält `.next/dev/lock`, zwei
 * `next dev` im selben Verzeichnis laufen nicht nebeneinander), eigenes
 * Publish-Ziel. Was zwei Server auseinanderhalten muss, kommt aus
 * `workerEnvironment`; die Fixture nimmt es nur entgegen.
 *
 * Für den dritten Ring gilt dasselbe mit einem Container je Worker.
 */
export type ServerKind = 'dev' | 'container';

export interface WorkerEnvironment {
  kind: ServerKind;
  index: number;
  port: number;
  url: string;
  /** Wohin der Publish auf dem Wirt schreibt — dort schaut `site-publish.spec.ts` nach. */
  siteTarget: string;
  containerName?: string;
  env: Record<string, string>;
}

const SHARED_ENV: Record<string, string> = {
  APP_ENV: 'test',
  SESSION_SECRET: 'e2e-session-secret-0123456789abcdef0123456789',
  E2E_RESET_TOKEN: 'e2e-reset',
  SITE_PUBLIC_URL: 'https://staging.example.org',
  SITE_STAGING: '1',
  SITE_DEPLOY_HOST: '',
  SITE_DEPLOY_USER: '',
  SITE_DEPLOY_KEY_FILE: '',
};

export function workerEnvironment(kind: ServerKind, index: number, root: string): WorkerEnvironment {
  if (kind === 'dev') {
    const tmp = path.join(root, 'e2e', '.tmp', `w${index}`);
    const siteTarget = path.join(tmp, 'site-target');
    const port = 3100 + index;
    return {
      kind,
      index,
      port,
      url: `http://localhost:${port}`,
      siteTarget,
      env: {
        ...SHARED_ENV,
        DATA_PATH: path.join(tmp, 'data'),
        // Unter `.next`, damit `pnpm e2e:cold` alle Worker mit leert.
        NEXT_DIST_DIR: path.join('.next', 'e2e', `w${index}`),
        SITE_DEPLOY_PATH: siteTarget,
        SITE_TEMPLATE_DIR: path.resolve(root, '../../templates/verein-basis'),
        SITE_CACHE_DIR: path.join(tmp, 'site-cache'),
        SITE_PREVIEW_DIR: path.join(tmp, 'site-preview'),
      },
    };
  }
  // Bewusst ausserhalb von `e2e/`: Der Entrypoint legt das Basis-Template ins
  // Volume, und dessen eigene Vitest-Dateien würde Playwright sonst als
  // Testfälle einsammeln.
  const tmp = path.join(root, '.e2e-container', `w${index}`);
  const port = 3200 + index;
  return {
    kind,
    index,
    port,
    url: `http://localhost:${port}`,
    siteTarget: path.join(tmp, 'deploy'),
    containerName: `kompass-e2e-${index}`,
    env: { ...SHARED_ENV, SITE_DEPLOY_PATH: '/deploy' },
  };
}

/**
 * Wie viele Server nebeneinander laufen.
 *
 * Lokal drei. Online ein Dev-Server und drei Container: Ein kalter `next dev`
 * mit Warmup belegt in der Spitze knapp 10 GB, zwei zusammen 19,5 GB
 * (gemessen 26.09.); der Läufer hat 16 GB und brach den Job mit zwei Servern
 * nach zwei Minuten ab (Lauf 36244325712). Ein Container mit Produktionsbuild
 * braucht einen Bruchteil davon. `E2E_WORKERS` übersteuert — nach oben für
 * `pnpm e2e:stress`, das Wettläufe absichtlich hervorlockt, nach unten, wenn
 * eine Maschine unter der Last Zeitüberschreitungen statt Fehler zeigt.
 */
export function workerCount(env: Record<string, string | undefined>, kind: ServerKind): number {
  if (env.E2E_WORKERS !== undefined) {
    const n = Number(env.E2E_WORKERS);
    if (!Number.isInteger(n) || n < 1) throw new Error(`E2E_WORKERS muss eine ganze Zahl ab 1 sein, nicht "${env.E2E_WORKERS}"`);
    return n;
  }
  if (!env.CI) return 3;
  return kind === 'dev' ? 1 : 3;
}

export interface RunningServer {
  url: string;
  stop(): Promise<void>;
}

/**
 * Mit `E2E_SERVER_LOG=1` landet die Ausgabe des Servers beim Abbau im
 * Protokoll — für einen roten Container-Lauf oft die einzige Spur, weil
 * `docker run --rm` sie sonst mitnimmt.
 */
function dumpIfWanted(label: string, output: () => string): void {
  if (process.env.E2E_SERVER_LOG) console.log(`\n[server ${label}]\n${output()}`);
}

async function healthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Ein belegter Port ist ein Fehler, keine Gelegenheit.
 *
 * Am 26.09. hielt ein stehen gebliebener Container aus einem früheren Lauf
 * Port 3200: `docker run` scheiterte am Binden, die Gesundheitsprüfung fand
 * trotzdem einen Server — den fremden — und 151 Fälle liefen gegen die
 * falsche Fassung. Antwortet auf dem Port irgendjemand, gleich mit welchem
 * Status, wird nicht gestartet.
 */
export async function ensurePortFree(url: string): Promise<void> {
  let occupied = false;
  try {
    await fetch(url);
    occupied = true;
  } catch {
    // Verbindung abgelehnt: frei.
  }
  if (occupied) {
    throw new Error(`Auf ${url} läuft schon ein Server — ein Rest aus einem abgebrochenen Lauf oder eine andere Instanz. Beenden, dann neu starten.`);
  }
}

async function waitUntilHealthy(url: string, child: ChildProcess, timeoutMs: number, output: () => string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server auf ${url} hat sich beendet (Code ${child.exitCode}):\n${output()}`);
    if (await healthy(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server auf ${url} antwortet nach ${timeoutMs / 1000}s nicht:\n${output()}`);
}

function collect(child: ChildProcess): () => string {
  const lines: string[] = [];
  const push = (chunk: Buffer) => {
    lines.push(chunk.toString());
    if (lines.length > 200) lines.shift();
  };
  child.stdout?.on('data', push);
  child.stderr?.on('data', push);
  return () => lines.join('');
}

function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', () => resolve()));
}

/**
 * `next dev` in einer eigenen Prozessgruppe, damit beim Aufräumen auch die
 * Kinder gehen, die `pnpm exec` dazwischenschaltet — sonst hält ein
 * verwaister Next-Prozess den Port bis zum nächsten Lauf.
 */
async function startDev(w: WorkerEnvironment, root: string): Promise<RunningServer> {
  await ensurePortFree(w.url);
  const child = spawn('pnpm', ['exec', 'next', 'dev', '-p', String(w.port)], {
    cwd: root,
    env: { ...process.env, ...w.env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = collect(child);
  await waitUntilHealthy(w.url, child, 120_000, output);
  return {
    url: w.url,
    async stop() {
      dumpIfWanted(w.url, output);
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // Gruppe ist schon weg.
      }
      const timer = setTimeout(() => {
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {
          // schon weg
        }
      }, 5_000);
      await exited(child);
      clearTimeout(timer);
    },
  };
}

/**
 * Nur das Publish-Ziel wird eingehängt — dort schaut der Test auf dem Wirt
 * nach, was der Container geschrieben hat. `/data` und `/media` bekommen
 * anonyme Volumes: Docker legt sie mit den Rechten aus dem Image an und
 * entfernt sie mit `--rm` wieder. Eingehängte Wirtsverzeichnisse behalten
 * unter Linux dagegen ihren Besitzer, und der Container (`node`, UID 1000)
 * durfte dort nicht schreiben — sichtbar erst auf dem CI-Läufer, nie unter
 * macOS, das die Rechte abbildet.
 */
async function startContainer(w: WorkerEnvironment, image: string): Promise<RunningServer> {
  const name = w.containerName!;
  // Ein Rest aus einem abgebrochenen Lauf hält sonst Namen und Port.
  execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  await ensurePortFree(w.url);
  // Geleert statt gelöscht: Docker Desktop reicht ein eben erst angelegtes
  // Verzeichnis nicht schnell genug in seine VM weiter, und der Start
  // scheiterte an „error while creating mount source path“. Geleert wird im
  // Container, nicht auf dem Wirt: Was der letzte Lauf dorthin geschrieben
  // hat, gehört unter Linux `node` und liegt in Unterverzeichnissen, die der
  // Wirtsnutzer nicht leeren darf.
  mkdirSync(w.siteTarget, { recursive: true });
  try {
    execFileSync('docker', ['run', '--rm', '--user', '0', '-v', `${w.siteTarget}:/x`, image, 'sh', '-c', 'rm -rf /x/..?* /x/.[!.]* /x/*'], { stdio: 'ignore' });
  } catch {
    // war leer
  }
  // Damit der Container als `node` hineinschreiben kann.
  execFileSync('chmod', ['0777', w.siteTarget]);

  const child = spawn(
    'docker',
    [
      'run',
      '--rm',
      '--name',
      name,
      '-p',
      `${w.port}:3000`,
      ...Object.entries(w.env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
      '-v',
      `${w.siteTarget}:/deploy`,
      image,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const output = collect(child);
  await waitUntilHealthy(w.url, child, 180_000, output);
  return {
    url: w.url,
    async stop() {
      dumpIfWanted(name, output);
      try {
        execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
      } catch {
        // schon weg
      }
      await exited(child);
    },
  };
}

export async function startServer(w: WorkerEnvironment, opts: { root: string; image?: string }): Promise<RunningServer> {
  return w.kind === 'dev' ? startDev(w, opts.root) : startContainer(w, opts.image ?? 'kompass-local');
}

/**
 * Einmal jede Seite abrufen, bevor der erste Test läuft.
 *
 * `next dev` übersetzt jede Route beim ersten Aufruf. Passiert das **im** Test,
 * läuft die Übersetzung innerhalb der Frist einer Zusicherung mit — und
 * Playwrights Vorgabe von fünf Sekunden reicht dafür auf einem kalten Läufer
 * nicht. Lokal fiel es nie auf, weil `.next` dort zwei Gigabyte warm liegt; die
 * CI startet immer kalt. Gemessen am 11.09.: derselbe Test 1,9 s warm, 42 s
 * kalt, und zwei rote CI-Läufe an genau dieser Stelle.
 *
 * Seit jeder Worker seinen eigenen Server hat, wärmt jeder seinen selbst;
 * bezahlt wird das vor dem ersten Test, nicht in einem.
 */
export function staticRoutes(appDir: string): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });

  return [
    ...new Set(
      walk(appDir)
        .filter((file) => path.basename(file) === 'page.tsx')
        .map((file) => path.relative(appDir, path.dirname(file)))
        // Für `[id]` liesse sich keine Adresse raten.
        .filter((route) => !route.includes('['))
        // Gruppen wie `(shell)` stehen nicht in der Adresse.
        .map((route) =>
          route
            .split(path.sep)
            .filter((part) => !part.startsWith('(') && part !== '.')
            .join('/'),
        )
        .map((route) => `/${route}`),
    ),
  ].sort();
}

export async function warmUp(baseURL: string, appDir: string, log: (line: string) => void = console.log): Promise<void> {
  const routes = staticRoutes(appDir);
  const started = Date.now();
  // Nacheinander: Ein kalter Server wird von zwanzig gleichzeitigen
  // Übersetzungen nicht schneller.
  for (const route of routes) {
    await fetch(`${baseURL}${route}`, { redirect: 'follow' }).catch(() => {});
  }
  log(`[warmup] ${baseURL}: ${routes.length} Routen in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
