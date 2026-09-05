import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CONTENT_DIR, loadContent } from '../../lib/content';

export async function getStaticPaths() {
  const content = await loadContent();
  return (content.downloads ?? []).map((d) => ({
    params: { key: d.key },
    props: { download: d },
  }));
}

export async function GET({ props }: { props: { download: { key: string; assetId: string } } }) {
  const content = await loadContent();
  const asset = content.assets.find((a) => a.id === props.download.assetId);
  if (!asset) return new Response('Not found', { status: 404 });
  const fileBytes = await readFile(path.join(CONTENT_DIR, 'assets', asset.filename));
  return new Response(fileBytes, {
    headers: {
      'content-type': asset.mimeType || 'application/pdf',
      'content-disposition': `inline; filename="${props.download.key}.pdf"`,
    },
  });
}
