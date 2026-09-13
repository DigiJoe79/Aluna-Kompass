import { buildMediaListing, parseMediaListParams } from '@/lib/media-listing';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

/** Die Mediathek als JSON für den Auswahl-Dialog. Kein Cache: Jeder Upload ändert die Liste. */
export async function GET(request: Request): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const filter = parseMediaListParams(new URL(request.url).searchParams);
  if (!filter) return new Response(null, { status: 400 });
  const result = await buildMediaListing(getDeps(), session.ctx, filter);
  if (!result.ok) return new Response(null, { status: result.error.type === 'forbidden' ? 403 : 500 });
  return Response.json(result.value, { headers: { 'cache-control': 'no-store' } });
}
