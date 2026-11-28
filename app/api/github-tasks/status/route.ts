/**
 * GET /api/github-tasks/status
 *
 * Returns whether a PAT is saved and what defaultRepo the dialog should
 * prefill. Never returns the token itself.
 */

import { githubTasksStatus } from '../../../../packages/cli/src/github-tasks.ts';
import { dataDir, refused } from '../../flows/local.ts';

export async function GET(request: Request) {
  const no = refused(request);
  if (no) return no;
  return Response.json(githubTasksStatus(dataDir()));
}
