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
    if (p === undefined) continue;
    const list = kids.get(taskId(p));
    if (list === undefined) kids.set(taskId(p), [t]);
    else list.push(t);
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

/** The card this one sits under, when its parent is here and of a type that holds it. */
export function parentOf(t: TaskRow, byId: Map<string, TaskRow>): TaskRow | undefined {
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

/** A picked epic that is gone, or no longer an epic after a re-import, means all epics. */
export const effectiveFilters = (f: Filters, ix: BoardIndex): Filters =>
  f.epic !== '' && ix.byId.get(f.epic)?.type !== 'epic' ? { ...f, epic: '' } : f;

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

/**
 * `expanded` holds `${column}:${taskId}` keys; every other group is folded.
 * Cards are filtered by type first, then grouped. A group shows only when it has visible
 * content here (a passing card, or for an epic a visible story group); a container in this
 * column with no visible content is a plain card in its epic's group, or loose.
 */
export function groupColumn(
  column: StatusId,
  ix: BoardIndex,
  filters: Filters,
  expanded: ReadonlySet<string>,
): ColumnGroups {
  const f = effectiveFilters(filters, ix);
  const kidsOf = (t: TaskRow) => (ix.kids.get(taskId(t)) ?? []).toSorted(byKey);
  const hasKids = (t: TaskRow) => (ix.kids.get(taskId(t))?.length ?? 0) > 0;
  const shown = (t: TaskRow) =>
    ix.column.get(taskId(t)) === column && (f.type === 'all' || t.type === f.type);

  // Sorts `k` into a group (when it has visible content) or a plain card.
  const place = (k: TaskRow, groups: Group[], cards: TaskRow[]) => {
    const g = hasKids(k) ? build(k) : undefined;
    if (g !== undefined) groups.push(g);
    else if (shown(k)) cards.push(k);
  };

  const build = (head: TaskRow): Group | undefined => {
    const kids = kidsOf(head);
    const stories: Group[] = [];
    const cards: TaskRow[] = [];
    for (const k of kids) place(k, stories, cards);
    if (stories.length === 0 && cards.length === 0) return undefined;
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
  for (const t of tops.toSorted(byKey)) place(t, t.type === 'epic' ? out.epics : out.stories, out.loose);
  // Every task here that passes the filters, whether it shows as a card or as a group head.
  out.count = [...ix.byId.values()].filter((t) => shown(t) && (f.epic === '' || epicOf(t, ix) === f.epic)).length;
  return out;
}
