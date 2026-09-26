import { createServer } from 'node:http';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensurePortFree, workerCount, workerEnvironment } from '../e2e/servers';

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

  it('hält den Dev-Server in APP_ENV=test mit Reset-Token und Staging-Publish', () => {
    const w = workerEnvironment('dev', 0, root);
    expect(w.env.APP_ENV).toBe('test');
    expect(w.env.E2E_RESET_TOKEN).toBe('e2e-reset');
    expect(w.env.SITE_STAGING).toBe('1');
    expect(w.env.SITE_DEPLOY_PATH).toBe(w.siteTarget);
    expect(w.env.SITE_TEMPLATE_DIR).toBe(path.resolve(root, '../../templates/verein-basis'));
  });

  it('gibt Containern eigenen Namen und Port ab 3200 und hängt nur das Publish-Ziel ein', () => {
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
  it('nimmt E2E_WORKERS, sonst 2 online und 3 lokal', () => {
    expect(workerCount({ E2E_WORKERS: '8' })).toBe(8);
    expect(workerCount({ CI: 'true' })).toBe(2);
    expect(workerCount({})).toBe(3);
  });

  it('lehnt Unsinn ab, statt still mit einem Worker zu laufen', () => {
    expect(() => workerCount({ E2E_WORKERS: '0' })).toThrow();
    expect(() => workerCount({ E2E_WORKERS: 'viele' })).toThrow();
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
