import type {
  FormAction,
  FormActionType,
  FormComponent,
  FormDefinition,
} from '@shared/utils/data-collection/form-definition.model';
import { ISSUE_CODES } from '@shared/utils/data-collection/issue-codes';
import { validateMappings } from '@shared/utils/data-collection/mapping-validator';
import type { MappingOperation, PublisherCapabilities } from '@shared/utils/data-collection/mapping.model';
import { isRecord } from '@shared/utils/data-collection/properties';
import type { ValidationIssue } from '@shared/utils/data-collection/validation';
import type { CatalogTarget, MappingCatalog } from '../data-access/mapping-catalog.model';
import { actionDescriptor, actionLabel, operationName } from './form-action-catalog';
import type { MappingRemoval } from './mapping-mutations';
import {
  componentLabel,
  findComponentContext,
  inputContexts,
  isTargetCompatible,
} from './mapping-compatibility';

export type ActionCoverageState = 'ready' | 'missing' | 'notRequired' | 'unavailable';

export interface CoverageCandidate {
  componentId: string;
  label: string;
}

export interface CoverageMissingTarget {
  targetKey: string;
  displayName: string;
  /** Vacío: requerido siempre; si no, los Kind de cliente que lo exigen. */
  kinds: string[];
  /** Campos sin mapear que podrían alimentarlo. */
  candidates: CoverageCandidate[];
}

export interface CoverageFieldProblem {
  componentId: string;
  label: string;
  code: string;
  message: string;
  /** False si el campo ya no existe en la definición (mapeo huérfano). */
  exists: boolean;
  /** Cómo quitar el mapeo (o la fila de `rowFields`) que causa el problema. */
  removal: MappingRemoval | null;
  /** Arreglo de un clic sobre el campo, cuando lo hay (p. ej. "Limit to 80"). */
  fix: CoverageFix | null;
}

export interface CoverageFix {
  label: string;
  componentId: string;
  patch: Partial<FormComponent>;
}

export interface ActionCoverage {
  actionKey: string;
  actionType: FormActionType;
  label: string;
  operation: string | null;
  state: ActionCoverageState;
  missing: CoverageMissingTarget[];
  fieldProblems: CoverageFieldProblem[];
  configProblems: string[];
}

export interface MappingCoverage {
  actions: ActionCoverage[];
  /** Problemas de los mapeos en sí, independientes de las acciones. */
  fieldProblems: CoverageFieldProblem[];
  ready: boolean;
}

// El catálogo ya viene filtrado por permisos: el engine no vuelve a decidirlos.
const OPEN_CAPABILITIES: PublisherCapabilities = { permissions: [], isTenantAdmin: false };

const FIELD_MESSAGES: Readonly<Record<string, string>> = {
  [ISSUE_CODES.mappingInvalidTarget]: 'The mapped field no longer exists.',
  [ISSUE_CODES.mappingUnknownTarget]: "Maps to a client property that doesn't exist or you can't use.",
  [ISSUE_CODES.mappingDeprecatedTarget]: 'Maps to a deprecated client property. Pick another one.',
  [ISSUE_CODES.mappingTypeMismatch]: "The field doesn't fit the client property.",
  [ISSUE_CODES.mappingLengthExceedsTarget]: 'The field allows more characters than the client property.',
  [ISSUE_CODES.mappingOptionMapIncomplete]: 'Every option needs a matching client value.',
  [ISSUE_CODES.mappingSensitivityMismatch]: 'Tax IDs only map to restricted properties.',
  [ISSUE_CODES.mappingDuplicateTarget]: 'Another field already maps to this property.',
  [ISSUE_CODES.mappingPermissionDenied]: "You don't have permission to map this property.",
  [ISSUE_CODES.mappingSourceNotRequired]: 'Make this field required: the client record needs it.',
  [ISSUE_CODES.mappingRequiredTargetMissing]: 'A required row field is not mapped.',
};

const CONFIG_MESSAGES: Readonly<Record<string, string>> = {
  [ISSUE_CODES.mappingTypeMismatch]: "A fixed value isn't accepted by the client record.",
  [ISSUE_CODES.mappingDuplicateTarget]: 'A value is fixed here and also mapped to a field: keep only one.',
  [ISSUE_CODES.mappingPermissionDenied]: "You don't have permission to configure this action.",
};

export function computeCoverage(definition: FormDefinition, catalog: MappingCatalog): MappingCoverage {
  const fieldProblems = toFieldProblems(
    definition,
    validateMappings({ ...definition, actions: [] }, catalog, OPEN_CAPABILITIES).issues,
    catalog,
  );
  const actions = (definition.actions ?? []).map((action) => actionCoverage(definition, catalog, action));
  return {
    actions,
    fieldProblems,
    ready:
      fieldProblems.length === 0 &&
      actions.every((item) => item.state === 'ready' || item.state === 'notRequired'),
  };
}

export function actionCoverage(
  definition: FormDefinition,
  catalog: MappingCatalog,
  action: FormAction,
): ActionCoverage {
  const base = {
    actionKey: action.key,
    actionType: action.type,
    label: actionLabel(action.type),
    missing: [] as CoverageMissingTarget[],
    fieldProblems: [] as CoverageFieldProblem[],
    configProblems: [] as string[],
  };
  const name = operationName(action.type);
  const operation = catalog.operations.find((item) => item.name === name);
  if (!operation) {
    const needsMapping = actionDescriptor(action.type)?.mappingOperation != null;
    return { ...base, operation: null, state: needsMapping ? 'unavailable' : 'notRequired' };
  }
  // Solo esta acción: así los issues del engine quedan atribuidos a ella.
  const issues = validateMappings({ ...definition, actions: [action] }, catalog, OPEN_CAPABILITIES).issues;
  const missing = missingTargets(definition, catalog, action, operation);
  const fieldProblems = toFieldProblems(
    definition,
    issues.filter((item) => item.code === ISSUE_CODES.mappingSourceNotRequired),
    catalog,
  );
  const configProblems = [
    ...new Set(
      issues
        .filter((item) => item.path.startsWith('/actions/0/'))
        .map((item) => CONFIG_MESSAGES[item.code])
        .filter((message): message is string => message != null),
    ),
  ];
  const ready = missing.length === 0 && fieldProblems.length === 0 && configProblems.length === 0;
  return {
    ...base,
    operation: operation.name,
    state: ready ? 'ready' : 'missing',
    missing,
    fieldProblems,
    configProblems,
  };
}

/** Requeridos sin mapeo ni constante, por cada Kind posible (como `ValidateRequiredTargets`). */
export function missingTargets(
  definition: FormDefinition,
  catalog: MappingCatalog,
  action: FormAction,
  operation: MappingOperation,
): CoverageMissingTarget[] {
  const mapped = new Set((definition.mappings ?? []).map((mapping) => mapping.targetKey));
  const constants = readConstants(catalog, action, operation);
  const kinds = possibleKinds(definition, catalog, operation, constants);
  const result: CoverageMissingTarget[] = [];
  for (const target of catalog.targets) {
    if (target.status === 'retired' || mapped.has(target.targetKey) || constants.has(target.targetKey))
      continue;
    const requirements = target.requiredFor.filter(
      (item) => item.operation === operation.name && (item.kind == null || kinds.has(item.kind)),
    );
    if (requirements.length === 0) continue;
    const always = requirements.some((item) => item.kind == null);
    result.push({
      targetKey: target.targetKey,
      displayName: target.displayName,
      kinds: always ? [] : requirements.map((item) => item.kind as string),
      candidates: candidatesFor(definition, target),
    });
  }
  return result;
}

function readConstants(
  catalog: MappingCatalog,
  action: FormAction,
  operation: MappingOperation,
): Map<string, string> {
  const constants = new Map<string, string>();
  for (const [configKey, targetKey] of Object.entries(operation.configTargets)) {
    const source = action.config?.[configKey];
    const value = isRecord(source) && typeof source['constant'] === 'string' ? source['constant'] : null;
    if (value != null && catalog.targets.some((target) => target.targetKey === targetKey))
      constants.set(targetKey, value);
  }
  return constants;
}

// Constante: un Kind. Mapeado: los que alcanza su optionMap. Sin ninguno: todos los del destino.
function possibleKinds(
  definition: FormDefinition,
  catalog: MappingCatalog,
  operation: MappingOperation,
  constants: Map<string, string>,
): Set<string> {
  const target = catalog.targets.find((item) => item.targetKey === operation.discriminatorTargetKey);
  if (!target) return new Set();
  const constant = constants.get(target.targetKey);
  if (constant != null) return new Set([constant]);
  const allowed = target.enumValues ?? [];
  const mapping = (definition.mappings ?? []).find((item) => item.targetKey === target.targetKey);
  const reached = Object.values(mapping?.optionMap ?? {}).filter((value) => allowed.includes(value));
  return new Set(reached.length > 0 ? reached : allowed);
}

function candidatesFor(definition: FormDefinition, target: CatalogTarget): CoverageCandidate[] {
  const mappedComponents = new Set((definition.mappings ?? []).map((mapping) => mapping.componentId));
  // Una colección se alimenta de una sección repeater, no de un campo.
  if (target.dataType === 'collection')
    return definition.pages
      .flatMap((page) => page.sections)
      .filter((section) => section.repeat != null && !mappedComponents.has(section.id))
      .map((section) => ({ componentId: section.id, label: section.title || 'Repeating section' }));
  return inputContexts(definition)
    .filter((source) => !mappedComponents.has(source.component.id) && isTargetCompatible(source, target))
    .map((source) => ({ componentId: source.component.id, label: componentLabel(source.component) }));
}

function toFieldProblems(
  definition: FormDefinition,
  issues: ValidationIssue[],
  catalog: MappingCatalog,
): CoverageFieldProblem[] {
  const seen = new Set<string>();
  const result: CoverageFieldProblem[] = [];
  for (const item of issues) {
    if (!item.componentId) continue;
    const id = `${item.componentId}|${item.code}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const context = findComponentContext(definition, item.componentId);
    const section = definition.pages
      .flatMap((page) => page.sections)
      .find((candidate) => candidate.id === item.componentId);
    result.push({
      componentId: item.componentId,
      label: context ? componentLabel(context.component) : (section?.title ?? 'Removed field'),
      code: item.code,
      message: FIELD_MESSAGES[item.code] ?? 'This mapping is not valid.',
      exists: context != null || section != null,
      removal: removalFor(definition, item.path),
      fix: item.code === ISSUE_CODES.mappingLengthExceedsTarget ? lengthFix(definition, catalog, item.path) : null,
    });
  }
  return result;
}

// El arreglo útil para un campo más largo que el destino es acortarlo, no quitar el mapeo.
function lengthFix(definition: FormDefinition, catalog: MappingCatalog, path: string): CoverageFix | null {
  const match = /^\/mappings\/(\d+)(?:\/rowFields\/([^/]+))?/.exec(path);
  const mapping = match ? (definition.mappings ?? [])[Number(match[1])] : undefined;
  const target = mapping ? catalog.targets.find((item) => item.targetKey === mapping.targetKey) : undefined;
  if (!match || !mapping || !target) return null;
  const componentId = match[2] ?? mapping.componentId;
  const max = match[2]
    ? target.fields.find((field) => field.name === mapping.rowFields?.[componentId])?.maxLength
    : target.maxLength;
  const component = findComponentContext(definition, componentId)?.component;
  if (max == null || !component) return null;
  return {
    label: `Limit to ${max}`,
    componentId,
    patch: { props: { ...(component.props ?? {}), maxLength: max } },
  };
}

// "/mappings/3/rowFields/fd_x" → quita esa fila; "/mappings/3/..." → quita el mapeo entero.
function removalFor(definition: FormDefinition, path: string): MappingRemoval | null {
  const match = /^\/mappings\/(\d+)(?:\/rowFields\/([^/]+))?/.exec(path);
  const mapping = match ? (definition.mappings ?? [])[Number(match[1])] : undefined;
  if (!match || !mapping) return null;
  return { mappingComponentId: mapping.componentId, rowComponentId: match[2] ?? null };
}
