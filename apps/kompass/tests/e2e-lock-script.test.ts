import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(import.meta.dirname, '../../../scripts/e2e-lock.sh');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function workdir(): { lock: string; log: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'e2e-lock-'));
  dirs.push(dir);
  return { lock: path.join(dir, 'kompass-e2e.lock'), log: path.join(dir, 'log') };
}

function run(lock: string, command: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('sh', [SCRIPT, ...command], { env: { ...process.env, E2E_LOCK: lock, E2E_LOCK_WAIT: '0.1' }, stdio: 'ignore' });
    child.on('exit', (code) => resolve(code ?? -1));
  });
}

/**
 * Teil C Task 3: Parallele Agenten teilen sich eine E2E-Sperre. Früher hat ein
 * `rmdir` nach gescheitertem `mkdir` die Sperre eines anderen entfernt. Das
 * Skript wartet, schreibt seinen Besitz hinein und räumt nur die eigene weg.
 */
describe('scripts/e2e-lock.sh', () => {
  it('lässt zwei gleichzeitige Aufrufe nacheinander laufen', async () => {
    const { lock, log } = workdir();
    const step = (name: string) => ['sh', '-c', `echo "${name} start" >> "${log}"; sleep 0.4; echo "${name} ende" >> "${log}"`];
    const codes = await Promise.all([run(lock, step('a')), run(lock, step('b'))]);
    expect(codes).toEqual([0, 0]);
    const lines = readFileSync(log, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(4);
    // Kein Start zwischen Start und Ende des anderen.
    expect(lines[0]!.split(' ')[0]).toBe(lines[1]!.split(' ')[0]);
    expect(lines[2]!.split(' ')[0]).toBe(lines[3]!.split(' ')[0]);
    expect(existsSync(lock)).toBe(false);
  });

  it('schreibt PID und Befehl in die Sperre und gibt den Exit-Code des Befehls weiter', async () => {
    const { lock, log } = workdir();
    const code = await run(lock, ['sh', '-c', `cat "${lock}/owner" > "${log}"; exit 3`]);
    expect(code).toBe(3);
    expect(readFileSync(log, 'utf8')).toMatch(/^pid=\d+\ncommand=sh -c /);
    expect(existsSync(lock)).toBe(false);
  });

  it('entfernt eine fremde Sperre nie — auch nicht, wenn es sie am Ende vorfindet', async () => {
    const { lock } = workdir();
    // Der eigene Lauf endet, während ein anderer die Sperre übernommen hat (simuliert: Besitzer umgeschrieben).
    const code = await run(lock, ['sh', '-c', `echo "pid=999999" > "${lock}/owner"`]);
    expect(code).toBe(0);
    expect(readFileSync(path.join(lock, 'owner'), 'utf8')).toContain('pid=999999');
  });

  it('wartet auf eine fremde Sperre statt sie zu brechen', async () => {
    const { lock, log } = workdir();
    mkdirSync(lock);
    writeFileSync(path.join(lock, 'owner'), 'pid=1\ncommand=fremd\n');
    const child = run(lock, ['sh', '-c', `echo lief >> "${log}"`]);
    await new Promise((r) => setTimeout(r, 400));
    expect(existsSync(log)).toBe(false);
    rmSync(lock, { recursive: true });
    expect(await child).toBe(0);
    expect(readFileSync(log, 'utf8')).toBe('lief\n');
  });
});
