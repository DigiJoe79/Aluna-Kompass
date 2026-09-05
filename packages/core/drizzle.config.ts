import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: ['./src/db/schema.ts', '../modules/*/src/schema.ts'],
  out: './src/db/migrations',
});
