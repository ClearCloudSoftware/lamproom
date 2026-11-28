/**
 * Map a Lamproom StatusId to Jira transition names, and pick the best
 * transition from the issue's available list.
 *
 * Jira workflows don't expose a "set status" API — you ask for the list of
 * transitions available FROM the issue's current state, each of which has a
 * `to.name` (the target status) and an id. To move an issue to "Done", you
 * find a transition whose `to.name` is Done (or similar) and POST its id.
 *
 * Because status names are configurable per Jira project, the match uses a
 * ranked list of synonyms per Lamproom status. The first synonym that hits
 * a case-insensitive `to.name` wins. A workflow whose names match none of
 * the synonyms reports "no transition to <X>" and the write-back fails
 * cleanly — the operator can either rename their Jira statuses or the
 * follow-up plan will add a per-project mapping UI.
 */

import type { StatusId } from '@lamproom/core';

export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string; statusCategory?: { key?: string } };
}

/**
 * Candidates to look for in a Jira transition's `to.name`, in order of
 * preference. The match is case-insensitive and exact (no substring),
 * because "Done" and "Ready for Done" are legitimately different things.
 */
const TARGETS: Record<StatusId, readonly string[]> = {
  'backlog': ['Backlog', 'To Do'],
  'needs-triage': ['Needs Triage', 'Triage', 'To Do'],
  'needs-info': ['Needs Info', 'Waiting for info', 'In Progress'],
  'needs-context': ['Needs Context', 'In Progress'],
  'ready-for-agent': ['Ready for Agent', 'Ready', 'To Do'],
  'ready-for-human': ['Ready for Review', 'In Review', 'In Progress'],
  'in tasks': [],
  'in progress': ['In Progress', 'Doing', 'In Development'],
  'done': ['Done', 'Closed', 'Resolved'],
  'wontfix': ["Won't Do", "Won't Fix", 'Cancelled', 'Done'],
};

/** Pick the transition whose `to.name` best matches the requested Lamproom status. */
export function pickTransition(
  status: StatusId,
  transitions: readonly JiraTransition[],
): JiraTransition | undefined {
  const candidates = TARGETS[status];
  for (const wanted of candidates) {
    const hit = transitions.find((t) => t.to.name.toLowerCase() === wanted.toLowerCase());
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** Human-readable message when no transition is available. */
export function noTransitionMessage(
  status: StatusId,
  transitions: readonly JiraTransition[],
): string {
  const have = transitions.length === 0 ? 'none available' : transitions.map((t) => t.to.name).join(', ');
  return `no Jira transition to '${status}' from this issue's current state; available targets: ${have}`;
}
