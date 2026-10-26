import type { RichTextDocument } from './rich-text';

export function propsOf(props: Record<string, unknown> | undefined): Record<string, unknown> {
  return props ?? {};
}

export function intProp(
  props: Record<string, unknown> | undefined,
  name: string,
  fallback: number,
): number {
  const value = propsOf(props)[name];
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= -2_147_483_648 &&
    value <= 2_147_483_647
    ? value
    : fallback;
}

export function numberProp(
  props: Record<string, unknown> | undefined,
  name: string,
): number | null {
  const value = propsOf(props)[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function stringProp(
  props: Record<string, unknown> | undefined,
  name: string,
): string | null {
  const value = propsOf(props)[name];
  return typeof value === 'string' ? value : null;
}

export function boolProp(
  props: Record<string, unknown> | undefined,
  name: string,
  fallback: boolean,
): boolean {
  const value = propsOf(props)[name];
  return typeof value === 'boolean' ? value : fallback;
}

export function richTextProp(
  props: Record<string, unknown> | undefined,
  name: string,
): RichTextDocument | null {
  const value = propsOf(props)[name];
  return value == null || typeof value !== 'object' || Array.isArray(value)
    ? null
    : (value as RichTextDocument);
}

export function optionValues(props: Record<string, unknown> | undefined): Set<string> {
  const options = propsOf(props)['options'];
  if (!Array.isArray(options)) return new Set();
  return new Set(
    options
      .filter(isRecord)
      .map((option) => option['value'])
      .filter((value): value is string => typeof value === 'string'),
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Comparación ordinal por unidades UTF-16, como `StringComparison.Ordinal` de .NET. */
export function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
