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

/**
 * Eine Anfrage, die schon rechnet, wenn der Reset kommt.
 *
 * Sie hat ihre Deps am Anfang geholt und fasst die Datenbank erst am Ende
 * wieder an — dazwischen rendert Typst, baut Astro oder läuft eine Vorschau.
 * Wurde die Verbindung in der Zwischenzeit geschlossen, meldete `previewDraft`
 * `TypeError: The database connection is not open`, und der Ring wurde rot.
 *
 * Ein Zähler über `after()` half hier nicht: `after()` hängt an der Antwort,
 * nicht am Handler. Bricht der Browser ab — beim Neuladen eines `<iframe>` mit
 * der Vorschau tut er das ständig — gilt die Antwort als erledigt, während der
 * Code weiterrechnet. Gemessen am 14.09.: `previewDraft` begann mit einem
 * Zählerstand von null.
 *
 * Deshalb zählt niemand mehr mit. Die alte Verbindung wird aus dem Verkehr
 * gezogen, aber erst später geschlossen; wer auf ihr rechnet, rechnet auf einer
 * bereits gelöschten Datei zu Ende, und das stört keinen.
 */
describe('eine Anfrage, die beim Reset schon rechnet', () => {
  it('kann ihre Datenbank zu Ende benutzen', async () => {
    const { getDeps, resetDeps } = await import('@/lib/deps');

    // Genau wie ein Route Handler: Deps am Anfang holen ...
    const deps = getDeps();

    let seen: unknown = null;
    let failed: unknown = null;
    const request = (async () => {
      try {
        // ... lange rechnen (Typst, Astro) ...
        await new Promise((resolve) => setTimeout(resolve, 50));
        // ... und erst danach die Datenbank anfassen.
        seen = deps.sqlite.prepare('SELECT 1 AS x').get();
      } catch (error) {
        failed = error;
      }
    })();

    await resetDeps('empty');
    await request;

    expect(failed).toBeNull();
    expect(seen).toEqual({ x: 1 });
  });

  it('bekommt trotzdem einen frischen Bestand für alles Neue', async () => {
    const { getDeps, resetDeps } = await import('@/lib/deps');

    const before = getDeps();
    before.sqlite.exec(`CREATE TABLE ${MARKER} (x)`);

    await resetDeps('empty');

    const after = getDeps();
    expect(after).not.toBe(before);
    expect(hasMarker(after.sqlite)).toBe(false);
  });

  it('lässt die abgelegte Verbindung nicht für immer offen', async () => {
    const { getDeps, resetDeps } = await import('@/lib/deps');

    const before = getDeps();
    // Kurze Frist statt der vorgegebenen halben Minute, damit der Test nicht
    // wartet: Danach ist zu, wer aus dem Verkehr gezogen wurde.
    await resetDeps('empty', 10);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(() => before.sqlite.prepare('SELECT 1').get()).toThrow();
  });
});

/**
 * Der geseedete Reset kostet fast nur den Seed: 0,89 s gegen 0,02 s für den
 * leeren, gemessen am 26.09. auf einem M5 Max — und die E2E-Suite ruft ihn
 * vor jedem ihrer 359 Fälle. Deshalb wird der Seed je Prozess genau einmal
 * gerechnet und danach als Schnappschuss des Datenpfads kopiert. Der Bestand,
 * den ein Test vorfindet, ist derselbe; nur der Weg dahin ist ein `cp`.
 */
describe('resetDeps(seeded) mit Schnappschuss', () => {
  it('liefert beim zweiten Mal denselben Bestand wie beim ersten', async () => {
    const { getDeps, resetDeps } = await import('@/lib/deps');
    const users = (deps: { sqlite: { prepare(sql: string): { get(): unknown } } }) =>
      (deps.sqlite.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n;

    await resetDeps('seeded');
    const first = users(getDeps());
    expect(first).toBeGreaterThan(0);

    getDeps().sqlite.exec(`CREATE TABLE ${MARKER} (x)`);
    await resetDeps('seeded');

    expect(hasMarker(getDeps().sqlite)).toBe(false);
    expect(users(getDeps())).toBe(first);
  });

  it('kopiert den Schnappschuss, statt neu zu seeden', async () => {
    const { getDeps, resetDeps, seedSnapshotDatabasePath } = await import('@/lib/deps');

    await resetDeps('seeded');

    // Eine Spur direkt im Schnappschuss hinterlassen: Kommt sie beim nächsten
    // Reset im Bestand an, war es die Kopie — ein neuer Seed hätte sie nicht.
    const sqlite = getDeps().sqlite;
    sqlite.exec(`ATTACH DATABASE '${seedSnapshotDatabasePath()}' AS snapshot`);
    sqlite.exec(`CREATE TABLE snapshot.${MARKER} (x)`);
    sqlite.exec('DETACH DATABASE snapshot');

    await resetDeps('seeded');
    expect(hasMarker(getDeps().sqlite)).toBe(true);
  });

  it('lässt bereitgestelltes Material in Ruhe — auch einen Symlink im Template', async () => {
    const { resetDeps } = await import('@/lib/deps');
    const { mkdirSync, readlinkSync, symlinkSync, writeFileSync } = await import('node:fs');

    // So legt es der Entrypoint ins Volume: das Template als Kopie, darin
    // `node_modules` als Symlink auf die Module im Image. `resetDataPath` lässt
    // beides stehen (`providedFiles` des Site-Moduls); der Schnappschuss muss
    // es genauso — sonst scheitert `cp` am zweiten Reset am Symlink (EINVAL,
    // Container-Ring am 26.09.: 151 rote Fälle).
    const template = path.join(dataPath, 'site', 'template');
    const modules = await mkdtemp(path.join(tmpdir(), 'kompass-modules-'));
    // Mit Astro darin, sonst erneuert das Site-Modul den Link von sich aus.
    mkdirSync(path.join(modules, 'astro'), { recursive: true });
    mkdirSync(template, { recursive: true });
    writeFileSync(path.join(template, 'kompass.template.ts'), 'export default {}');
    symlinkSync(modules, path.join(template, 'node_modules'));

    await resetDeps('seeded');
    await expect(resetDeps('seeded')).resolves.toBeUndefined();

    expect(readlinkSync(path.join(template, 'node_modules'))).toBe(modules);
    await rm(modules, { recursive: true, force: true });
  });

  it('lässt den leeren Reset leer', async () => {
    const { getDeps, resetDeps } = await import('@/lib/deps');

    await resetDeps('seeded');
    await resetDeps('empty');

    const n = (getDeps().sqlite.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n;
    expect(n).toBe(0);
  });
});
