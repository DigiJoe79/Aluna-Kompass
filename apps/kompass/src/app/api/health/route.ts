import { backgroundStarted } from '@/lib/background';
import { appVersion, buildId } from '@/lib/build';
import { getDeps, runtimeEnv } from '@/lib/deps';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const deps = getDeps();
  return Response.json({
    status: 'ok',
    environment: runtimeEnv().env,
    migrationCount: deps.migrationCount,
    background: backgroundStarted(),
    version: appVersion(),
    build: buildId(),
  });
}
