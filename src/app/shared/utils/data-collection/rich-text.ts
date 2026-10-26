import { isHttpsUri } from './formats';
import { issue, type ValidationIssue } from './validation';

export interface RichTextDocument {
  type: string;
  blocks: RichTextBlock[];
}

export interface RichTextBlock {
  type: string;
  level?: number | null;
  align?: string | null;
  font?: string | null;
  children?: RichTextInline[];
  items?: RichTextInline[][];
}

export interface RichTextInline {
  type: string;
  text?: string | null;
  href?: string | null;
  marks?: string[];
  color?: string | null;
  children?: RichTextInline[];
}

const blockTypes = new Set(['paragraph', 'heading', 'bulletList', 'orderedList']);
const alignments = new Set(['left', 'center', 'right', 'justify']);
const fonts = new Set(['sans', 'serif', 'script1', 'script2']);
const marks = new Set(['bold', 'italic', 'underline']);
const colors = new Set([
  'ink',
  'secondary',
  'muted',
  'brand',
  'accent',
  'success',
  'warning',
  'danger',
  'info',
]);

export function validateRichText(
  document: RichTextDocument | null | undefined,
  path: string,
  maxCharacters: number,
): ValidationIssue[] {
  if (document == null) return [];
  const issues: ValidationIssue[] = [];
  // Sin objeto o sin `blocks` .NET ni siquiera parsea; un `type` inválido o > 200 bloques se reporta y sigue.
  if (!isRecord(document) || !Array.isArray(document.blocks)) {
    issues.push(issue('richtext.invalid_node', path));
    return issues;
  }
  if (document.type !== 'doc' || document.blocks.length > 200)
    issues.push(issue('richtext.invalid_node', path));

  let characters = 0;
  document.blocks.forEach((block, blockIndex) => {
    const blockPath = `${path}/blocks/${blockIndex}`;
    if (!isRecord(block) || typeof block.type !== 'string' || !blockTypes.has(block.type)) {
      issues.push(issue('richtext.invalid_node', blockPath));
      return;
    }
    if (block.type === 'heading' && block.level !== 2 && block.level !== 3) {
      issues.push(issue('richtext.invalid_node', `${blockPath}/level`));
    }
    if (block.type !== 'heading' && block.level != null) {
      issues.push(issue('richtext.invalid_node', `${blockPath}/level`));
    }
    if (block.align != null && !alignments.has(block.align))
      issues.push(issue('richtext.invalid_node', `${blockPath}/align`));
    if (block.font != null && !fonts.has(block.font))
      issues.push(issue('richtext.invalid_node', `${blockPath}/font`));

    const children = Array.isArray(block.children) ? block.children : [];
    const items = Array.isArray(block.items) ? block.items : [];
    if (block.type === 'bulletList' || block.type === 'orderedList') {
      if (children.length > 0 || items.length === 0)
        issues.push(issue('richtext.invalid_node', blockPath));
      items.forEach((item, itemIndex) => {
        if (!Array.isArray(item) || item.length === 0)
          issues.push(issue('richtext.invalid_node', `${blockPath}/items/${itemIndex}`));
        if (Array.isArray(item))
          characters += validateInlines(item, `${blockPath}/items/${itemIndex}`, issues, true);
      });
    } else {
      if (items.length > 0) issues.push(issue('richtext.invalid_node', `${blockPath}/items`));
      characters += validateInlines(children, `${blockPath}/children`, issues, true);
    }
  });
  if (characters > maxCharacters) issues.push(issue('richtext.invalid_node', path));
  return issues;
}

function validateInlines(
  nodes: RichTextInline[],
  path: string,
  issues: ValidationIssue[],
  allowLinks: boolean,
): number {
  let count = 0;
  nodes.forEach((node, index) => {
    const nodePath = `${path}/${index}`;
    if (
      !isRecord(node) ||
      (node.type !== 'text' && node.type !== 'link') ||
      (!allowLinks && node.type === 'link')
    ) {
      issues.push(issue('richtext.invalid_node', nodePath));
      return;
    }
    count += typeof node.text === 'string' ? node.text.length : 0;
    const nodeMarks = Array.isArray(node.marks) ? node.marks : [];
    if (
      new Set(nodeMarks).size !== nodeMarks.length ||
      nodeMarks.some((mark) => !marks.has(mark)) ||
      (node.color != null && !colors.has(node.color))
    ) {
      issues.push(issue('richtext.invalid_node', nodePath));
    }
    const children = Array.isArray(node.children) ? node.children : [];
    if (node.type === 'link') {
      if (typeof node.href !== 'string' || !isHttpsUri(node.href))
        issues.push(issue('richtext.invalid_link', `${nodePath}/href`));
      if (node.text != null || children.length === 0)
        issues.push(issue('richtext.invalid_node', nodePath));
      count += validateInlines(children, `${nodePath}/children`, issues, false);
    } else if (typeof node.text !== 'string' || children.length > 0 || node.href != null) {
      issues.push(issue('richtext.invalid_node', nodePath));
    }
  });
  return count;
}

export function richTextCharacterCount(document: RichTextDocument | null | undefined): number {
  if (document == null || !Array.isArray(document.blocks)) return 0;
  return document.blocks.reduce(
    (total, block) =>
      total +
      countInlines(block.children) +
      (block.items ?? []).reduce((sum, item) => sum + countInlines(item), 0),
    0,
  );
}

export function richTextPlainText(document: RichTextDocument | null | undefined): string {
  if (document == null || !Array.isArray(document.blocks)) return '';
  return document.blocks
    .flatMap((block) => [flatten(block.children), ...(block.items ?? []).map(flatten)])
    .join(' ');
}

export function canonicalizeRichText(document: RichTextDocument): string {
  return stableStringify(document);
}

function countInlines(nodes: RichTextInline[] | undefined): number {
  return (nodes ?? []).reduce(
    (total, node) => total + (node.text?.length ?? 0) + countInlines(node.children),
    0,
  );
}

function flatten(nodes: RichTextInline[] | undefined): string {
  return (nodes ?? []).map((node) => `${node.text ?? ''}${flatten(node.children)}`).join('');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
