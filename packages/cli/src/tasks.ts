/**
 * A project's tasks: the `tasks` table (`db.ts`). Imported tasks carry the `importKey` their source derived
 * (`keyTasks`); a re-import upserts on project + key, so importing the same backlog twice creates nothing new.
 */
import type { ParsedTask } from '@lamproom/core';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from './db.ts';
import { tasks } from './schema.ts';

export type TaskStatus = (typeof tasks.$inferSelect)['status'];

/** A task as the pages see it. `importKey`: null on a task made by hand, so no import ever matches it. */
export interface Task {
  id: string;
  projectId: string;
  title: string;
  body: string | null;
  acceptanceCriteria: string[];
  nonGoals: string[];
  status: TaskStatus;
  importKey: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `skipped`: in the file and already past the backlog, so left as it is. */
export type UpsertCounts = { created: number; updated: number; skipped: number };

/** The project's tasks, in the order they were made. */
export async function readTasks(dataDir: string, projectId: string): Promise<Task[]> {
  return db(dataDir).select().from(tasks).where(eq(tasks.projectId, projectId)).orderBy(asc(tasks.createdAt), sql`rowid`).all();
}

/**
 * Writes `parsed` into the project's tasks, in one transaction: a new key is a new task in the backlog; a known key
 * still in the backlog takes the file's title, body, criteria and non-goals; one already promoted or run is skipped,
 * since runs read its text. Tasks no longer in the file stay as they are.
 */
export async function upsertTasks(dataDir: string, projectId: string, parsed: ParsedTask[]): Promise<UpsertCounts> {
  return db(dataDir).transaction((tx) => {
    const counts: UpsertCounts = { created: 0, updated: 0, skipped: 0 };
    for (const p of parsed) {
      const fields = { title: p.title, body: p.body ?? null, acceptanceCriteria: p.acceptance_criteria ?? [], nonGoals: p.non_goals ?? [] };
      const t = tx.select({ id: tasks.id, status: tasks.status }).from(tasks).where(and(eq(tasks.projectId, projectId), eq(tasks.importKey, p.import_key))).get();
      if (!t) {
        tx.insert(tasks).values({ projectId, importKey: p.import_key, ...fields }).run();
        counts.created++;
      } else if (t.status !== 'backlog') counts.skipped++;
      else {
        tx.update(tasks).set(fields).where(eq(tasks.id, t.id)).run();
        counts.updated++;
      }
    }
    return counts;
  });
}
