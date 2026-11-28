/**
 * POST /api/import/github?project=<id>&owner=<o>&repo=<r>
 *
 * Kicks off a GitHub Issues import for the named project. Resolves the
 * stored PAT from `github-tasks.json`, builds a GithubTaskProvider bound to
 * (owner, repo), calls startIntake() and returns `{ importId }` immediately.
 * The UI then polls GET /api/imports/<id> until `state !== 'running'`.
 *
 * Concurrency: a second POST for the same (project, source) pair while the
 * first is still running returns the first's importId. No doubled work.
 *
 * Note: `sourceId` is kept as the bare string 'github' in the imports table,
 * matching the storage PK convention used by Jira. If you add a second
 * GitHub repo for the same project later, the (owner, repo) lives in each
 * task's `extras.repository` — the PK still uses `github-<n>` keys.
 */

import { join } from 'node:path';
import { z } from 'zod';
import { GithubTaskProvider } from '../../../../packages/adapters/src/index.ts';
import { redactToken } from '../../../../packages/adapters/src/ticket/github/auth.ts';
import { openDb } from '../../../../packages/cli/src/storage.ts';
import { startIntake } from '../../../../packages/cli/src/intake.ts';
import { claimTaskProvider, readProjects } from '../../../../packages/cli/src/projects.ts';
import { readGithubTasksCredential } from '../../../../packages/cli/src/github-tasks.ts';
import { readGithubSettings, staticResolver, tokensOf } from '../../github-tasks/_lib.ts';
import { runningImports, runningKey } from '../../jira/local.ts';
import { dataDir, refused } from '../../flows/local.ts';

const Query = z.object({
  project: z.string().min(1),
  owner: z.string().trim().min(1).optional(),
  repo: z.string().trim().min(1).optional(),
});

export async function POST(request: Request) {
  const no = refused(request);
  if (no) return no;

  const url = new URL(request.url);
  const parsed = Query.safeParse({
    project: url.searchParams.get('project'),
    owner: url.searchParams.get('owner') ?? undefined,
    repo: url.searchParams.get('repo') ?? undefined,
  });
  if (!parsed.success) {
    return Response.json({ error: 'missing ?project=<id>' }, { status: 400 });
  }
  const projectId = parsed.data.project;

  const projects = readProjects(dataDir());
  if (projects.find((p) => p.id === projectId) === undefined) {
    return Response.json({ error: `project not found: ${projectId}` }, { status: 404 });
  }

  const claim = claimTaskProvider(dataDir(), projectId, 'github');
  if (!claim.ok) return Response.json({ error: claim.error }, { status: claim.status });

  const settings = readGithubSettings();
  const explicit = parsed.data.owner !== undefined && parsed.data.repo !== undefined
    ? { owner: parsed.data.owner, repo: parsed.data.repo }
    : undefined;
  const target = explicit ?? settings.defaultRepo;
  if (target === undefined) {
    return Response.json({ error: 'missing ?owner=<o>&repo=<r> and no default saved' }, { status: 400 });
  }

  let cred;
  try {
    cred = readGithubTasksCredential(dataDir());
  } catch {
    return Response.json({ error: 'no GitHub PAT configured' }, { status: 400 });
  }

  const key = runningKey(projectId, 'github');
  const existing = runningImports.get(key);
  if (existing !== undefined) {
    return Response.json({ importId: existing.importId, reused: true });
  }

  const db = openDb(join(dataDir(), 'lamproom.db'));
  const source = new GithubTaskProvider({
    target,
    resolver: staticResolver(cred),
    projectId,
  });

  const redact = (msg: string) => {
    const [token] = tokensOf(cred);
    return token === undefined ? msg : redactToken(msg, token);
  };

  const { importId, finished } = startIntake(db, {
    projectId,
    sourceId: 'github',
    source,
    input: {},
    redactFn: redact,
  });

  const guarded = finished
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[import/github] intake loop threw unexpectedly:', redact(message));
    })
    .finally(() => {
      runningImports.delete(key);
    });

  runningImports.set(key, { importId, promise: guarded });

  return Response.json({ importId, reused: false });
}
