'use client';
/**
 * "Import markdown" button for the project page: paste a backlog or pick a file, and the importer agent maps it to
 * tasks (the parser if the agent can't). The progress toast is the Jira import's, polling the same imports row.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { startMarkdownImport } from './api.ts';
import { ImportToast } from './import-jira.tsx';

export function ImportMarkdown({ projectId, pinned }: { projectId: string; pinned: string | null }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [importId, setImportId] = useState<string | undefined>(undefined);

  const start = useMutation({
    mutationFn: (content: string) => startMarkdownImport(projectId, content),
    onSuccess: (r) => {
      setImportId(r.importId);
      setOpen(false);
      setText('');
    },
  });

  const blocked = pinned !== null && pinned !== 'markdown';
  const triggerDisabled = blocked || importId !== undefined;
  const triggerTitle = blocked
    ? `This project uses ${pinned} — only one task provider per project. Delete the stored tasks to switch.`
    : importId !== undefined
      ? 'An import is already running for this project'
      : undefined;

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" disabled={triggerDisabled} title={triggerTitle}>
            <FileText aria-hidden /> Import markdown
          </Button>
        </DialogTrigger>
        <DialogContent className="font-sans sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-sans">Import a markdown backlog</DialogTitle>
            <DialogDescription>
              The backlog importer maps each piece of work to a task; if it can’t, the parser reads the file. Importing
              the same backlog again updates its tasks instead of adding new ones.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) start.mutate(text);
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="import-md-file">File</Label>
              <Input
                id="import-md-file"
                type="file"
                accept=".md,.markdown,.txt,text/markdown,text/plain"
                onChange={(e) => void e.target.files?.[0]?.text().then(setText)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="import-md-text">Or paste it</Label>
              <Textarea
                id="import-md-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={'## Backlog\n- **Filter list by status** — add a dropdown'}
                rows={10}
                spellCheck={false}
                className="max-h-[50vh] font-mono text-xs"
              />
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
              <Button type="submit" size="sm" disabled={start.isPending || !text.trim()}>
                {start.isPending ? 'Starting…' : 'Import'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {importId !== undefined && (
        <ImportToast
          importId={importId}
          label="markdown"
          onClose={() => {
            setImportId(undefined);
            void queryClient.invalidateQueries({ queryKey: ['project-tasks', projectId] });
          }}
        />
      )}
    </>
  );
}
