import { isoNow, newId, schema } from '@kompass/core';
import { NextResponse } from 'next/server';
import { getDeps, runtimeEnv } from '@/lib/deps';

/**
 * Nur E2E: ein Protokolleintrag, wie ihn Migration 0006 hinterlässt — Aktion ohne `params` (Plan Protokoll,
 * Review Focus 1). Bewusst am Dienst vorbei, weil `recordAudit` heute keinen solchen Eintrag mehr schreibt.
 */
export async function POST(request: Request): Promise<Response> {
  if (runtimeEnv().env !== 'test' || request.headers.get('x-e2e-token') !== process.env.E2E_RESET_TOKEN) {
    return new NextResponse(null, { status: 404 });
  }
  const { action, entityType, entityId } = (await request.json()) as { action: string; entityType: string; entityId: string };
  const deps = getDeps();
  const id = newId();
  deps.db
    .insert(schema.auditLog)
    .values({ id, occurredAt: isoNow(deps.clock), userId: null, channel: 'system', action, entityType, entityId, before: null, after: null, params: null, apiTokenId: null, ipAddress: null, requestId: 'E2E-LEGACY', environment: deps.env })
    .run();
  return NextResponse.json({ id });
}
