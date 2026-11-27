'use client';
/**
 * The Internal steps section: the steps Lamproom runs for itself, outside any flow (`internal-steps.ts`). What
 * each may touch is fixed by Lamproom; which agent CLI, model class and budget it runs on is set here, for every
 * project.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CLASSES, HARNESSES, type Harness, INTERNAL_STEP_SCHEMA, INTERNAL_STEPS, type InternalStep, type InternalStepConfig, type ModelClass } from '../../packages/cli/src/settings.ts';
import { type AppView, appSettingsQuery, updateAppSettings } from '../projects/api.ts';
import { ErrorLine, Head } from './settings.tsx';
import { Loader } from '@/components/loader';

const label = 'grid content-start gap-1 text-[11px] text-muted-foreground'; // content-start: a note under one field leaves the others where they are
const box = 'h-8 w-full font-mono text-[13px] text-foreground';

function Step({ id, view }: { id: InternalStep; view: AppView }) {
  const s = INTERNAL_STEPS[id];
  const queryClient = useQueryClient();
  const saved = view.app.internal[id];
  const [f, setF] = useState({ ...saved, budget: String(saved.budgetUsd) });
  const cfg: InternalStepConfig = { adapter: f.adapter, class: f.class, budgetUsd: Number(f.budget) };
  const errors = Object.fromEntries((INTERNAL_STEP_SCHEMA.safeParse(cfg).error?.issues ?? []).map((i) => [i.path[0], i.message]));
  const dirty = JSON.stringify(cfg) !== JSON.stringify(saved);
  const save = useMutation({
    mutationFn: () => updateAppSettings({ internal: { ...view.app.internal, [id]: cfg } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });
  const err = (k: string) => errors[k] && <em className="text-[11px] text-fail not-italic">{errors[k]}</em>;
  return (
    <section aria-label={s.name} className="grid border border-border bg-card">
      <header className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b border-border px-4 py-3">
        <h3 className="m-0 font-sans text-sm font-semibold">{s.name}</h3>
        <code className="text-[11px] text-muted-foreground">/{id}</code>
        <p className="m-0 basis-full font-sans text-xs text-[var(--ink-2)]">{s.text}</p>
      </header>
      <p className="m-0 border-b border-border px-4 py-3 font-sans text-xs text-muted-foreground">
        Fixed by Lamproom: {s.fixed}
      </p>
      <div className="grid gap-3 px-4 py-3">
        <div className="grid gap-3 sm:grid-cols-[150px_150px_140px]">
          <label className={label}>
            runs on
            <Select value={f.adapter} onValueChange={(v) => setF({ ...f, adapter: v as Harness })}>
              <SelectTrigger className={box}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(HARNESSES) as Harness[]).map((h) => (
                  <SelectItem key={h} value={h}>
                    {HARNESSES[h].name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className={label}>
            class
            <Select value={f.class} onValueChange={(v) => setF({ ...f, class: v as ModelClass })}>
              <SelectTrigger className={box}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="font-mono">
                {CLASSES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className={label}>
            budget per run, $
            <Input value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} inputMode="decimal" autoComplete="off" aria-invalid={errors.budgetUsd ? true : undefined} className={box} />
            {err('budgetUsd')}
          </label>
        </div>
        <ErrorLine error={save.error} />
        <div>
          <Button size="sm" disabled={!dirty || Object.keys(errors).length > 0 || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </section>
  );
}

export function InternalPage() {
  const view = useQuery(appSettingsQuery);
  return (
    <>
      <Head title="Internal steps">Steps Lamproom runs for itself, outside any flow and for every project. Choose what each runs on here; what it may read and write is fixed, and it never appears in a project’s library.</Head>
      {view.isPending && <Loader />}
      <ErrorLine error={view.error} />
      {view.data &&
        (Object.keys(INTERNAL_STEPS) as InternalStep[]).map((id) => <Step key={`${id}:${JSON.stringify(view.data.app.internal[id])}`} id={id} view={view.data} />)}
      {view.data && <p className="m-0 text-xs text-muted-foreground">Saved here; nothing launches these yet. The new-project wizard and backlog import will.</p>}
    </>
  );
}
