import { NextResponse } from 'next/server';
import { getDeps, runtimeEnv } from '@/lib/deps';
import { writeSettingInternal } from '@kompass/core';

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
  // Wie ein Fachdienst intern, nicht über `setSetting`: Die Suite stellt auch Einstellungen, die ein Modul führt
  // (`managedBy`, etwa `finance.mcpHumanOnlyAllowed`), als Ausgangslage ein. Testumgebung und Token wie oben.
  const result = deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctx, key, value));
  return NextResponse.json({ ok: result.ok });
}
