# Board: Task Types, Epics And Stories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The project board at `/p/[slug]/tasks` shows tasks in Lamproom's own status columns, knows each task's type (bug, task, story, epic) and parent, groups cards in every column under their epic and story, and filters by type and by epic. That's the board in `docs/mockups/board.html`, minus everything that needs agents or runs.

**Architecture:** Imports gain a `type` and a `parentKey` from each provider. Storage adds `type`, `parent_key` and `status` columns, and Lamproom owns `status` once a task exists. The status list and move rules are a fixed list in `@lamproom/core` (`packages/core/src/board.ts`). The board's grouping and filtering live in a pure module (`app/projects/board-model.ts`). The React board renders that module's output with shadcn components and moves a card through one PATCH route.

**Tech Stack:** Next.js 16 app (`app/`), pnpm workspace packages (`packages/core`, `packages/adapters`, `packages/cli`), Drizzle + SQLite (better-sqlite3), TanStack Query, shadcn/ui, lucide-react, `node --test`.

**Spec:**
- `docs/Lamproom/Board/Task Types And Statuses.md`, the design note. Read the summary, "Task types", "How an epic moves", the provider table, and decisions 3 and 5.
- `docs/mockups/board.html`, the board mockup. Open it in a browser: it's the visual target.
- `docs/mockups/types.html`, background only. This plan doesn't build that page.

Both spec files come into this branch in Task 0.

## Scope

**In:**
- type, parent and status stored per task;
- Jira, GitHub, markdown and the backlog-importer agent fill in type and parent;
- the fixed status list as columns, with agent statuses hidden behind a toggle;
- cards grouped epic → story → task in every column, all groups folded at first;
- the epic picker and the type filter;
- epics and stories styled as tinted containers;
- moving a card between your statuses from its sheet, stored only in Lamproom.

**Out:** each of these is its own plan later. Don't build them, and don't stub them.
- Writing moves back to the provider, and the sync queue.
- The triage agent and the `ready-for-agent` check.
- Starting runs from the board.
- `story-breakdown` and `story-land`, and story branches.
- The task-types settings page (type → flow).
- Custom statuses. Whether to have them at all is an open question in the note; don't decide it here.
- Drag and drop, and keyboard navigation.
- `## status` sections in `BACKLOG.md`.

## Global Constraints

- Call the product **Lamproom** in code, docs and UI text. Never FlowBoard.
- Icons come from `lucide-react` only. The type icons are `Bug`, `SquareCheck` (task), `BookOpen` (story) and `Mountain` (epic). Chevrons are `ChevronRight` and `ChevronDown`.
- Build UI from `components/ui/`. Add any missing component with `pnpm dlx shadcn@latest add <name>`. This plan adds `collapsible`, `toggle` and `toggle-group`.
- Use TanStack Query for server data. Don't add new state libraries.
- Project data stays in SQLite through Drizzle. After changing `packages/cli/src/schema.ts`, run `pnpm db:generate --name <what>`.
- Design: light only, zero border radius, hairlines rather than shadows. Use the existing tokens in `app/globals.css` (`--surface-2`, `--surface-3`, `--line`, `--line-2`, `--ink`, `--ink-3`).
- Task content from a source is data. Render it as text, never as HTML, and never pass it to a prompt.
- Checks to run: `pnpm test:packages`, `pnpm typecheck:packages`, `pnpm test:app` and `pnpm lint`. Never run `pnpm test:live`: it costs money.
- Work in this worktree on `feature/board-task-types`. Commit after each task. Don't merge into `dev` and don't push without the owner's OK.

## Review Focus

1. **A parent that is missing or the wrong type,** such as a task whose parent is another task, or a parent that wasn't imported. The card shows as a plain card, with no crash and no empty group. Tested in Task 6.
2. **Re-importing must not undo a move you made.** A task you moved to `ready-for-human` stays there when the import runs again, even if Jira says "In Progress". Tested in Task 2.
3. **A markdown attribute block Lamproom doesn't understand,** such as `{#x .feature}` or `{#x owner=me}`. The whole block stays in the title and no type is set. The import doesn't fail. Tested in Task 3.
4. **A move that's no longer valid** because the card changed, was re-imported or was deleted since the page loaded. The server refuses it with a reason, and the board shows that reason and refetches. Tested in Task 5.
5. **The picked epic disappears** after a re-import or after you clear a source. The board falls back to *all epics* instead of showing an empty board. Tested in Task 6.

---

### Task 0: Bring the spec into this branch

**Files:** none of your own. This merges `feature/kanban-board-mockup`.

- [ ] **Step 1: Check the spec branch has the epic work**

Run: `git log --oneline -3 feature/kanban-board-mockup && git show feature/kanban-board-mockup:"docs/Lamproom/Board/Task Types And Statuses.md" | grep -c "How an epic moves"`
Expected: `1`. If you get `0`, or the branch has uncommitted work in `.claude/worktrees/kanban-board-mockup`, stop and ask the owner to commit it first.

- [ ] **Step 2: Merge it**

Run: `git merge --no-ff feature/kanban-board-mockup -m "Merge branch 'feature/kanban-board-mockup' into feature/board-task-types"`
Expected: a clean merge. It only touches `docs/`.

### Task 1: The status list and move rules in core

**Files:**
- Create: `packages/core/src/board.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './board.ts';`)
- Test: `packages/core/test/board.test.ts`

**Interfaces:**
- Produces:
  - `TASK_TYPES = ['bug', 'task', 'story', 'epic'] as const`
  - `type TaskType`
  - `isContainer(t: TaskType): boolean` (true for story and epic)
  - `type StatusId = 'backlog' | 'needs-triage' | 'needs-info' | 'needs-context' | 'ready-for-agent' | 'ready-for-human' | 'in tasks' | 'in progress' | 'done' | 'wontfix'`
  - `interface StatusDef { id: StatusId; category: 'todo' | 'doing' | 'done'; owner: 'you' | 'agent' | 'tasks'; who: string; means: string }`
  - `STATUSES: readonly StatusDef[]`, in board order
  - `isStatus(s: unknown): s is StatusId`
  - `isClosed(s: StatusId): boolean` (done or wontfix)
  - `columnOf(type: TaskType, status: StatusId, childColumns: StatusId[]): StatusId`
  - `canMove(type: TaskType, column: StatusId, to: StatusId): string` (empty means allowed; `'same'` means no move)

- [ ] **Step 1: Write the failing tests** in `packages/core/test/board.test.ts`:

```ts
test('STATUSES: the ten columns in board order, owners as the note says', () => {
  assert.deepEqual(STATUSES.map((s) => s.id), ['backlog', 'needs-triage', 'needs-info', 'needs-context', 'ready-for-agent', 'ready-for-human', 'in tasks', 'in progress', 'done', 'wontfix']);
  assert.deepEqual(STATUSES.filter((s) => s.owner === 'you').map((s) => s.id), ['backlog', 'ready-for-agent', 'ready-for-human', 'done', 'wontfix']);
  assert.equal(STATUSES.find((s) => s.id === 'in tasks')!.owner, 'tasks');
});
test('columnOf: a container with an open child is in tasks; all closed with one done is done; all wontfix stays put', () => {
  assert.equal(columnOf('story', 'backlog', ['done', 'backlog']), 'in tasks');
  assert.equal(columnOf('story', 'backlog', ['done', 'wontfix']), 'done');
  assert.equal(columnOf('epic', 'backlog', ['wontfix']), 'backlog');
  assert.equal(columnOf('story', 'backlog', []), 'backlog');          // not split yet
  assert.equal(columnOf('story', 'wontfix', ['backlog']), 'wontfix'); // you closed it
  assert.equal(columnOf('task', 'ready-for-human', ['backlog']), 'ready-for-human');
});
test('canMove: free between your statuses; agents, runs and children own the rest', () => {
  assert.equal(canMove('task', 'backlog', 'ready-for-human'), '');
  assert.equal(canMove('task', 'needs-info', 'backlog'), '');
  assert.equal(canMove('task', 'backlog', 'backlog'), 'same');
  assert.match(canMove('task', 'backlog', 'needs-info'), /^Agents set needs-info/);
  assert.match(canMove('task', 'backlog', 'in progress'), /^Only a run/);
  assert.match(canMove('task', 'in progress', 'done'), /^A run owns this card/);
  assert.match(canMove('story', 'in tasks', 'done'), /moves with its children/);
  assert.match(canMove('task', 'backlog', 'in tasks'), /^Only an epic or story/);
  assert.match(canMove('epic', 'backlog', 'ready-for-agent'), /^An epic runs no flow/);
  assert.equal(canMove('epic', 'backlog', 'wontfix'), '');
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test packages/core/test/board.test.ts`
Expected: FAIL, because `board.ts` doesn't exist yet.

- [ ] **Step 3: Implement `packages/core/src/board.ts`**

- **`STATUSES`:** copy `who` and `means` verbatim from the `COLS` list in `docs/mockups/board.html` (lines 289–298 after Task 0). Categories: `todo` for backlog, the three needs-*, ready-for-agent and ready-for-human; `doing` for `in tasks` and `in progress`; `done` for done and wontfix.
- **`canMove`:** check the rules in this order. The copy is exact:
  1. `column === to` returns `'same'`.
  2. `column === 'in tasks'` returns `"An epic or story moves with its children. It's done when the last of them is."`
  3. `to === 'in tasks'` returns `"Only an epic or story with children goes in tasks, and it goes there by itself."`
  4. `column === 'in progress'` returns `"A run owns this card. It moves on when the run does."`
  5. `to === 'in progress'` returns `"Only a run puts a card in progress, and the board can't start runs yet."`
  6. `type === 'epic' && to === 'ready-for-agent'` returns `"An epic runs no flow: open one of its stories and run that."`
  7. `to` is owned by an agent: returns `` `Agents set ${to}. You can't move a card there.` ``
  8. Otherwise return `''`.
- **`columnOf`:** a container, not closed, with at least one child, returns `'done'` when every child is closed and at least one is done; otherwise `'in tasks'`. If every child is wontfix, return the container's own status. A container with no children, and any non-container, returns its own status.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node --test packages/core/test/board.test.ts && pnpm typecheck:packages`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/board.ts packages/core/src/index.ts packages/core/test/board.test.ts
git commit -m "feat(core): board statuses, task types and move rules"
```

### Task 2: Store type, parent and status

**Files:**
- Modify: `packages/core/src/ports/task-source.ts` (`ParsedTask`)
- Modify: `packages/cli/src/schema.ts` (`tasksTable`)
- Create: `packages/cli/drizzle/0002_task-types.sql` (generated, then add one line by hand)
- Modify: `packages/cli/src/storage.ts`
- Test: `packages/cli/test/storage.test.ts`

**Interfaces:**
- Consumes: `TaskType`, `StatusId`, `columnOf` and `canMove` from Task 1.
- Produces:
  - `ParsedTask` gains `type?: TaskType` and `parentKey?: string`. `parentKey` is the parent's `importKey` in the same source.
  - `TaskRow` gains `type: TaskType`, `parentKey: string | null` and `status: StatusId`.
  - `moveTask(db, projectId, sourceId, importKey, to: StatusId): { ok: true; task: TaskRow } | { ok: false; code: 404 | 409; error: string }`

- [ ] **Step 1: Write the failing tests** in `packages/cli/test/storage.test.ts`, using the file's existing temp-db helper:

```ts
test('a new task stores its type and parent; status starts at backlog, or done when the source says done', () => {
  upsertTask(db, 'p', 'jira', { ...base('KAN-2'), type: 'story', parentKey: 'kan-1' }, now);
  upsertTask(db, 'p', 'jira', { ...base('KAN-3'), extras: { statusCategory: 'done' } }, now);
  const a = getTask(db, 'p', 'jira', 'kan-2')!;
  assert.equal(a.type, 'story'); assert.equal(a.parentKey, 'kan-1'); assert.equal(a.status, 'backlog');
  assert.equal(getTask(db, 'p', 'jira', 'kan-3')!.status, 'done');
  assert.equal(getTask(db, 'p', 'jira', 'kan-3')!.type, 'task'); // no type from the source → task
});
test('re-importing updates type and parent but never the status you set', () => {
  upsertTask(db, 'p', 'jira', base('KAN-4'), now);
  assert.equal(moveTask(db, 'p', 'jira', 'kan-4', 'ready-for-human').ok, true);
  upsertTask(db, 'p', 'jira', { ...base('KAN-4'), type: 'bug', extras: { statusCategory: 'done' } }, now);
  const t = getTask(db, 'p', 'jira', 'kan-4')!;
  assert.equal(t.status, 'ready-for-human'); assert.equal(t.type, 'bug');
});
test('moveTask: refuses with the rule’s reason, a gone task with 404, a container by its children’s column', () => {
  assert.deepEqual(moveTask(db, 'p', 'jira', 'nope', 'done'), { ok: false, code: 404, error: 'task not found: nope' });
  upsertTask(db, 'p', 'jira', base('KAN-5'), now);
  const r = moveTask(db, 'p', 'jira', 'kan-5', 'needs-info');
  assert.equal(r.ok, false); assert.equal(!r.ok && r.code, 409); assert.match(!r.ok ? r.error : '', /^Agents set/);
  upsertTask(db, 'p', 'jira', { ...base('KAN-6'), type: 'story' }, now);
  upsertTask(db, 'p', 'jira', { ...base('KAN-7'), parentKey: 'kan-6' }, now);
  assert.equal(moveTask(db, 'p', 'jira', 'kan-6', 'done').ok, false); // the story is "in tasks" while kan-7 is open
});
```

`base(key)` returns `{ importKey: key.toLowerCase(), title: key, _hint: { upstream: key, titleSlug: key.toLowerCase() } }`.

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test packages/cli/test/storage.test.ts`
Expected: FAIL, because the columns and `moveTask` don't exist yet.

- [ ] **Step 3: Add the columns**

In `tasksTable` add:
- `type: text('type', { enum: TASK_TYPES }).notNull().default('task')`
- `parentKey: text('parent_key')`
- `status: text('status').$type<StatusId>().notNull().default('backlog')`

Add the index `tasks_by_parent` on `(projectId, sourceId, parentKey)`.

Run `pnpm db:generate --name task-types`. Then append this line to the generated SQL, so existing Jira tasks that are already done land in done:
`UPDATE tasks SET status = 'done' WHERE json_extract(extras, '$.statusCategory') = 'done';`

- [ ] **Step 4: Change storage**

- **`upsertTask`:** an insert writes `type` (`task.type ?? 'task'`), `parentKey` (`task.parentKey ?? null`) and `status` (`'done'` when `extras.statusCategory === 'done'`, else `'backlog'`). An update sets `type` and `parentKey` and leaves `status` alone.
- **`moveTask`:**
  1. Load the task. If it's missing, return 404 with `task not found: <importKey>`.
  2. Load its children with one query on `(projectId, sourceId, parentKey)`. For an epic, compute each child story's column with `columnOf` using that story's own children.
  3. Work out the task's column with `columnOf`, then call `canMove`. A non-empty result other than `'same'` returns 409 with that reason. `'same'` returns ok without writing.
  4. Otherwise write `status` and `updatedAt`, and return the row.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pnpm test:packages && pnpm typecheck:packages`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ports/task-source.ts packages/cli/src/schema.ts packages/cli/drizzle packages/cli/src/storage.ts packages/cli/test/storage.test.ts
git commit -m "feat(storage): tasks keep a type, a parent and a Lamproom status"
```

### Task 3: Markdown and the importer agent: type and parent

**Files:**
- Modify: `packages/adapters/src/ticket/markdown/normalize.ts` (`EXPLICIT_ID_RE`, `splitTitleAndExplicitId`, `UnkeyedTask`, `keyMarkdownTasks`)
- Modify: `packages/cli/src/backlog-import.ts` (`AgentTasks`, `agentTasks`)
- Modify: `internal/backlog-importer/SKILL.md` (the field table and the example)
- Modify: `docs/Lamproom/Intake And Import/Backlog File Shapes.md` (document the attribute block)
- Test: `packages/adapters/test/markdown-normalize.test.ts`, `packages/cli/test/backlog-import.test.ts`

**Interfaces:**
- Consumes: `TASK_TYPES` and `TaskType` from Task 1, and `ParsedTask.type` and `parentKey` from Task 2.
- Produces: `UnkeyedTask` gains `type?: TaskType` and `parentId?: string`. `keyMarkdownTasks` copies them to `type` and `parentKey`.

- [ ] **Step 1: Write the failing tests** in `markdown-normalize.test.ts`:

```ts
test('attribute block: {#id .type parent=key} sets the key, type and parent, in any order after #id', () => {
  const [epic, story, task] = parseMarkdown('## Intl billing {#intl .epic}\n\n## Bill in currency {#bic .story parent=intl}\n\n## Minor units {#mu parent=bic .task}\n', 'markdown');
  assert.deepEqual([epic!.importKey, epic!.type, epic!.parentKey], ['intl', 'epic', undefined]);
  assert.deepEqual([story!.type, story!.parentKey], ['story', 'intl']);
  assert.deepEqual([task!.type, task!.parentKey], ['task', 'bic']);
});
test('attribute block works on shape B bullets too', () => {
  const [t] = parseMarkdown('## Billing\n\n- **CHF symbol** {#chf .bug parent=bic} — shows $\n', 'markdown');
  assert.deepEqual([t!.importKey, t!.type, t!.parentKey, t!.title], ['chf', 'bug', 'bic', 'CHF symbol']);
});
test('a block with an unknown type or token stays in the title, untyped', () => {
  const [a, b] = parseMarkdown('## A {#a .feature}\n\n## B {#b owner=me}\n', 'markdown');
  assert.equal(a!.title, 'A {#a .feature}'); assert.equal(a!.type, undefined);
  assert.equal(b!.title, 'B {#b owner=me}');
});
```

In `backlog-import.test.ts`, check that `agentTasks` keeps `type` and `parent` from the agent's JSON. It keeps `parent` only when that text appears in the backlog (the same rule as `import_key`), and drops a `type` that isn't one of the four.

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test packages/adapters/test/markdown-normalize.test.ts packages/cli/test/backlog-import.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

The block is `{` + `#id`, then any number of `.type` and `parent=key` tokens separated by spaces, then `}`. The id and the parent key use the same character class as today (`[a-z0-9][a-z0-9-]*`). If any token doesn't fit, or there's more than one type, the block isn't an attribute block and stays in the title.

The agent's JSON gains `"type": "bug|task|story|epic"` and `"parent": "<import_key of the parent>"`. Map `parent` to `parentId`. In `SKILL.md`, add both rows to the field table, saying "only when the backlog says so; never guess a parent".

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm test:packages`
Expected: PASS, including the old markdown tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/adapters packages/cli/src/backlog-import.ts packages/cli/test/backlog-import.test.ts internal/backlog-importer/SKILL.md "docs/Lamproom/Intake And Import/Backlog File Shapes.md"
git commit -m "feat(markdown): type and parent in the {#id .type parent=key} block"
```

### Task 4: Jira and GitHub: type and parent

**Files:**
- Modify: `packages/adapters/src/ticket/jira/normalize.ts`
- Modify: `packages/adapters/src/ticket/github/options.ts` (`ISSUES_QUERY`), `packages/adapters/src/ticket/github/normalize.ts` (`GithubIssueNode`, `normalizeIssueNode`)
- Modify: `packages/adapters/test/fixtures/github/issues-page1.json` (add `issueType` and `parent` to two nodes)
- Test: `packages/adapters/test/jira-normalize.test.ts`, `packages/adapters/test/github-normalize.test.ts`

**Interfaces:**
- Consumes: `TaskType` from Task 1, and `ParsedTask.type` and `parentKey` from Task 2.
- Produces: nothing new. Both adapters fill in `type` and `parentKey`.

- [ ] **Step 1: Write the failing tests**

Jira (build issues the way the existing tests do):
- `issuetype.name` maps: `'Bug'` → `bug`, `'Epic'` → `epic`, `'Story'` → `story`. `'Task'`, `'Sub-task'`, `'Subtask'` and anything unknown → `task`.
- A `parent` of `{ key: 'KAN-1' }` gives `parentKey === 'kan-1'`, which is the same key `deriveImportKey` gives KAN-1 itself.
- `parent: null` leaves `parentKey` undefined.

GitHub:
- `issueType.name` maps: `'Bug'` → `bug`, `'Task'` → `task`, `'Epic'` → `epic`, `'Feature'` → `story`. A `'Feature'` with an `epic` label (any case) → `epic`. A null type → `task`.
- A `parent: { number: 7 }` gives `parentKey === 'github-7'`, which matches the parent's own `importKey` under source id `github`.
- Also assert that `ISSUES_QUERY` contains `issueType { name }` and `parent { number }`.

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test packages/adapters/test/jira-normalize.test.ts packages/adapters/test/github-normalize.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- **Jira:** build `parentKey` the way the issue's own key is built: run `deriveImportKey(sourceId, { upstream: parent.key, titleSlug: slugify(parent.key) }, POLICY_PREFIX, new Set())`, with a fresh set so the batch's dedupe doesn't touch it.
- **GitHub:** `parentKey` is `deriveImportKey(sourceId, { upstream: String(parent.number), titleSlug: '' }, POLICY_NUMERIC, new Set())`. Both new GraphQL fields can be null.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm test:packages && pnpm typecheck:packages`
Expected: PASS. Don't run the live GitHub or Jira tests.

- [ ] **Step 5: Commit**

```bash
git add packages/adapters
git commit -m "feat(adapters): Jira and GitHub import each issue's type and parent"
```

### Task 5: The move route and the client side

**Files:**
- Create: `app/api/projects/[id]/tasks/[source]/[key]/route.ts` (`PATCH`)
- Modify: `app/projects/api.ts` (`TaskRow` gains `type`, `parentKey`, `status`; add `moveTaskMutation`)
- Test: `app/projects/api.test.ts`

**Interfaces:**
- Consumes: `moveTask` from Task 2, and `isStatus` from Task 1.
- Produces:
  - `PATCH /api/projects/<id>/tasks/<source>/<key>` with body `{ "status": StatusId }`. It returns 200 `{ task }`, 400 `{ error }` for a bad body, or 404 and 409 `{ error }` from `moveTask`.
  - `moveTaskMutation(projectId: string, client: Pick<QueryClient, 'invalidateQueries'>)`: TanStack `mutationOptions` whose `mutationFn` takes `{ sourceId, importKey, to }`. Its `onSettled` calls `client.invalidateQueries({ queryKey: ['project-tasks', projectId] })`.

- [ ] **Step 1: Write the failing test** in `app/projects/api.test.ts`. Pass a stub `{ invalidateQueries: (f) => calls.push(f) }` to `moveTaskMutation('p', stub)`, call its `onSettled`, and assert that `calls` deep-equals `[{ queryKey: ['project-tasks', 'p'] }]`.

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test app/projects/api.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

The route follows `app/api/projects/[id]/tasks/route.ts`:
1. `refused(request)` first.
2. A project that doesn't exist returns 404.
3. Read `status` from the JSON body. If `isStatus` rejects it, return 400 `{ error: 'status must be one of the board statuses' }`.
4. Call `moveTask` and pass its code and error straight through.

`source` and `key` arrive URL-encoded; decode them.

- [ ] **Step 4: Run the checks and watch them pass**

Run: `pnpm test:app && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/projects app/projects/api.ts app/projects/api.test.ts
git commit -m "feat(app): PATCH a task's status; the client mutation"
```

### Task 6: Board model: columns, groups and filters (pure)

**Files:**
- Create: `app/projects/board-model.ts`
- Test: `app/projects/board-model.test.ts`

**Interfaces:**
- Consumes: `TaskRow` from Task 5, and `columnOf`, `TaskType` and `StatusId` from Task 1.
- Produces:
  - `taskId(t: TaskRow): string`, which is `` `${t.sourceId}:${t.importKey}` ``
  - `interface BoardIndex { byId: Map<string, TaskRow>; kids: Map<string, TaskRow[]>; column: Map<string, StatusId> }`
  - `indexTasks(tasks: TaskRow[]): BoardIndex`. It links a parent only when the parent exists in the same source and the types fit: a story's parent is an epic; a task's or bug's parent is a story or an epic; an epic never has a parent. Any other parent is ignored. Because the types strictly descend, this also rules out cycles.
  - `epicOf(t: TaskRow, ix: BoardIndex): string | undefined` (the epic's `taskId`)
  - `interface Filters { type: TaskType | 'all'; epic: string }` (an empty string means all epics)
  - `effectiveFilters(f: Filters, ix: BoardIndex): Filters`. An `epic` that no longer exists becomes `''`.
  - `interface Group { head: TaskRow; cards: TaskRow[]; stories: Group[]; folded: boolean; done: number; total: number }`
  - `interface ColumnGroups { epics: Group[]; stories: Group[]; loose: TaskRow[]; count: number }`
  - `groupColumn(column: StatusId, ix: BoardIndex, f: Filters, expanded: ReadonlySet<string>): ColumnGroups`

- [ ] **Step 1: Write the failing tests.** Build a small fixture with a helper `t(key, type, status, parent?)`, using one source. The fixture has epic `e1` with stories `s1` (tasks `a` in backlog, `b` in ready-for-agent) and `s2` (not split, in backlog), epic `e2` with story `s3` (task `c` in backlog), and loose task `x` in backlog.

```ts
test('backlog groups epic → story → task, then loose cards; all folded at first', () => {
  const g = groupColumn('backlog', ix, { type: 'all', epic: '' }, new Set());
  assert.deepEqual(g.epics.map((e) => e.head.importKey), ['e1', 'e2']);         // same order in every column
  assert.deepEqual(g.epics[0]!.stories.map((s) => s.head.importKey), ['s1']);
  assert.deepEqual(g.epics[0]!.cards.map((c) => c.importKey), ['s2']);          // unsplit story sits in its epic
  assert.equal(g.epics[0]!.folded, true);
  assert.deepEqual(g.loose.map((c) => c.importKey), ['x']);
  assert.equal(g.count, 4);                                                      // a, s2, c, x: s1, e1, s3, e2 are in tasks
});
test('an expanded key opens exactly that group in that column', () => {
  const g = groupColumn('backlog', ix, { type: 'all', epic: '' }, new Set(['backlog:md:e1']));
  assert.equal(g.epics[0]!.folded, false); assert.equal(g.epics[1]!.folded, true);
});
test('picking an epic drops the epic level and everything outside it, the epic itself included', () => {
  const g = groupColumn('backlog', ix, { type: 'all', epic: 'md:e1' }, new Set());
  assert.deepEqual(g.epics, []);
  assert.deepEqual(g.stories.map((s) => s.head.importKey), ['s1']);
  assert.deepEqual(g.loose.map((c) => c.importKey), ['s2']);
});
test('an epic or story whose group is in this column is not also a loose card', () => {
  const g = groupColumn('in tasks', ix, { type: 'all', epic: '' }, new Set());
  assert.ok(!g.loose.some((c) => c.importKey === 'e1' || c.importKey === 's1'));
});
test('a missing or wrong-type parent leaves the card loose', () => {
  const ix2 = indexTasks([t('y', 'task', 'backlog', 'gone'), t('z', 'task', 'backlog', 'x'), t('x', 'task', 'backlog')]);
  assert.deepEqual(groupColumn('backlog', ix2, { type: 'all', epic: '' }, new Set()).loose.map((c) => c.importKey).sort(), ['x', 'y', 'z']);
});
test('a picked epic that no longer exists falls back to all epics', () => {
  assert.equal(effectiveFilters({ type: 'all', epic: 'md:gone' }, ix).epic, '');
});
test('the type filter hides other types but keeps their groups as headers', () => {
  const g = groupColumn('backlog', ix, { type: 'task', epic: '' }, new Set());
  assert.deepEqual(g.loose.map((c) => c.importKey), ['x']);
  assert.equal(g.epics[0]!.cards.length, 0);                                    // s2 is a story: hidden
});
test('rollup: a group counts all its children, wherever they sit', () => {
  const s1 = groupColumn('backlog', ix, { type: 'all', epic: '' }, new Set()).epics[0]!.stories[0]!;
  assert.deepEqual([s1.done, s1.total], [0, 2]);
});
```

`count` is every card in that column that passes the filters. In this fixture `s1`, `s3`, `e1` and `e2` are in `in tasks`, because each has an open child.

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test app/projects/board-model.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `app/projects/board-model.ts`**

- `indexTasks` computes each task's column: tasks and bugs first, then stories, then epics, using `columnOf` with the children's columns.
- Sort groups and cards by `importKey` with `localeCompare(…, undefined, { numeric: true })`.
- `groupColumn` drops a head from the loose list when its own group is in the same column.
- `done` and `total` count the head's direct children: stories for an epic, tasks and bugs for a story.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm test:app`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/projects/board-model.ts app/projects/board-model.test.ts
git commit -m "feat(app): board model groups epic → story → task and filters by type and epic"
```

### Task 7: The board UI

**Files:**
- Add: `components/ui/collapsible.tsx`, `components/ui/toggle.tsx` and `components/ui/toggle-group.tsx` (via `pnpm dlx shadcn@latest add collapsible toggle toggle-group`)
- Modify: `app/projects/tasks-board.tsx`. Replace the `statusCategory` columns, and keep the page shell, empty state and error handling.
- Create: `app/projects/board-group.tsx` (`GroupBox`: header with a fold chevron, an open-title button, type tag, progress bar and status line)
- Create: `app/projects/task-sheet.tsx`. Move `TaskSheet` here from `tasks-board.tsx` and add the "move to" buttons.

**Interfaces:**
- Consumes: `indexTasks`, `groupColumn`, `effectiveFilters`, `Filters` and `taskId` from Task 6; `moveTaskMutation` from Task 5; `STATUSES` and `canMove` from Task 1.
- Produces: the page. No exports other files use.

- [ ] **Step 1: Columns and filters.** Render one column per `STATUSES` entry, with the name, a count (`ColumnGroups.count`), `who` and `means`.
  - Agent-owned columns (needs-triage, needs-info, needs-context, in progress) are hidden until a **Show agent statuses** toggle is on.
  - In the top bar, an epic `Select` ("All epics", then one item per epic as `<key> <title>`) and a type `ToggleGroup` (all · bug · task · story · epic).
  - Filter state and the expanded set live in `useState`. They're per visit, not saved.

- [ ] **Step 2: Groups and cards.** Inside a column, render epic groups, then story groups, then a small "no epic or story" label (only when there are groups and loose cards, and no epic is picked), then the loose cards.
  - A group is a `Collapsible`, closed by default. Its key in the expanded set is `` `${column}:${taskId(head)}` ``.
  - **Group header:** a chevron button (`aria-expanded`), then the type tag and the key and title as a button that opens the sheet, then a progress bar with one segment per child, then `` `${done} of ${total} ${stories|tasks} done · ${type}: ${its column}` ``. When folded, add `` ` · ${n} hidden here` ``.
  - **Containers:** an epic box is `bg-[var(--surface-3)]` with a left border `3px solid var(--ink)` and a solid **EPIC** tag (ink background, paper text). A story box is `bg-[var(--surface-2)]` with a left border `3px solid var(--ink-3)` and an outlined **STORY** tag.
  - **Cards:** tasks and bugs stay white with their type icon. An unsplit story card says "not split yet". Copy the look from `docs/mockups/board.html` (`.grp`, `.grp-head`, `.ttag`, `.kc.is-story`).

- [ ] **Step 3: Moving a card.** In the sheet, show the task's column and type and its parent ("part of …"), then a "Move to" row with one button per status you own.
  - A button is disabled when `canMove` refuses it, with the reason in a tooltip.
  - Clicking calls the mutation. A 409 or 404 shows the server's `error` in an inline alert in the sheet, and the board refetches.

- [ ] **Step 4: Check it in the browser.**
  1. Make a project whose repo has this `BACKLOG.md`, and import it from the project page:

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

  2. Run `pnpm dev` and open `/p/<slug>/tasks`. Check each of these:
     - Backlog shows one folded EPIC box and the CSV card under "no epic or story". The epic and `bic` show in `in tasks`.
     - Opening the epic shows the `bic` STORY box and the `entity` story card. Opening `bic` shows three white cards.
     - Picking the epic removes the epic box and hides CSV.
     - Moving `mu` to `ready-for-human` puts it there, and `bic`'s bar still shows 0 of 3 done. Moving `mu`, `e2e` and `chf` to done moves `bic` to done.
     - Moving a card to `needs-info` isn't offered, and its tooltip gives the reason.
  3. Take one screenshot for the commit description.

- [ ] **Step 5: Run every check**

Run: `pnpm test:packages && pnpm typecheck:packages && pnpm test:app && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/ui app/projects
git commit -m "feat(app): board columns by Lamproom status, epic and story groups, epic and type filters"
```

### Task 8: Docs and handoff

**Files:**
- Modify: `docs/Lamproom/Board/Task Types And Statuses.md`. Change "Nothing here is built" to say what this branch built and what it didn't (the Scope "Out" list).
- Create: `docs/Lamproom/Board/Board Handoff.md`. Cover what's built, the decisions taken in this plan (listed below), and how to try it, using the Task 7 backlog.
- Modify: `docs/Lamproom/Deferred Work.md`. Add a **Board** section for known problems only, for example "moves aren't written back to the provider" and "a Jira task directly under an epic shows inside the epic's box". Designed-but-unbuilt work stays in the note.

Decisions to record in the handoff, so the owner can review them:
- Lamproom owns `status` once a task exists. An import sets it only on the first import (backlog, or done when the source says done).
- An epic's or story's column is computed from its children, not stored. Until `story-land` exists, a story is done when its last task is.
- On GitHub, Feature maps to story, and Feature with an `epic` label maps to epic.
- A parent link that doesn't fit the type levels is ignored on the board but kept in the database.

- [ ] **Step 1: Write the three docs.**
- [ ] **Step 2: Commit**

```bash
git add docs/Lamproom
git commit -m "docs(board): handoff for task types, epics and stories on the board"
```
