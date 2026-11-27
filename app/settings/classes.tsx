'use client';
/**
 * The Model classes section: for each agent CLI, which model and effort a class (deep, standard, fast) runs on under
 * each profile; the profile in use is the one runs resolve through. As `docs/mockups/model-classes-map.html` draws it;
 * the rules are in `classes-model.ts`, the spec in docs/Lamproom/Agent Providers/Model Catalogue.md.
 */
import { useForm, useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, SquareTerminal } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ProviderModel } from '../../packages/core/src/ports/agent-provider.ts';
import { CLASSES, type ClassCell, cellProblem, type Effort, type Harness, HARNESSES, type ModelClass, type ModelClasses, type Profile, PROFILES } from '../../packages/cli/src/settings.ts';
import { agentModelsQuery, type AppView, appSettingsQuery, refreshAgentModels, updateAppSettings } from '../projects/api.ts';
import { aliasOf, blocking, notSet, unset, withModel } from './classes-model.ts';
import { ErrorLine, Head } from './settings.tsx';
import { Loader } from '@/components/loader';

const CLASS_TEXT: Record<ModelClass, string> = {
  deep: 'Thinking model, high effort. Implementing, planning, debugging.',
  standard: 'Reviews, docs, routine edits.',
  fast: 'Triage, summaries, imports.',
};
const PROFILE_TEXT: Record<Profile, string> = { quality: 'Best models. Costs most.', balanced: 'Strong where it matters.', budget: 'Small and local models.' };
const CLIS = Object.keys(HARNESSES) as Harness[];
const NONE = '-'; // Radix keeps '' for "nothing picked"
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One block per level the model has, filled up to the cell's; a dash for a model with none. */
function Meter({ m, effort }: { m: ProviderModel | undefined; effort: Effort | null }) {
  const em = 'text-[10.5px] text-muted-foreground not-italic';
  if (!m) return effort && <em className={em}>{effort}</em>;
  if (!m.efforts.length) return <em className={em}>—</em>;
  const n = effort ? m.efforts.indexOf(effort) + 1 : 0;
  return (
    <span className="inline-flex items-center gap-0.5">
      {m.efforts.map((l, i) => (
        <i key={l} className={`h-2.5 w-[7px] ${i < n ? 'bg-foreground' : 'bg-secondary shadow-[inset_0_0_0_1px_var(--line-2)]'}`} />
      ))}
      <em className={`ml-1.5 ${em}`}>{effort ?? 'pick a level'}</em>
    </span>
  );
}

function Table({ view, cli, setCli }: { view: AppView; cli: Harness; setCli: (c: Harness) => void }) {
  const queryClient = useQueryClient();
  const cc = useQuery(agentModelsQuery('claude-code'));
  const oc = useQuery(agentModelsQuery('opencode'));
  const lists = { 'claude-code': cc, opencode: oc };
  // fetchedAt null: never listed, so nothing to check against (the server skips the checks too).
  const offered = Object.fromEntries(CLIS.map((c) => [c, lists[c].data?.fetchedAt ? lists[c].data.models : null])) as Record<Harness, ProviderModel[] | null>;
  const list = lists[cli].data;

  const saved = view.app.modelClasses;
  const save = useMutation({ mutationFn: (modelClasses: ModelClasses) => updateAppSettings({ modelClasses }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }) });
  // The CLI rides with the request, so a tab switched mid-list still stores the answer under the CLI it came from.
  const refresh = useMutation({ mutationFn: (c: Harness) => refreshAgentModels(c), onSuccess: (d, c) => queryClient.setQueryData(agentModelsQuery(c).queryKey, d) });
  const form = useForm({ defaultValues: saved, onSubmit: ({ value }) => save.mutate(value) });
  const t = useStore(form.store, (s) => s.values);
  const [edit, setEdit] = useState<{ p: Profile; k: ModelClass } | null>(null);

  const cellsOf = (m: ModelClasses, c: Harness) => PROFILES.flatMap((p) => CLASSES.map((k) => JSON.stringify(m.profiles[p][k][c])));
  const edited = (c: Harness) => cellsOf(t, c).some((x, i) => x !== cellsOf(saved, c)[i]);
  const changes = CLIS.reduce((n, c) => n + cellsOf(t, c).filter((x, i) => x !== cellsOf(saved, c)[i]).length, t.inUse === saved.inUse ? 0 : 1);
  const blocked = blocking(t, offered);
  const find = (c: Harness, id: string | undefined) => offered[c]?.find((m) => m.id === id);
  const setCell = (p: Profile, k: ModelClass, cell: ClassCell | null) => form.setFieldValue('profiles', (ps) => ({ ...ps, [p]: { ...ps[p], [k]: { ...ps[p][k], [cli]: cell } } }));
  const label = (cell: ClassCell) => {
    const m = find(cli, cell.model);
    if (!m) return cell.model;
    const to = cli === 'claude-code' && aliasOf(m, offered[cli] ?? []);
    return to ? `${m.id} → ${to}` : cli === 'claude-code' ? m.id : m.name;
  };

  return (
    <div className="grid gap-0">
      <div role="tablist" aria-label="Agent CLI" className="flex items-end overflow-x-auto border-b-2 border-foreground">
        <span className="pr-3.5 pb-2 text-[10px] font-medium tracking-[0.12em] whitespace-nowrap text-muted-foreground uppercase">Agent CLI</span>
        {CLIS.map((c) => {
          const n = notSet(t, c, offered[c]);
          return (
            <button key={c} type="button" role="tab" aria-selected={c === cli} title={n ? `${plural(n, 'cell', 'cells')} with no model, or no effort` : undefined} onClick={() => {
                setCli(c);
                setEdit(null);
              }} className={`mr-0.5 flex items-center gap-1.5 border border-b-0 px-3.5 py-2 font-mono text-[13px] whitespace-nowrap ${c === cli ? 'border-foreground bg-foreground font-semibold text-background' : 'border-input bg-accent hover:bg-secondary'}`}>
              <SquareTerminal aria-hidden className="size-3.5" strokeWidth={1.75} />
              {c}
              {n > 0 && <span className="bg-fail px-1.5 text-[10.5px] font-semibold text-white">{n} not set</span>}
              {edited(c) && <span aria-label="unsaved" className="size-1.5 bg-current" />}
            </button>
          );
        })}
        <span className="flex-1" />
        <span className="pr-2 pb-2 text-[11px] whitespace-nowrap text-muted-foreground">{list?.fetchedAt ? `listed ${new Date(list.fetchedAt).toLocaleString()}` : lists[cli].isPending ? 'listing…' : 'never listed'}</span>
        <Button size="sm" variant="outline" className="mb-1" disabled={refresh.isPending} onClick={() => refresh.mutate(cli)}>
          <RefreshCw aria-hidden className={`size-3.5 ${refresh.isPending ? 'animate-spin' : ''}`} strokeWidth={1.75} />
          {refresh.isPending ? 'Listing…' : 'List again'}
        </Button>
      </div>
      {list?.error && <p className="m-0 border-l-[3px] border-wait bg-[var(--wait-soft)] px-2.5 py-1.5 text-xs text-wait">{list.error}{list.fetchedAt && '; showing the list saved earlier'}</p>}
      {list && !list.fetchedAt && <p className="m-0 border-l-[3px] border-wait bg-[var(--wait-soft)] px-2.5 py-1.5 text-xs text-wait">{cli} has never listed its models on this machine, so its cells are not checked here. Install it, then list again.</p>}
      <ErrorLine error={lists[cli].error ?? refresh.error} />

      <div className="overflow-x-auto border border-t-0 border-input bg-card">
        <div className="grid min-w-[640px] grid-cols-[150px_repeat(3,minmax(0,1fr))] md:grid-cols-[190px_repeat(3,minmax(0,1fr))]">
          <div className="flex items-end border-b border-input bg-accent px-3 py-2.5">
            <span className="text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">class ↓ · profile →</span>
          </div>
          {PROFILES.map((p) => {
            const on = p === t.inUse;
            return (
              <button key={p} type="button" aria-pressed={on} onClick={() => form.setFieldValue('inUse', p)} className={`grid gap-0.5 border-b border-l border-input px-3 py-2 text-left ${on ? 'bg-run text-white' : 'bg-accent hover:bg-secondary'}`}>
                <span className="flex items-center gap-2 font-mono text-sm font-semibold">
                  <span className={`relative inline-block size-[13px] border-[1.5px] ${on ? 'border-white after:absolute after:inset-[2.5px] after:bg-white' : 'border-muted-foreground'}`} />
                  {p}
                  {on && <span className="ml-auto text-[9.5px] font-semibold tracking-widest uppercase">in use</span>}
                </span>
                <span className={`font-sans text-[11.5px] ${on ? 'text-white/80' : 'text-muted-foreground'}`}>{PROFILE_TEXT[p]}</span>
              </button>
            );
          })}
          {CLASSES.map((k) => (
            <div key={k} className="contents">
              <div className="grid content-start gap-1 border-b border-border p-3">
                <span className="justify-self-start border border-foreground px-1.5 font-mono text-[13px] font-semibold">{k}</span>
                <p className="m-0 font-sans text-[11.5px] leading-snug text-muted-foreground">{CLASS_TEXT[k]}</p>
              </div>
              {PROFILES.map((p) => {
                const cell = t.profiles[p][k][cli];
                const editing = edit?.p === p && edit.k === k;
                const red = unset(cli, cell, offered[cli]);
                return (
                  <div key={p} className={`grid border-b border-l border-border transition-opacity ${p === t.inUse ? 'bg-[var(--run-soft)]' : 'opacity-45 hover:opacity-80'}`}>
                    <button type="button" aria-label={`${p} ${k} ${cli}: ${cell ? [cell.model, cell.effort].filter(Boolean).join(', ') : 'not set'}`} onClick={() => setEdit({ p, k })} className={`grid content-start gap-1 p-3 text-left font-mono hover:bg-black/[0.03] ${editing ? 'shadow-[inset_0_0_0_2px_var(--run)]' : ''}`}>
                      <span className={`truncate text-[13px] ${red ? 'text-fail' : ''}`} title={cell?.model}>
                        {cell ? label(cell) : 'nothing set'}
                      </span>
                      {cell && <Meter m={find(cli, cell.model)} effort={cell.effort} />}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="m-0 mt-2 font-sans text-xs text-muted-foreground">
        {cli === 'claude-code' ? 'Claude Code: effort levels as each model lists them, low · medium · high · xhigh · max. ' : 'OpenCode: effort comes from the model’s own variants, so the meter shows only the levels that model has; — the model has none. Only approved models are offered. '}
        Red: no model, or no effort picked; every model with levels needs one.
      </p>

      {edit && <Editor key={`${edit.p}${edit.k}${cli}`} cli={cli} p={edit.p} k={edit.k} inUse={t.inUse} cell={t.profiles[edit.p][edit.k][cli]} offered={offered[cli]} approved={view.app.opencodeModels.map((a) => a.id)} onCell={(c) => setCell(edit.p, edit.k, c)} onDone={() => setEdit(null)} />}

      <ErrorLine error={save.error} />
      {changes > 0 && (
        <div className="sticky bottom-0 z-10 mt-4 flex flex-wrap items-center gap-3 border-t-2 border-foreground bg-card px-4 py-2.5">
          <span className="font-sans text-xs">
            {blocked ? (
              <>
                <b>{blocked}</b> {blocked === 1 ? 'cell needs' : 'cells need'} an effort level, or another model, before you can save.
              </>
            ) : (
              <>
                <b>{changes}</b> unsaved {changes === 1 ? 'change' : 'changes'}. Runs already going keep the models they started with.
              </>
            )}
          </span>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => {
              form.reset(saved);
              setEdit(null);
            }}>
            Discard
          </Button>
          <Button size="sm" disabled={blocked > 0 || save.isPending} onClick={() => void form.handleSubmit()}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      )}
    </div>
  );
}

/** One cell's model and effort. The effort lists only the model's levels, with no "model default"; changing the model keeps the effort only if the new one lists it. */
function Editor({ cli, p, k, inUse, cell, offered, approved, onCell, onDone }: { cli: Harness; p: Profile; k: ModelClass; inUse: Profile; cell: ClassCell | null; offered: ProviderModel[] | null; approved: string[]; onCell: (c: ClassCell | null) => void; onDone: () => void }) {
  const models = offered ?? [];
  const m = models.find((x) => x.id === cell?.model);
  const levels = m?.efforts ?? [];
  const problem = cell && cellProblem(cli, cell, offered, approved);
  const lbl = 'grid gap-1 text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase';
  return (
    <div className="mt-2.5 grid items-end gap-3 border border-run bg-card px-3.5 py-3 md:grid-cols-[auto_minmax(0,1fr)_170px_auto]">
      <span className="pb-1.5 font-mono font-semibold">
        {p} › {k} › {cli}
      </span>
      <label className={lbl}>
        Model
        <Select value={cell?.model ?? (cli === 'opencode' ? NONE : '')} onValueChange={(v) => onCell(withModel(cell, v === NONE ? '' : v, offered))}>
          <SelectTrigger className="h-8 w-full min-w-0 font-mono text-[12.5px] tracking-normal text-foreground normal-case" aria-invalid={problem && !m ? true : undefined}>
            <span className="min-w-0 truncate">
              <SelectValue placeholder="nothing set" />
            </span>
          </SelectTrigger>
          <SelectContent className="font-mono">
            {cli === 'opencode' && <SelectItem value={NONE}>— nothing set —</SelectItem>}
            {cell && !m && <SelectItem value={cell.model}>{cell.model} (not offered)</SelectItem>}
            {models.map((x) => {
              const to = cli === 'claude-code' && aliasOf(x, models);
              return (
                <SelectItem key={x.id} value={x.id}>
                  {x.id}
                  {to ? ` (follows the latest: ${to} today)` : ''}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </label>
      <label className={lbl}>
        Effort
        <Select value={cell?.effort ?? ''} onValueChange={(v) => cell && onCell({ ...cell, effort: v as Effort })} disabled={!levels.length}>
          <SelectTrigger className="h-8 w-full font-mono text-[12.5px] tracking-normal text-foreground normal-case" aria-invalid={levels.length > 0 && !cell?.effort ? true : undefined}>
            <SelectValue placeholder={levels.length ? 'pick a level' : 'no effort setting'} />
          </SelectTrigger>
          <SelectContent className="font-mono">
            {levels.map((l) => (
              <SelectItem key={l} value={l}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <Button size="sm" variant="outline" onClick={onDone}>
        Done
      </Button>
      {problem && <p className="m-0 font-sans text-xs text-fail md:col-span-4">{problem}</p>}
      {cli === 'opencode' && offered && models.length === 0 && (
        <p className="m-0 font-sans text-xs text-wait md:col-span-4">
          {approved.length ? (
            'opencode lists none of the approved models on this machine.'
          ) : (
            <>
              No approved OpenCode models:{' '}
              <Link href="/settings/agents/models" className="underline">
                approve some
              </Link>
            </>
          )}
        </p>
      )}
      <p className="m-0 font-sans text-xs text-muted-foreground md:col-span-4">{p === inUse ? `Anything that asks for ${k} on ${cli} gets this, from the next run on.` : `This applies only while ${p} is the profile in use.`}</p>
    </div>
  );
}

export function ClassesPage() {
  const view = useQuery(appSettingsQuery);
  const [cli, setCli] = useState<Harness>('claude-code');
  return (
    <>
      <Head title="Model classes">
        A step asks for a class; pick an agent CLI, then each class turns into one of its models and an effort level. Only the profile marked in use applies; click a profile’s name to switch. Click any cell to change it. App-wide, for every project.
      </Head>
      {view.isPending && <Loader />}
      <ErrorLine error={view.error} />
      {/* Saved settings remount the table on the new values: that is the confirmation. */}
      {view.data && <Table key={JSON.stringify(view.data.app.modelClasses)} view={view.data} cli={cli} setCli={setCli} />}
    </>
  );
}
