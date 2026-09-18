import { exportBackup, requirePermission } from '@kompass/core';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  if (requirePermission(session.ctx, 'backup.export')) return new Response(null, { status: 403 });
  const result = await exportBackup(getDeps(), session.ctx, { workDir: tmpdir() });
  if (!result.ok) return Response.json(result.error, { status: 400 });
  const bytes = await readFile(result.value.archivePath);
  await rm(result.value.archivePath, { force: true });
  const name = result.value.archivePath.split('/').pop() ?? 'kompass-backup.tar.gz';
  return new Response(bytes, { headers: { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${name}"`, 'content-length': String(bytes.byteLength), 'cache-control': 'no-store' } });
}
