import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  transpilePackages: ['@kompass/core', '@kompass/documents', '@kompass/mcp', '@kompass/module-website', '@kompass/module-animals', '@kompass/markdown'],
  serverExternalPackages: ['better-sqlite3', '@node-rs/argon2', 'tar', 'file-type', 'image-size'],
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
};

export default withNextIntl(nextConfig);
