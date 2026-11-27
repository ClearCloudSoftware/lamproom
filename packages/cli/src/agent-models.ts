/**
 * The models each agent CLI can run, as the CLI lists them (`AgentProvider.listModels`), kept per CLI in the data
 * folder as `agent-models/<cli>.json`, the way OpenRouter's list is (`openrouter.ts`). Lists are made at app start and
 * by the settings page; checks read the saved file and never start a CLI. Spec: docs/Lamproom/Agent Providers/Model Catalogue.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderModel } from '@lamproom/core';
import { ClaudeCodeProvider, OpencodeProvider } from '@lamproom/adapters';
import { readAppSettings } from './app-settings.ts';
import { isFile, writeJsonFile } from './config.ts';
import { harnessStatus } from './harnesses.ts';
import { readOllamaList, refreshOllama } from './ollama.ts';
import { applySavedKey, CATALOGUE_MAX_AGE_MS } from './openrouter.ts';
import { HARNESSES, type Harness, isLocal } from './settings.ts';

export interface AgentModels { fetchedAt: string; models: ProviderModel[] }
/** Lists one CLI's models, run from `path` (null for its name on PATH). */
export type ListFn = (cli: Harness, path: string | null) => Promise<ProviderModel[]>;

/** How long one CLI may take to list: a CLI that hangs (installed, not signed in) must not stall the rest. */
const LIST_TIMEOUT_MS = 60_000;

const fileOf = (dataDir: string, cli: Harness) => join(dataDir, 'agent-models', `${cli}.json`);

/** The list as last saved, or null before the first. */
export function readAgentModels(dataDir: string, cli: Harness): AgentModels | null {
  try {
    const f = fileOf(dataDir, cli);
    const l = isFile(f) ? (JSON.parse(readFileSync(f, 'utf8')) as AgentModels) : undefined;
    return l && Array.isArray(l.models) && typeof l.fetchedAt === 'string' ? l : null;
  } catch {
    return null; // ponytail: a file that does not parse counts as absent; only this module writes it
  }
}

/** Asks the CLI itself. OpenCode first gets the saved OpenRouter key, so its OpenRouter models appear. */
const defaultList = (dataDir: string): ListFn => (cli, path) => {
  if (cli === 'claude-code') return new ClaudeCodeProvider({ ...(path && { claudePath: path }) }).listModels();
  applySavedKey(dataDir);
  return new OpencodeProvider({ models: {}, ...(path && { opencodePath: path }) }).listModels();
};

/**
 * The list, asked of the CLI again when the saved one is older than `maxAgeMs` (0: always). A failed or timed-out
 * list keeps the saved one and says why.
 */
export async function refreshAgentModels(dataDir: string, cli: Harness, maxAgeMs = CATALOGUE_MAX_AGE_MS, list: ListFn = defaultList(dataDir), now = new Date(), timeoutMs = LIST_TIMEOUT_MS): Promise<{ list: AgentModels | null; error?: string }> {
  const saved = readAgentModels(dataDir, cli);
  if (saved && maxAgeMs > 0 && now.getTime() - Date.parse(saved.fetchedAt) < maxAgeMs) return { list: saved };
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error(`no answer in ${timeoutMs / 1000} s`)), timeoutMs); });
    const fresh: AgentModels = { fetchedAt: now.toISOString(), models: await Promise.race([list(cli, readAppSettings(dataDir).agents[cli].path), timeout]) };
    writeJsonFile(fileOf(dataDir, cli), fresh);
    return { list: fresh };
  } catch (e) {
    return { list: saved, error: `could not list ${cli}'s models: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What a settings cell may hold: the saved list; for OpenCode only the approved ids (`opencodeModels`), plus Ollama's
 * saved models that are approved, which take no effort. null: never listed, so nothing to check against.
 */
export function offeredModels(dataDir: string, cli: Harness): ProviderModel[] | null {
  const saved = readAgentModels(dataDir, cli);
  if (!saved || cli !== 'opencode') return saved?.models ?? null;
  const approved = new Set(readAppSettings(dataDir).opencodeModels.map((a) => a.id));
  const local = (readOllamaList(dataDir) ?? []).map((o): ProviderModel => ({ id: o.id, name: o.name, efforts: [] }));
  return [...saved.models, ...local].filter((x) => approved.has(x.id));
}

/**
 * App start: every installed CLI, listed now, one at a time; then Ollama when an approved model is local (the gate
 * `prepareRun` uses). Errors are logged, never thrown.
 */
export async function listAllAgentModels(dataDir: string, list?: ListFn, log: (line: string) => void = console.error, fetchFn: typeof fetch = fetch): Promise<void> {
  try {
    const { agents, opencodeModels } = readAppSettings(dataDir);
    // ponytail: one at a time, and harnessStatus (up to ~2 x 20 s) is outside the 60 s list timeout; it only delays the later CLIs. Run them in parallel if that is felt.
    for (const cli of Object.keys(HARNESSES) as Harness[]) {
      if (!(await harnessStatus(cli, agents[cli].path)).installed) continue;
      const { error } = await refreshAgentModels(dataDir, cli, 0, list);
      if (error) log(error);
    }
    if (opencodeModels.some((m) => isLocal(m.id))) {
      const { error } = await refreshOllama(dataDir, process.env, fetchFn);
      if (error) log(error);
    }
  } catch (e) {
    log(`could not list the agent CLIs' models: ${(e as Error).message}`); // a settings.json that does not parse, say
  }
}
