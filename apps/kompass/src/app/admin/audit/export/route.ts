import { exportDocument, queryAudit } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

/** Der Änderungsprotokoll-Auszug: auf Nachfrage gerendert und heruntergeladen, nie abgelegt. */
export async function GET(request: Request): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  const params = new URL(request.url).searchParams;
  const filters = Object.fromEntries([...params.entries()].filter(([k, v]) => v && k !== 'entry' && k !== 'offset'));

  const query = queryAudit(deps, session.ctx, {
    userId: filters.userId || undefined,
    channel: filters.channel || undefined,
    action: filters.action || undefined,
    text: filters.text || undefined,
    from: filters.from ? `${filters.from}T00:00:00.000Z` : undefined,
    to: filters.to ? `${filters.to}T23:59:59.999Z` : undefined,
    limit: 200,
  });
  if (!query.ok) return new Response(null, { status: query.error.type === 'forbidden' ? 403 : 400 });

  const t = await getTranslations();
  const labels = t.raw('audit.filters') as Record<string, string>;
  const shown = Object.fromEntries(Object.entries(filters).map(([k, v]) => [labels[k] ?? k, String(v)]));
  const result = await exportDocument(deps, session.ctx, {
    templateKey: 'audit-log-export',
    input: {
      title: t('audit.title'),
      filters: shown,
      entries: query.value.entries.map((e) => ({ occurredAt: e.occurredAt, userName: e.userName, channel: e.channel, action: e.action, entityType: e.entityType, entityId: e.entityId, summary: e.summary })),
    },
  });
  if (!result.ok) return new Response(null, { status: result.error.type === 'forbidden' ? 403 : 400 });

  const { bytes, filename, mimeType } = result.value;
  // Umlaute überleben nur in filename*; filename bleibt als ASCII-Rückfall daneben stehen (RFC 5987).
  const ascii = filename.normalize('NFKD').replace(/[^\x20-\x7E]/g, '_');
  return new Response(Buffer.from(bytes), {
    headers: {
      'content-type': mimeType,
      'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'cache-control': 'private, no-store',
    },
  });
}
