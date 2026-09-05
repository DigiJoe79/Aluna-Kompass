import { IS_STAGING, PUBLIC_URL } from '../lib/content';

export function GET() {
  const body = IS_STAGING
    ? 'User-agent: *\nDisallow: /\n'
    : `User-agent: *\nAllow: /\nSitemap: ${new URL('/sitemap-index.xml', PUBLIC_URL).href}\n`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
