import { exportAnimalProfiles, type ProfileLabels } from '@kompass/module-animals';
import { getTranslations } from 'next-intl/server';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

const STATUS: Record<string, number> = { forbidden: 403, notFound: 404, unauthorized: 401 };

/** Tierprofile als PDF (Spec 2026-10-05, § 9.3), `?ids=` in der Reihenfolge der Liste; der Knopf ruft per fetch. */
export async function GET(request: Request): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const ids = (new URL(request.url).searchParams.get('ids') ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  const t = await getTranslations('animals');
  const labels: ProfileLabels = {
    title: t('print.title'),
    sexes: t.raw('form.sexes') as ProfileLabels['sexes'],
    locations: t.raw('form.locations') as ProfileLabels['locations'],
    status: { reserved: t('form.status.reserved'), adopted: t('form.status.adopted') },
    emergency: t('list.emergency'),
    sponsorable: t('list.sponsorable'),
    more: t.raw('print.more') as string,
    continued: t('print.continued'),
  };
  const result = await exportAnimalProfiles(getDeps(), session.ctx, { ids, labels });
  if (!result.ok) return new Response(null, { status: STATUS[result.error.type] ?? 400 });

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
