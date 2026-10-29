import { canonicalJson } from './canonical-json';
import {
  DRAFT_MISSING,
  type DraftConflictTarget,
  type DraftDocumentModel,
  type DraftMergeResult,
  type DraftMergeValue,
  type DraftRawConflict,
} from './draft-save-coordinator';
import type {
  FormComponent,
  FormDefinition,
  FormPage,
  FormSection,
} from './form-definition.model';

/**
 * Modelo del coordinador para el builder (P-6.2). La definición se descompone en elementos con id:
 * - `/root/{clave}`: propiedades raíz (título, descripción, mapeos, acciones…);
 * - `/pages/{id}`: la página sin sus secciones;
 * - `/sections/{id}`: `{ section, pageId }`, la sección sin sus componentes y dónde está;
 * - `/components/{id}`: `{ component, sectionId }`;
 * - `/order/pages`, `/order/pages/{pageId}` y `/order/sections/{sectionId}`: el orden de los hijos.
 * Cada elemento se fusiona en tres vías; el orden se fusiona por pertenencia y solo es conflicto si
 * los dos lados reordenaron distinto. Lo que no se puede fusionar queda como conflicto visible.
 */
export const DEFINITION_DRAFT_MODEL: DraftDocumentModel<FormDefinition> = {
  changedPaths(base, local) {
    const before = flatten(base);
    const after = flatten(local);
    const changed = new Set<string>();
    for (const path of new Set([...before.keys(), ...after.keys()]))
      if (!equal(entry(before, path), entry(after, path))) changed.add(path);
    return changed;
  },
  merge: mergeDefinitions,
  apply(document, path, value) {
    const entries = flatten(document);
    applyEntry(entries, path, value);
    return build(entries, document);
  },
  target(conflict) {
    return definitionTarget(conflict);
  },
};

export type DefinitionElementKind = 'root' | 'page' | 'section' | 'component' | 'order';

/** Qué elemento de la definición nombra una ruta del modelo. */
export function describeDefinitionPath(path: string): {
  kind: DefinitionElementKind;
  id: string;
  container: 'pages' | 'page' | 'section' | null;
} {
  const parts = path.split('/').slice(1).map(unescape);
  if (parts[0] === 'root') return { kind: 'root', id: parts[1], container: null };
  if (parts[0] === 'pages') return { kind: 'page', id: parts[1], container: null };
  if (parts[0] === 'sections') return { kind: 'section', id: parts[1], container: null };
  if (parts[0] === 'components') return { kind: 'component', id: parts[1], container: null };
  if (parts[0] === 'order' && parts.length === 2) return { kind: 'order', id: '', container: 'pages' };
  if (parts[0] === 'order' && parts[1] === 'pages')
    return { kind: 'order', id: parts[2], container: 'page' };
  if (parts[0] === 'order' && parts[1] === 'sections')
    return { kind: 'order', id: parts[2], container: 'section' };
  throw new Error(`Unsupported definition path '${path}'.`);
}

interface SectionEntry {
  section: Omit<FormSection, 'components'>;
  pageId: string;
}

interface ComponentEntry {
  component: FormComponent;
  sectionId: string;
}

type Entries = Map<string, unknown>;

const ROOT_ORDER = [
  'schemaVersion',
  'title',
  'description',
  'purpose',
  'presentation',
  'settings',
  'pages',
  'mappings',
  'actions',
];

function mergeDefinitions(
  base: FormDefinition,
  local: FormDefinition,
  remote: FormDefinition,
): DraftMergeResult<FormDefinition> {
  const before = flatten(base);
  const mine = flatten(local);
  const theirs = flatten(remote);
  const result: Entries = new Map();
  const conflicts: DraftRawConflict[] = [];
  const paths = new Set([...theirs.keys(), ...mine.keys(), ...before.keys()]);

  for (const path of paths) {
    if (path.startsWith('/order/')) continue;
    const merge = path.startsWith('/pages/') || path.startsWith('/sections/') ? mergeShell : mergeAtomic;
    const merged = merge(path, entry(before, path), entry(mine, path), entry(theirs, path), conflicts);
    if (merged !== DRAFT_MISSING) result.set(path, merged);
  }
  for (const path of paths) {
    if (!path.startsWith('/order/')) continue;
    const merged = mergeOrder(path, entry(before, path), entry(mine, path), entry(theirs, path), conflicts);
    if (merged !== DRAFT_MISSING) result.set(path, merged);
  }
  restoreContainers(result, before, mine, theirs, conflicts);
  return { value: build(result, remote), conflicts: sortConflicts(conflicts) };
}

function mergeAtomic(
  path: string,
  base: DraftMergeValue,
  local: DraftMergeValue,
  remote: DraftMergeValue,
  conflicts: DraftRawConflict[],
): DraftMergeValue {
  if (equal(local, remote)) return local;
  if (equal(local, base)) return remote;
  if (equal(remote, base)) return local;
  conflicts.push(conflict(path, base, local, remote));
  return remote;
}

/**
 * Página o sección: se fusiona propiedad por propiedad (título, condición, estilo, repetición y
 * ubicación). Si una propiedad choca, el conflicto es del elemento, pero cada lado del conflicto
 * conserva las propiedades que el otro cambió sin chocar.
 */
function mergeShell(
  path: string,
  base: DraftMergeValue,
  local: DraftMergeValue,
  remote: DraftMergeValue,
  conflicts: DraftRawConflict[],
): DraftMergeValue {
  if (equal(local, remote)) return local;
  if (equal(local, base)) return remote;
  if (equal(remote, base)) return local;
  if (local === DRAFT_MISSING || remote === DRAFT_MISSING) {
    conflicts.push(conflict(path, base, local, remote));
    return remote;
  }
  const flat = (value: DraftMergeValue) => shellProperties(path, value);
  const before = flat(base);
  const mine = flat(local);
  const theirs = flat(remote);
  const merged: Record<string, unknown> = {};
  const localSide: Record<string, unknown> = {};
  const remoteSide: Record<string, unknown> = {};
  let clash = false;
  for (const key of new Set([...Object.keys(theirs), ...Object.keys(mine), ...Object.keys(before)])) {
    const b = key in before ? before[key] : DRAFT_MISSING;
    const l = key in mine ? mine[key] : DRAFT_MISSING;
    const r = key in theirs ? theirs[key] : DRAFT_MISSING;
    let value: DraftMergeValue;
    if (equal(l, r) || equal(r, b)) value = l;
    else if (equal(l, b)) value = r;
    else {
      clash = true;
      if (l !== DRAFT_MISSING) localSide[key] = l;
      if (r !== DRAFT_MISSING) remoteSide[key] = r;
      if (r !== DRAFT_MISSING) merged[key] = r;
      continue;
    }
    if (value !== DRAFT_MISSING) {
      merged[key] = value;
      localSide[key] = value;
      remoteSide[key] = value;
    }
  }
  if (!clash) return unflattenShell(path, merged);
  conflicts.push(conflict(path, base, unflattenShell(path, localSide), unflattenShell(path, remoteSide)));
  return unflattenShell(path, merged);
}

function shellProperties(path: string, value: DraftMergeValue): Record<string, unknown> {
  if (value === DRAFT_MISSING || value == null) return {};
  if (path.startsWith('/pages/')) return { ...(value as Record<string, unknown>) };
  const item = value as SectionEntry;
  return { ...(item.section as Record<string, unknown>), $pageId: item.pageId };
}

function unflattenShell(path: string, properties: Record<string, unknown>): unknown {
  if (path.startsWith('/pages/')) return properties;
  const { $pageId, ...section } = properties;
  return { section, pageId: $pageId } as SectionEntry;
}

/** Orden de hijos: une altas y bajas de ambos lados; dos reordenamientos distintos son conflicto. */
function mergeOrder(
  path: string,
  base: DraftMergeValue,
  local: DraftMergeValue,
  remote: DraftMergeValue,
  conflicts: DraftRawConflict[],
): DraftMergeValue {
  if (equal(local, remote)) return local;
  if (equal(local, base)) return remote;
  if (equal(remote, base)) return local;
  const baseIds = ids(base);
  const localIds = ids(local);
  const remoteIds = ids(remote);
  const common = baseIds.filter((id) => localIds.includes(id) && remoteIds.includes(id));
  const localCommon = localIds.filter((id) => common.includes(id));
  const remoteCommon = remoteIds.filter((id) => common.includes(id));
  if (equal(localCommon, remoteCommon) || equal(remoteCommon, common))
    return interleave(localIds, remoteIds);
  if (equal(localCommon, common)) return interleave(remoteIds, localIds);
  conflicts.push(conflict(path, base, local, remote));
  return interleave(remoteIds, localIds);
}

/** `primary` con los ids que solo tiene `secondary`, cada uno detrás de su vecino anterior. */
function interleave(primary: readonly string[], secondary: readonly string[]): string[] {
  const result = [...primary];
  secondary.forEach((id, index) => {
    if (result.includes(id)) return;
    const previous = secondary.slice(0, index).reverse().find((candidate) => result.includes(candidate));
    result.splice(previous == null ? 0 : result.indexOf(previous) + 1, 0, id);
  });
  return result;
}

/**
 * Un elemento que quedaría sin contenedor no se descarta nunca. Se restaura su sección o página
 * desde el lado que la conserva y se abre un conflicto visible sobre ese contenedor:
 * - lo conserva este lado (el otro la borró): "mine" la deja como estaba aquí, "theirs" la borra;
 * - lo conserva el otro lado (aquí se borró, allá se agregó o editó contenido): "theirs" la devuelve
 *   con su contenido remoto y "mine" la borra con todo.
 * Si quedara un huérfano sin contenedor en ningún lado, también es conflicto visible.
 */
function restoreContainers(
  result: Entries,
  base: Entries,
  local: Entries,
  remote: Entries,
  conflicts: DraftRawConflict[],
): void {
  const conflictPaths = new Set(conflicts.map((item) => item.path));
  const source = (path: string): Entries | null =>
    local.has(path) ? local : remote.has(path) ? remote : null;
  const neededSections = new Set<string>();
  const neededPages = new Set<string>();
  // Contenedor borrado en un lado y editado en el otro: el candidato lo conserva con su contenido,
  // así "conservar" lo devuelve completo y "borrar" lo quita con todo.
  for (const item of conflicts) {
    if (item.local !== DRAFT_MISSING && item.remote !== DRAFT_MISSING) continue;
    const target = describeDefinitionPath(item.path);
    if (target.kind === 'section') neededSections.add(target.id);
    if (target.kind === 'page') neededPages.add(target.id);
  }
  for (const [path, value] of [...result.entries(), ...conflictSides(conflicts, '/components/')]) {
    if (!path.startsWith('/components/')) continue;
    const sectionId = (value as ComponentEntry).sectionId;
    if (!result.has(sectionPath(sectionId)) && source(sectionPath(sectionId)))
      neededSections.add(sectionId);
  }
  const sectionsToCheck: Array<[string, unknown]> = [
    ...result.entries(),
    ...conflictSides(conflicts, '/sections/'),
    ...[...neededSections].map(
      (id) => [sectionPath(id), source(sectionPath(id))!.get(sectionPath(id))] as [string, unknown],
    ),
  ];
  for (const [path, value] of sectionsToCheck) {
    if (!path.startsWith('/sections/')) continue;
    const pageId = (value as SectionEntry).pageId;
    if (!result.has(pagePath(pageId)) && source(pagePath(pageId))) neededPages.add(pageId);
  }

  for (const pageId of neededPages) {
    const from = source(pagePath(pageId))!;
    restore(result, from, pagePath(pageId));
    restore(result, from, `/order/pages/${escape(pageId)}`);
    // La página vuelve como la tiene ese lado, con sus secciones.
    for (const [path, value] of from)
      if (
        path.startsWith('/sections/') &&
        (value as SectionEntry).pageId === pageId &&
        !conflictPaths.has(path)
      )
        neededSections.add(unescape(path.slice('/sections/'.length)));
    addContainerConflict(pagePath(pageId), base, from === local, from, conflicts, conflictPaths);
  }
  for (const sectionId of neededSections) {
    const from = source(sectionPath(sectionId));
    if (!from) continue;
    restore(result, from, sectionPath(sectionId));
    restore(result, from, `/order/sections/${escape(sectionId)}`);
    for (const [path, value] of from)
      if (
        path.startsWith('/components/') &&
        (value as ComponentEntry).sectionId === sectionId &&
        !conflictPaths.has(path)
      )
        restore(result, from, path);
    const pageId = (from.get(sectionPath(sectionId)) as SectionEntry).pageId;
    // Si se restauró la página entera, el conflicto de la página ya cubre la sección.
    if (!neededPages.has(pageId))
      addContainerConflict(sectionPath(sectionId), base, from === local, from, conflicts, conflictPaths);
  }
  reportOrphans(result, base, local, remote, conflicts, conflictPaths);
}

/** Red de seguridad: un componente o sección sin contenedor nunca desaparece en silencio. */
function reportOrphans(
  result: Entries,
  base: Entries,
  local: Entries,
  remote: Entries,
  conflicts: DraftRawConflict[],
  existing: Set<string>,
): void {
  for (const [path, value] of [...result]) {
    const orphan =
      (path.startsWith('/components/') &&
        !result.has(sectionPath((value as ComponentEntry).sectionId))) ||
      (path.startsWith('/sections/') && !result.has(pagePath((value as SectionEntry).pageId)));
    if (!orphan) continue;
    result.delete(path);
    if (existing.has(path)) continue;
    existing.add(path);
    conflicts.push(conflict(path, entry(base, path), entry(local, path), entry(remote, path)));
  }
}

function conflictSides(conflicts: DraftRawConflict[], prefix: string): Array<[string, unknown]> {
  return conflicts
    .filter((item) => item.path.startsWith(prefix))
    .flatMap((item) =>
      [item.local, item.remote]
        .filter((side) => side !== DRAFT_MISSING && side != null)
        .map((side) => [item.path, side] as [string, unknown]),
    );
}

function restore(result: Entries, from: Entries, path: string): void {
  if (!result.has(path) && from.has(path)) result.set(path, clone(from.get(path)));
}

function addContainerConflict(
  path: string,
  base: Entries,
  keptHere: boolean,
  from: Entries,
  conflicts: DraftRawConflict[],
  existing: Set<string>,
): void {
  if (existing.has(path)) {
    // Ya había conflicto (p. ej. editado aquí y borrado allá): el candidato ahora conserva el contenedor.
    return;
  }
  existing.add(path);
  const kept = entry(from, path);
  conflicts.push(
    keptHere
      ? conflict(path, entry(base, path), kept, DRAFT_MISSING)
      : conflict(path, entry(base, path), DRAFT_MISSING, kept),
  );
}

// Contenedores al final: elegir borrar una sección se aplica después de sus componentes.
function sortConflicts(conflicts: DraftRawConflict[]): DraftRawConflict[] {
  const rank = (path: string) =>
    path.startsWith('/components/') ? 0 : path.startsWith('/order/') ? 1 : path.startsWith('/root/') ? 2 : path.startsWith('/sections/') ? 3 : 4;
  return [...conflicts].sort((left, right) => rank(left.path) - rank(right.path));
}

function applyEntry(entries: Entries, path: string, value: DraftMergeValue): void {
  const target = describeDefinitionPath(path);
  if (value !== DRAFT_MISSING) {
    entries.set(path, clone(value));
    return;
  }
  entries.delete(path);
  if (target.kind === 'page') {
    entries.delete(`/order/pages/${escape(target.id)}`);
    for (const [key, item] of [...entries])
      if (key.startsWith('/sections/') && (item as SectionEntry).pageId === target.id)
        applyEntry(entries, key, DRAFT_MISSING);
  }
  if (target.kind === 'section') {
    entries.delete(`/order/sections/${escape(target.id)}`);
    for (const [key, item] of [...entries])
      if (key.startsWith('/components/') && (item as ComponentEntry).sectionId === target.id)
        entries.delete(key);
  }
}

function definitionTarget(conflict: DraftRawConflict): DraftConflictTarget {
  const target = describeDefinitionPath(conflict.path);
  const componentId =
    target.kind === 'root' ? `$${target.id}` : target.kind === 'order' && target.container === 'pages' ? '$pages' : target.id;
  return {
    path: conflict.path,
    kind: conflict.kind,
    componentId,
    sectionId: null,
    rowId: null,
    rowIndex: null,
  };
}

function flatten(definition: FormDefinition): Entries {
  const entries: Entries = new Map();
  for (const [key, value] of Object.entries(definition)) {
    if (key === 'pages' || value === undefined) continue;
    entries.set(`/root/${escape(key)}`, clone(value));
  }
  const pages = Array.isArray(definition.pages) ? definition.pages : [];
  entries.set('/order/pages', pages.map((page) => page.id));
  for (const page of pages) {
    const { sections, ...shell } = page;
    entries.set(pagePath(page.id), clone(shell));
    const pageSections = Array.isArray(sections) ? sections : [];
    entries.set(`/order/pages/${escape(page.id)}`, pageSections.map((section) => section.id));
    for (const section of pageSections) {
      const { components, ...sectionShell } = section;
      entries.set(sectionPath(section.id), { section: clone(sectionShell), pageId: page.id } satisfies SectionEntry);
      const sectionComponents = Array.isArray(components) ? components : [];
      entries.set(`/order/sections/${escape(section.id)}`, sectionComponents.map((component) => component.id));
      for (const component of sectionComponents)
        entries.set(`/components/${escape(component.id)}`, {
          component: clone(component),
          sectionId: section.id,
        } satisfies ComponentEntry);
    }
  }
  return entries;
}

/** Arma la definición desde los elementos; el orden de las claves raíz sigue a `shape`. */
function build(entries: Entries, shape: FormDefinition): FormDefinition {
  const pageShells = collect<Omit<FormPage, 'sections'>>(entries, '/pages/');
  const sections = collect<SectionEntry>(entries, '/sections/');
  const components = collect<ComponentEntry>(entries, '/components/');
  const pages: FormPage[] = ordered([...pageShells.keys()], entries.get('/order/pages')).map((pageId) => {
    const sectionIds = [...sections].filter(([, item]) => item.pageId === pageId).map(([id]) => id);
    return {
      ...clone(pageShells.get(pageId)!),
      sections: ordered(sectionIds, entries.get(`/order/pages/${escape(pageId)}`)).map((sectionId) => {
        const componentIds = [...components]
          .filter(([, item]) => item.sectionId === sectionId)
          .map(([id]) => id);
        return {
          ...clone(sections.get(sectionId)!.section),
          components: ordered(componentIds, entries.get(`/order/sections/${escape(sectionId)}`)).map(
            (componentId) => clone(components.get(componentId)!.component),
          ),
        } as FormSection;
      }),
    } as FormPage;
  });
  const roots = new Map<string, unknown>();
  for (const [path, value] of entries)
    if (path.startsWith('/root/')) roots.set(unescape(path.slice('/root/'.length)), value);
  const keyOrder = [...Object.keys(shape), ...ROOT_ORDER, ...[...roots.keys()].sort()];
  const result: Record<string, unknown> = {};
  for (const key of keyOrder) {
    if (key in result) continue;
    if (key === 'pages') result['pages'] = pages;
    else if (roots.has(key)) result[key] = clone(roots.get(key));
  }
  if (!('pages' in result)) result['pages'] = pages;
  return result as unknown as FormDefinition;
}

function collect<T>(entries: Entries, prefix: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const [path, value] of entries)
    if (path.startsWith(prefix)) result.set(unescape(path.slice(prefix.length)), value as T);
  return result;
}

/** Ordena `present` según `order`; los que no figuran van al final en su orden actual. */
function ordered(present: readonly string[], order: unknown): string[] {
  const preferred = ids(order).filter((id) => present.includes(id));
  return [...new Set(preferred), ...present.filter((id) => !preferred.includes(id))];
}

function ids(value: DraftMergeValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function conflict(
  path: string,
  base: DraftMergeValue,
  local: DraftMergeValue,
  remote: DraftMergeValue,
): DraftRawConflict {
  return { id: path, path, kind: 'value', base: clone(base), local: clone(local), remote: clone(remote) };
}

function entry(entries: Entries, path: string): DraftMergeValue {
  return entries.has(path) ? entries.get(path) : DRAFT_MISSING;
}

function pagePath(id: string): string {
  return `/pages/${escape(id)}`;
}

function sectionPath(id: string): string {
  return `/sections/${escape(id)}`;
}

function equal(left: DraftMergeValue, right: DraftMergeValue): boolean {
  if (left === DRAFT_MISSING || right === DRAFT_MISSING) return left === right;
  return canonicalJson(left) === canonicalJson(right);
}

function clone<T>(value: T): T {
  return value === DRAFT_MISSING || value === undefined ? value : structuredClone(value);
}

function escape(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function unescape(value: string): string {
  return value.replaceAll('~1', '/').replaceAll('~0', '~');
}
