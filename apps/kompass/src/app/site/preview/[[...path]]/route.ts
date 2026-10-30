import { requirePermission } from '@kompass/core';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { optionalSession } from '@/lib/request-context';
import { siteEnv } from '@/lib/site-env';
import { previewResponseHeaders, resolvePreviewFile, rewritePreviewHtml } from '@/lib/site-preview';


export async function GET(_request: Request, ctx: { params: Promise<{ path?: string[] }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  if (requirePermission(session.ctx, 'site.view')) return new Response(null, { status: 403 });
  const { path: parts = [] } = await ctx.params;
  const resolved = resolvePreviewFile(siteEnv().previewDir, parts);
  if (!resolved) return new Response(null, { status: 404 });
  let target = resolved;
  const info = await stat(target).catch(() => null);
  if (!info) return new Response(null, { status: 404 });
  if (info.isDirectory()) target = path.join(target, 'index.html');
  const bytes = await readFile(target).catch(() => null);
  if (!bytes) return new Response(null, { status: 404 });
  const ext = path.extname(target);
  let content: BodyInit = bytes;
  if (ext === '.html') {
    content = rewritePreviewHtml(bytes.toString('utf8'));
  }
  return new Response(content, { headers: previewResponseHeaders(ext) });
}
