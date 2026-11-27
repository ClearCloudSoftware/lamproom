import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate --name <what>` after changing src/schema.ts; db.ts applies the migration on its next open.
export default defineConfig({ dialect: 'sqlite', schema: './src/schema.ts', out: './drizzle' });
