import { getPublish } from '@kompass/module-site';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';
import { failureStatus } from '@/lib/site-job-view';

/**
 * Ein Eintrag der Publish-Historie mit Dateiliste und Protokoll. Die Historie
 * selbst trägt beides nicht mit; das Protokoll lädt erst, wer es öffnet.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const { id } = await params;
  const query = new URL(request.url).searchParams;
  const result = await getPublish(getDeps(), session.ctx, {
    id,
    ...(query.get('paths') === 'all' ? { paths: 'all' as const } : {}),
    ...(query.get('log') === 'full' ? { log: 'full' as const } : {}),
  });
  if (!result.ok) return new Response(null, { status: failureStatus(result.error) });
  return Response.json(result.value, { headers: { 'cache-control': 'no-store' } });
}
