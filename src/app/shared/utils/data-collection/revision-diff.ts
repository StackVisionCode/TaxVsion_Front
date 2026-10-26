import type { FormAnswers, RepeaterRows } from './form-answers.model';
import { isRecord } from './properties';

export type RevisionDiffKind = 'changed' | 'added' | 'removed';

export interface RevisionDiffEntry {
  componentId: string;
  rowId: string | null;
  kind: RevisionDiffKind;
  before: unknown;
  after: unknown;
}

export function revisionDiff(previous: FormAnswers, current: FormAnswers): RevisionDiffEntry[] {
  const before = flatten(previous);
  const after = flatten(current);
  const keys = new Set([...before.keys(), ...after.keys()]);
  const result: RevisionDiffEntry[] = [];
  for (const key of keys) {
    const left = before.get(key);
    const right = after.get(key);
    if (left && right && stable(left.value) === stable(right.value)) continue;
    const value = right ?? left;
    if (!value) continue;
    result.push({
      componentId: value.componentId,
      rowId: value.rowId,
      kind: left && right ? 'changed' : right ? 'added' : 'removed',
      before: left?.value,
      after: right?.value,
    });
  }
  return result.sort((a, b) =>
    `${a.componentId}:${a.rowId ?? ''}`.localeCompare(`${b.componentId}:${b.rowId ?? ''}`),
  );
}

interface FlatValue {
  componentId: string;
  rowId: string | null;
  value: unknown;
}

function flatten(answers: FormAnswers): Map<string, FlatValue> {
  const result = new Map<string, FlatValue>();
  for (const [componentId, value] of Object.entries(answers.values ?? {})) {
    if (isRepeater(value)) {
      for (const row of value.rows) {
        for (const [childId, childValue] of Object.entries(row.values ?? {})) {
          result.set(`${childId}:${row.rowId}`, {
            componentId: childId,
            rowId: row.rowId,
            value: childValue,
          });
        }
      }
    } else {
      result.set(`${componentId}:`, { componentId, rowId: null, value });
    }
  }
  return result;
}

function isRepeater(value: unknown): value is RepeaterRows {
  return isRecord(value) && Array.isArray(value['rows']);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
