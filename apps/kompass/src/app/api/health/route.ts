import { getDeps, runtimeEnv } from '@/lib/deps';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const deps = getDeps();
  return Response.json({ status: 'ok', environment: runtimeEnv().env, migrationCount: deps.migrationCount, version: '0.1.0' });
}
