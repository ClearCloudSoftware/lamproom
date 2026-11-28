/**
 * Shared helpers for /api/github-tasks/* and /api/import/github.
 *
 * - `readGithubSettings` — thin wrapper over the storage module so routes
 *   don't need to know the data-dir path.
 * - `staticResolver` — a `SourceCredentialResolver` bound to a stored
 *   credential; used in place of EnvFileCredentialResolver so the PAT lives
 *   in `github-tasks.json` (UI-managed) rather than `.lamproom/credentials.json`.
 * - `tokensOf` — one-token list for error-redaction.
 *
 * The adapter itself still takes any resolver; this file only keeps the
 * route code tight.
 */

import {
  readGithubTasks,
  type GithubTasksCredential,
} from '../../../packages/cli/src/github-tasks.ts';
import { dataDir } from '../flows/local.ts';

export function readGithubSettings() {
  return readGithubTasks(dataDir());
}

export function staticResolver(cred: GithubTasksCredential) {
  return { resolve: async () => cred };
}

export function tokensOf(cred: GithubTasksCredential): Array<string | undefined> {
  return [cred.token];
}
