/** The app's settings file: `settings.json` in Lamproom's data folder. The model is `settings.ts`. */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { offeredModels } from './agent-models.ts'; // a cycle (it reads settings from here); both only call each other at run time
import { isFile, writeJsonFile } from './config.ts';
import type { Result } from './projects.ts';
import { APP_DEFAULTS, type AppSettings, AppSettingsSchema, CLASSES, cellProblem, type Harness, PROFILES } from './settings.ts';

const fileOf = (dataDir: string) => join(dataDir, 'settings.json');

/** Lamproom's data folder for the CLIs: `LAMPROOM_DATA_DIR`, else `data/` in the app's folder, as the app has it. */
export const defaultDataDir = () =>
  process.env.LAMPROOM_DATA_DIR ? resolve(process.env.LAMPROOM_DATA_DIR) : resolve(dirname(fileURLToPath(import.meta.url)), '../../../data');

/**
 * A file from before model classes, made to fit: each agent keeps only its `path`, and an `internal` entry that still
 * names a model is replaced by its step's default. Without this the whole file would fail the schema and reset.
 */
function upgradeOld(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw; // the schema refuses it: the defaults
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
  const out: Record<string, unknown> = { ...raw };
  if ('agents' in raw) out.agents = Object.fromEntries(Object.entries(APP_DEFAULTS.agents).map(([cli, d]) => [cli, 'path' in obj(obj(raw.agents)[cli]) ? { path: obj(obj(raw.agents)[cli]).path } : d]));
  if ('internal' in raw) out.internal = Object.fromEntries(Object.entries(APP_DEFAULTS.internal).map(([id, d]) => [id, id in obj(raw.internal) && !('model' in obj(obj(raw.internal)[id])) ? obj(raw.internal)[id] : d]));
  return out;
}

/** The app's settings: the defaults, with what `settings.json` sets over them. */
export function readAppSettings(dataDir: string): AppSettings {
  const file = fileOf(dataDir);
  if (!isFile(file)) return APP_DEFAULTS;
  // ponytail: a file that does not pass is ignored, as only this module writes it; say so on /settings if hand edits appear
  const r = AppSettingsSchema.partial().safeParse(upgradeOld(JSON.parse(readFileSync(file, 'utf8'))));
  return r.success ? { ...APP_DEFAULTS, ...r.data } : APP_DEFAULTS;
}

/** Sets the keys given; a key holding an object is replaced whole. 400 with the first rule broken. */
export function updateAppSettings(dataDir: string, edit: Partial<AppSettings>): Result<AppSettings> {
  const r = AppSettingsSchema.partial().safeParse(edit);
  if (!r.success) return { ok: false, status: 400, error: r.error.issues[0].message };
  const next = { ...readAppSettings(dataDir), ...r.data };
  // Each cell set here must be a model its CLI lists (OpenCode: an approved one); a stale cell saved earlier is left alone.
  const mc = r.data.modelClasses;
  const offered = new Map<Harness, ReturnType<typeof offeredModels>>();
  for (const profile of mc ? PROFILES : [])
    for (const cls of CLASSES)
      for (const cli of Object.keys(mc!.profiles[profile][cls]) as Harness[]) {
        const cell = mc!.profiles[profile][cls][cli];
        if (!cell) continue;
        if (!offered.has(cli)) offered.set(cli, offeredModels(dataDir, cli));
        const problem = cellProblem(cli, cell, offered.get(cli)!, next.opencodeModels.map((a) => a.id));
        if (problem) return { ok: false, status: 400, error: `${profile} › ${cls} › ${cli}: ${problem}` };
      }
  writeJsonFile(fileOf(dataDir), next);
  return { ok: true, value: next };
}

