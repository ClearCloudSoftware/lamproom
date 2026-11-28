'use client';
/**
 * GitHub Issues as a task source.
 *
 * Paste a Personal Access Token, test it, and optionally pin a default
 * repo so the project page's import dialog pre-fills it. The PAT is sent
 * to /api/github-tasks/credential (PUT), which stores it in
 * `github-tasks.json` with mode 0600. The status endpoint never returns
 * the token.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorLine, Field, Head } from '../../../settings.tsx';

interface GithubTasksStatus {
  connected: boolean;
  defaultRepo?: { owner: string; repo: string };
}
interface TestResult {
  ok: boolean;
  login?: string;
  error?: string;
}

const statusQuery = {
  queryKey: ['github-tasks', 'status'] as const,
  queryFn: async (): Promise<GithubTasksStatus> => {
    const r = await fetch('/api/github-tasks/status');
    if (!r.ok) throw new Error(`status ${r.status}`);
    return (await r.json()) as GithubTasksStatus;
  },
};

async function saveCredential(input: { pat: string; defaultRepo?: { owner: string; repo: string } }): Promise<GithubTasksStatus> {
  const r = await fetch('/api/github-tasks/credential', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const { error } = (await r.json()) as { error?: string };
    throw new Error(error ?? `save failed: ${r.status}`);
  }
  return (await r.json()) as GithubTasksStatus;
}

async function forgetCredential(): Promise<GithubTasksStatus> {
  const r = await fetch('/api/github-tasks/credential', { method: 'DELETE' });
  if (!r.ok) throw new Error(`forget failed: ${r.status}`);
  return (await r.json()) as GithubTasksStatus;
}

async function testCredential(): Promise<TestResult> {
  const r = await fetch('/api/github-tasks/test', { method: 'POST' });
  return (await r.json()) as TestResult;
}

const warnBox = 'm-0 flex items-start gap-2 border-l-[3px] border-wait bg-[var(--wait-soft)] px-2.5 py-1.5 font-sans text-xs text-wait';
const okBox = 'm-0 flex items-start gap-2 border-l-[3px] border-run bg-[var(--run-soft)] px-2.5 py-1.5 font-sans text-xs text-run';

export function GithubTasksPage() {
  const status = useQuery(statusQuery);
  return (
    <div className="grid gap-4">
      <Head title="GitHub Issues">
        Pull a repository&apos;s open issues as tasks. Uses a Personal Access Token you paste here — kept separate from the <code className="font-mono">gh</code> CLI login used for cloning.
      </Head>
      {status.isPending && <p className="m-0 text-xs text-muted-foreground">Loading…</p>}
      {status.isError && <ErrorLine error={status.error} />}
      {status.data && (
        <>
          <Banner status={status.data} />
          <PatForm status={status.data} />
          <ScopesHelp />
        </>
      )}
    </div>
  );
}

function Banner({ status }: { status: GithubTasksStatus }) {
  if (!status.connected) {
    return <p className={warnBox}>No PAT saved. Paste one below.</p>;
  }
  return (
    <p className={okBox}>
      PAT saved
      {status.defaultRepo !== undefined && (
        <>
          {' '}· default repo <code className="font-mono">{status.defaultRepo.owner}/{status.defaultRepo.repo}</code>
        </>
      )}
    </p>
  );
}

function PatForm({ status }: { status: GithubTasksStatus }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['github-tasks', 'status'] });
  const [pat, setPat] = useState('');
  const [owner, setOwner] = useState(status.defaultRepo?.owner ?? '');
  const [repo, setRepo] = useState(status.defaultRepo?.repo ?? '');
  const [testResult, setTestResult] = useState<TestResult | undefined>(undefined);

  const save = useMutation({
    mutationFn: () => {
      const trimmedOwner = owner.trim();
      const trimmedRepo = repo.trim();
      return saveCredential({
        pat: pat.trim(),
        ...(trimmedOwner !== '' && trimmedRepo !== '' ? { defaultRepo: { owner: trimmedOwner, repo: trimmedRepo } } : {}),
      });
    },
    onSuccess: () => {
      setPat('');
      setTestResult(undefined);
      invalidate();
    },
  });

  const forget = useMutation({ mutationFn: forgetCredential, onSuccess: () => { setTestResult(undefined); invalidate(); } });
  const test = useMutation({ mutationFn: testCredential, onSuccess: (r) => setTestResult(r) });

  return (
    <div className="grid gap-4">
      <Field
        title="Personal Access Token"
        htmlFor="github-pat"
        text={
          <>
            Classic PAT: <code className="font-mono">repo</code> scope (public and private) or just <code className="font-mono">public_repo</code> for public repos. Fine-grained: <b>Issues: Read-only</b> on the target repos. Never returned once saved.
          </>
        }
      >
        <div className="flex max-w-xl flex-wrap items-center gap-2">
          <Input
            id="github-pat"
            type="password"
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            placeholder={status.connected ? '(saved · enter a new one to replace)' : 'ghp_… or github_pat_…'}
            className="min-w-0 flex-1 font-mono"
          />
          <Button size="sm" disabled={pat.trim() === '' || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : status.connected ? 'Replace' : 'Save'}
          </Button>
          {status.connected && (
            <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
              {test.isPending ? 'Testing…' : 'Test'}
            </Button>
          )}
          {status.connected && (
            <Button size="sm" variant="ghost" disabled={forget.isPending} onClick={() => forget.mutate()}>
              {forget.isPending ? 'Forgetting…' : 'Forget'}
            </Button>
          )}
        </div>
      </Field>

      <Field
        title="Default repository (optional)"
        htmlFor="github-owner"
        text="Pre-fills the import dialog on every project page. Leave empty to ask on each import."
      >
        <div className="flex max-w-xl flex-wrap items-center gap-2">
          <Input id="github-owner" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="owner" className="min-w-0 flex-1 font-mono" />
          <span className="text-muted-foreground">/</span>
          <Input id="github-repo" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="repo" className="min-w-0 flex-1 font-mono" />
        </div>
      </Field>

      <ErrorLine error={save.error} />
      <ErrorLine error={forget.error} />
      <ErrorLine error={test.error} />
      {testResult !== undefined && (
        <p className={testResult.ok ? okBox : warnBox} role="status">
          {testResult.ok ? <>Token works — authenticated as <b className="font-mono">{testResult.login}</b></> : <>Test failed: {testResult.error ?? 'unknown error'}</>}
        </p>
      )}
    </div>
  );
}

function ScopesHelp() {
  return (
    <section className="grid gap-1 border-t border-border pt-3 font-sans text-xs text-muted-foreground">
      <p className="m-0">
        Create a token at <code className="font-mono">github.com/settings/tokens</code> (classic) or{' '}
        <code className="font-mono">github.com/settings/personal-access-tokens</code> (fine-grained).
      </p>
      <p className="m-0">
        Lamproom reads only — the token never writes. A fine-grained token pinned to specific repos is the safer choice.
      </p>
    </section>
  );
}
