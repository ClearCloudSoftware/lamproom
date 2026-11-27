/**
 * PATCH /api/projects/<id>/tasks/<source>/<key>   body: { "status": StatusId }
 *
 * Moves one task to a board status. 200 { task }; 400 for a body without a board status;
 * 404 when the project or the task is not there; 409 with the reason when the move breaks a rule.
 */

import { join } from 'node:path';
import { isStatus } from '../../../../../../../packages/core/src/board.ts';
import { moveTask, openDb } from '../../../../../../../packages/cli/src/storage.ts';
import { readProjects } from '../../../../../../../packages/cli/src/projects.ts';
import { dataDir, refused } from '../../../../../flows/local.ts';

type Params = { params: Promise<{ id: string; source: string; key: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const no = refused(request);
  if (no) return no;
  const { id, source, key } = await params; // Next has already URL-decoded these; decoding again would break a key holding a "%"

  if (!readProjects(dataDir()).some((p) => p.id === id)) {
    return Response.json({ error: `project not found: ${id}` }, { status: 404 });
  }

  const body: unknown = await request.json().catch(() => null);
  const status = typeof body === 'object' && body !== null ? (body as { status?: unknown }).status : undefined;
  if (!isStatus(status)) {
    return Response.json({ error: 'status must be one of the board statuses' }, { status: 400 });
  }

  const db = openDb(join(dataDir(), 'lamproom.db'));
  const moved = moveTask(db, id, source, key, status);
  return moved.ok
    ? Response.json({ task: moved.task })
    : Response.json({ error: moved.error }, { status: moved.code });
}
