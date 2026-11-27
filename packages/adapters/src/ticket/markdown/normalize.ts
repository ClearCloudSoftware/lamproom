/**
 * Markdown → ParsedTask[]. Pure.
 *
 * Rules the parser follows (lifted from docs/Lamproom/Intake And Import/
 * Backlog File Shapes.md and the markdown adapter section of
 * docs/superpowers/specs/2026-11-14-task-source-port-design.md):
 *
 *   - Only `##` headings open tasks. `#` and `#### `+ do not.
 *   - Prose before the first `##` is dropped.
 *   - Shape B: a `##` whose body has `- **Title** — text` bullets only groups
 *     them; each bold bullet is a task (separators `-`, `–`, `—`, `:`), and
 *     the sub-sections below attach to the last bullet.
 *   - Between one `##` and the next, the task's content is:
 *       * depth-3 heading "Acceptance criteria" / "AC" / "Done when" → list
 *         items into ParsedTask.acceptanceCriteria.
 *       * depth-3 heading "Non-goals" / "Out of scope" → list items into
 *         ParsedTask.nonGoals.
 *       * Any other content before the first special section → the body.
 *       * Content after the first special section is dropped (keep it simple;
 *         users who want more structure can split into separate tasks).
 *   - A trailing `{#slug}` at the end of a heading becomes the explicit
 *     upstream id. It is the `importKey` directly, bypassing deriveImportKey.
 *     After the id the block may also carry `.bug|.task|.story|.epic` (the
 *     task's type) and `parent=<key>` (its parent's key): `{#id .story parent=intl}`.
 *     A block with any other token, or two types or parents, is not an
 *     attribute block and stays in the title.
 *     Markdown's UpstreamKeyPolicy is 'never' — the explicit path is the
 *     only way to get a key that isn't a title slug.
 *   - Two tasks with the same explicit `{#slug}` throws (a file-level error).
 *     Two tasks with the same title get `-2`, `-3` suffixes via deriveImportKey.
 *
 * Body preservation: bodies are sliced from the original source string via
 * mdast position offsets. This preserves backticks, dollar signs and any
 * other content verbatim — the parser never re-serialises. Satisfies the
 * trust-boundary rule that ticket content is data, not instructions.
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { deriveImportKey, slugify, TASK_TYPES, type ImportKeyHint } from '@lamproom/core';
import type { ParsedTask, SourceId, TaskType } from '@lamproom/core';

interface MdastPosition {
  start: { offset?: number };
  end: { offset?: number };
}

interface MdastNode {
  type: string;
  depth?: number;
  value?: string;
  children?: MdastNode[];
  position?: MdastPosition;
}

const EXPLICIT_ID_RE = /^(.*?)\s*\{#([a-z0-9][a-z0-9-]*)((?:\s+(?:\.[a-z]+|parent=[a-z0-9][a-z0-9-]*))*)\}\s*$/;
const AFTER_BOLD_RE = /^[ \t]*\{#[^}\n]*\}/;
const ACCEPTANCE_RE = /^(acceptance criteria|ac|done when)\s*:?$/i;
const NON_GOALS_RE = /^(non[- ]goals?|out of scope)\s*:?$/i;
const POLICY_NEVER = { trust: 'never' as const };

/** A task before its key: what the file (or the importer agent) says. `id`: an explicit id, used as the key as is. */
export interface UnkeyedTask {
  title: string;
  id?: string;
  type?: TaskType;
  /** The parent's key in the same source. */
  parentId?: string;
  body?: string;
  acceptanceCriteria?: string[];
  nonGoals?: string[];
}

export function parseMarkdown(content: string, sourceId: SourceId): ParsedTask[] {
  const tree = unified().use(remarkParse).parse(content) as unknown as MdastNode;
  const children = tree.children ?? [];

  // Find the spans: [startIndex, endIndex) of each task in `children`.
  const spans: Array<{ heading: MdastNode; from: number; to: number }> = [];
  let currentStart: number | undefined;
  for (let i = 0; i < children.length; i++) {
    const node = children[i]!;
    if (node.type === 'heading' && node.depth === 2) {
      if (currentStart !== undefined) {
        spans.push({ heading: children[currentStart]!, from: currentStart + 1, to: i });
      }
      currentStart = i;
    }
  }
  if (currentStart !== undefined) {
    spans.push({ heading: children[currentStart]!, from: currentStart + 1, to: children.length });
  }

  const raw: UnkeyedTask[] = [];
  for (const span of spans) {
    const { bodyNodes, acceptanceCriteria, nonGoals } = splitSpan(span.from, span.to, children);
    const fields = {
      ...(acceptanceCriteria.length > 0 && { acceptanceCriteria }),
      ...(nonGoals.length > 0 && { nonGoals }),
    };

    const bullets = bodyNodes.flatMap((n) => (n.type === 'list' ? (n.children ?? []).filter(isBoldItem) : []));
    if (bullets.length > 0) {
      // Shape B: the heading only groups; the sub-sections belong to the last bullet.
      bullets.forEach((item, i) => {
        const { title, attrs, block } = splitBullet(item);
        if (title === '') return;
        const body = bulletBody(content, item, block);
        raw.push({
          title,
          ...attrs,
          ...(body !== undefined && { body }),
          ...(i === bullets.length - 1 && fields),
        });
      });
      continue;
    }

    const { title, ...attrs } = splitTitleAndExplicitId(textContent(span.heading));
    if (title === '') continue;
    const body = bodyNodes.length > 0 ? sliceSource(content, bodyNodes) : undefined;
    raw.push({ title, ...attrs, ...(body !== undefined && { body }), ...fields });
  }

  return keyMarkdownTasks(raw, sourceId);
}

/**
 * Keys tasks in file order: an explicit id is the key as is (two of the same throw), otherwise the title's slug,
 * with `-2`, `-3` on repeats. The parser and the importer agent's output both go through here.
 */
export function keyMarkdownTasks(raw: UnkeyedTask[], sourceId: SourceId): ParsedTask[] {
  const seenKeys = new Set<string>();
  const explicitIds = new Set<string>();
  return raw.map(({ title, id, type, parentId, body, acceptanceCriteria, nonGoals }) => {
    const hint: ImportKeyHint = { titleSlug: slugify(title) };
    if (id !== undefined) {
      if (explicitIds.has(id)) throw new Error(`markdown source: duplicate explicit id '${id}'`);
      explicitIds.add(id);
      hint.upstream = id;
      seenKeys.add(id);
    }
    const importKey = id ?? deriveImportKey(sourceId, hint, POLICY_NEVER, seenKeys);
    const task: ParsedTask = { importKey, title, _hint: hint };
    if (type !== undefined) task.type = type;
    if (parentId !== undefined) task.parentKey = parentId;
    if (body !== undefined) task.body = body;
    if (acceptanceCriteria !== undefined && acceptanceCriteria.length > 0) task.acceptanceCriteria = acceptanceCriteria;
    if (nonGoals !== undefined && nonGoals.length > 0) task.nonGoals = nonGoals;
    return task;
  });
}

/** A list item that opens with bold text: `- **Title** — text`. */
function isBoldItem(item: MdastNode): boolean {
  const first = item.children?.[0];
  return first?.type === 'paragraph' && first.children?.[0]?.type === 'strong';
}

/**
 * A bullet's title and attributes. The `{#id ...}` block sits inside the bold (`**Title {#id}**`) or right after it
 * (`**Title** {#id .bug} — text`); `block` is the text after the bold that held it, to keep it out of the body.
 */
function splitBullet(item: MdastNode): { title: string; attrs: Omit<ReturnType<typeof splitTitleAndExplicitId>, 'title'>; block?: string } {
  const [strong, next] = item.children![0]!.children!;
  const inside = splitTitleAndExplicitId(textContent(strong!));
  const block = inside.id === undefined && next?.type === 'text' ? next.value?.match(AFTER_BOLD_RE)?.[0] : undefined;
  if (block) {
    const { title, ...attrs } = splitTitleAndExplicitId(`${inside.title} ${block.trim()}`);
    if (attrs.id !== undefined) return { title, attrs, block };
  }
  const { title, ...attrs } = inside;
  return { title, attrs };
}

/** The item's text after its bold title and separator, verbatim from the source; a `{#id ...}` block that followed the bold is not part of it. */
function bulletBody(content: string, item: MdastNode, block?: string): string | undefined {
  const from = item.children![0]!.children![0]!.position?.end.offset;
  const to = item.position?.end.offset;
  if (from === undefined || to === undefined) return undefined;
  let text = content.slice(from, to);
  if (block) text = text.replace(/^[ \t]*\{#[^}\n]*\}/, '');
  const body = text.replace(/^[ \t]*[-–—:]?[ \t]*/, '').trim();
  return body === '' ? undefined : body;
}

function splitSpan(
  from: number,
  to: number,
  children: MdastNode[],
): { bodyNodes: MdastNode[]; acceptanceCriteria: string[]; nonGoals: string[] } {
  const bodyNodes: MdastNode[] = [];
  const acceptanceCriteria: string[] = [];
  const nonGoals: string[] = [];
  let mode: 'body' | 'acceptance' | 'non_goals' | 'drop' = 'body';

  for (let i = from; i < to; i++) {
    const node = children[i]!;
    if (node.type === 'heading' && node.depth === 3) {
      const headingText = textContent(node).trim();
      if (ACCEPTANCE_RE.test(headingText)) {
        mode = 'acceptance';
        continue;
      }
      if (NON_GOALS_RE.test(headingText)) {
        mode = 'non_goals';
        continue;
      }
      // An unrecognised depth-3 heading after a special section means "stop collecting
      // prose into body too" — we keep it simple and just drop the rest.
      mode = 'drop';
      continue;
    }
    if (mode === 'body' && node.type !== 'heading') bodyNodes.push(node);
    else if (mode === 'acceptance' && node.type === 'list') acceptanceCriteria.push(...listItems(node));
    else if (mode === 'non_goals' && node.type === 'list') nonGoals.push(...listItems(node));
  }

  return { bodyNodes, acceptanceCriteria, nonGoals };
}

function listItems(listNode: MdastNode): string[] {
  const items: string[] = [];
  for (const item of listNode.children ?? []) {
    items.push(textContent(item).trim());
  }
  return items;
}

function textContent(node: MdastNode): string {
  if (node.value !== undefined) return node.value;
  if (!node.children) return '';
  return node.children.map(textContent).join('');
}

function splitTitleAndExplicitId(headingText: string): { title: string; id?: string; type?: TaskType; parentId?: string } {
  const trimmed = headingText.trim();
  const match = trimmed.match(EXPLICIT_ID_RE);
  if (match) {
    const tokens = match[3]!.split(/\s+/).filter(Boolean);
    const types = tokens.filter((t) => t.startsWith('.')).map((t) => t.slice(1));
    const parents = tokens.filter((t) => t.startsWith('parent=')).map((t) => t.slice(7));
    if (types.length <= 1 && parents.length <= 1 && types.every((t) => (TASK_TYPES as readonly string[]).includes(t))) {
      return {
        title: match[1]!.trim(),
        id: match[2]!,
        ...(types[0] && { type: types[0] as TaskType }),
        ...(parents[0] && { parentId: parents[0] }),
      };
    }
  }
  return { title: trimmed };
}

function sliceSource(content: string, nodes: MdastNode[]): string {
  const first = nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  const start = first.position?.start.offset;
  const end = last.position?.end.offset;
  if (start === undefined || end === undefined) return '';
  return content.slice(start, end).replace(/\s+$/, '');
}
