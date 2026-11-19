/**
 * Lamproom's database schema: SQLite at `<data>/lamproom.db` for now, through Drizzle so it can move to another
 * database later. Tables and columns follow the PRD's names (PRD §5). Projects are still in projects.json, so
 * `project_id` has no foreign key yet. After changing it, `pnpm db:generate --name <what>` writes a migration into
 * `packages/cli/drizzle/`; `db.ts` applies it when it opens the file. Times are ISO strings.
 */
import { randomUUID } from 'node:crypto';
import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const now = () => new Date().toISOString();

/** A piece of work in a project (Task Record). `import_key`: null on a task made by hand, so no import matches it. */
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey().$defaultFn(randomUUID),
    projectId: text('project_id').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    /** What has to be true to close it, one string per item. */
    acceptanceCriteria: text('acceptance_criteria', { mode: 'json' }).$type<string[]>().notNull(),
    /** What agents must leave alone, one string per item. */
    nonGoals: text('non_goals', { mode: 'json' }).$type<string[]>().notNull(),
    status: text('status', { enum: ['backlog', 'todo', 'running', 'blocked', 'done', 'failed', 'cancelled'] }).notNull().default('backlog'),
    importKey: text('import_key'),
    createdAt: text('created_at').notNull().$defaultFn(now),
    updatedAt: text('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
  },
  (t) => [uniqueIndex('tasks_project_id_import_key_key').on(t.projectId, t.importKey), index('tasks_project_id_status_idx').on(t.projectId, t.status)],
);

/** One backlog import by the importer agent: its run, the backlog text until the tasks are saved, then the result. */
export const backlogImports = sqliteTable('backlog_imports', {
  run: text('run').primaryKey(),
  projectId: text('project_id').notNull(),
  text: text('text'),
  state: text('state', { enum: ['running', 'applying', 'settled'] }).notNull().default('running'),
  /** AgentImport once settled. */
  result: text('result', { mode: 'json' }),
  createdAt: text('created_at').notNull().$defaultFn(now),
});
