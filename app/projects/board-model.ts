/** The board's model: each task's column, cards grouped epic → story → task per column, and the filters. Pure. */
import { columnOf, isContainer, type StatusId, type TaskType } from '../../packages/core/src/board.ts';
import type { TaskRow } from './api.ts';

export const taskId = (t: TaskRow): string => `${t.sourceId}:${t.importKey}`;

export interface BoardIndex {
  byId: Map<string, TaskRow>;
  kids: Map<string, TaskRow[]>;
  column: Map<string, StatusId>;
}

const byKey = (a: TaskRow, b: TaskRow): number =>
  a.importKey.localeCompare(b.importKey, undefined, { numeric: true });

/** A story sits under an epic; a task or bug under a story or an epic; an epic under nothing. */
const fits = (parent: TaskType, child: TaskType): boolean =>
  child === 'story' ? parent === 'epic' : (child === 'task' || child === 'bug') && isContainer(parent);

export function indexTasks(tasks: TaskRow[]): BoardIndex {
  const byId = new Map(tasks.map((t) => [taskId(t), t]));
  const kids = new Map<string, TaskRow[]>();
  for (const t of tasks) {
    const p = parentOf(t, byId);
    if (p !== undefined) kids.set(taskId(p), [...(kids.get(taskId(p)) ?? []), t]);
  }
  // Same rule as the server's `columnFor`: tasks and bugs first, then stories, then epics.
  const column = new Map<string, StatusId>();
  for (const type of ['task', 'bug', 'story', 'epic'] as const) {
    for (const t of tasks.filter((x) => x.type === type)) {
      const childColumns = (kids.get(taskId(t)) ?? []).map((k) => column.get(taskId(k))!);
      column.set(taskId(t), columnOf(t.type, t.status, childColumns));
    }
  }
  return { byId, kids, column };
}

function parentOf(t: TaskRow, byId: Map<string, TaskRow>): TaskRow | undefined {
  const p = t.parentKey === null ? undefined : byId.get(`${t.sourceId}:${t.parentKey}`);
  return p !== undefined && fits(p.type, t.type) ? p : undefined;
}

/** The epic a card belongs to, directly or through its story. */
export function epicOf(t: TaskRow, ix: BoardIndex): string | undefined {
  const p = parentOf(t, ix.byId);
  if (p === undefined) return undefined;
  return p.type === 'epic' ? taskId(p) : epicOf(p, ix);
}

export interface Filters {
  type: TaskType | 'all';
  epic: string; // an epic's taskId; '' means all epics
}

export const effectiveFilters = (f: Filters, ix: BoardIndex): Filters =>
  f.epic !== '' && !ix.byId.has(f.epic) ? { ...f, epic: '' } : f;

export interface Group {
  head: TaskRow;
  cards: TaskRow[];
  stories: Group[];
  folded: boolean;
  done: number;
  total: number;
}

export interface ColumnGroups {
  epics: Group[];
  stories: Group[];
  loose: TaskRow[];
  count: number;
}

/** `expanded` holds `${column}:${taskId}` keys; every other group is folded. */
export function groupColumn(
  column: StatusId,
  ix: BoardIndex,
  f: Filters,
  expanded: ReadonlySet<string>,
): ColumnGroups {
  const kidsOf = (t: TaskRow) => (ix.kids.get(taskId(t)) ?? []).toSorted(byKey);
  const hasKids = (t: TaskRow) => isContainer(t.type) && kidsOf(t).length > 0;
  const inColumn = (t: TaskRow) => ix.column.get(taskId(t)) === column;
  const shown = (t: TaskRow) => inColumn(t) && (f.type === 'all' || t.type === f.type);
  let count = 0;

  // A group shows when a card of its own passes, or (with no type filter) when its head sits in this column.
  const build = (head: TaskRow): Group | undefined => {
    const kids = kidsOf(head);
    const stories: Group[] = [];
    const cards: TaskRow[] = [];
    for (const k of kids) {
      if (hasKids(k)) {
        const g = build(k);
        if (g !== undefined) stories.push(g);
      } else if (shown(k)) {
        cards.push(k);
        count++;
      }
    }
    if (stories.length === 0 && cards.length === 0 && !(f.type === 'all' && inColumn(head))) return undefined;
    const counted = head.type === 'epic' ? kids.filter((k) => k.type === 'story') : kids;
    return {
      head,
      cards,
      stories,
      folded: !expanded.has(`${column}:${taskId(head)}`),
      done: counted.filter((k) => ix.column.get(taskId(k)) === 'done').length,
      total: counted.length,
    };
  };

  const out: ColumnGroups = { epics: [], stories: [], loose: [], count: 0 };
  const tops =
    f.epic === ''
      ? [...ix.byId.values()].filter((t) => parentOf(t, ix.byId) === undefined)
      : kidsOf(ix.byId.get(f.epic)!);
  for (const t of tops.toSorted(byKey)) {
    if (hasKids(t)) {
      const g = build(t);
      if (g !== undefined) (t.type === 'epic' ? out.epics : out.stories).push(g);
    } else if (shown(t)) {
      out.loose.push(t);
      count++;
    }
  }
  out.count = count;
  return out;
}
