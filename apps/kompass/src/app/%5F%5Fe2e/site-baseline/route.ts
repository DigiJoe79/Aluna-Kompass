import { isoNow, systemContext } from '@kompass/core';
import { BASELINE_ENVIRONMENT, currentContentManifest, recordPublish } from '@kompass/module-site';
import { NextResponse } from 'next/server';
import { getDeps, runtimeEnv } from '@/lib/deps';

/**
 * Nur für E2E: trägt einen erfolgreichen Publish der Produktion mit dem heutigen öffentlichen Stand ein — als wäre
 * gerade publiziert worden. Im Test wird nie in die Produktion publiziert, und nur deren Stand zählt (Plan C).
 */
export async function POST(request: Request): Promise<Response> {
  if (runtimeEnv().env !== 'test' || request.headers.get('x-e2e-token') !== process.env.E2E_RESET_TOKEN) {
    return new NextResponse(null, { status: 404 });
  }
  const deps = getDeps();
  const contentManifest = currentContentManifest(deps);
  if (!contentManifest) return NextResponse.json({ ok: false }, { status: 409 });
  recordPublish(deps, systemContext('e2e-site-baseline'), {
    environment: BASELINE_ENVIRONMENT,
    startedAt: isoNow(deps.clock),
    status: 'success',
    contentHash: 'e2e',
    diff: { changed: [], added: [], removed: [] },
    fileManifest: {},
    log: '',
    summary: '',
    contentManifest,
  });
  return NextResponse.json({ ok: true });
}
