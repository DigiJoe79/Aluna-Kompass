import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  transpilePackages: ['@kompass/core', '@kompass/documents', '@kompass/mcp'],
  serverExternalPackages: ['better-sqlite3', '@node-rs/argon2'],
  output: 'standalone',
};

export default withNextIntl(nextConfig);
