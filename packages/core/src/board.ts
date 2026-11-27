export const TASK_TYPES = ['bug', 'task', 'story', 'epic'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

/** A story or an epic holds other cards. */
export const isContainer = (t: TaskType): boolean => t === 'story' || t === 'epic';

export type StatusId =
  | 'backlog' | 'needs-triage' | 'needs-info' | 'needs-context' | 'ready-for-agent'
  | 'ready-for-human' | 'in tasks' | 'in progress' | 'done' | 'wontfix';

export interface StatusDef {
  id: StatusId;
  category: 'todo' | 'doing' | 'done';
  owner: 'you' | 'agent' | 'tasks';
  who: string;
  means: string;
}

/** The board's columns, in board order. You manage five; agents, runs and children manage the rest. */
export const STATUSES: readonly StatusDef[] = [
  { id: 'backlog', category: 'todo', owner: 'you', who: 'you manage', means: 'Parked. Nothing runs and nothing is spent until you move it on.' },
  { id: 'needs-triage', category: 'todo', owner: 'agent', who: 'triage agent', means: 'New issues land here; the triage agent reads each one and decides what it is.' },
  { id: 'needs-info', category: 'todo', owner: 'agent', who: 'triage agent → reporter', means: 'The agent asked whoever filed it for detail only they have.' },
  { id: 'needs-context', category: 'todo', owner: 'agent', who: 'triage agent, repo-analyst', means: 'The ask is clear, but the agent couldn’t find where in the code to start or which rule applies.' },
  { id: 'ready-for-agent', category: 'todo', owner: 'you', who: 'you manage', means: 'You want an agent on it. The triage agent checks it first; then Start run.' },
  { id: 'ready-for-human', category: 'todo', owner: 'you', who: 'you manage', means: 'Needs hands an agent shouldn’t have: secrets, production, a judgement call.' },
  { id: 'in tasks', category: 'doing', owner: 'tasks', who: 'its tasks', means: 'A story split into tasks, or an epic into stories. It moves on by itself when its last child is done.' },
  { id: 'in progress', category: 'doing', owner: 'agent', who: 'the run', means: 'A run is working through the flow. Cards come and go with the run.' },
  { id: 'done', category: 'done', owner: 'you', who: 'you, or a finished run', means: 'Finished: a run landed it, or you closed it yourself.' },
  { id: 'wontfix', category: 'done', owner: 'you', who: 'you manage', means: 'Will not be actioned.' },
];

export const isStatus = (s: unknown): s is StatusId => STATUSES.some((d) => d.id === s);

export const isClosed = (s: StatusId): boolean => s === 'done' || s === 'wontfix';

/** Where a card sits. A container follows its children; everything else sits in its own status. */
export function columnOf(type: TaskType, status: StatusId, childColumns: StatusId[]): StatusId {
  if (!isContainer(type) || isClosed(status) || childColumns.length === 0) return status;
  if (childColumns.every(isClosed)) return childColumns.includes('done') ? 'done' : status;
  return 'in tasks';
}

/** Why a card can't move from `column` to `to`. Empty means it can; 'same' means there is no move. */
export function canMove(type: TaskType, column: StatusId, to: StatusId): string {
  if (column === to) return 'same';
  if (column === 'in tasks') return "An epic or story moves with its children. It's done when the last of them is.";
  if (to === 'in tasks') return 'Only an epic or story with children goes in tasks, and it goes there by itself.';
  if (column === 'in progress') return 'A run owns this card. It moves on when the run does.';
  if (to === 'in progress') return "Only a run puts a card in progress, and the board can't start runs yet.";
  if (type === 'epic' && to === 'ready-for-agent') return 'An epic runs no flow: open one of its stories and run that.';
  if (STATUSES.find((d) => d.id === to)?.owner === 'agent') return `Agents set ${to}. You can't move a card there.`;
  return '';
}
