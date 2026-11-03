/**
 * Modelo y funciones puras de `app-grouped-search` (buscador con sugerencias agrupadas).
 * Sin Angular para poder probarlas aisladas.
 */

/** Una sugerencia. `data` es del llamador y vuelve tal cual en `(picked)`. */
export interface GroupedSearchItem<T = unknown> {
  id: string;
  label: string;
  sublabel?: string | null;
  /** Texto corto a la derecha (fecha, carpeta). */
  meta?: string | null;
  /** Icono ionicons cuando no hay avatar. */
  icon?: string | null;
  avatar?: { name: string; seed?: string | null; imageUrl?: string | null } | null;
  data: T;
}

export interface GroupedSearchGroup<T = unknown> {
  id: string;
  label: string;
  items: readonly GroupedSearchItem<T>[];
}

/** Lo que devuelve la función de búsqueda: grupos y si alguno sigue en camino. */
export interface GroupedSearchSuggestions<T = unknown> {
  groups: readonly GroupedSearchGroup<T>[];
  pending: boolean;
}

/** Chip quitable dentro del buscador (p. ej. "Client: Ana Pérez"). */
export interface GroupedSearchChip {
  id: string;
  label: string;
}

export interface GroupedSearchPick<T = unknown> {
  groupId: string;
  item: GroupedSearchItem<T>;
}

/** Entrada navegable con flechas: una sugerencia o el pie "See all results". */
export type GroupedSearchEntry<T = unknown> =
  { kind: 'item'; groupId: string; item: GroupedSearchItem<T> } | { kind: 'all' };

/** Recorta cada grupo a `maxPerGroup` y quita los vacíos. */
export function visibleGroups<T>(
  groups: readonly GroupedSearchGroup<T>[],
  maxPerGroup: number,
): GroupedSearchGroup<T>[] {
  return groups
    .map((group) => ({ ...group, items: group.items.slice(0, Math.max(0, maxPerGroup)) }))
    .filter((group) => group.items.length > 0);
}

/** Lista plana en el orden en que se pinta (grupos y luego el pie, si lo hay). */
export function flattenEntries<T>(
  groups: readonly GroupedSearchGroup<T>[],
  withSeeAll: boolean,
): GroupedSearchEntry<T>[] {
  const entries: GroupedSearchEntry<T>[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      entries.push({ kind: 'item', groupId: group.id, item });
    }
  }
  if (withSeeAll) {
    entries.push({ kind: 'all' });
  }
  return entries;
}

/** Siguiente índice resaltado con flechas (cíclico). -1 = nada resaltado (Enter busca lo tecleado). */
export function moveHighlight(current: number, delta: 1 | -1, count: number): number {
  if (count <= 0) {
    return -1;
  }
  if (current < 0) {
    return delta === 1 ? 0 : count - 1;
  }
  return (current + delta + count) % count;
}

/** Trozos de un texto con la coincidencia marcada (sin html: el template pinta cada trozo). */
export interface HighlightPart {
  text: string;
  match: boolean;
}

export function highlightParts(
  text: string | null | undefined,
  term: string | null | undefined,
): HighlightPart[] {
  const source = text ?? '';
  const needle = (term ?? '').trim().toLowerCase();
  if (!source || !needle) {
    return source ? [{ text: source, match: false }] : [];
  }
  const parts: HighlightPart[] = [];
  const lower = source.toLowerCase();
  let from = 0;
  let at = lower.indexOf(needle, from);
  while (at >= 0) {
    if (at > from) {
      parts.push({ text: source.slice(from, at), match: false });
    }
    parts.push({ text: source.slice(at, at + needle.length), match: true });
    from = at + needle.length;
    at = lower.indexOf(needle, from);
  }
  if (from < source.length) {
    parts.push({ text: source.slice(from), match: false });
  }
  return parts;
}
