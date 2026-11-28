import type { Metadata } from 'next';
import { GithubTasksPage } from './GithubTasksPage';

export const metadata: Metadata = { title: 'GitHub Issues · Task providers · Settings · Lamproom' };

/** `/settings/connections/tasks/github`: save a PAT, test it, pick a default repo. */
export default function Page() {
  return <GithubTasksPage />;
}
