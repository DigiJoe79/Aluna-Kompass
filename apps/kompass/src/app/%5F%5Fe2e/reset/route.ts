import { rmSync } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { resetDeps, runtimeEnv } from '@/lib/deps';
import { siteEnv } from '@/lib/site-env';

export async function POST(request: Request): Promise<Response> {
  if (runtimeEnv().env !== 'test' || request.headers.get('x-e2e-token') !== process.env.E2E_RESET_TOKEN) {
    return new NextResponse(null, { status: 404 });
  }
  const mode = new URL(request.url).searchParams.get('mode') === 'seeded' ? 'seeded' : 'empty';
  await resetDeps(mode);
  // Die Ergebnisse der Webseiten-Läufe liegen im Cache, nicht in der Datenbank:
  // Ohne das zeigte ein Test das Ergebnis, das der vorige gebaut hat.
  for (const kind of ['preview', 'publish', 'deployCheck']) rmSync(path.join(siteEnv().cacheDir, `${kind}-result.json`), { force: true });
  return NextResponse.json({ ok: true, mode });
}
