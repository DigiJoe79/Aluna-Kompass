import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Befundliste 0.4.0, N1/N8: `write` schrieb mit `wx` direkt ins Ziel und schluckte
 * `EEXIST`. Brach das Schreiben ab (Platte voll, Absturz), blieb eine halbe Datei
 * stehen — und jeder spätere gleiche Upload hielt sie für vorhanden. Jetzt landet
 * die Datei erst als Ganzes unter ihrem Namen; überschrieben wird weiterhin nie.
 */

const failing = { on: false };

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const enospc = () => Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
  const half = (data: unknown) => (data instanceof Uint8Array ? data.subarray(0, Math.max(1, data.byteLength >> 1)) : data);
  return {
    ...real,
    // Alte Fassung: writeFile direkt ins Ziel.
    writeFile: async (file: Parameters<typeof real.writeFile>[0], data: Uint8Array, options?: Parameters<typeof real.writeFile>[2]) => {
      if (!failing.on) return real.writeFile(file, data, options);
      await real.writeFile(file, half(data) as Uint8Array, options);
      throw enospc();
    },
    // Neue Fassung: über einen FileHandle.
    open: async (...args: Parameters<typeof real.open>) => {
      const handle = await real.open(...args);
      if (!failing.on) return handle;
      return new Proxy(handle, {
        get(target, prop, receiver) {
          if (prop === 'writeFile' || prop === 'write') {
            return async (data: Uint8Array) => {
              await target.writeFile(half(data) as Uint8Array);
              throw enospc();
            };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
});

const { createFileStore, createMemoryFileStore, FILE_STORE_TEMP_DIR } = await import('../src/files/store');

const dirs: string[] = [];
afterEach(() => {
  failing.on = false;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-file-store-'));
  dirs.push(d);
  return d;
};

const BYTES = new TextEncoder().encode('ganz und gar vollständig');

describe('createFileStore.write', () => {
  it('leaves no file behind when writing fails halfway', async () => {
    const root = tmp();
    const store = createFileStore(root);
    failing.on = true;
    await expect(store.write('beleg-1.pdf', BYTES)).rejects.toThrow(/ENOSPC/);
    failing.on = false;
    expect(await store.exists('beleg-1.pdf')).toBe(false);
    // Auch keine Temp-Datei bleibt liegen.
    expect(readdirSync(path.join(root, FILE_STORE_TEMP_DIR))).toEqual([]);
    // Ein zweiter Versuch legt die ganze Datei ab.
    await store.write('beleg-1.pdf', BYTES);
    expect(Buffer.from(await store.read('beleg-1.pdf')).equals(Buffer.from(BYTES))).toBe(true);
  });

  it('never overwrites a file that is already there', async () => {
    const store = createFileStore(tmp());
    await store.write('a.txt', BYTES);
    await store.write('a.txt', new TextEncoder().encode('anders'));
    expect(Buffer.from(await store.read('a.txt')).equals(Buffer.from(BYTES))).toBe(true);
    expect(readdirSync(path.join(store.rootDir!, FILE_STORE_TEMP_DIR))).toEqual([]);
  });

  it('sweeps leftovers of an interrupted run from the temp directory', async () => {
    const root = tmp();
    const store = createFileStore(root);
    mkdirSync(path.join(root, FILE_STORE_TEMP_DIR), { recursive: true });
    writeFileSync(path.join(root, FILE_STORE_TEMP_DIR, '01REST'), 'halb');
    await store.sweepTemp();
    expect(existsSync(path.join(root, FILE_STORE_TEMP_DIR, '01REST'))).toBe(false);
    await store.write('b.txt', BYTES);
    expect(readFileSync(path.join(root, 'b.txt'), 'utf8')).toBe('ganz und gar vollständig');
  });

  it('keeps the memory store first-wins and gives it a no-op sweep', async () => {
    const store = createMemoryFileStore();
    await store.write('a.txt', BYTES);
    await store.write('a.txt', new TextEncoder().encode('anders'));
    await store.sweepTemp();
    expect(Buffer.from(await store.read('a.txt')).equals(Buffer.from(BYTES))).toBe(true);
    expect(existsSync('a.txt')).toBe(false);
  });
});
