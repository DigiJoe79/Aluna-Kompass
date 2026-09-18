import { spawn, spawnSync } from 'node:child_process';

export class TypstRenderError extends Error {
  constructor(message: string, public readonly stderr: string) {
    super(message);
    this.name = 'TypstRenderError';
  }
}

export function findTypstBinary(): string {
  const candidate = process.env.TYPST_BINARY ?? 'typst';
  const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    throw new Error(`typst binary not found (${candidate}). Install Typst 0.15.x (brew install typst) or set TYPST_BINARY.`);
  }
  return candidate;
}

export function typstVersion(binary: string): string {
  return spawnSync(binary, ['--version'], { encoding: 'utf8' }).stdout.trim();
}

export function compileTypst(opts: { binary: string; rootDir: string; fontPaths: string[]; entry: string; output: string }): Promise<void> {
  const fontArgs = opts.fontPaths.flatMap((p) => ['--font-path', p]);
  return new Promise((resolve, reject) => {
    const child = spawn(opts.binary, ['compile', '--root', opts.rootDir, ...fontArgs, '--ignore-system-fonts', opts.entry, opts.output], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new TypstRenderError(`typst exited with ${code}`, stderr));
      if (/unknown font family/i.test(stderr)) return reject(new TypstRenderError('typst: unknown font family (fonts must come from the repo)', stderr));
      resolve();
    });
  });
}
