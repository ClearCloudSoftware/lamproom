/**
 * Importing a markdown backlog into a project. The `backlog-importer` internal step reads it first and maps each
 * piece of work to a task (title, body, acceptance criteria, non-goals): a run of the project like the repo analyst,
 * with the backlog's text as its task (the step has no tool to read a path). When the run cannot start, fails,
 * pauses, takes too long or writes nothing readable, the parser (`parseMarkdown`) reads the same text instead, and
 * the import's `note` says so (backlog 7.3).
 *
 * The import is one `imports` row with source `markdown`, so the page polls `GET /api/imports/<id>` as it does for
 * Jira, and the tasks go through the same upsert on (project, source, import key).
 */
import { readFileSync, realpathSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import type { ParsedTask } from '@lamproom/core';
import { keyMarkdownTasks, parseMarkdown } from '@lamproom/adapters';
import { readAppSettings } from './app-settings.ts';
import { isFile } from './config.ts';
import type { LamproomDb } from './db.ts';
import { readArtifact, readRun, type RunStatus } from './flow-logs.ts';
import { startRun } from './flow-start.ts';
import { internalFlowText } from './internal-steps.ts';
import { owns, type Project } from './projects.ts';
import { finishImport, recordImport, updateImportProgress, upsertTasks } from './storage.ts';

/** A backlog larger than this is not one a person keeps by hand. */
export const MAX_BACKLOG_BYTES = 256 * 1024;
const SOURCE = 'markdown';

/** Pasted or uploaded text, or a file in the project's repo: exactly one. */
export interface ImportInput { content?: string; path?: string }

/** What `startBacklogImport` needs of a run: its status, and once done, its `tasks` output. */
export type RunLook = (run: string) => { status: RunStatus; output?: string } | undefined;
const lookRun = (runsDir: string): RunLook => (run) => {
  const r = readRun(runsDir, run);
  return r && { status: r.status, ...(r.status === 'done' && { output: readArtifact(runsDir, run, 'tasks') }) };
};

export interface ImportDeps {
  start?: typeof startRun;
  look?: RunLook;
  /** How often the run is checked, and how long it may take before the parser reads the backlog instead. */
  pollMs?: number;
  maxMs?: number;
}

export type BacklogImportStarted =
  | { ok: true; importId: string; finished: Promise<void> }
  | { ok: false; status: 400; error: string };

const bad = (error: string) => ({ ok: false as const, status: 400 as const, error });

/** The backlog's text: `content`, or the file at `path`, which must be in the project's repo (the API has no login). */
function textOf(project: Project, input: ImportInput): { ok: true; text: string } | ReturnType<typeof bad> {
  if ((input.content === undefined) === (input.path === undefined)) return bad('send the backlog as content or as a path in the repo, one of them');
  if (input.content !== undefined) {
    return Buffer.byteLength(input.content) > MAX_BACKLOG_BYTES ? bad(`the backlog is larger than ${MAX_BACKLOG_BYTES / 1024} KB`) : { ok: true, text: input.content };
  }
  const path = isAbsolute(input.path!) ? input.path! : join(project.repoPath, input.path!);
  if (!isFile(path)) return bad(`${input.path}: no such file`);
  // The real path, so a symlink in the repo cannot reach a file outside it.
  if (!owns(project, realpathSync.native(path))) return bad(`${input.path}: not a file in ${project.repoPath}`);
  if (statSync(path).size > MAX_BACKLOG_BYTES) return bad(`${input.path} is larger than ${MAX_BACKLOG_BYTES / 1024} KB`);
  return { ok: true, text: readFileSync(path, 'utf8') };
}

const AgentTasks = z.array(
  z.object({
    title: z.string(),
    body: z.string().optional(),
    acceptance_criteria: z.array(z.string()).optional(),
    non_goals: z.array(z.string()).optional(),
    import_key: z.string().optional(),
  }),
);

/**
 * The agent's output as tasks: the first `[` to the last `]` of its file, as JSON. Its `import_key` is kept only as
 * an explicit id found word for word in the backlog (the skill copies one from the file); one it made up is dropped
 * and the key derived from the title like the parser's. An empty list is not read as "no tasks": a backlog the
 * agent found nothing in goes to the parser.
 */
export function agentTasks(output: string, text: string): { ok: true; tasks: ParsedTask[] } | { ok: false; error: string } {
  const from = output.indexOf('[');
  const to = output.lastIndexOf(']');
  let json: unknown;
  try {
    json = from < 0 || to < from ? undefined : JSON.parse(output.slice(from, to + 1));
  } catch {
    json = undefined;
  }
  const r = AgentTasks.safeParse(json);
  if (!r.success) return { ok: false, error: 'the importer agent wrote no task list Lamproom can read' };
  const raw = r.data
    .filter((t) => t.title.trim())
    .map((t) => ({
      title: t.title.trim(),
      ...(t.import_key && /^[\w.-]+$/.test(t.import_key) && text.includes(t.import_key) && { id: t.import_key }),
      ...(t.body?.trim() && { body: t.body.trim() }),
      ...(t.acceptance_criteria && { acceptanceCriteria: t.acceptance_criteria }),
      ...(t.non_goals && { nonGoals: t.non_goals }),
    }));
  if (!raw.length) return { ok: false, error: 'the importer agent found no task' };
  try {
    return { ok: true, tasks: keyMarkdownTasks(raw, SOURCE) };
  } catch (e) {
    return { ok: false, error: `the importer agent's tasks: ${(e as Error).message}` };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Starts importing a backlog into `project`; the import row's id comes back at once, and `finished` settles when its
 * tasks are saved (or the import failed). The importer's run takes the repo's folder lock like any run, so while
 * another run works there the parser reads the backlog.
 */
export async function startBacklogImport(
  db: LamproomDb,
  dataDir: string,
  runsDir: string,
  project: Project,
  input: ImportInput,
  { start = startRun, look = lookRun(runsDir), pollMs = 2000, maxMs = 10 * 60 * 1000 }: ImportDeps = {},
): Promise<BacklogImportStarted> {
  const read = textOf(project, input);
  if (!read.ok) return read;
  const text = read.text;
  if (!text.trim()) return bad('the backlog is empty');

  const importId = recordImport(db, project.id, SOURCE, new Date()).id;

  const save = (tasks: ParsedTask[], note?: string) => {
    const { created, updated } = upsertTasks(db, project.id, SOURCE, tasks, new Date());
    updateImportProgress(db, importId, { created, updated, pages: 1 });
    finishImport(db, importId, 'done', note === undefined ? {} : { note });
  };
  const byParser = (why: string) => {
    const tasks = parseMarkdown(text, SOURCE);
    if (!tasks.length) return finishImport(db, importId, 'failed', { error: `${why}, and the parser found no task in the backlog either` });
    save(tasks, `read by the parser: ${why}`);
  };

  // ponytail: the run is watched from this server's memory, so a restart mid-run leaves the row `running`.
  // Apply it from lr-run-flow when the run ends if that matters.
  const finished = (async () => {
    try {
      const dir = join(dataDir, 'internal');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'backlog-importer.yaml'), internalFlowText('backlog-importer', readAppSettings(dataDir).internal['backlog-importer']));
      const r = await start(runsDir, dir, { flow: 'backlog-importer', folder: project.repoPath, task: text, allowDirty: true }, dataDir);
      if (!r.ok) return byParser(`the importer agent did not start: ${r.error}`);

      const until = Date.now() + maxMs;
      for (;;) {
        const run = look(r.name);
        if (!run) return byParser('the importer’s run is gone');
        if (run.status === 'paused') return byParser('the importer’s run paused');
        if (run.status === 'failed') return byParser('the importer agent failed');
        if (run.status === 'done') {
          const out = agentTasks(run.output ?? '', text);
          return out.ok ? save(out.tasks) : byParser(out.error);
        }
        if (Date.now() >= until) return byParser(`the importer agent took longer than ${maxMs / 60000} minutes`);
        await sleep(pollMs);
      }
    } catch (e) {
      // The upsert is one transaction: nothing was saved.
      finishImport(db, importId, 'failed', { error: (e as Error).message });
    }
  })();
  return { ok: true, importId, finished };
}
