# Model Classes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flow steps and the internal steps ask for a capability class (`deep`, `standard`, `fast`). An app-wide profile table turns each class into a model and an effort level for each agent CLI, built from the models and levels each CLI reports.

**Architecture:**
- The `AgentProvider` port gains `listModels()`. The Claude adapter reads `supportedModels()` and the OpenCode adapter reads its server's `config.providers()` variants.
- The CLI layer saves each list in the data folder: at app start, hourly from the settings page, and never at run start.
- `settings.ts` holds the profile table and its checks. `flow-config.ts` resolves a step's class through the `ModelRules` seam it already receives, and the resolved class and profile are pinned in the run's `flow.json`.

**Tech Stack:**
- TypeScript, run directly by Node 24, with `node:test` and zod 4;
- `@anthropic-ai/claude-agent-sdk` 0.3.302 and `@opencode-ai/sdk` 1.19.3;
- Next.js 16 (read `node_modules/next/dist/docs/` before app code), shadcn/ui, TanStack Query and Form, `lucide-react`.

**Spec:** `docs/Lamproom/Agent Providers/Model Catalogue.md`. Read it in full first. Mockup: `docs/mockups/model-classes-map.html`.

## Global Constraints

- **Branch:** work on `feature/model-classes`, cut from `dev`, in the worktree `.claude/worktrees/model-classes`. Never commit on `dev`, and never merge or push without Alex's say-so. Run `git log origin/dev..dev` just before any push.
- **Files never to commit:** `docs/Lamproom/Software Factory Gap Analysis.md` and `docs/Lamproom/Architecture Review 2026-11-17.md`. They live only in the `dev` checkout. Don't copy them.
- **Live tests:** `pnpm test:live` calls real providers: OpenRouter costs money and Claude uses Alex's subscription login. Don't run it unless Alex asks. Task 1 runs one small, free script instead.
- **Names:** say Lamproom, never FlowBoard. Use icons from `lucide-react` only. Build UI from shadcn/ui components in `components/ui/`, and add a missing one with `pnpm dlx shadcn@latest add <name>`.
- **Vocabulary:**
  - Classes: `deep`, `standard`, `fast`.
  - Profiles: `quality`, `balanced`, `budget`.
  - Effort levels, in order: `low < medium < high < xhigh < max`. `none` and `minimal` are not efforts: drop them.
- **Effort is required** in a cell whose model has levels. Null is allowed only when the model's `efforts` is `[]`.
- **An unknown list means no check.** When a CLI's saved list doesn't exist yet (fresh machine, CLI never listed), skip the list-based model and effort checks for that CLI. This is the same rule the Ollama window check uses.
- **Checks commands** (repo root): `pnpm test:packages`, `pnpm typecheck:packages`, `pnpm test:app`, `pnpm lint`. All four must pass at the end of every task.

## Review Focus

1. **An old `settings.json`.** A file with `internal.*.model` or `agents.*.model` must keep every other setting. Today any schema failure drops the whole file (`app-settings.ts:20`). Task 4 tests this.
2. **The model changed under a saved cell.** A saved effort that the model no longer lists refuses the run, with a message naming the model and the levels it takes. Task 5 tests this.
3. **A fresh machine with no saved lists.** Saving the default table must work, and runs must resolve. Tasks 4 and 5 each test it.
4. **The CLI isn't installed or isn't signed in at app start, or Ollama isn't running.** The old file stays, one line is logged, and the start isn't delayed. Task 3 tests this.
5. **A pinned run after the profile changes.** The run page and a resumed run show the class, profile and model the run started with, not today's table. Task 5 tests this.

---

### Task 0: Worktree and the design docs

The spec, the mockup and this plan are uncommitted in the `dev` checkout (`/Users/alex/projects/personal/flowboard/flowboard_v3`), so a new worktree doesn't have them.

- [ ] **Step 1:** Create the worktree and branch from the `dev` checkout:
  `git worktree add .claude/worktrees/model-classes -b feature/model-classes dev`, then `cd .claude/worktrees/model-classes && pnpm install`.
- [ ] **Step 2:** Copy these files from the `dev` checkout into the worktree at the same paths, and nothing else:
  - `docs/Lamproom/Agent Providers/Model Catalogue.md`
  - `docs/Lamproom/Agent Providers/Agent Providers Index.md`
  - `docs/mockups/model-classes-map.html`
  - `docs/mockups/model-classes.html`
  - `docs/mockups/README.md`
  - `docs/superpowers/plans/2026-11-27-model-classes.md`
- [ ] **Step 3:** Check that `git status` shows only those six files, then commit:
  `git commit -m "docs(models): model classes design, mockup and plan"`.
- [ ] **Step 4:** Run `pnpm test:packages && pnpm typecheck:packages`. Expected: PASS. This is the baseline.

---

### Task 1: Live check of Claude's `supportedModels()`

**Files:**
- Create: a throwaway script outside the repo. Nothing is committed except the note's edit.
- Modify: `docs/Lamproom/Agent Providers/Model Catalogue.md`, section "Claude Code: `Query.supportedModels()`".

- [ ] **Step 1:** Write a throwaway script outside the repo that:
  - calls `query({ prompt: neverYields(), options: { pathToClaudeCodeExecutable: 'claude' } })`, where `neverYields` is an async generator that awaits a promise that never settles;
  - prints `JSON.stringify(await q.supportedModels(), null, 2)`;
  - then calls `q.close()`.

  It sends no prompt, so it costs no tokens.
- [ ] **Step 2:** Run it with `node <script>.ts`. Expected: a JSON array of `ModelInfo` rows.
- [ ] **Step 3:** In the note, add a table of the rows: `value`, `resolvedModel`, `supportsEffort`, `supportedEffortLevels`. Answer in one line each:
  - Is `default` a row?
  - Is `resolvedModel` filled in for aliases?
  - What does `supportedEffortLevels` hold when it's absent?
  - Does `supportsEffort: true` ever come with no levels?

  Task 2 maps a missing `supportedEffortLevels` to `[]`. Change that rule there if the output shows otherwise.
- [ ] **Step 4:** Commit: `git commit -am "docs(models): record Claude's supportedModels() output"`.

---

### Task 2: Port and adapters: `listModels()`

**Files:**
- Modify: `packages/core/src/ports/agent-provider.ts`, around `:30` (`Effort`) and `:220` (the port).
- Modify: `packages/adapters/src/agent/claude/provider.ts`.
- Modify: `packages/adapters/src/agent/opencode/options.ts` and `provider.ts`, lines 166-168.
- Modify: `packages/adapters/src/agent/replay/replay-provider.ts`.
- Test:
  - `packages/core/test/` (wherever the port's helpers are tested; create `effort.test.ts` if none);
  - `packages/adapters/test/claude-provider.test.ts`;
  - `packages/adapters/test/opencode-options.test.ts`;
  - `packages/adapters/test/replay.test.ts`.

**Interfaces:**
- Produces, in core and exported from the package index:

  ```ts
  export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
  /** Names that are Effort values, deduplicated, in EFFORTS order; anything else ('none', 'minimal') dropped. */
  export function effortsFrom(names: Iterable<string>): Effort[];
  export interface ProviderModel { id: string; name: string; resolvesTo?: string; efforts: Effort[] }
  // on AgentProvider:
  /** The models this CLI can run on this machine, with the efforts each takes. Starts the CLI; sends no prompt. */
  listModels(): Promise<ProviderModel[]>;
  ```

- Produces, in the adapters:
  - Claude: `export type ListQueryFn = (p: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Pick<Query, 'supportedModels' | 'close'>`, and the constructor option `listQuery?: ListQueryFn`, which defaults to the SDK's `query`.
  - OpenCode `options.ts`:
    - `export function variantsOf(providers: Provider[], providerID: string, modelID: string): string[]`
    - `export function modelsFromProviders(providers: Provider[]): ProviderModel[]`
  - Replay: `ReplayScript` gains `models?: ProviderModel[]`.

- [ ] **Step 1: Failing tests:**
  - `effortsFrom(['max', 'none', 'low', 'high', 'low'])` deep-equals `['low', 'high', 'max']`.
  - **Claude:** a fake `listQuery` returns these rows:
    - `{ value:'opus', displayName:'Opus', resolvedModel:'claude-opus-5-5', supportsEffort:true, supportedEffortLevels:['max','low','medium','high','xhigh'] }`
    - `{ value:'haiku', displayName:'Haiku', supportsEffort:false }`

    `listModels()` deep-equals `[{ id:'opus', name:'Opus', resolvesTo:'claude-opus-5-5', efforts:['low','medium','high','xhigh','max'] }, { id:'haiku', name:'Haiku', efforts:[] }]`. The fake's `close` was called once, including when `supportedModels` rejects (a second test).
  - **OpenCode:** `modelsFromProviders` on two providers:
    - `openrouter` with `deepseek/deepseek-v4.1-flash` (variants `none, low, high, max`) and `qwen/qwen3-coder` (no variants);
    - `ollama` with `qwen3-coder:30b`.

    It gives the ids `openrouter/deepseek/deepseek-v4.1-flash`, `openrouter/qwen/qwen3-coder` and `ollama/qwen3-coder:30b`, with efforts `['low','high','max']`, `[]` and `[]`.
  - **Replay:** `new ReplayProvider({ ..., models: [m] }).listModels()` resolves to `[m]`, and to `[]` without `models`.
- [ ] **Step 2:** Run `pnpm test:packages`. Expected: these tests FAIL.
- [ ] **Step 3: Implement.**
  - **Claude:** `listModels` passes the options `{ pathToClaudeCodeExecutable: this.claudePath, env: this.env }`, awaits `supportedModels()`, and calls `close()` in a `finally`.
    - `resolvesTo` is set only when `resolvedModel` differs from `value`.
    - `efforts` is `[]` when `supportsEffort === false`, and otherwise `effortsFrom(supportedEffortLevels ?? [])`.
  - **OpenCode:**
    - `launch` uses `variantsOf` instead of its inline lookup.
    - `listModels` makes a `mkdtemp` config home and a random password, then calls `startServer(hostExecHost, { opencodePath, cwd: configHome, env: { ...this.env, XDG_CONFIG_HOME: configHome, OPENCODE_SERVER_PASSWORD: password }, killGraceMs })`.
    - It then calls `config.providers()` with the same Basic auth as `launch` and returns `modelsFromProviders`.
    - It stops the server and removes the config home in a `finally`, as `launch`'s cleanup does.
- [ ] **Step 4:** Make `settings.ts`'s `EFFORTS` re-export core's instead of keeping its own list. Run `pnpm test:packages && pnpm typecheck:packages`. Expected: PASS. Every `AgentProvider` implementation compiles.
- [ ] **Step 5:** Commit: `feat(agents): providers list their models and effort levels`.

---

### Task 3: Saved lists, app-start listing and the route

**Files:**
- Create: `packages/cli/src/agent-models.ts`.
- Create: `app/api/agents/models/route.ts`.
- Modify: `instrumentation.ts` (`register()`).
- Test: `packages/cli/test/agent-models.test.ts`.

**Interfaces:**
- Consumes: `ProviderModel` and `listModels()` (Task 2); `CATALOGUE_MAX_AGE_MS` (`openrouter.ts`); `writeJsonFile`/`isFile` (`config.ts`); `harnessStatus` (`harnesses.ts`); `readAppSettings`; `readOllamaList`.
- Produces:

  ```ts
  export interface AgentModels { fetchedAt: string; models: ProviderModel[] }
  export type ListFn = (cli: Harness, path: string | null) => Promise<ProviderModel[]>; // default: provider from agents[cli].path
  export function readAgentModels(dataDir: string, cli: Harness): AgentModels | null;   // <data>/agent-models/<cli>.json
  export async function refreshAgentModels(dataDir: string, cli: Harness, maxAgeMs = CATALOGUE_MAX_AGE_MS, list: ListFn = defaultList, now = new Date()): Promise<{ list: AgentModels | null; error?: string }>;
  /** What a settings cell may hold: the saved list; for OpenCode also Ollama's saved models (efforts []) and only approved ids. null: never listed. */
  export function offeredModels(dataDir: string, cli: Harness): ProviderModel[] | null;
  /**
   * App start: every installed CLI, listed now, one at a time; then Ollama (`refreshOllama`) when an approved model is local.
   * Errors logged, never thrown.
   */
  export async function listAllAgentModels(dataDir: string, list?: ListFn, log?: (line: string) => void, fetchFn: typeof fetch = fetch): Promise<void>;
  ```

- [ ] **Step 1: Failing tests:**
  - A refresh writes the file. A second refresh within the hour doesn't call `list`, and `maxAgeMs = 0` does.
  - A `list` that throws keeps the old file and returns `error: "could not list claude-code's models: <message>"`.
  - `offeredModels(dir, 'opencode')`, with saved models `a/x` and `b/y`, `a/x` approved, and Ollama's saved list `ollama/q` approved, gives `[a/x, ollama/q]` with `ollama/q`'s efforts `[]`.
  - `offeredModels` is `null` when nothing was ever saved.
  - `listAllAgentModels` with a `list` that throws for `opencode` still saves `claude-code` and logs one line naming `opencode`.
  - **Ollama, approved local model:** with `ollama/q` approved and a fake `fetchFn` answering Ollama's `/api/version`, `/api/tags`, `/api/show` and `/api/ps`, `listAllAgentModels` writes Ollama's saved list (`readOllamaList` returns it).
  - **Ollama, nothing local approved:** `fetchFn` is never called for Ollama.
  - **Ollama down:** a `fetchFn` that rejects for Ollama keeps the old saved list and logs `refreshOllama`'s error line.
- [ ] **Step 2:** Run `pnpm test:packages`. Expected: FAIL.
- [ ] **Step 3: Implement** to the signatures above.
  - `defaultList` builds `new ClaudeCodeProvider({ claudePath })` or `new OpencodeProvider({ models: {}, opencodePath })`. Call `applySavedKey(dataDir)` before an OpenCode list so OpenRouter's models appear.
  - `listAllAgentModels` skips a CLI that `harnessStatus` reports as not installed.
  - After the CLIs, it calls `refreshOllama(dataDir, process.env, fetchFn)` only when `readAppSettings(dataDir).opencodeModels` has an `isLocal` id, the same gate as `prepareRun`. It logs the result's `error` if one is set.
  - In `register()`, add `void listAllAgentModels(dataDir())` after `startEscalation`. Don't await it.
  - The route: `GET ?cli=<claude-code|opencode>[&refresh=1]`.
    - It returns `400 { error: 'cli must be claude-code or opencode' }` for anything else.
    - Otherwise it returns `{ fetchedAt, models, error? }` from `refreshAgentModels` (`maxAgeMs` is 0 when `refresh=1`).
    - Use `connection()` and `refused(request)` as `app/api/agents/route.ts` does.
- [ ] **Step 4:** Run `pnpm test:packages && pnpm typecheck:packages && pnpm lint`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(agents): save each CLI's model list at app start and on request`.

---

### Task 4: App settings: the profile table, internal steps on classes, old files

**Files:**
- Modify: `packages/cli/src/settings.ts`:
  - types near `:30-40`;
  - `InternalStepConfig` at `:115`;
  - `APP_DEFAULTS` at `:180`;
  - schemas at `:239-264`.
- Modify: `packages/cli/src/app-settings.ts`:
  - `readAppSettings`;
  - `updateAppSettings`, replacing the model check at `:31`.
- Test: `packages/cli/test/settings.test.ts` and `packages/cli/test/app-settings.test.ts` (create it if missing).

**Interfaces:**
- Produces, in `settings.ts`:

  ```ts
  export const CLASSES = ['deep', 'standard', 'fast'] as const;      export type ModelClass = (typeof CLASSES)[number];
  export const PROFILES = ['quality', 'balanced', 'budget'] as const; export type Profile = (typeof PROFILES)[number];
  export interface ClassCell { model: string; effort: Effort | null }
  export interface ModelClasses { inUse: Profile; profiles: Record<Profile, Record<ModelClass, Record<Harness, ClassCell | null>>> }
  // AppSettings: + modelClasses: ModelClasses;  agents: Record<Harness, { path: string | null }>  (model, effort removed)
  // InternalStepConfig becomes { adapter: Harness; class: ModelClass; budgetUsd: number }
  /** Why a cell can't be saved, or undefined. offered null: the CLI was never listed, so only the shape is checked. */
  export function cellProblem(cli: Harness, cell: ClassCell, offered: ProviderModel[] | null): string | undefined;
  ```

- Defaults. Every OpenCode cell is null, because nothing is approved on a fresh install. Claude cells:

  | | quality | balanced (in use) | budget |
  |---|---|---|---|
  | deep | opus · xhigh | opus · high | sonnet · high |
  | standard | opus · high | sonnet · high | sonnet · medium |
  | fast | sonnet · medium | haiku · medium | haiku · low |

  Internal steps: `repo-analyst` is `{ adapter: 'claude-code', class: 'standard', budgetUsd: 0.5 }` and `backlog-importer` is `{ adapter: 'claude-code', class: 'fast', budgetUsd: 0.25 }`. Under `balanced` these give sonnet · high and haiku · medium, the same as today.

- `cellProblem` messages, exactly:
  - not offered: `` `${model} is not a ${cli} model on this machine` ``
  - OpenCode, not approved: the existing `` `${model} is not an approved model; approve it in ${MODELS_PAGE}` ``
  - effort missing: `` `${model} needs an effort level: ${efforts.join(', ')}` ``
  - effort not listed: `` `${model} has no ${effort} effort; it takes ${efforts.join(', ') || 'none'}` ``

- [ ] **Step 1: Failing tests:**
  - `cellProblem('claude-code', { model:'opus', effort:null }, [opus with five levels])` gives `'opus needs an effort level: low, medium, high, xhigh, max'`.
  - The `medium` case on DeepSeek flash (efforts `low, high, max`) gives the "has no medium effort" message.
  - `{ model:'ollama/q', effort:null }` with efforts `[]` gives undefined.
  - Any cell with `offered = null` gives undefined.
  - `APP_DEFAULTS` passes `AppSettingsSchema`.
  - `updateAppSettings` with an empty data folder saves the default `modelClasses` (unknown list means no check).
  - `readAppSettings` on this old file keeps `trust: 'careful'` and `agents.opencode.path`, and gives the default `internal`:

    ```json
    { "trust": "careful", "agents": { "claude-code": { "path": null, "model": "opus", "effort": "high" }, "opencode": { "path": "/x/opencode", "model": null, "effort": null } }, "internal": { "repo-analyst": { "adapter": "claude-code", "model": "sonnet", "effort": null, "budgetUsd": 0.5 } } }
    ```
- [ ] **Step 2:** Run `pnpm test:packages`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `readAppSettings` passes the raw JSON through `upgradeOld(raw: Record<string, unknown>): Record<string, unknown>` (not exported) before parsing. It:
    - reduces each `agents[cli]` to `{ path }`;
    - drops each `internal` entry that has a `model` key.

    The per-key spread then fills in the defaults.
  - `updateAppSettings` runs `cellProblem` on each non-null cell of `modelClasses` with `offeredModels(dataDir, cli)`. It returns `400` with `` `${profile} › ${class} › ${cli}: ${problem}` `` for the first problem.
- [ ] **Step 4:** Run `pnpm test:packages && pnpm typecheck:packages`. Expected: PASS.

  The typecheck will flag everything that read `agents[cli].model`, `.effort` or `internal[*].model`: `internal-steps.ts`, `app/settings/agents/page.tsx`, `app/settings/internal.tsx` and `doctor-needs.ts`.
  - Make the minimum fix in each: drop the fields.
  - `internalFlowText` writes `defaults: { adapter, class }`. Update `internal-steps.test.ts` to expect that.
  - The internal page gets a temporary class `Select`; Task 6 finishes it.
- [ ] **Step 5:** Commit: `feat(settings): model classes table; internal steps pick a class`.

---

### Task 5: Resolution in flows, refusals and what a run pins

**Files:**
- Modify: `packages/cli/src/config.ts`, the `ModelRules` interface at `:41`.
- Modify: `packages/cli/src/models.ts`, `modelRules()`.
- Modify: `packages/cli/src/flow-config.ts`:
  - `Launch` and `StepSchema` at `:56`;
  - `AiStep` at `:24`;
  - the merge at `:217`.
- Modify: `packages/cli/src/flow-logs.ts:199` and `packages/cli/src/flow-run.ts:1001`.
- Modify: `flows/delivery.yaml`, `flows/review-loop.yaml`.
- Test: `packages/cli/test/flow-config.test.ts`, `packages/cli/test/flow-logs.test.ts` (or wherever `readRun` is tested).

**Interfaces:**
- Consumes: `ModelClasses`, `cellProblem` (Task 4); `offeredModels` (Task 3).
- Produces:

  ```ts
  // ModelRules gains (optional, so tests that pass none are unchanged):
  resolveClass?(cls: ModelClass, cli: Harness): { model: string; effort?: Effort; profile: Profile } | { error: string };
  /** The levels `model` takes on `cli`; undefined when the list is unknown or the model is not in it. */
  efforts?(cli: Harness, model: string): Effort[] | undefined;
  // AiStep gains:
  resolved?: { class: ModelClass; profile: Profile };
  ```

- **Rules.**
  - **Which applies:** a step's own `model:` or `class:` beats either in `defaults`.
  - **Both at once:** `model` and `class` on the same level is an error, `` `${at}: set class or model, not both` ``.
  - **Neither:** a step with neither (on the step or in defaults) gets `standard`, but only when `models?.resolveClass` exists. Without it, today's "model required" error stands.
  - **Effort:** a step's own `effort:` beats the cell's.
  - **Refusals, as errors in `--check` and before launch:**
    - an empty cell: `` `${at}.class: no ${cli} model for ${class} in ${profile}` ``, with the profile in use named;
    - an effort the model doesn't list: `` `${at}.effort: ${model} has no ${effort} effort; it takes …` ``, using `cellProblem`'s wording. This holds for direct models too, whenever `efforts()` knows the model.
  - **Warning:** a step that names `model:` directly gets `` `${at}.model: names a model directly; class: lets the profile in use pick it` ``.
- **Library flows.** `delivery.yaml` and `review-loop.yaml` use `class: standard` in `defaults` instead of `model: sonnet`.
  - The OpenCode step in `delivery.yaml` and `opencode-trial.yaml` keep their explicit DeepSeek model, and get the warning. No OpenCode cell is set by default, so a class would be refused there.
  - Fix any test that expects these flows to have no warnings.

- [ ] **Step 1: Failing tests (`flow-config.test.ts`)**, with fake `ModelRules` whose table is `balanced: standard → claude-code sonnet · high; deep → opencode null`:
  - A step with `adapter: claude-code` and no model resolves to `spec.model === 'sonnet'`, `spec.effort === 'high'` and `resolved` `{ class:'standard', profile:'balanced' }`.
  - `class: deep` with `adapter: opencode` fails with `steps.x.class: no opencode model for deep in balanced`.
  - Step `effort: low` beats the cell's `high`.
  - `class` and `model` on one step: the "set class or model, not both" error.
  - Step `model:` with `defaults.class`: the model is used, with the "names a model directly" warning.
  - `efforts('claude-code','sonnet')` returns `['low','high']` and the step sets `effort: max`: error.
  - The same flow with no `ModelRules` and no model: today's error.
  - In the `readRun` test, a pinned `flow.json` whose AI step has `resolved` shows `class` and `profile` on its `StepView`, whatever the current settings say.
- [ ] **Step 2:** Run `pnpm test:packages`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `modelRules()` builds `resolveClass` from `readAppSettings(dataDir).modelClasses`. A cell that fails `cellProblem` against `offeredModels` returns `{ error }` with that message.
  - `efforts` reads `offeredModels`.
  - `Launch` in `flow-config.ts` gets `.extend({ class: z.enum(CLASSES).optional() })`. Strip `class` out before `configFromObject`, since `RunSchema` stays as it is and `lr-run-agent` keeps `model:`.
  - `StepView` gains `class?` and `profile?`.
  - The step-start line in `flow-run.ts:1001` reads `` `${adapter} ${model} (${class} in ${profile})` `` when `resolved` is set.
- [ ] **Step 4:** Run `pnpm test:packages && pnpm typecheck:packages`, then `pnpm lr-run-flow --check flows/delivery.yaml`. Expected: PASS, with only the OpenCode step's "names a model directly" warning.
- [ ] **Step 5:** Commit: `feat(flows): steps ask for a class; the profile in use picks the model`.

---

### Task 6: The pages

**Files:**
- Create: `app/settings/agents/classes/page.tsx` and `app/settings/classes.tsx`, following `internal.tsx` and its `page.tsx`.
- Modify:
  - `app/settings/nav.tsx`: add "Model classes" under Agents, after "OpenCode models";
  - `app/settings/internal.tsx`: the class picker;
  - `app/settings/agents/page.tsx`: drop the model and effort fields if any remain after Task 4;
  - `app/projects/api.ts`: query helpers for `/api/agents/models`.
- Test: an `app/**/*.test.ts` for any pure helper you extract, for example the "cleared effort" rule. The behaviour is checked in the browser in Step 3.

**Interfaces:**
- Consumes: `GET /api/agents/models?cli=` (Task 3); `CLASSES`, `PROFILES`, `cellProblem`, `ModelClasses` (Task 4); `updateAppSettings({ modelClasses })`.

**What the page does**, the same as `docs/mockups/model-classes-map.html`:
- **Layout:**
  - Agent CLI tabs above the table. Each tab carries a red "N not set" count of cells with no model, or with no effort where the model has levels.
  - Classes are rows and profiles are columns. The column in use is solid; clicking a profile's name makes it the one in use.
  - Each cell shows the model name (with "→ Opus 5.5" when `resolvesTo` is set) and an effort meter with one block per level of that model.
- **Editing a cell:**
  - Clicking a cell opens an editor with a Model `Select` (from `offeredModels`, via the route) and an Effort `Select` listing only the model's levels. There is no "model default" entry, and the Effort field is disabled when the model has none.
  - Changing the model keeps the effort if the new model lists it, and clears it otherwise.
  - Claude's `default` row may be picked, labelled with what it resolves to.
- **Saving:** a save bar appears for unsaved edits. Save is disabled while any cell is missing an effort. Use TanStack Form for the table state and Query for the lists and the save.
- **Refresh:** the page loads the list through the route, which refreshes when it's more than an hour old. Add a refresh button (Lucide `RefreshCw`) that passes `refresh=1`.
- **Internal steps:** the model and effort pickers become one Class `Select`. Beside it, show what the class gives under the profile in use, for example `fast → haiku · medium`, or the red refusal when the cell is empty.

- [ ] **Step 1:** Build the pages to the description above.
- [ ] **Step 2:** Run `pnpm test:app && pnpm lint && pnpm typecheck:packages`. Expected: PASS.
- [ ] **Step 3:** Run `pnpm dev` and open `/settings/agents/classes`. Check the following and record what you saw in the task report:
  - Set an OpenCode cell to a model without `medium` while its effort is `medium`. The effort clears and Save is disabled.
  - Pick a level. Save works, and reloading keeps the change.
  - `/settings/internal` shows the resolution line.
- [ ] **Step 4:** Commit: `feat(app): model classes settings page; internal steps pick a class`.

---

### Task 7: Docs and the live tests

**Files:**
- Modify:
  - `packages/adapters/test/claude-live.test.ts` and `opencode-live.test.ts`: one `listModels()` case each, gated by `LAMPROOM_LIVE` like the rest;
  - `docs/Lamproom/Agent Providers/Model Catalogue.md`: change the callout to "Built" with the branch, and note any departure from the design;
  - `docs/Lamproom/Agent Providers/Agent Providers Open Questions.md`: mark #12 as half answered (class and profile recorded) and #29 as closed (the run refuses an unlisted effort before launch);
  - `docs/Lamproom/Deferred Work.md`: add anything left unfixed.
- Modify: user docs that mention a step's `model:` in flow files. Find them with `grep -rn "model:" docs/Lamproom --include="*.md"`. Show `class:` as the usual way and `model:` as the direct override.

- [ ] **Step 1:** Write the two live cases. Each asserts that the list is non-empty and that every `efforts` is in `EFFORTS` order. **Don't run them.** Tell Alex they're ready; `pnpm test:live` runs only when Alex asks.
- [ ] **Step 2:** Make the doc edits.
- [ ] **Step 3:** Run all four checks. Expected: PASS.
- [ ] **Step 4:** Commit: `docs(models): model classes built`. Then stop and report to Alex:
  - the branch, and `git log --oneline dev..feature/model-classes`;
  - the browser checks;
  - every departure from this plan.

  Don't merge into `dev` or push without Alex's go-ahead.
