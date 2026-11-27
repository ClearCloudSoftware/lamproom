import { connection } from 'next/server';
import { refreshAgentModels } from '../../../../packages/cli/src/agent-models.ts';
import { dataDir, refused } from '../../flows/local.ts';

/** `?cli=claude-code|opencode`: the models that CLI lists, from its saved list unless over an hour old or `refresh=1`; a failed list falls back to the saved one with an `error`. */
export async function GET(request: Request) {
  await connection();
  const no = refused(request);
  if (no) return no;
  const q = new URL(request.url).searchParams;
  const cli = q.get('cli');
  if (cli !== 'claude-code' && cli !== 'opencode') return Response.json({ error: 'cli must be claude-code or opencode' }, { status: 400 });
  const { list, error } = await refreshAgentModels(dataDir(), cli, q.get('refresh') === '1' ? 0 : undefined);
  return Response.json({ fetchedAt: list?.fetchedAt ?? null, models: list?.models ?? [], ...(error && { error }) });
}
