/**
 * GitHub Issues as a task source — settings + credential storage.
 *
 * `github-tasks.json` in the data dir, written with mode 0600. Shape:
 *
 *   {
 *     "pat": "ghp_xxx | github_pat_xxx",
 *     "defaultRepo": { "owner": "octokit", "repo": "octokit.js" }
 *   }
 *
 * Kept separate from `.lamproom/credentials.json` (the EnvFileCredentialResolver's
 * file) and from `jira.json` for the same reason jira.json is separate: the UI
 * manages this file at runtime, no editor and no file-mode dance for the
 * operator. The GithubTaskSource adapter still works with any
 * SourceCredentialResolver; the API route uses a staticResolver that reads
 * from this file.
 *
 * `defaultRepo` is populated from a project's `source.repo` when the project
 * came from GitHub, and can be overridden per import in the dialog.
 *
 * This module is the ONLY place the file is read or written. API routes under
 * app/api/github-tasks/ and app/api/import/github/ call these helpers.
 */

import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { SourceCredentials } from '@lamproom/core';
import { isFile, writeJsonFile } from './config.ts';

/** The credential kinds this module understands. */
export type GithubTasksCredential = Extract<SourceCredentials, { kind: 'github_pat' }>;

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

export interface GithubTasksSettings {
  /** The PAT (classic or fine-grained). Never returned to the UI. */
  pat?: string;
  /** Prefill for the import dialog. */
  defaultRepo?: GithubRepoRef;
}

const fileOf = (dataDir: string) => join(dataDir, 'github-tasks.json');

export function readGithubTasks(dataDir: string): GithubTasksSettings {
  try {
    const path = fileOf(dataDir);
    if (!isFile(path)) return {};
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as GithubTasksSettings;
  } catch {
    return {};
  }
}

export function writeGithubTasks(dataDir: string, settings: GithubTasksSettings): void {
  const clean: GithubTasksSettings = {};
  if (settings.pat !== undefined && settings.pat.trim() !== '') clean.pat = settings.pat.trim();
  if (
    settings.defaultRepo !== undefined &&
    settings.defaultRepo.owner.trim() !== '' &&
    settings.defaultRepo.repo.trim() !== ''
  ) {
    clean.defaultRepo = {
      owner: settings.defaultRepo.owner.trim(),
      repo: settings.defaultRepo.repo.trim(),
    };
  }
  if (Object.keys(clean).length === 0) {
    rmSync(fileOf(dataDir), { force: true });
    return;
  }
  writeJsonFile(fileOf(dataDir), clean, 0o600);
}

export function clearGithubTasksCredential(dataDir: string): void {
  const current = readGithubTasks(dataDir);
  if (current.pat === undefined) return;
  const next: GithubTasksSettings = {};
  if (current.defaultRepo !== undefined) next.defaultRepo = current.defaultRepo;
  writeGithubTasks(dataDir, next);
}

/**
 * Status summary for the UI. Never returns the token itself; shows only the
 * fields the page can safely display.
 */
export interface GithubTasksStatus {
  connected: boolean;
  defaultRepo?: GithubRepoRef;
}

export function githubTasksStatus(dataDir: string): GithubTasksStatus {
  const s = readGithubTasks(dataDir);
  const out: GithubTasksStatus = { connected: s.pat !== undefined && s.pat.trim() !== '' };
  if (s.defaultRepo !== undefined) out.defaultRepo = s.defaultRepo;
  return out;
}

/**
 * Credential extracted from the stored PAT. Thrown if no PAT is saved.
 * The API route uses this to build a SourceCredentialResolver that always
 * returns the operator's PAT.
 */
export function readGithubTasksCredential(dataDir: string): GithubTasksCredential {
  const s = readGithubTasks(dataDir);
  if (s.pat === undefined || s.pat.trim() === '') {
    throw new Error('github-tasks: no PAT configured');
  }
  return { kind: 'github_pat', token: s.pat.trim() };
}
