/**
 * POST /api/import/markdown?project=<id>  body `{ content }` or `{ path }` (a file in the project's repo)
 *
 * Imports a markdown backlog: the importer agent reads it, the parser if the agent can't. Returns `{ importId }` at
 * once; the page polls `GET /api/imports/<id>` like a Jira import. See `packages/cli/src/backlog-import.ts`.
 */
import { join } from 'node:path';
import { z } from 'zod';
import { startBacklogImport } from '../../../../packages/cli/src/backlog-import.ts';
import { readProjects } from '../../../../packages/cli/src/projects.ts';
import { openDb } from '../../../../packages/cli/src/storage.ts';
import { body, dataDir, refused, runsDir } from '../../flows/local.ts';

const Input = z.strictObject({ content: z.string().optional(), path: z.string().optional() });

export async function POST(request: Request) {
  const no = refused(request);
  if (no) return no;
  const projectId = new URL(request.url).searchParams.get('project');
  const project = projectId ? readProjects(dataDir()).find((p) => p.id === projectId) : undefined;
  if (!project) return Response.json({ error: `project not found: ${projectId ?? '(none)'}` }, { status: 404 });
  const input = Input.safeParse(await body(request));
  if (!input.success) return Response.json({ error: 'send { content } or { path }' }, { status: 400 });

  const r = await startBacklogImport(openDb(join(dataDir(), 'lamproom.db')), dataDir(), runsDir(), project, input.data);
  return r.ok ? Response.json({ importId: r.importId }) : Response.json({ error: r.error }, { status: r.status });
}
