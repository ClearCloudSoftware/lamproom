---
tags: [lamproom, board, handoff, task-types]
module: Board
---

# Board Handoff

The project board now knows task types, epics and stories. Cards sit in columns by their Lamproom status, are grouped epic, then story, then task, and move between your statuses from the card's sheet. Before this branch the board's columns came from each provider's status category, and a task had no type or parent.

This note is the state of branch `feature/board-task-types` on 2026-11-27: cut from `dev` at `b728382`, commits `20aade2..9e5d13e`, not merged or pushed. The plan is `docs/superpowers/plans/2026-11-27-board-task-types.md`. The design is [[Task Types And Statuses]]. It records:

- [[#What is built]].
- [[#Decisions open to your review]].
- [[#Rulings made while building]].
- [[#How to try it]].
- [[#Left for later]].

## What is built

- **Types and parents.** A task stores `type` (`bug`, `task`, `story` or `epic`), `parent_key` (its parent's import key in the same source) and `status`. Migration `packages/cli/drizzle/0002_task-types.sql` adds them. The types and move rules are in `packages/core/src/board.ts`.
- **Where the type comes from.**
  - Jira: the issue type (Bug, Epic and Story map to the same names, anything else is a task) and the issue's parent.
  - GitHub: the issue type and the sub-issue parent. See [[#Decisions open to your review]] for Feature.
  - Markdown: `{#id .story parent=key}` after a heading or a bold bullet title. [[Backlog File Shapes]] has the syntax.
  - The backlog-importer agent: `type` and `parent` in its JSON, checked the same way as the parser's.
- **The board.** One column per status, with the count, who manages it and what it means. Agent statuses are hidden until you turn on *Show agent statuses*. Epic and story groups are folded at first. An epic picker and a type filter sit in the top bar. Epics and stories are tinted boxes with a progress bar.
- **Moving a card.** The card's sheet has a *Move to* row. A move goes to `PATCH /api/projects/<id>/tasks/<source>/<key>` with `{ "status": ... }`. The server checks the same rules as the board (`canMove`) and answers 409 with the reason when one is broken. A move is stored in Lamproom only.

The code is `packages/core/src/board.ts` (statuses, `columnOf`, `canMove`), `packages/cli/src/storage.ts` (`upsertTask`, `moveTask`, `columnFor`), the three `normalize.ts` files under `packages/adapters/src/ticket/`, `app/projects/board-model.ts` (grouping and filters), and `tasks-board.tsx`, `board-group.tsx` and `task-sheet.tsx` beside it.

What it left out, each its own plan: writing moves back to the provider and the sync queue; the triage agent and the `ready-for-agent` check; starting runs from the board; `story-breakdown`, `story-land` and story branches; the task types settings page; custom statuses (still an open question in [[Task Types And Statuses]]); drag and drop and keyboard navigation; `## status` sections in `BACKLOG.md`.

## Decisions open to your review

These shape what the board does. Each is easy to change.

| # | Decision | Why | What changing it takes |
|---|---|---|---|
| 1 | Lamproom owns `status` once a task exists. An import sets it only on the first import: `backlog`, or `done` when the source says done | A re-import must not undo a move you made. The provider's status isn't written back yet, so it has nothing better to say | Importing a status on every run would reset your moves. Syncing both ways needs the write-back plan |
| 2 | An epic's or story's column is computed from its children, not stored. Until `story-land` exists, a story is done when its last task is | Stored, it would drift from its children. `story-land` is what will make a story's own finish a separate step | `columnOf` in `board.ts` |
| 3 | On GitHub, a Feature is a story, and a Feature with an `epic` label is an epic. An Epic issue type is an epic | GitHub has no story type, and the note proposed this mapping | One `switch` in `github/normalize.ts` |
| 4 | A parent link that doesn't fit the type levels is ignored on the board but kept in the database | A bad link in the source shouldn't hide a card or break the board, and keeping it means fixing the source fixes the board | The rule is in the next section |

## Rulings made while building

The smaller calls, in the order they came up.

| # | Ruling | Why | Cost if wrong |
|---|---|---|---|
| 1 | The server (`moveTask`) and the board use the same type-level parent rule. An epic counts its stories and its direct tasks and bugs. A story counts its tasks and bugs. Any other parent link is ignored, which also makes cycles harmless | The server and the page must agree on which column a container is in | Two places to change: `columnFor` and `board-model.ts` |
| 2 | Grouping follows the mockup. A group shows in a column only when it has visible content there. Otherwise a container in that column is a plain card. A column's count is the number of tasks in that column that pass the filters | The mockup does it this way, and a group with nothing inside is noise | `groupColumn` in `board-model.ts` |
| 3 | A picked epic that disappears, or stops being an epic, falls back to all epics | A board filtered by something that isn't there would look empty | One guard in `effectiveFilters` |
| 4 | *Move to* shows the statuses you own plus the card's current column, as in the mockup. A refused move is disabled and gives the reason in a tooltip | The mockup shows it this way. Agent statuses are never yours to pick | One `filter` in `task-sheet.tsx` |
| 5 | The move route doesn't call `decodeURIComponent` again | Next already decodes params. Checked with a key holding `%2F` | A key with a `%` would break |
| 6 | The markdown block also accepts a plain `{#id}` after the bold in a shape B bullet (`- **T** {#x} — body`). That changes the import key for that rare shape on re-import, from the title slug to `x` | The attribute block should work wherever the id works | A re-import of such a bullet makes a new task and leaves the old one |
| 7 | A block with two `parent=` tokens, like one with two types, isn't an attribute block | The same rule as two types: say nothing rather than guess | A regex in `markdown/normalize.ts` |
| 8 | The browser check seeded a scratch data folder rather than running the agent import. The backlog-importer agent's `type` and `parent` output has been unit-tested only, never run against real Claude | The agent needs `CLAUDE_CODE_OAUTH_TOKEN` on this machine (see [[Deferred Work#Markdown backlog import]]) | A wrong guess by the agent shows up on the board only |

## How to try it

The normal way: open a project with a repo that holds a `BACKLOG.md` and press *Import* on the project page. Then open `/p/<slug>/tasks`.

To try it without a real repo, seed a scratch data folder. The browser check did this:

1. Make a scratch git repo whose `BACKLOG.md` is the one below.

   ```md
   # billing-svc backlog
   ## International billing {#intl .epic}
   ## Bill customers in their own currency {#bic .story parent=intl}
   ## Format amounts with minor units {#mu .task parent=bic}
   ## Add CHF and JPY to the end-to-end tests {#e2e .task parent=bic}
   ## Invoice from more than one legal entity {#entity .story parent=intl}
   ## CHF amounts show a dollar sign {#chf .bug parent=bic}
   ## Export invoices as CSV {#csv}
   ```

2. Point `LAMPROOM_DATA_DIR` at an empty folder. Add the repo as a project with `createProject` (`packages/cli/src/projects.ts`). Parse the file with `parseMarkdown` (`packages/adapters`) and store the tasks with `upsertTask` (`packages/cli/src/storage.ts`), source `markdown`. These are the calls the importer's parser path makes.
3. Run `LAMPROOM_DATA_DIR=<that folder> pnpm dev` and open `/p/<slug>/tasks`.

What you should see:

- **Backlog** shows one folded EPIC box and the CSV card under *no epic or story*. The epic and `bic` also show in `in tasks`.
- Opening the epic shows the `bic` STORY box and the `entity` story card, which says *not split yet*. Opening `bic` shows three white cards.
- Picking the epic in the picker removes the epic box and hides CSV.
- Moving `mu` to `ready-for-human` puts it there, and `bic`'s bar still says 0 of 3 done. Moving `mu`, `e2e` and `chf` to done moves `bic` to done.
- In a card's sheet, `needs-info` isn't offered. Open `bic` or the epic and every target is disabled, with the reason in a tooltip.

## Left for later

What this work left unfixed is in [[Deferred Work#Board]], the one list of deferred work. Designed-but-unbuilt work stays in [[Task Types And Statuses]].

## Related

- [[Task Types And Statuses]]: the design this builds part of
- [[Backlog File Shapes]]: the attribute block
- [[Backlog Importer Agent]]
- [[Intake Data Model]]
