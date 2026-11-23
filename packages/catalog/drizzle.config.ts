import { defineConfig } from 'drizzle-kit';

/** Where `drizzle-kit generate` reads the photo index's schema, and writes its migrations. */
export default defineConfig({
  dialect: 'sqlite',
  out: './src/database/photo-index/migrations',
  schema: './src/database/photo-index/schema.ts',
});
