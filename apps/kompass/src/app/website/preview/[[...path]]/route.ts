import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { optionalSession } from '@/lib/request-context';
import { siteEnv } from '@/lib/site-env';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
};

export async function GET(_request: Request, ctx: { params: Promise<{ path?: string[] }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const { path: parts = [] } = await ctx.params;
  const root = path.resolve(siteEnv().previewDir);
  let target = path.resolve(root, ...parts);
  if (!target.startsWith(root)) return new Response(null, { status: 404 });
  const info = await stat(target).catch(() => null);
  if (!info) return new Response(null, { status: 404 });
  if (info.isDirectory()) target = path.join(target, 'index.html');
  const bytes = await readFile(target).catch(() => null);
  if (!bytes) return new Response(null, { status: 404 });
  const ext = path.extname(target);
  let content: BodyInit = bytes;
  if (ext === '.html') {
    let html = bytes.toString('utf8');
    html = html.replace('<head>', '<head><base href="/website/preview/">');
    html = html.replace(/href="\/(?!\/)/g, 'href="/website/preview/');
    html = html.replace(/src="\/(?!\/)/g, 'src="/website/preview/');
    content = html;
  }
  return new Response(content, {
    headers: {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    },
  });
}
