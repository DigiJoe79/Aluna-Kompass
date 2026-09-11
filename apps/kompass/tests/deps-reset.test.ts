import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * `resetDeps` verwirft den Bestand und legt ihn neu an. Seit der Texterkennung
 * ist es damit nicht mehr allein: Der Textworker ruft `getDeps()` aus einem
 * Timer heraus, also mitten in fremde `await`-Punkte hinein.
 *
 * Trifft er das Fenster zwischen `holder.deps = null` und dem Löschen der
 * Datei, legt **er** die Deps an — auf der alten Datei. Der offene Handle hält
 * den gelöschten Inode mitsamt Inhalt am Leben, und `resetDeps` findet danach
 * ein belegtes Feld vor und legt nichts Neues mehr an. Die Anwendung liest
 * weiter den alten Bestand; der Reset war wirkungslos.
 *
 * So entstand der Fehlschlag vom 11.09. im dritten Prüfring: Ein Sperrwort aus
 * dem vorhergehenden Test überlebte `resetDatabase` und verhinderte den
 * Publish.
 */

const MARKER = 'race_marker';

let dataPath: string;
let previous: Record<string, string | undefined>;

/**
 * Der Halter liegt auf `globalThis` und überlebt jeden Testfall. Geleert wird
 * das Feld, nicht der Halter: Das Modul greift sich das Objekt beim Laden ein
 * einziges Mal, ein `delete` auf `globalThis` ginge also an ihm vorbei.
 */
function clearHolder(): void {
  const holder = (globalThis as { __kompass?: { deps: { close(): void } | null } }).__kompass;
  try {
    holder?.deps?.close();
  } catch {
    // schon zu
  }
  if (holder) holder.deps = null;
}

beforeEach(async () => {
  dataPath = await mkdtemp(path.join(tmpdir(), 'kompass-reset-'));
  previous = {
    APP_ENV: process.env.APP_ENV,
    DATA_PATH: process.env.DATA_PATH,
    SESSION_SECRET: process.env.SESSION_SECRET,
  };
  process.env.APP_ENV = 'test';
  process.env.DATA_PATH = dataPath;
  process.env.SESSION_SECRET = 'reset-test-secret-0123456789abcdef0123456789';
  clearHolder();
});

afterEach(async () => {
  clearHolder();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(dataPath, { recursive: true, force: true });
});

function hasMarker(sqlite: { prepare(sql: string): { get(name: string): unknown } }): boolean {
  return sqlite.prepare(`SELECT name FROM sqlite_master WHERE name = ?`).get(MARKER) !== undefined;
}

describe('resetDeps', () => {
  it('wirft den Bestand weg, auch wenn nebenher jemand die Deps anfordert', async () => {
    const { getDeps, resetDeps } = await import('@/lib/deps');

    getDeps().sqlite.exec(`CREATE TABLE ${MARKER} (x)`);
    expect(hasMarker(getDeps().sqlite)).toBe(true);

    // Der Worker, nachgestellt: Er ruft `getDeps()` bei jeder Runde seiner
    // Schleife und verschluckt dabei jeden Fehler (`worker.ts`).
    let spinning = true;
    const spin = (async () => {
      while (spinning) {
        try {
          getDeps();
        } catch {
          // wie im Worker
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();

    await resetDeps('empty');
    spinning = false;
    await spin;

    expect(hasMarker(getDeps().sqlite)).toBe(false);
  });

  it('lässt den Worker nicht auf einer verworfenen Datenbank weiterlaufen', async () => {
    const { getDeps, resetDeps } = await import('@/lib/deps');

    const before = getDeps();
    await resetDeps('empty');
    const after = getDeps();

    expect(after).not.toBe(before);
    expect(after.databasePath).toBe(before.databasePath);
    // Der alte Handle ist zu — wer ihn noch hält, merkt es, statt ins Leere zu
    // schreiben.
    expect(() => before.sqlite.prepare('SELECT 1').get()).toThrow();
  });
});

describe('während ein Reset läuft', () => {
  it('bekommt eine Anfrage Deps statt einer Ausnahme', async () => {
    const { getDeps, resetDeps } = await import('@/lib/deps');

    getDeps();
    let thrown: unknown = null;
    const spin = (async () => {
      for (let i = 0; i < 50; i += 1) {
        try {
          getDeps();
        } catch (error) {
          thrown ??= error;
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();

    await resetDeps('empty');
    await spin;

    // Eine Anfrage, die mitten in den Reset läuft, darf nicht mit einem Fehler
    // im Browser enden — das tat sie, und die CI hat es gezeigt.
    expect(thrown).toBeNull();
  });
});

describe('eine Anfrage mitten im Reset', () => {
  it('bringt ihn nicht zum Scheitern', async () => {
    const { getDeps, resetDeps, depsReady } = await import('@/lib/deps');

    getDeps();
    let spinning = true;
    // Ohne `depsReady()` legt dieser Aufruf die Datenbank neu an, während sie
    // gelöscht wird — `rm` meldete dann ENOTEMPTY und der Reset brach ab.
    // Genau so scheiterte am 11.09. `setup-import` in der CI.
    const spin = (async () => {
      while (spinning) {
        await depsReady();
        getDeps();
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();

    await expect(resetDeps('empty')).resolves.toBeUndefined();
    spinning = false;
    await spin;
  });
});
