import { spawn } from 'node:child_process';
import type { DeployTarget } from './env';

export async function rsyncPublish(opts: { distDir: string; deploy: DeployTarget; dryRun?: boolean }): Promise<{ log: string }> {
  const remote = opts.deploy.host ? `${opts.deploy.user}@${opts.deploy.host}:${opts.deploy.path.replace(/\/?$/, '/')}` : opts.deploy.path.replace(/\/?$/, '/');
  const src = opts.distDir.endsWith('/') ? opts.distDir : `${opts.distDir}/`;
  const args = ['-az', '--delete', '--checksum', ...(opts.dryRun ? ['--dry-run'] : []), ...(opts.deploy.host ? ['-e', `ssh -i ${opts.deploy.keyFile} -o StrictHostKeyChecking=accept-new -o BatchMode=yes`] : []), src, remote];
  return new Promise((resolve, reject) => {
    const child = spawn('rsync', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let log = `rsync ${args.join(' ')}\n`;
    child.stdout.on('data', (c: Buffer) => {
      log += c.toString('utf8');
    });
    child.stderr.on('data', (c: Buffer) => {
      log += c.toString('utf8');
    });
    child.on('error', (e) => reject(new Error(`rsync failed to start: ${e.message}`)));
    child.on('close', (code) => (code === 0 ? resolve({ log }) : reject(new Error(`rsync exited with ${code}\n${log}`))));
  });
}
