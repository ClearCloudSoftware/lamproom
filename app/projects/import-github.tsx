'use client';
/**
 * "Import from GitHub" button for the project page.
 *
 * Opens a dialog asking for owner/repo (pre-filled from the saved default if
 * any, or from the project's own GitHub source when `defaultOwnerRepo` is
 * provided). On submit POSTs to `/api/import/github?project=<id>&owner=<o>&repo=<r>`,
 * closes the dialog, and opens the shared ImportToast that polls progress.
 *
 * Why a dialog: a single PAT may reach many repos. Picking one explicitly
 * per import is less surprising than a silent default.
 */
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { githubTasksStatusQuery, startGithubImport } from './api.ts';
import { ImportToast } from './import-jira.tsx';

export function ImportFromGithub({
  projectId,
  defaultOwnerRepo,
}: {
  projectId: string;
  /** Pre-fill when the project itself lives on GitHub; falls back to the saved default. */
  defaultOwnerRepo?: { owner: string; repo: string };
}) {
  const queryClient = useQueryClient();
  // Reuse the slug from the route so the toast can link to the board.
  useParams<{ slug: string }>();
  const github = useQuery(githubTasksStatusQuery);
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [importId, setImportId] = useState<string | undefined>(undefined);

  const start = useMutation({
    mutationFn: (t: { owner: string; repo: string }) => startGithubImport(projectId, t),
    onSuccess: (r) => {
      setImportId(r.importId);
      setOpen(false);
    },
  });

  const loaded = github.data !== undefined;
  const connected = github.data?.connected === true;
  const savedDefault = github.data?.defaultRepo;
  const prefill = defaultOwnerRepo ?? savedDefault;
  const effective = {
    owner: owner.trim() !== '' ? owner.trim() : (prefill?.owner ?? ''),
    repo: repo.trim() !== '' ? repo.trim() : (prefill?.repo ?? ''),
  };
  const ready = effective.owner !== '' && effective.repo !== '';

  const triggerDisabled = !loaded || !connected || importId !== undefined;
  const triggerTitle = !loaded
    ? 'Checking GitHub connection…'
    : !connected
      ? 'No PAT saved — add one in Settings → Connections → GitHub Issues'
      : importId !== undefined
        ? 'An import is already running for this project'
        : undefined;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setOwner(prefill?.owner ?? '');
            setRepo(prefill?.repo ?? '');
          }
        }}
      >
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" disabled={triggerDisabled} title={triggerTitle}>
            <Download aria-hidden /> Import from GitHub
          </Button>
        </DialogTrigger>
        <DialogContent className="font-sans sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-sans">Import from GitHub</DialogTitle>
            <DialogDescription>
              Open issues in the chosen repository are upserted into this project. Re-running
              on the same repo is idempotent — nothing is duplicated.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!ready) return;
              start.mutate(effective);
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="import-gh-owner">Repository</Label>
              <div className="flex max-w-xl flex-wrap items-center gap-2">
                <Input
                  id="import-gh-owner"
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  placeholder={prefill?.owner ?? 'owner'}
                  autoFocus
                  spellCheck={false}
                  className="min-w-0 flex-1 font-mono"
                />
                <span className="text-muted-foreground">/</span>
                <Input
                  id="import-gh-repo"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  placeholder={prefill?.repo ?? 'repo'}
                  spellCheck={false}
                  className="min-w-0 flex-1 font-mono"
                />
              </div>
              <em className="text-xs text-muted-foreground not-italic">
                {prefill
                  ? <>Leave blank to use <code className="font-mono">{prefill.owner}/{prefill.repo}</code>.</>
                  : <>No default saved. Save one on <code className="font-mono">Settings → Connections → GitHub Issues</code> to skip this step next time.</>}
              </em>
            </div>
            {start.error && (
              <p role="alert" className="border-l-2 border-fail bg-[var(--fail-soft)] px-2 py-1 text-xs whitespace-pre-wrap break-words text-fail">
                {start.error.message}
              </p>
            )}
            <DialogFooter>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={start.isPending}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={start.isPending || !ready}>
                {start.isPending ? 'Starting…' : 'Import'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {importId !== undefined && (
        <ImportToast
          importId={importId}
          label="GitHub"
          onClose={() => {
            setImportId(undefined);
            void queryClient.invalidateQueries({ queryKey: ['project-tasks', projectId] });
          }}
        />
      )}
    </>
  );
}
