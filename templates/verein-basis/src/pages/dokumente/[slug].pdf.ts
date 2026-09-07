import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CONTENT_DIR, loadContent, slugify, t } from '../../lib/content';

export async function getStaticPaths() {
  const content = await loadContent();
  return content.collections.documents
    .filter((doc) => doc.file)
    .map((doc) => ({ params: { slug: slugify(t(doc.title)) }, props: { assetId: doc.file as string } }));
}

export async function GET({ props }: { props: { assetId: string } }) {
  const content = await loadContent();
  const asset = content.assets.find((a) => a.id === props.assetId);
  if (!asset) return new Response('Not found', { status: 404 });
  const bytes = await readFile(path.join(CONTENT_DIR, 'assets', asset.filename));
  return new Response(bytes, {
    headers: {
      'content-type': asset.mimeType || 'application/pdf',
      'content-disposition': `inline; filename="${asset.filename}"`,
    },
  });
}
