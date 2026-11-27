/** The Model classes page's rules, kept out of the component so a test can hold them (`classes-model.test.ts`). */
import type { ProviderModel } from '../../packages/core/src/ports/agent-provider.ts';
import { CLASSES, type ClassCell, cellProblem, type Harness, type ModelClasses, PROFILES } from '../../packages/cli/src/settings.ts';

/**
 * A cell after its model changes: the effort stays if the new model lists it, else it is cleared (the cell then
 * needs a level). `model` '' empties the cell. `offered` null: the list is unknown, so the effort is kept.
 */
export function withModel(cell: ClassCell | null, model: string, offered: ProviderModel[] | null): ClassCell | null {
  if (!model) return null;
  const effort = cell?.effort ?? null;
  const levels = offered?.find((m) => m.id === model)?.efforts;
  return { model, effort: effort && (!offered || levels?.includes(effort)) ? effort : null };
}

/** Red on the page: no model, or one the save would refuse (no effort where it has levels, not offered, a level it lacks). */
export const unset = (cli: Harness, cell: ClassCell | null, offered: ProviderModel[] | null) => !cell || !!cellProblem(cli, cell, offered);

/** The tab's "N not set": every profile × class cell of one CLI that is red. */
export const notSet = (t: ModelClasses, cli: Harness, offered: ProviderModel[] | null) =>
  PROFILES.flatMap((p) => CLASSES.map((k) => t.profiles[p][k][cli])).filter((c) => unset(cli, c, offered)).length;

/** Cells the save would refuse, for every CLI; an empty cell is allowed (a run that asks for it is refused instead). */
export const blocking = (t: ModelClasses, offered: Record<Harness, ProviderModel[] | null>) =>
  (Object.keys(offered) as Harness[]).flatMap((cli) => PROFILES.flatMap((p) => CLASSES.map((k) => t.profiles[p][k][cli])).filter((c) => c && cellProblem(cli, c, offered[cli]))).length;

/** Where an alias points now (`opus` → "Opus 5.5"); `default` borrows the name of the alias it matches. Undefined for a pinned id. */
export function aliasOf(m: ProviderModel, all: ProviderModel[]) {
  if (!m.resolvesTo) return undefined;
  return m.id === 'default' ? (all.find((x) => x.id !== m.id && x.resolvesTo === m.resolvesTo)?.name ?? m.resolvesTo) : m.name;
}
