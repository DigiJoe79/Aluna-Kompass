import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(import.meta.dirname, '../../../scripts/seed-site-template.sh');
const TEMPLATE_SRC = path.resolve(import.meta.dirname, '../../../templates/verein-basis');

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const workspace = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kompass-entrypoint-'));
  tmpDirs.push(dir);
  return dir;
};

/** Führt seed-site-template.sh gegen ein isoliertes „Volume" aus. */
const run = (opts: { templateDir: string; nodeModules: string; source?: string }) =>
  execFileSync('sh', [SCRIPT, opts.source ?? TEMPLATE_SRC, opts.nodeModules], {
    env: { ...process.env, SITE_TEMPLATE_DIR: opts.templateDir },
    encoding: 'utf8',
  });

describe('seed-site-template.sh', () => {
  it('copies the base template into an empty volume and links the module resolution', () => {
    const root = workspace();
    const templateDir = path.join(root, 'site-template');
    const nodeModules = path.join(root, 'node_modules');
    mkdirSync(nodeModules);

    run({ templateDir, nodeModules });

    expect(existsSync(path.join(templateDir, 'kompass.template.ts'))).toBe(true);
    expect(existsSync(path.join(templateDir, 'src/pages/[...path].astro'))).toBe(true);
    const link = path.join(templateDir, 'node_modules');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(nodeModules);
  });

  it('leaves an existing template untouched — an update must never overwrite it', () => {
    const root = workspace();
    const templateDir = path.join(root, 'site-template');
    const nodeModules = path.join(root, 'node_modules');
    mkdirSync(nodeModules);
    mkdirSync(templateDir, { recursive: true });
    writeFileSync(path.join(templateDir, 'kompass.template.ts'), '// vom Verein gepflegt\n');

    run({ templateDir, nodeModules });

    expect(readFileSync(path.join(templateDir, 'kompass.template.ts'), 'utf8')).toBe('// vom Verein gepflegt\n');
  });

  it('is idempotent — a second run changes nothing and does not fail on the existing link', () => {
    const root = workspace();
    const templateDir = path.join(root, 'site-template');
    const nodeModules = path.join(root, 'node_modules');
    mkdirSync(nodeModules);

    run({ templateDir, nodeModules });
    expect(() => run({ templateDir, nodeModules })).not.toThrow();
    expect(lstatSync(path.join(templateDir, 'node_modules')).isSymbolicLink()).toBe(true);
  });
});
