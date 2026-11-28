---
tags: [lamproom, intake-and-import, handoff, task-provider, write-back]
module: Intake And Import
---

# TaskProvider port + write-back — handoff

Branch `feature/promote-markdown-task-source` on 2026-11-28: six commits
on top of `origin/dev` at `727492b`. Not pushed. Reviewed as one PR.

## What this ships

- **Markdown promoted** out of "coming soon" on
  `/settings/connections/tasks` — the backlog importer + parser have
  been shipping for a while; only the settings row was still greyed out.
- **GitHub Issues** as a first-class task source end-to-end:
  - Storage: `packages/cli/src/github-tasks.ts` (`github-tasks.json`, mode
    0600, UI-managed PAT + optional default owner/repo).
  - API: `GET /api/github-tasks/status`, `PUT|DELETE /api/github-tasks/credential`,
    `POST /api/github-tasks/test`, `POST /api/import/github?project=&owner=&repo=`.
  - UI: `/settings/connections/tasks/github` settings page, Import-from-GitHub
    button on the project overview + kanban board, Settings row with live status.
- **Port rename** `TaskSource` → `TaskProvider` across 32 files. The port
  covers pull, push and (now) write-back; the old name only described the
  read role.
- **One task provider per project** — `project.taskProvider` pins on
  first successful import; buttons for other providers go disabled with
  the reason. Clearing stored tasks for a (project, source) releases the
  pin.
- **Jira write-back** — new `applyStatus(upstreamKey, statusId)` method
  on `TaskProvider` + `write_back_status` capability. Jira implementation
  calls `GET` then `POST /rest/api/3/issue/<key>/transitions` with a
  ranked Lamproom-status → Jira-target-name synonym map. OAuth scope
  grew `write:jira-work` — existing users must re-sign-in.
- **Board topbar imports** — all three import buttons now live on
  `/p/<slug>/tasks` alongside the filter controls.

## Code map

| Concern | File |
|---|---|
| TaskProvider port (renamed) | `packages/core/src/ports/task-provider.ts` |
| New capability + method shape | `write_back_status`, `applyStatus`, `WriteBackResult` in the same file |
| Lamproom→Jira status synonym table | `packages/adapters/src/ticket/jira/transitions.ts` |
| Jira write-back implementation | `JiraTaskProvider.applyStatus` in `packages/adapters/src/ticket/jira/provider.ts` |
| OAuth scope bump | `app/api/jira/auth/{start,callback}/route.ts` — added `write:jira-work` |
| Project pin field + helpers | `project.taskProvider`, `claimTaskProvider`, `releaseTaskProvider` in `packages/cli/src/projects.ts` |
| Pin claim in import routes | `/api/import/{jira,github,markdown}/route.ts` |
| Pin release on wipe | `DELETE /api/projects/[id]/tasks/route.ts` |
| Board PATCH ride-along | `/api/projects/[id]/tasks/[source]/[key]/route.ts` returns `{ task, writeBack? }` |
| Task-sheet warning strip | `app/projects/task-sheet.tsx` |
| Board topbar imports | `app/projects/tasks-board.tsx` (`<ImportFromJira>`, `<ImportFromGithub>`, `<ImportMarkdown>`) |

## How to try it

1. **Re-sign in with Atlassian.** Stored OAuth tokens from before this
   branch do not carry `write:jira-work`. Open
   `/settings/connections/tasks/jira`, Sign out, Sign in again, approve
   the new scopes.
2. **Move a Jira card on the board.** Open any card, pick a status in
   *Move to*. The Lamproom move always stands; if Jira has a matching
   transition the issue moves upstream too. If it doesn't (e.g. the
   workflow names its final state *Resolved* and Lamproom asks for
   *Done*), a wait-colored strip under *Move to* says why. See
   `transitions.ts` for the synonym list.
3. **Add a GitHub PAT.** `/settings/connections/tasks/github` — paste a
   classic PAT (`repo`) or fine-grained token (*Issues: Read-only* on the
   target repos), click **Test**, optionally set a default owner/repo.
4. **Pin a provider.** On a project without stored tasks, click any
   *Import…* button; that provider becomes the project's pin. The other
   two buttons go disabled with a tooltip explaining why. Delete the
   stored tasks (DELETE `/api/projects/<id>/tasks?source=<id>`) to switch
   providers.
5. **Import from the board.** `/p/<slug>/tasks` top bar now carries all
   three buttons.

## Tests

- 95 unit tests pass (6 new for `pickTransition`/`noTransitionMessage`,
  1 for `claimTaskProvider`, 9 for `github-tasks` storage).
- Packages + app typecheck clean.
- Live Jira write-back round-trip was done against `nikhil0035.atlassian.net`
  (KAN board) on 2026-11-28 — status moves in Lamproom transitioned the
  linked KAN-* issues; a status without a matching transition surfaced
  the "available targets" message cleanly.

## Decisions worth keeping in your head

| # | Call | Why |
|---|---|---|
| 1 | The port was renamed, not aliased. `TaskSource` is gone from this build — no `export { TaskProvider as TaskSource }`. | An alias would read as "both names are supported" and new adapters would split which name they implement. One name. |
| 2 | `SourceId`, `SourceInput`, `SourceResult`, `SourceUsage`, `SourceCredentials` kept their `Source*` names. | They describe the ticket source's own shape — the port's `Provider` identity is the read+write role, not the thing providing. Renaming would be churn with no clarity gain. |
| 3 | Pin is set on *first successful* import (inside `claimTaskProvider`), not at project creation. | A project may be registered long before anyone imports anything; forcing a pick upfront is noise. |
| 4 | DELETE `/api/projects/<id>/tasks?source=<id>` releases the pin. | Operators were already going to do this to switch providers — don't make them click twice. |
| 5 | Write-back result rides the 200 response instead of a separate poll. | The move is synchronous from the UI's perspective. A poll would need a new "sync job" table and give no more information. |
| 6 | Jira status → transition lookup happens per-move (GET then POST). No cached per-project workflow map yet. | Jira workflows are per-project and transitions depend on the issue's current state. Caching is the next optimisation, not v1. |

## Left for later

Non-blocking; moved to `docs/Lamproom/Deferred Work.md § Task providers`
when this lands. Flag of what's not here:

- **GitHub write-back** — `GithubTaskProvider.applyStatus` is not
  implemented. The capability set does not carry `write_back_status`
  for GitHub, so the PATCH route's write-back branch is a no-op for
  GitHub-sourced projects. Needs a scope decision (`repo` grants it; a
  fine-grained token needs *Issues: Read and write*) and a mapping from
  Lamproom status to open/closed + labels.
- **Markdown write-back** — out of scope by decision. Editing the
  backlog file reliably after the importer agent touched it is awkward;
  deferred until there is a clean round-trip story.
- **Per-project transition map UI** — a Jira workflow with no synonym
  match today only surfaces a "no transition to X; available targets: …"
  message. A settings page that lets the operator pin "ready-for-human
  → In Review" once per project is the next step.
- **Retry button on the sync-pending strip** — the move stands, but a
  failed write-back isn't re-tryable from the sheet yet. For now the
  operator moves the card to the same status again, which reruns
  applyStatus.
- **Replay provider is not exercised for applyStatus** — the port's
  method is optional; replay keeps pull-only capabilities.

## Related

- [[Task Intake Handoff]] — the handoff for the storage + intake slice
  that landed on `feature/task-source-jira-mcp`
- [[Board Handoff]] — the task types / epics / stories board this
  write-back feeds
- [[TaskSource Port]] — original port design doc; `TaskSource` references
  in there still read as the pre-rename shape
- `docs/superpowers/specs/2026-11-14-task-source-port-design.md` — the
  original port spec; the "`TaskSource`" name is kept verbatim
