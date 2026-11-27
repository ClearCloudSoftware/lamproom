'use client';
/**
 * The kanban board for one project.
 *
 * Reads tasks from `/api/projects/<id>/tasks` (TanStack Query, 10s poll) and lays them out in
 * Lamproom's own status columns (`STATUSES`), each holding epic groups, then story groups, then
 * loose cards (`groupColumn` in `board-model.ts`). The agents' columns stay hidden until asked
 * for. A card moves from its sheet's "Move to" row; there is no drag-and-drop yet.
 *
 * Trust boundary carries forward: a card renders title, labels, body, etc.
 * from source data. We show it as content inside <b>, <p>, <span> — never
 * execute it as HTML, never pass it to a prompt, never auto-fetch any URL
 * the title mentions.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Bug, ExternalLink, Layers, Lock, SquareCheck, Users } from 'lucide-react';
import { Loader } from '@/components/loader';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { STATUSES, TASK_TYPES, type StatusDef, type TaskType } from '../../packages/core/src/board.ts';
import { Topbar } from './topbar.tsx';
import { projectsQuery, projectTasksQuery, type TaskRow } from './api.ts';
import { effectiveFilters, groupColumn, indexTasks, taskId, type BoardIndex, type Filters } from './board-model.ts';
import { countedKids, GroupBox, KidBar, TypeTag } from './board-group.tsx';
import { shownKey, sourceBadge, statusName, TaskSheet } from './task-sheet.tsx';

const ALL_EPICS = 'all'; // a Select item can't have an empty value
const byKey = (a: TaskRow, b: TaskRow) => a.importKey.localeCompare(b.importKey, undefined, { numeric: true });

export function TasksBoard() {
  const { slug } = useParams<{ slug: string }>();
  const projects = useQuery(projectsQuery);
  const p = projects.data?.find((x) => x.slug === slug);
  const tasks = useQuery({ ...projectTasksQuery(p?.id ?? ''), enabled: p !== undefined });
  const [open, setOpen] = useState<TaskRow | undefined>(undefined);
  // Per visit, not saved.
  const [filters, setFilters] = useState<Filters>({ type: 'all', epic: '' });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [agents, setAgents] = useState(false);

  const ix = useMemo(() => indexTasks(tasks.data?.tasks ?? []), [tasks.data]);
  const epics = useMemo(() => [...ix.byId.values()].filter((t) => t.type === 'epic').toSorted(byKey), [ix]);
  const epic = effectiveFilters(filters, ix).epic;
  const fold = (key: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  // The sheet follows the task through a refetch; a task gone since keeps its last copy.
  const openRow = open && (ix.byId.get(taskId(open)) ?? open);

  return (
    <div className="flex min-h-dvh flex-col text-[13px]">
      <Topbar slug={slug}>
        {tasks.data && tasks.data.tasks.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={epic === '' ? ALL_EPICS : epic} onValueChange={(v) => setFilters((f) => ({ ...f, epic: v === ALL_EPICS ? '' : v }))}>
              <SelectTrigger size="sm" className="max-w-64 text-xs" aria-label="Epic">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_EPICS}>All epics</SelectItem>
                {epics.map((e) => (
                  <SelectItem key={taskId(e)} value={taskId(e)}>
                    {shownKey(e)} {e.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              spacing={0}
              aria-label="Type"
              value={filters.type}
              onValueChange={(v) => { if (v !== '') setFilters((f) => ({ ...f, type: v as TaskType | 'all' })); }}
            >
              {(['all', ...TASK_TYPES] as const).map((t) => (
                <ToggleGroupItem key={t} value={t} className="text-xs">
                  {t}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Toggle size="sm" variant="outline" className="text-xs" pressed={agents} onPressedChange={setAgents}>
              Show agent statuses
            </Toggle>
          </div>
        )}
      </Topbar>
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6">
        {projects.isPending && <Loader />}
        {projects.data && !p && (
          <p>
            No project has the slug <code>{slug}</code>.{' '}
            <Link href="/" className="text-run underline underline-offset-4">
              Back to projects
            </Link>
          </p>
        )}
        {p && (
          <>
            <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h1 className="font-sans text-lg font-semibold">{p.name}</h1>
                <span className="text-muted-foreground">tasks</span>
                {tasks.data && (
                  <span className="text-xs text-muted-foreground tabular-nums">{tasks.data.tasks.length}</span>
                )}
              </div>
              <Link href={`/p/${encodeURIComponent(p.slug)}`} className="text-xs text-muted-foreground underline underline-offset-4">
                Back to overview
              </Link>
            </header>

            {tasks.isPending && <Loader />}
            {tasks.isError && (
              <p role="alert" className="border-l-2 border-fail bg-[var(--fail-soft)] px-3 py-2 text-fail">
                {tasks.error.message}
              </p>
            )}
            {tasks.data && tasks.data.tasks.length === 0 && <EmptyState />}
            {tasks.data && tasks.data.tasks.length > 0 && (
              <div className="flex min-h-[60dvh] overflow-x-auto border-y border-border">
                {STATUSES.filter((s) => agents || s.owner !== 'agent').map((s) => (
                  <BoardColumn key={s.id} status={s} ix={ix} filters={filters} expanded={expanded} onFold={fold} onOpen={setOpen} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
      {p && <TaskSheet projectId={p.id} row={openRow} ix={ix} onClose={() => setOpen(undefined)} />}
    </div>
  );
}

function BoardColumn({
  status,
  ix,
  filters,
  expanded,
  onFold,
  onOpen,
}: {
  status: StatusDef;
  ix: BoardIndex;
  filters: Filters;
  expanded: ReadonlySet<string>;
  onFold: (key: string) => void;
  onOpen: (t: TaskRow) => void;
}) {
  const g = groupColumn(status.id, ix, filters, expanded);
  const agent = status.owner === 'agent';
  const card = (t: TaskRow) => <TaskCard key={taskId(t)} row={t} ix={ix} onOpen={onOpen} />;
  const group = { column: status.id, ix, onFold, onOpen };
  const empty = g.epics.length + g.stories.length + g.loose.length === 0;
  return (
    <section
      aria-label={status.id}
      className={`flex min-w-[226px] max-w-[360px] flex-[1_1_226px] flex-col border-r border-border ${agent ? 'bg-[var(--surface-2)]' : ''}`}
    >
      <header className="border-b border-border px-3 pt-3 pb-2">
        <h2 className="m-0 flex items-center gap-1.5 text-[12.5px] font-semibold">
          {agent && <Lock aria-hidden className="size-3 text-muted-foreground" />}
          {status.owner === 'tasks' && <Layers aria-hidden className="size-3 text-muted-foreground" />}
          {status.id} <span className="font-normal text-muted-foreground tabular-nums">{g.count}</span>
        </h2>
        <p className="m-0 mt-0.5 text-[10.5px] text-muted-foreground">{status.who}</p>
        <p className="m-0 mt-1 font-sans text-[11.5px] leading-snug text-muted-foreground">{status.means}</p>
      </header>
      <div className="flex flex-col gap-[7px] p-2 pb-10">
        {g.epics.map((e) => (
          <GroupBox key={taskId(e.head)} group={e} {...group}>
            {e.stories.map((s) => (
              <GroupBox key={taskId(s.head)} group={s} {...group}>
                {s.cards.map(card)}
              </GroupBox>
            ))}
            {e.cards.map(card)}
          </GroupBox>
        ))}
        {g.stories.map((s) => (
          <GroupBox key={taskId(s.head)} group={s} {...group}>
            {s.cards.map(card)}
          </GroupBox>
        ))}
        {effectiveFilters(filters, ix).epic === '' && g.epics.length + g.stories.length > 0 && g.loose.length > 0 && (
          <p className="m-0 border-t border-border pt-1 text-[10.5px] tracking-[0.06em] text-muted-foreground">no epic or story</p>
        )}
        {g.loose.map(card)}
        {empty && (
          <p className="m-0 border border-dashed border-input px-1 py-2.5 text-center text-[11px] text-muted-foreground">nothing here</p>
        )}
      </div>
    </section>
  );
}

function TaskCard({ row, ix, onOpen }: { row: TaskRow; ix: BoardIndex; onOpen: (t: TaskRow) => void }) {
  const status = statusName(row);
  const labels = row.labels.slice(0, 3);
  const extraLabels = row.labels.length - labels.length;
  const kids = row.type === 'story' || row.type === 'epic' ? countedKids(row, ix) : [];
  const done = kids.filter((k) => ix.column.get(taskId(k)) === 'done').length;
  const look =
    row.type === 'epic'
      ? 'border-l-[3px] border-l-[var(--ink)] bg-[var(--surface-3)]'
      : row.type === 'story'
        ? 'border-l-[3px] border-l-[var(--ink-3)] bg-[var(--surface-2)]'
        : 'bg-[var(--surface)]';
  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      className={`grid w-full gap-[5px] border border-border px-2.5 pt-2 pb-[9px] text-left hover:border-[var(--line-2)] ${look}`}
    >
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {row.type === 'story' || row.type === 'epic' ? (
          <TypeTag type={row.type} />
        ) : (
          <span title={row.type}>
            {row.type === 'bug' ? <Bug aria-label="bug" className="size-3.5" /> : <SquareCheck aria-label="task" className="size-3.5" />}
          </span>
        )}
        <span className="truncate font-mono">{shownKey(row)}</span>
        <span className="flex-1" />
        <span className="border border-dashed border-input px-1">{sourceBadge(row.sourceId)}</span>
      </span>
      <span className="font-sans text-[13px] leading-[1.3] font-medium [overflow-wrap:anywhere]">{row.title}</span>
      {kids.length > 0 && (
        <>
          <KidBar kids={kids} ix={ix} />
          <span className="flex items-center gap-1.5 text-[11px] text-[var(--ink-2)]">
            <Layers aria-hidden className="size-3" />
            {done} of {kids.length} {row.type === 'epic' ? 'stories' : 'tasks'} done
          </span>
        </>
      )}
      {row.type === 'story' && kids.length === 0 && (
        <span className="flex items-center gap-1.5 text-[11px] text-[var(--ink-2)]">
          <Layers aria-hidden className="size-3" />
          not split yet
        </span>
      )}
      {(labels.length > 0 || row.assignees.length > 0 || status !== undefined) && (
        <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {status !== undefined && <span className="border border-border px-1.5">{status}</span>}
          {labels.map((l) => (
            <span key={l} className="border border-border px-1.5">
              {l}
            </span>
          ))}
          {extraLabels > 0 && <span className="text-muted-foreground">+{extraLabels}</span>}
          {row.assignees.length > 0 && (
            <span className="ml-auto inline-flex items-center gap-1">
              <Users aria-hidden className="size-3" />
              {row.assignees.length}
            </span>
          )}
        </span>
      )}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="grid gap-2 border border-dashed border-input px-5 py-10 text-center text-muted-foreground">
      <p className="m-0 font-sans text-base font-semibold text-foreground">No tasks yet</p>
      <p className="m-0 text-xs">Click <b>Import from Jira</b> on the project overview to pull your tickets in.</p>
      <p className="m-0 text-xs">
        <Link href="../" className="text-run underline underline-offset-4 inline-flex items-center gap-1">
          Back to overview <ExternalLink aria-hidden className="size-3" />
        </Link>
      </p>
    </div>
  );
}
