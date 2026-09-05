import { NextResponse } from 'next/server';
import { resetDeps, runtimeEnv } from '@/lib/deps';

export async function POST(request: Request): Promise<Response> {
  if (runtimeEnv().env !== 'test' || request.headers.get('x-e2e-token') !== process.env.E2E_RESET_TOKEN) {
    return new NextResponse(null, { status: 404 });
  }
  const mode = new URL(request.url).searchParams.get('mode') === 'seeded' ? 'seeded' : 'empty';
  await resetDeps(mode);
  return NextResponse.json({ ok: true, mode });
}
