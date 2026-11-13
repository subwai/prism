import { defineConfig } from 'drizzle-kit';

/** Where `drizzle-kit generate` reads the thumbnail index's schema, and writes its migrations. */
export default defineConfig({
  dialect: 'sqlite',
  out: './src/thumbnail-index-migrations',
  schema: './src/thumbnail-index-schema.ts',
});
