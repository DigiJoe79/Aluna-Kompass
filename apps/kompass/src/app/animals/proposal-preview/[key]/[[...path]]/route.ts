import { requirePermission } from '@kompass/core';
import { singlePageRoot } from '@kompass/module-site';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { optionalSession } from '@/lib/request-context';
import { siteEnv } from '@/lib/site-env';
import { resolvePreviewFile, rewritePreviewHtml } from '@/lib/site-preview';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
const KEY = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * Die gebaute Einzelvorschau einer Prüfung (Board Vorschläge 7b): nur mit `animals.manage`, aus dem eigenen Ordner
 * `site-single/<key>/out`, Adressen auf diesen Präfix umgebogen wie bei `/site/preview`.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ key: string; path?: string[] }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  if (requirePermission(session.ctx, 'animals.manage')) return new Response(null, { status: 403 });
  const { key, path: parts = [] } = await ctx.params;
  if (!KEY.test(key)) return new Response(null, { status: 404 });
  const resolved = resolvePreviewFile(path.join(singlePageRoot(siteEnv()), key, 'out'), parts);
  if (!resolved) return new Response(null, { status: 404 });
  let target = resolved;
  const info = await stat(target).catch(() => null);
  if (!info) return new Response(null, { status: 404 });
  if (info.isDirectory()) target = path.join(target, 'index.html');
  const bytes = await readFile(target).catch(() => null);
  if (!bytes) return new Response(null, { status: 404 });
  const ext = path.extname(target);
  const content: BodyInit = ext === '.html' ? rewritePreviewHtml(bytes.toString('utf8'), `/animals/proposal-preview/${key}/`) : bytes;
  return new Response(content, { headers: { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
