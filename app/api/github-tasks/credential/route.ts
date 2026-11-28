/**
 * PUT    /api/github-tasks/credential  — save or replace the GitHub PAT
 * DELETE /api/github-tasks/credential  — forget the stored PAT (keeps defaultRepo)
 *
 * The PAT lives in `github-tasks.json` with mode 0600. The status route
 * (`/api/github-tasks/status`) exposes only a boolean `connected` flag.
 */

import { z } from 'zod';
import {
  clearGithubTasksCredential,
  githubTasksStatus,
  readGithubTasks,
  writeGithubTasks,
} from '../../../../packages/cli/src/github-tasks.ts';
import { body, dataDir, refused } from '../../flows/local.ts';

const Input = z.object({
  pat: z.string().trim().min(1, 'pat is required'),
  defaultRepo: z
    .object({ owner: z.string().trim().min(1), repo: z.string().trim().min(1) })
    .optional(),
});

export async function PUT(request: Request) {
  const no = refused(request);
  if (no) return no;
  const parsed = Input.safeParse(await body(request));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join('; ') }, { status: 400 });
  }
  const current = readGithubTasks(dataDir());
  writeGithubTasks(dataDir(), {
    ...current,
    pat: parsed.data.pat,
    ...(parsed.data.defaultRepo !== undefined ? { defaultRepo: parsed.data.defaultRepo } : {}),
  });
  return Response.json(githubTasksStatus(dataDir()));
}

export async function DELETE(request: Request) {
  const no = refused(request);
  if (no) return no;
  clearGithubTasksCredential(dataDir());
  return Response.json(githubTasksStatus(dataDir()));
}
