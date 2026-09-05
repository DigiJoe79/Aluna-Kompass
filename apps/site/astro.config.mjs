// @ts-check
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

const site = process.env.SITE_PUBLIC_URL ?? 'https://example.org';

export default defineConfig({
  site,
  trailingSlash: 'always',
  build: { format: 'directory' },
  compressHTML: true,
  devToolbar: { enabled: false },
  integrations: [sitemap({ filter: () => process.env.SITE_STAGING !== '1' })],
});
