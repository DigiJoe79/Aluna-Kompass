import type { Result, ServiceError } from '@kompass/core';
import { PdfPageOutOfRangeError } from '@kompass/documents';
import { PAGE_DPI } from '@/lib/finance/report-pages';

function statusOf(error: ServiceError): number {
  if (error.type === 'forbidden') return 403;
  if (error.type === 'unauthorized') return 401;
  if (error.type === 'notFound') return 404;
  if (error.type === 'conflict' && (error.code === 'reportUnknown' || error.code === 'reportUnavailable')) return 404;
  return 409;
}

/**
 * Antwort einer Seitenbild-Route für `PdfPages`: Seite `n` (ganze Zahl), `?scale=2` die doppelte Dichte fürs `srcset`.
 * Eine Seitenzahl außerhalb, keine Zahl oder eine unbekannte Dichte → 404; die Seitenzahl steht in `x-page-count`.
 */
export async function pageImageResponse(request: Request, n: string, render: (page: number, scale: string) => Promise<Result<{ png: Uint8Array; pageCount: number | null }>>): Promise<Response> {
  const scale = new URL(request.url).searchParams.get('scale') ?? '1';
  if (!/^[1-9]\d{0,2}$/.test(n) || !(scale in PAGE_DPI)) return new Response(null, { status: 404 });
  try {
    const result = await render(Number(n), scale);
    if (!result.ok) return new Response(null, { status: statusOf(result.error) });
    return new Response(Buffer.from(result.value.png), {
      headers: {
        'content-type': 'image/png',
        'cache-control': 'private, no-store',
        'content-length': String(result.value.png.byteLength),
        ...(result.value.pageCount === null ? {} : { 'x-page-count': String(result.value.pageCount) }),
      },
    });
  } catch (error) {
    if (error instanceof PdfPageOutOfRangeError) return new Response(null, { status: 404 });
    throw error;
  }
}
