// drizzle-kit's settings: `pnpm db:generate --name <what>` diffs the schema against the last migration and writes
// the next one. It needs no database; the app applies migrations itself (packages/cli/src/db.ts).
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
} satisfies Config;
