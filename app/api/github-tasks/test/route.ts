/**
 * POST /api/github-tasks/test
 *
 * Pings `GET https://api.github.com/user` with the stored PAT. Returns
 * `{ ok: true, login }` on success (so the UI can show "connected as X"),
 * or `{ ok: false, error }` with the PAT redacted on failure.
 *
 * Helpful immediately after pasting a new token — operators learn whether
 * the token is live before trying an actual import.
 */

import { redactToken } from '../../../../packages/adapters/src/ticket/github/auth.ts';
import { readGithubTasks } from '../../../../packages/cli/src/github-tasks.ts';
import { dataDir, refused } from '../../flows/local.ts';

export async function POST(request: Request) {
  const no = refused(request);
  if (no) return no;

  const settings = readGithubTasks(dataDir());
  const pat = settings.pat?.trim();
  if (pat === undefined || pat === '') {
    return Response.json({ ok: false, error: 'no PAT saved' }, { status: 400 });
  }

  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      const txt = (await res.text().catch(() => '')).slice(0, 200);
      return Response.json(
        { ok: false, error: redactToken(`github ${res.status}: ${txt}`, pat) },
        { status: 502 },
      );
    }
    const body = (await res.json()) as { login?: string };
    return Response.json({ ok: true, login: body.login ?? 'unknown' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: redactToken(message, pat) }, { status: 502 });
  }
}
