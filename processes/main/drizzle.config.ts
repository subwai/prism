import { defineConfig } from 'drizzle-kit';

/** Where `drizzle-kit generate` reads the photo index's schema, and writes its migrations. */
export default defineConfig({
  dialect: 'sqlite',
  out: './src/photos/migrations',
  schema: './src/photos/index-schema.ts',
});
