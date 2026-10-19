import { NextResponse } from 'next/server';
import { getDeps, runtimeEnv } from '@/lib/deps';
import { readMailEnv, setFakeMailState, type FakeMailKind } from '@/lib/mail-transport';
import { kickMailSender } from '@/lib/background';

const KINDS: readonly FakeMailKind[] = ['off', 'redirect', 'blocked'];

/**
 * Schaltet den Test-Transport der E2E-Server (`KOMPASS_MAIL_FAKE=1`) zwischen „nicht eingerichtet“, „Testumgebung mit
 * Umleitung“ und „gesperrt“. Nur in `APP_ENV=test`, nur mit dem Reset-Schlüssel und nur, wenn der Test-Transport läuft —
 * eine echte Mailverbindung lässt sich hierüber nie schalten.
 */
export async function POST(request: Request): Promise<Response> {
  if (runtimeEnv().env !== 'test' || request.headers.get('x-e2e-token') !== process.env.E2E_RESET_TOKEN || !readMailEnv().fake) {
    return new NextResponse(null, { status: 404 });
  }
  const { state } = (await request.json()) as { state?: string };
  if (!KINDS.includes(state as FakeMailKind)) return NextResponse.json({ ok: false }, { status: 400 });
  getDeps();
  setFakeMailState(state as FakeMailKind);
  kickMailSender();
  return NextResponse.json({ ok: true, state });
}
