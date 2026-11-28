/**
 * PATCH /api/projects/<id>/tasks/<source>/<key>   body: { "status": StatusId }
 *
 * Moves one task to a board status. 200 { task, writeBack? }; 400 for a body
 * without a board status; 404 when the project or the task is not there;
 * 409 with the reason when the move breaks a rule.
 *
 * When the source is Jira and the task has an upstream key (e.g. KAN-5),
 * we also ask the provider to transition the issue. The Lamproom-side
 * move always stands; a failed write-back is reported in `writeBack` on
 * the 200 response so the UI can show a sync-pending badge.
 */

import { join } from 'node:path';
import { isStatus } from '../../../../../../../packages/core/src/board.ts';
import { moveTask, openDb } from '../../../../../../../packages/cli/src/storage.ts';
import { readProjects } from '../../../../../../../packages/cli/src/projects.ts';
import { JiraTaskProvider, McpClient, redactJiraTokens } from '../../../../../../../packages/adapters/src/index.ts';
import {
  buildJiraTransport,
  collectJiraTokens,
  ensureFreshCredential,
  makeRefreshOAuthFn,
  readJiraSettings,
  staticResolver,
} from '../../../../../jira/_lib.ts';
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
  if (!moved.ok) return Response.json({ error: moved.error }, { status: moved.code });

  const writeBack = await attemptWriteBack(source, moved.task, status);
  return Response.json({ task: moved.task, ...(writeBack !== undefined ? { writeBack } : {}) });
}

/**
 * Try to push the status change back to the source. Returns:
 *   - undefined       — no write-back attempted (source isn't jira, or no
 *                       upstream key, or no credentials)
 *   - { ok: true }    — the source accepted the write
 *   - { ok: false, reason } — attempted, source refused (surface on UI)
 */
async function attemptWriteBack(
  source: string,
  task: { extras: Record<string, unknown>; hint: { upstream?: string } },
  status: Parameters<typeof moveTask>[4],
): Promise<{ ok: boolean; reason?: string } | undefined> {
  if (source !== 'jira') return undefined;
  const upstreamRaw = task.extras['issueKey'] ?? task.hint.upstream;
  if (typeof upstreamRaw !== 'string' || upstreamRaw.trim() === '') return undefined;

  const settings = readJiraSettings();
  if (settings.credential === undefined) return undefined;

  try {
    const refreshed = await ensureFreshCredential(settings);
    const cred = refreshed.cred!;
    const mcpClient = new McpClient(buildJiraTransport(cred));
    const provider = new JiraTaskProvider({
      resolver: staticResolver(cred),
      defaultJql: '',
      mcpClient,
      refreshOAuthFn: makeRefreshOAuthFn(refreshed.settings),
    });
    const result = await provider.applyStatus(upstreamRaw, status);
    if (result.ok) return { ok: true };
    const tokens = collectJiraTokens(cred);
    return { ok: false, reason: redactJiraTokens(result.reason, ...tokens) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const tokens = collectJiraTokens(settings.credential);
    return { ok: false, reason: redactJiraTokens(`Jira write-back threw: ${message}`, ...tokens) };
  }
}
