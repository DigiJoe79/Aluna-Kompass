import { NextResponse } from 'next/server';
import { getDeps, runtimeEnv } from '@/lib/deps';
import { setSetting } from '@kompass/core';

export async function POST(request: Request): Promise<Response> {
  if (runtimeEnv().env !== 'test' || request.headers.get('x-e2e-token') !== process.env.E2E_RESET_TOKEN) {
    return new NextResponse(null, { status: 404 });
  }
  const { key, value } = await request.json();
  const deps = getDeps();
  const ctx = {
    userId: null,
    permissions: new Set(['settings.manage']),
    channel: 'system',
    apiTokenId: null,
    ipAddress: null,
    requestId: 'E2E',
  } as const;
  const result = await setSetting(deps, ctx, { key, value });
  return NextResponse.json({ ok: result.ok });
}
