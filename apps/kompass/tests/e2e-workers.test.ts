import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensurePortFree, staticRoutes, warmUp, workerCount, workerEnvironment } from '../e2e/servers';

/**
 * Ein Server je Playwright-Worker. Alles, was zwei Server auseinanderhalten
 * muss — Port, Datenpfad, Build-Verzeichnis, Publish-Ziel, Containername —
 * kommt aus dieser einen Ableitung; die Fixture nimmt sie nur entgegen.
 */
const root = path.resolve('/repo/apps/kompass');

describe('workerEnvironment', () => {
  it('gibt jedem Worker eigenen Port, Datenpfad, Build-Verzeichnis und Publish-Ziel', () => {
    const a = workerEnvironment('dev', 0, root);
    const b = workerEnvironment('dev', 1, root);

    expect(a.port).toBe(3100);
    expect(b.port).toBe(3101);
    expect(a.url).toBe('http://localhost:3100');
    expect(a.env.DATA_PATH).not.toBe(b.env.DATA_PATH);
    expect(a.env.NEXT_DIST_DIR).not.toBe(b.env.NEXT_DIST_DIR);
    expect(a.siteTarget).not.toBe(b.siteTarget);
    expect(a.env.SITE_CACHE_DIR).not.toBe(b.env.SITE_CACHE_DIR);
    expect(a.env.SITE_PREVIEW_DIR).not.toBe(b.env.SITE_PREVIEW_DIR);
  });

  it('legt Build-Verzeichnisse unter .next ab, damit e2e:cold sie mit leert', () => {
    const w = workerEnvironment('dev', 2, root);
    expect(w.env.NEXT_DIST_DIR).toMatch(/^\.next[\\/]/);
  });

  /**
   * Eine Worker-DB aus einem älteren Stand überlebte e2e:cold, der Migrator übersprang danach die Migrationen des
   * Merges und der Server blieb die Nacht über mit 503 stehen (29.10., Befund 11). Kalt heißt: auch die Daten.
   */
  it('e2e:cold leert neben .next auch die Datenpfade der Worker', () => {
    const w = workerEnvironment('dev', 1, root);
    const tmp = path.relative(path.join(root, '../..'), path.dirname(path.dirname(w.env.DATA_PATH!)));
    const script = (JSON.parse(readFileSync(path.join(import.meta.dirname, '../../../package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts['e2e:cold'];
    expect(script).toContain('apps/kompass/.next');
    expect(script).toContain(tmp);
  });

  it('schaltet für die Dev-Server den Next-Indikator ab, der sonst unten rechts Klicks abfängt (K9-Befund 14)', () => {
    expect(workerEnvironment('dev', 0, root).env.KOMPASS_E2E_NO_DEV_INDICATOR).toBe('1');
  });

  it('hält den Dev-Server in APP_ENV=test mit Reset-Token und Staging-Publish', () => {
    const w = workerEnvironment('dev', 0, root);
    expect(w.env.APP_ENV).toBe('test');
    expect(w.env.E2E_RESET_TOKEN).toBe('e2e-reset');
    expect(w.env.SITE_STAGING).toBe('1');
    expect(w.env.SITE_DEPLOY_PATH).toBe(w.siteTarget);
    expect(w.env.SITE_TEMPLATE_DIR).toBe(path.resolve(root, '../../templates/verein-basis'));
  });

  it('hängt Containern ein eigenes Backup-Verzeichnis ein wie eine echte Installation', () => {
    const a = workerEnvironment('container', 0, root);
    const b = workerEnvironment('container', 1, root);
    // Ohne Einhängung meldet Kompass „nicht eingehängt“ auf Startseite und Backup-Seite (Spec Backup § Ablage).
    expect(a.backupTarget).toBe(path.join(root, '.e2e-container', 'w0', 'backups'));
    expect(a.backupTarget).not.toBe(b.backupTarget);
    expect(a.env.BACKUP_PATH).toBeUndefined(); // das Image setzt /backups
    expect(workerEnvironment('dev', 0, root).backupTarget).toBeUndefined();
  });

  it('gibt Containern eigenen Namen und Port ab 3200 und hängt das Publish-Ziel ein', () => {
    const a = workerEnvironment('container', 0, root);
    const b = workerEnvironment('container', 1, root);

    expect(a.port).toBe(3200);
    expect(b.port).toBe(3201);
    expect(a.containerName).toBe('kompass-e2e-0');
    expect(b.containerName).toBe('kompass-e2e-1');
    expect(a.siteTarget).not.toBe(b.siteTarget);
    // Im Container zeigt der Publish-Pfad auf den Einhängepunkt, nicht auf den Wirt.
    expect(a.env.SITE_DEPLOY_PATH).toBe('/deploy');
    expect(a.env.DATA_PATH).toBeUndefined();
    // Bewusst ausserhalb von e2e/: Der Entrypoint legt das Template ins Volume,
    // dessen Vitest-Dateien Playwright sonst als Testfälle einsammelt.
    expect(a.siteTarget.startsWith(path.join(root, 'e2e'))).toBe(false);
  });
});

describe('workerCount', () => {
  it('nimmt E2E_WORKERS, sonst 3 lokal', () => {
    expect(workerCount({ E2E_WORKERS: '8' }, 'dev')).toBe(8);
    expect(workerCount({}, 'dev')).toBe(3);
    expect(workerCount({}, 'container')).toBe(3);
  });

  /**
   * Online einer, gleich welcher Art. Zwei kalte `next dev` sprengten mit
   * 19,5 GB den 16-GB-Läufer (Lauf 36244325712); drei Container machten auf
   * vier Kernen jeden Fall dreimal so langsam und trieben die Anmelde-Tests
   * mit zwanzig Argon2id-Versuchen in die Frist (Lauf 36245267692).
   */
  it('online: ein Server, gleich welcher Art', () => {
    expect(workerCount({ CI: 'true' }, 'dev')).toBe(1);
    expect(workerCount({ CI: 'true' }, 'container')).toBe(1);
  });

  it('lehnt Unsinn ab, statt still mit einem Worker zu laufen', () => {
    expect(() => workerCount({ E2E_WORKERS: '0' }, 'dev')).toThrow();
    expect(() => workerCount({ E2E_WORKERS: 'viele' }, 'dev')).toThrow();
  });
});

/**
 * Bevor ein Worker seinen Server startet, muss der Port frei sein. Am 26.09.
 * hielt ein stehen gebliebener Container aus einem früheren Lauf Port 3200:
 * `docker run` scheiterte am Binden, die Gesundheitsprüfung fand trotzdem
 * einen Server — den fremden — und 151 Fälle liefen gegen die falsche
 * Fassung. Ein belegter Port ist ein Fehler, keine Gelegenheit.
 */
describe('ensurePortFree', () => {
  it('lehnt einen Port ab, auf dem schon jemand antwortet, und lässt einen freien durch', async () => {
    const stranger = createServer((_request, response) => response.end('fremd'));
    await new Promise<void>((resolve) => stranger.listen(0, '127.0.0.1', resolve));
    const address = stranger.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const url = `http://127.0.0.1:${port}`;

    await expect(ensurePortFree(url)).rejects.toThrow(/läuft schon/);

    await new Promise<void>((resolve) => stranger.close(() => resolve()));
    await expect(ensurePortFree(url)).resolves.toBeUndefined();
  });
});

/**
 * Wackler `finance-partners.spec.ts:21` (Nachrunde sha-0170e73, Task 6):
 * Unter Last löste `next dev` die Zahlungsseite gelegentlich auf
 * `(shell)/[...catchAll]` auf — 404 statt Formular, `fill` wartete bis zum
 * Test-Timeout (nachgewiesen mit einem Protokoll im Auffänger). Die
 * Aufwärmrunde ruft deshalb auch jede dynamische Route mit Platzhalter auf und
 * stösst die Routentabelle neu an, wenn eine im Auffänger landet.
 */
describe('staticRoutes (Aufwärmen)', () => {
  const appDir = path.resolve(import.meta.dirname, '../src/app');

  it('wärmt auch dynamische Routen, mit Platzhalter statt ID', () => {
    const routes = staticRoutes(appDir);
    expect(routes).toContain('/finance/partners');
    expect(routes).toContain('/finance/partners/warmup');
    expect(routes).toContain('/finance/partners/warmup/payments/warmup');
    expect(routes.some((r) => r.includes('['))).toBe(false);
  });

  it('den Auffänger `[...catchAll]` braucht niemand vorzuwärmen — er ist das Symptom, nicht das Ziel', () => {
    expect(staticRoutes(appDir).filter((r) => r === '/warmup')).toEqual([]);
  });
});

describe('warmUp (Auffänger statt Seite)', () => {
  const appDir = path.resolve(import.meta.dirname, '../src/app');
  // So antwortet der Auffänger `[...catchAll]` ohne Anmeldung: Weiterleitung und der Fallback des 404 im Datenstrom.
  const CATCH_ALL = 'NEXT_REDIRECT … NEXT_HTTP_ERROR_FALLBACK;404';
  const PAGE = 'NEXT_REDIRECT';

  it('löst der Dev-Server eine dynamische Route auf den Auffänger auf, stösst er die Routentabelle neu an und prüft erneut', async () => {
    const answers = new Map<string, string[]>([['/finance/partners/warmup/payments/warmup', [CATCH_ALL, CATCH_ALL, PAGE]]]);
    const fetched: string[] = [];
    let rescans = 0;
    const lines: string[] = [];
    await warmUp('http://w', appDir, (line) => lines.push(line), {
      fetchPage: async (url) => {
        const route = url.replace('http://w', '');
        fetched.push(route);
        return { status: 200, body: answers.get(route)?.shift() ?? PAGE };
      },
      rescan: () => {
        rescans += 1;
      },
      pauseMs: 0,
    });
    expect(rescans).toBe(2);
    expect(fetched.filter((r) => r === '/finance/partners/warmup/payments/warmup')).toHaveLength(3);
    expect(lines.join('\n')).toContain('Auffänger');
  });

  it('eine statische Route und ein echtes 404 zählen nicht als Auffänger', async () => {
    let rescans = 0;
    await warmUp('http://w', appDir, () => {}, { fetchPage: async () => ({ status: 200, body: PAGE }), rescan: () => { rescans += 1; }, pauseMs: 0 });
    expect(rescans).toBe(0);
  });

  it('schluckt keinen Fehler: Eine gescheiterte Route steht im Protokoll und wird einmal nachgeholt', async () => {
    const lines: string[] = [];
    const tries = new Map<string, number>();
    await warmUp('http://w', appDir, (line) => lines.push(line), {
      fetchPage: async (url) => {
        const route = url.replace('http://w', '');
        const n = (tries.get(route) ?? 0) + 1;
        tries.set(route, n);
        if (route === '/finance/entries' && n === 1) throw new Error('ECONNRESET');
        if (route === '/members' && n === 1) return { status: 500, body: 'kaputt' };
        return { status: 200, body: PAGE };
      },
      pauseMs: 0,
    });
    expect(lines.filter((l) => l.includes('/finance/entries') && l.includes('ECONNRESET'))).toHaveLength(1);
    expect(lines.filter((l) => l.includes('/members') && l.includes('500'))).toHaveLength(1);
    expect(tries.get('/finance/entries')).toBe(2);
    expect(tries.get('/members')).toBe(2);
  });

  it('wartet am Ende, bis eine echte Seite zweimal in Folge 200 liefert', async () => {
    const answers = [500, 200, 503, 200, 200, 200];
    let asked = 0;
    await warmUp('http://w', appDir, () => {}, {
      fetchPage: async (url) => {
        if (!url.endsWith('/login')) return { status: 200, body: PAGE };
        asked += 1;
        return { status: answers.shift() ?? 200, body: PAGE };
      },
      pauseMs: 0,
    });
    // /login gehört auch zu den Routen: eine Antwort im Durchgang, fünf am Ende.
    expect(asked).toBe(5);
  });

  it('gibt nach der Frist auf und nennt die Ausgabe des Servers, statt den ersten Test scheitern zu lassen', async () => {
    await expect(
      warmUp('http://w', appDir, () => {}, { fetchPage: async () => ({ status: 500, body: '' }), serverOutput: () => 'letzte Zeile des Servers', pauseMs: 0, readyTimeoutMs: 0 }),
    ).rejects.toThrow(/letzte Zeile des Servers/);
  });

  it('macht eine Panik von Turbopack sichtbar, auch wenn die Seiten danach wieder antworten', async () => {
    const lines: string[] = [];
    await warmUp('http://w', appDir, (line) => lines.push(line), {
      fetchPage: async () => ({ status: 200, body: PAGE }),
      serverOutput: () => 'ok\nFATAL: An unexpected Turbopack error occurred\ntask is missing in memory or persistent storage\nok',
      pauseMs: 0,
    });
    expect(lines.filter((l) => l.includes('Panik') && l.includes('task is missing'))).toHaveLength(1);
  });
});
