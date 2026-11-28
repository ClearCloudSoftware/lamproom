'use client';
/**
 * One task, opened from the board: its column, type and parent, a "Move to" row, then what the source says.
 * Source content (title, body, labels) is data: rendered as text, never as HTML.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { canMove, STATUSES, type StatusId } from '../../packages/core/src/board.ts';
import { moveTaskMutation, type TaskRow } from './api.ts';
import { parentOf, taskId, type BoardIndex } from './board-model.ts';

export function statusName(t: TaskRow): string | undefined {
  const raw = t.extras['statusName'];
  return typeof raw === 'string' ? raw : undefined;
}

function upstreamKey(t: TaskRow): string | undefined {
  const raw = t.extras['issueKey'];
  if (typeof raw === 'string') return raw;
  return t.hint.upstream;
}

/** The key a person knows the task by: the upstream issue key, else the import key. */
export const shownKey = (t: TaskRow): string => upstreamKey(t) ?? t.importKey;

export function sourceBadge(sourceId: string): string {
  if (sourceId === 'jira') return 'Jira';
  if (sourceId === 'github') return 'GitHub';
  if (sourceId === 'markdown') return 'Markdown';
  return sourceId;
}

const label = 'text-[10px] font-medium tracking-[0.1em] text-muted-foreground uppercase';

export function TaskSheet({
  projectId,
  row,
  ix,
  onClose,
}: {
  projectId: string;
  row: TaskRow | undefined;
  ix: BoardIndex;
  onClose: () => void;
}) {
  const open = row !== undefined;
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent side="right" className="w-full font-sans sm:max-w-xl">
        {row && (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2 text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
                <span className="font-mono">{shownKey(row)}</span>
                <span className="border border-dashed border-input px-1 normal-case tracking-normal">{sourceBadge(row.sourceId)}</span>
                {statusName(row) !== undefined && (
                  <span className="border border-border px-1.5 normal-case tracking-normal text-foreground">{statusName(row)}</span>
                )}
              </div>
              <SheetTitle className="font-sans text-base leading-snug [overflow-wrap:anywhere]">{row.title}</SheetTitle>
              <SheetDescription className="text-xs text-muted-foreground">
                updated {new Date(row.updatedAt).toLocaleString()}
              </SheetDescription>
            </SheetHeader>
            <div className="grid gap-4 overflow-y-auto px-4 pb-4 text-[13px]">
              {/* Keyed so a move's error belongs to the task it was made on. */}
              <Placement key={taskId(row)} projectId={projectId} row={row} ix={ix} />
              {row.labels.length > 0 && (
                <section className="grid gap-1.5">
                  <h4 className={label}>labels</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {row.labels.map((l) => (
                      <span key={l} className="border border-border px-1.5 text-xs">{l}</span>
                    ))}
                  </div>
                </section>
              )}
              {row.assignees.length > 0 && (
                <section className="grid gap-1.5">
                  <h4 className={label}>assignees</h4>
                  <ul className="m-0 grid list-none gap-1 p-0 text-xs">
                    {row.assignees.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </section>
              )}
              {row.acceptance.length > 0 && (
                <section className="grid gap-1.5">
                  <h4 className={label}>acceptance criteria</h4>
                  <ul className="m-0 grid list-none gap-1 border-l-2 border-border pl-3 text-xs">
                    {row.acceptance.map((line, i) => (
                      <li key={`${i}:${line}`}>{line}</li>
                    ))}
                  </ul>
                </section>
              )}
              {row.nonGoals.length > 0 && (
                <section className="grid gap-1.5">
                  <h4 className={label}>non-goals</h4>
                  <ul className="m-0 grid list-none gap-1 border-l-2 border-border pl-3 text-xs">
                    {row.nonGoals.map((line, i) => (
                      <li key={`${i}:${line}`}>{line}</li>
                    ))}
                  </ul>
                </section>
              )}
              {row.body !== null && row.body.trim() !== '' && (
                <section className="grid gap-1.5">
                  <h4 className={label}>description</h4>
                  <pre className="m-0 overflow-x-auto border border-border bg-card px-3 py-2 font-sans text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {row.body}
                  </pre>
                </section>
              )}
              <section className="grid gap-1 border-t border-border pt-3 text-[11px] text-muted-foreground">
                <div className="grid grid-cols-[96px_1fr] gap-2"><span>source</span><code className="break-all font-mono">{row.sourceId}</code></div>
                <div className="grid grid-cols-[96px_1fr] gap-2"><span>key</span><code className="break-all font-mono">{row.importKey}</code></div>
                <div className="grid grid-cols-[96px_1fr] gap-2"><span>imported</span><span>{new Date(row.importedAt).toLocaleString()}</span></div>
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Where the task sits and where it can go. */
function Placement({ projectId, row, ix }: { projectId: string; row: TaskRow; ix: BoardIndex }) {
  const move = useMutation(moveTaskMutation(projectId, useQueryClient()));
  // A task gone after a refetch keeps its last status, so the sheet can still say why the move failed.
  const column: StatusId = ix.column.get(taskId(row)) ?? row.status;
  const def = STATUSES.find((s) => s.id === column);
  const parent = parentOf(row, ix.byId);
  return (
    <section className="grid gap-2">
      <dl className="m-0 grid grid-cols-[96px_1fr] gap-x-2 gap-y-1 text-xs">
        <dt className="text-muted-foreground">status</dt>
        <dd className="m-0">
          <b>{column}</b>
          {def && <span className="text-muted-foreground"> · {def.who}</span>}
        </dd>
        <dt className="text-muted-foreground">type</dt>
        <dd className="m-0 [overflow-wrap:anywhere]">
          {row.type}
          {parent && ` · part of ${shownKey(parent)} ${parent.title}`}
        </dd>
      </dl>
      <h4 className={label}>Move to</h4>
      {/* The statuses you own, plus where the card sits now (as in the mockup); a refused one carries its reason in a tooltip. */}
      <div className="flex flex-wrap gap-1">
        {STATUSES.filter((s) => s.owner === 'you' || s.id === column).map((s) => {
          const why = canMove(row.type, column, s.id);
          if (why === 'same')
            return (
              <Button key={s.id} size="xs" aria-current="true" disabled className="border-[var(--ink)] bg-[var(--ink)] text-[var(--surface)] disabled:opacity-100">
                {s.id}
              </Button>
            );
          if (why === '')
            return (
              <Button
                key={s.id}
                size="xs"
                variant="outline"
                disabled={move.isPending}
                onClick={() => move.mutate({ sourceId: row.sourceId, importKey: row.importKey, to: s.id })}
              >
                {s.id}
              </Button>
            );
          return (
            <Tooltip key={s.id}>
              {/* A disabled button gets no pointer events, so the tooltip hangs on a focusable wrapper. */}
              <TooltipTrigger asChild>
                <span tabIndex={0} aria-label={`${s.id}: ${why}`}>
                  <Button size="xs" variant="outline" disabled tabIndex={-1}>
                    {s.id}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{why}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      {move.isError && (
        <p role="alert" className="m-0 border-l-2 border-fail bg-[var(--fail-soft)] px-3 py-2 text-xs text-fail">
          {move.error.message}
        </p>
      )}
      {move.data?.writeBack && !move.data.writeBack.ok && (
        <p role="status" className="m-0 border-l-2 border-wait bg-[var(--wait-soft)] px-3 py-2 text-xs text-wait whitespace-pre-wrap break-words">
          Moved in Lamproom, but the source refused the write: {move.data.writeBack.reason}
        </p>
      )}
    </section>
  );
}
