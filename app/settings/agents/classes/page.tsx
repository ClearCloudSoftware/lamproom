import type { Metadata } from 'next';
import { ClassesPage } from '../../classes.tsx';

export const metadata: Metadata = { title: 'Model classes · Settings · Lamproom' };

/** `/settings/agents/classes`: which model and effort each class runs on, per agent CLI and profile. */
export default function Page() {
  return <ClassesPage />;
}
