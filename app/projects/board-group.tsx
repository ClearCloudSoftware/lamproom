'use client';
/** An epic or story group in a board column (the mockup's `.grp`), and the type tag and progress bar its cards share. */
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { StatusId, TaskType } from '../../packages/core/src/board.ts';
import type { TaskRow } from './api.ts';
import { taskId, type BoardIndex, type Group } from './board-model.ts';
import { shownKey } from './task-sheet.tsx';

/** The children a container's progress counts: an epic's stories, a story's tasks and bugs. Same rule as `groupColumn`. */
export function countedKids(head: TaskRow, ix: BoardIndex): TaskRow[] {
  const kids = ix.kids.get(taskId(head)) ?? [];
  return (head.type === 'epic' ? kids.filter((k) => k.type === 'story') : kids).toSorted((a, b) =>
    a.importKey.localeCompare(b.importKey, undefined, { numeric: true }),
  );
}

/** The solid EPIC or outlined STORY tag. */
export function TypeTag({ type }: { type: TaskType }) {
  return (
    <span
      className={`shrink-0 border px-[5px] text-[9.5px] leading-[15px] tracking-[0.1em] uppercase ${
        type === 'epic' ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]' : 'border-[var(--ink-3)] text-[var(--ink-2)]'
      }`}
    >
      {type}
    </span>
  );
}

/** One segment per counted child: done, running, or still to do. */
export function KidBar({ kids, ix }: { kids: TaskRow[]; ix: BoardIndex }) {
  const tone = (c: StatusId | undefined) =>
    c === 'done' ? 'bg-[var(--done)]' : c === 'in progress' ? 'bg-[var(--run)]' : 'bg-[var(--line-2)]';
  return (
    <span className="flex max-w-[140px] gap-0.5" aria-hidden>
      {kids.map((k) => (
        <span key={taskId(k)} className={`h-1.5 flex-1 ${tone(ix.column.get(taskId(k)))}`} />
      ))}
    </span>
  );
}

export function GroupBox({
  column,
  group,
  ix,
  onFold,
  onOpen,
  children,
}: {
  column: StatusId;
  group: Group;
  ix: BoardIndex;
  onFold: (key: string) => void;
  onOpen: (t: TaskRow) => void;
  children: ReactNode;
}) {
  const { head } = group;
  const epic = head.type === 'epic';
  const hidden = group.cards.length + group.stories.reduce((n, s) => n + s.cards.length, 0);
  return (
    <Collapsible
      open={!group.folded}
      onOpenChange={() => onFold(`${column}:${taskId(head)}`)}
      className={`flex flex-col gap-1.5 border border-l-[3px] px-1.5 pb-1.5 ${
        epic
          ? 'border-[var(--line-2)] border-l-[var(--ink)] bg-[var(--surface-3)]'
          : 'border-[var(--line)] border-l-[var(--ink-3)] bg-[var(--surface-2)]'
      }`}
    >
      <div
        className={`-mx-1.5 grid min-w-0 gap-[5px] border-b px-2 pt-[7px] pb-1.5 text-[11px] text-[var(--ink-2)] ${
          epic ? 'border-[var(--line-2)]' : 'border-[var(--line)]'
        }`}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <CollapsibleTrigger
            className="shrink-0 text-[var(--ink-3)] hover:text-[var(--ink)]"
            title={`${group.folded ? 'Show' : 'Hide'} what’s under this ${head.type}`}
          >
            {group.folded ? <ChevronRight aria-hidden className="size-3.5" /> : <ChevronDown aria-hidden className="size-3.5" />}
          </CollapsibleTrigger>
          <button
            type="button"
            className="group/open flex min-w-0 flex-1 items-center gap-1.5 text-left"
            title={`Open the ${head.type}`}
            onClick={() => onOpen(head)}
          >
            <TypeTag type={head.type} />
            <span className="shrink-0 font-mono">{shownKey(head)}</span>
            <span className="min-w-0 flex-1 truncate font-sans text-[12.5px] font-semibold text-[var(--ink)] group-hover/open:underline">
              {head.title}
            </span>
          </button>
        </span>
        <KidBar kids={countedKids(head, ix)} ix={ix} />
        <span>
          {group.done} of {group.total} {epic ? 'stories' : 'tasks'} done · {head.type}: {ix.column.get(taskId(head))}
          {group.folded && ` · ${hidden} hidden here`}
        </span>
      </div>
      <CollapsibleContent className="flex flex-col gap-1.5">{children}</CollapsibleContent>
    </Collapsible>
  );
}
