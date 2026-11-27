---
tags: [lamproom, agent-providers, models, effort, design]
module: Agent Providers
---

# Model Catalogue

Each agent CLI provider reports the models it can run and the effort levels each model accepts. The *Model classes* settings page is built from these lists, and so are the checks on its table. This note is the implementation brief for that part of the model classes story.

> [!info] Design, not built (2026-11-23; decisions 2026-11-27)
> Analysed against `dev` at `f65259f`, `@anthropic-ai/claude-agent-sdk` 0.3.302 and `@opencode-ai/sdk` / `opencode` 1.19.3. Mockup: `docs/mockups/model-classes-map.html`.

## The story this serves

Decided with Alex on 2026-11-23:

- **Flows ask for a capability class**, not a model: `deep`, `standard` or `fast`. A step still names its agent CLI (`adapter:`).
- **A profile** (`quality`, `balanced`, `budget`) is a full table. For each class and each agent CLI it holds one model and one effort level. One profile is *in use*, and it decides what every run gets.
- **The table is app-wide** for now. No project overrides it.
- **The settings page** has one tab per agent CLI above the table. Rows are classes, columns are profiles, and each cell is a model and an effort level.
- **Effort belongs to the model.** Each cell offers only the levels its model takes, so a class never asks for a level that the CLI's model can't give.
- **Effort is required.** There is no "model default" choice: a cell whose model takes effort must name a level. Only a model with no effort control (`efforts: []`) has none. (2026-11-27)
- **Internal steps use classes too**, in this story. The repo analyst and the backlog importer each pick a class instead of a model and an effort. (2026-11-27)

Which models a CLI has, and which levels each model takes, is what this note adds.

## What exists today

| Piece | Where | What it does |
|---|---|---|
| `Effort` | `core/src/ports/agent-provider.ts:30` | `low \| medium \| high \| xhigh \| max`, one list for every provider |
| `Capability 'effort'` | same file | Says a provider can pass effort at all. Says nothing per model. |
| `resolveModel(logical)` | the port, `:220` | Claude returns its input unchanged. OpenCode looks up its constructor `models` table (built empty in `cli/src/run.ts:82`) or passes `provider/model` through. |
| Variant lookup | `opencode/provider.ts:166-168` | **Inside each launch**, reads `client.config.providers()` and keeps the variant names of the run's model. |
| `pickVariant` | `opencode/options.ts:40` | Sends the effort as the variant only on an exact name match. Otherwise **drops it without a message**. |
| Claude effort | `claude/options.ts:45` | Passed to the SDK as is. The CLI clamps or ignores what a model can't take. |
| Model choices in settings | `cli/src/settings.ts` `HARNESSES[*].model`, `MODELS` | Free text checked by a regex (Claude) or the approved list (OpenCode). There is no list of what a CLI actually offers. |
| OpenCode's model lists | `cli/src/openrouter.ts`, `ollama.ts`, `models.ts` | OpenRouter's catalogue and Ollama's list, used for **approval** (money, privacy). They carry no effort information. |

So the port can launch a model, but it can't say which models exist or what effort each takes. The variant names OpenCode reports are read too late, after the run has started, and thrown away.

## What each CLI can report

### Claude Code: `Query.supportedModels()`

The Agent SDK already exposes this (`sdk.d.ts`, `ModelInfo`):

| `ModelInfo` field | Meaning | Used for |
|---|---|---|
| `value` | The id to pass as `model`, an alias like `opus` or a full id | `id` |
| `resolvedModel` | The id the alias resolves to now, e.g. `claude-opus-5-5` | "follows the latest: Opus 5.5 today" |
| `displayName`, `description` | Human labels | `name` |
| `supportsEffort` | Whether the model takes effort at all | `efforts: []` when false |
| `supportedEffortLevels` | Subset of `low…max` | `efforts` |
| `supportsAdaptiveThinking`, `supportsFastMode`, `supportsAutoMode` | Other capabilities | Not needed yet |

- **How to call it.** Start a `query()` whose prompt is an async iterable that never yields, call `supportedModels()`, then end the query. No message is sent, so it costs no tokens. The cost is one CLI start (one to a few seconds).
- **Login and policy.** The list honours the machine's login and any managed `availableModels` / `deniedModels` policy. An enterprise-restricted machine therefore sees only what it may use.
- **No default effort.** `ModelInfo` doesn't say which level a model uses when none is given; Opus 5.5's is `medium`, for example. This doesn't matter, because a cell must name a level (decision 2).
- **Unverified.** The output shape hasn't been checked against a live CLI yet. Task 1 is that check.

### OpenCode: `config.providers()` on a running server

Each `Model` has `variants: { [name]: {...} }`, plus `capabilities.reasoning`, `cost` and `limit.context`. The adapter already calls `config.providers()` in `launch`, so the catalogue uses the same call outside a run.

What OpenCode 1.19.3 reports for its OpenRouter models (`opencode models openrouter --verbose`, 2026-11-23), grouped by variant set:

| Models | Variant names |
|---|---|
| 161 | none |
| 55 | `low medium high` |
| 21 | `low medium high xhigh max` |
| 19 | `none low medium high xhigh max` |
| 13 | `none low high max` |
| 11 | `low medium high xhigh` |
| 9 | `low high max` |
| others | sets that include `minimal`, or only `high max` |

Examples:

| Model | Variants | `reasoning` |
|---|---|---|
| `openrouter/deepseek/deepseek-v4.1-flash` | `none low high max` (**no `medium`**) | true |
| `openrouter/qwen/qwen3-coder` | none | false |
| `openrouter/anthropic/claude-opus-5.5` | `low medium high xhigh max` | true |

What this shows:

- **Mostly the same words.** Variant names are nearly always Lamproom's effort words, so the mapping is by name.
- **Gaps.** A model can skip a level, like `medium` on DeepSeek flash. That makes exact matching necessary, and it's why the settings page offers only listed levels.
- **Extra names.** `none` and `minimal` sit below `low` and are not `Effort` values. They are left out for now (decision 1).
- **Order.** Variant names arrive unordered. Sort them by `low < medium < high < xhigh < max`.
- **Ollama.** Local models come from the per-run Ollama provider config that `ollama.ts` writes, and have no variants unless that config adds them, so their `efforts` is `[]`.

Two ways to get the list:

| Way | Pros | Cons |
|---|---|---|
| **`opencode serve` + `client.config.providers()`** (recommended) | The SDK call `launch` already uses. Sees the same config a run sees, including the Ollama provider Lamproom adds. | One server start per refresh (a few seconds). |
| `opencode models <provider> --verbose` | No server | Output is text: an id line, then JSON. Not a stable API, and it misses the per-run config. |

## The design

### Port

Add one method to `AgentProvider`, and one type beside `Effort`:

```ts
/** One model a provider can run, as the CLI reports it now. */
interface ProviderModel {
  id: string;            // what RunSpec.model takes: 'opus', 'claude-opus-5-5', 'openrouter/qwen/qwen3-coder'
  name: string;          // display name
  resolvesTo?: string;   // an alias's current target ('opus' -> 'claude-opus-5-5'); absent for a pinned id
  efforts: Effort[];     // levels this model takes, low→max order; [] = no effort control
}

/** The models this CLI can run on this machine, with the efforts each takes. Starts the CLI; no tokens spent. */
listModels(): Promise<ProviderModel[]>;
```

- **Claude adapter:** `supportedModels()` as above. `efforts` = `supportedEffortLevels`, or `[]` when `supportsEffort` is false.
- **OpenCode adapter:** start a server (`startServer` with the host `ExecHost`, the same config builder as `launch`), call `config.providers()`, and flatten it to `provider/model` ids. `efforts` = variant names that are `Effort` values, sorted. Then stop the server. Pull the variant lookup at `provider.ts:166-168` into a helper that both `launch` and `listModels` use.
- **Replay provider:** a fixed list, for tests.
- **The `effort` capability flag** keeps its meaning: the provider can pass effort at all. What a given model takes comes from `efforts`.
- **No filtering in the port.** The port reports everything the CLI can run. Approval (OpenCode's money and privacy list) is app policy and stays in `cli/` (see Settings).
- **`resolveModel` doesn't change.** Classes are resolved before the `RunSpec` is built (see Resolution), so `RunSpec.model` stays a native id.

### Storage and refresh

Store the list the same way as OpenRouter's catalogue (`openrouter.ts`): one file per CLI in the data folder, `agent-models/<cli>.json` = `{ fetchedAt, models: ProviderModel[] }`.

- **App start:** list every installed agent CLI's models in the background, from `register()` in `instrumentation.ts` beside the knowledge scheduler (decision 3). This never delays the start. A CLI that isn't installed, isn't signed in, or fails to answer keeps its old file, and the error is logged.
- **Ollama at app start:** after the CLIs, ask Ollama for its list too (`refreshOllama`), but only when an approved OpenCode model is local, the same gate run start uses (`prepareRun`). It never throws and keeps the old list when Ollama doesn't answer. So the settings page and the checks see the local models and their context windows without a run first.
- **Settings page:** refresh when the file is more than an hour old, or now with `?refresh=1`. This catches a CLI upgraded while the app runs.
- **Checks:** read the saved file and never start a CLI, so they stay synchronous, as `modelRules` does today.
- **Run start:** don't refresh. A stale list doesn't break a run (see Run time).
- **Why keep the file.** `lr-run-flow` and the other CLIs run in their own process, without the app's memory. Listing at startup fills the file; it doesn't replace it.

### API

`GET /api/agents/models?cli=<id>[&refresh=1]` returns `{ fetchedAt, models, error? }`. It uses the CLI path from `agents[cli].path`, refuses non-local callers as the other routes do, and on failure falls back to the saved file with an `error`, as `refreshCatalogue` does.

### Settings: what a cell may hold

| CLI | Models a cell offers | Efforts offered |
|---|---|---|
| Claude Code | `listModels()` | That model's `efforts` |
| OpenCode | `listModels()` ∩ the approved list (`opencodeModels`) | That model's `efforts` (for Ollama, none) |

- **Model check:** a cell's model must be in its CLI's saved list (and approved, for OpenCode).
- **Effort check:** if the model's `efforts` isn't empty, the cell's effort must be one of them. Null is allowed only when `efforts` is `[]` (decision 2).
- **An empty cell** (no model) is allowed. It means "this profile has no `<cli>` model for this class", and a run that asks for it is refused.
- **Where the checks run:** the settings schema checks both on save, and the page also checks each field as you edit.
- **On the page:**
  - The effort list has no "model default" entry.
  - Changing a cell's model keeps its effort if the new model lists it, and clears it otherwise.
  - A cleared cell turns red and counts in the tab's "N not set" badge. Save stays disabled until every such cell has a level.

### Resolution

The CLI layer resolves a class to a model before the `RunSpec` is built, in `flow-config.ts` / `config.ts` where `adapter` and `model` are read today:

1. **What the step asks for.**
   - A step with `class:` and no `model:` resolves through the profile in use: `(class, adapter)` gives `{ model, effort }`.
   - `class:` may also sit in the flow's `defaults`, as `model` can today.
   - A step's own `effort:` wins over the cell's, and must also be one the model lists.
   - A step that names neither `class:` nor `model:` gets `standard`.
2. **Checks.**
   - An empty cell refuses the run before launch: "no `<cli>` model for `<class>` in `<profile>`".
   - An effort the model doesn't list refuses the run as well, both in `--check` and before launch. On the settings page that cell turns red (decision 4).
3. **A step's own model.** A step with `model:` keeps today's behaviour: it runs that model, and `--check` warns that the step names a model directly.
4. **What gets recorded.** The run records the class, the profile, the model and the effort. This answers half of [[Agent Providers Open Questions]] #12.

### Run time

`pickVariant`'s exact match stays as the last line of defence. A mismatch should be impossible after the check in step 2, but it can still happen if a model's variants change between the check and the launch. Then the adapter should emit a warning event instead of dropping the effort without a word. Today's silent drop is the gap [[Agent Providers Open Questions]] #29 records.

### Internal steps

The repo analyst and the backlog importer move to classes in this story (decision 5).

| Piece | Today | After |
|---|---|---|
| `InternalStepConfig` (`cli/src/settings.ts:115`) | `{ adapter, model, effort, budgetUsd }` | `{ adapter, class, budgetUsd }` |
| Defaults (`APP_DEFAULTS.internal`) | analyst `sonnet`, importer `haiku` | analyst `standard`, importer `fast` |
| `internalFlowText` (`cli/src/internal-steps.ts:15`) | writes `defaults: { adapter, model, effort? }` | writes `defaults: { adapter, class }`, so the step resolves the way a flow step does (see Resolution) |
| OpenCode approval check (`cli/src/app-settings.ts:31`) | checks `internal[*].model` | that part goes away: the table's own check covers the models |
| `/settings/internal` (`app/settings/internal.tsx`) | model and effort pickers | a class picker, showing what the class gives under the profile in use, e.g. `fast → haiku · low` |

- **Old settings files.** `readAppSettings` drops the *whole* file when it fails the schema (`app-settings.ts:20`). A saved `internal` in the old shape would therefore reset every setting to its default. On read, replace each old-shape `internal` entry with that step's default and keep the rest of the file. Add one test for it.
- **`agents[cli].model` and `.effort`.** No run reads them; only `path` is used (`doctor.ts`). With classes they have no job, so drop them, the settings fields that edit them, and their approval check at `app-settings.ts:31`. Keep `path`. A step that names neither class nor model gets `standard` (Resolution, step 1). Old files need the same read-time fix as `internal`.

## Tasks

1. **Check Claude's list live.** Start a query, call `supportedModels()`, and record the real `ModelInfo` rows in this note. Expect alias rows (`default`, `opus`, `sonnet`, `haiku`), whether `resolvedModel` is filled in, and the effort lists.
2. **Port:** `ProviderModel`, `listModels()`. Implement it in the Claude, OpenCode and replay adapters, with a shared variant helper for OpenCode.
3. **Storage, refresh and the route:** the app-start background listing, the hourly refresh on the page, and `GET /api/agents/models`.
4. **App settings:**
   - the `modelClasses` shape (`inUse`, `profiles[profile][class][cli] = { model, effort } | null`) with the checks above, effort required where the model has levels, and its defaults;
   - drop `agents[cli].model/effort`.
5. **Resolution** in the run and flow config (`class:` on a step and in `defaults`, `standard` when neither is named), the refusals, and the recorded fields.
6. **Internal steps** on classes, as in the table above, including the read-time fix for old settings files.
7. **The pages:** the model classes page as in the mockup, fed from the route, and the class picker on `/settings/internal`.
8. **Tests:**
   - unit tests with a fake `query` (Claude) and a stub server answer (OpenCode);
   - one test reading an old-shape settings file;
   - one `test:live` case per CLI. It is free, since listing sends no prompt, but it needs the login and the installed CLI.

## Decisions

Alex, 2026-11-27:

1. **`none` and `minimal` stay out of `Effort` for now.** Only the five levels are mapped. A model whose only variants are `none` or `minimal` shows as having no effort control (`efforts: []`). `none` turns reasoning off, which might suit `fast` one day; adding it later means:
   - adding it to `Effort` below `low`;
   - mapping Claude's lowest level, since Claude has no `none`.
2. **No "model default" effort.** A model that lists levels needs one picked: the page and the schema both require it. This also removes the need to know each model's default level, which the SDK doesn't report.
3. **List the models at app start**, in the background, and keep the hourly refresh on the settings page (see Storage and refresh).
4. **A saved effort the model no longer lists refuses the run**, in `--check` and before launch, and its cell turns red.
5. **The internal steps move to classes in this story** (see Internal steps). The per-CLI `agents[cli].model/effort` go too, since no run reads them. This is the note's reading of Alex's "move to classes now"; confirm it.

Still open:

- **Claude's `default` row** (the account's recommended model, which changes with the account tier). Proposal: a cell may hold it, labelled with what it resolves to now. Task 1 shows whether `resolvedModel` is filled in for it.
