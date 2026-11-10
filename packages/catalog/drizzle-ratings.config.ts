import { defineConfig } from 'drizzle-kit';

/** Where `drizzle-kit generate` reads the ratings file's schema, and writes its migrations. */
export default defineConfig({
  dialect: 'sqlite',
  out: './src/ratings-migrations',
  schema: './src/ratings-schema.ts',
});
