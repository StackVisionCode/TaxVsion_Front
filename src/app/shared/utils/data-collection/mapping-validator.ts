import { getComponentType } from './component-registry';
import type { Condition } from './conditions';
import type {
  FormAction,
  FormComponent,
  FormDefinition,
  FormMapping,
  FormPage,
  FormSection,
  MappingTransform,
} from './form-definition.model';
import { ISSUE_CODES } from './issue-codes';
import type {
  MappingCatalogSnapshot,
  MappingOperation,
  MappingSensitivity,
  MappingTarget,
  MappingTargetField,
  MappingTargetType,
  PublisherCapabilities,
} from './mapping.model';
import { compareOrdinal, intProp, optionValues, stringProp } from './properties';
import { issue, report, type ValidationIssue, type ValidationReport } from './validation';

interface MappingSource {
  component: FormComponent;
  section: FormSection;
  page: FormPage;
  inRepeater: boolean;
  isRestricted: boolean;
}

interface MappingContext {
  definition: FormDefinition;
  catalog: MappingCatalogSnapshot;
  capabilities: PublisherCapabilities;
  sources: Map<string, MappingSource>;
  sections: Map<string, { section: FormSection; page: FormPage }>;
  mappings: FormMapping[];
  mappedTargets: Map<string, number>;
  issues: ValidationIssue[];
}

const compatibleComponents: Readonly<Record<MappingTargetType, readonly string[]>> = {
  string: ['text', 'textarea'],
  email: ['email'],
  phone: ['phone'],
  date: ['date'],
  enum: ['select', 'radio'],
  boolean: ['yesNo', 'checkbox'],
  address: ['address'],
  taxId: ['taxId'],
  collection: [],
};

const actionOperation: Readonly<Record<string, string>> = {
  notifyStaff: 'NotifyStaff',
  routeToReview: 'RouteToReview',
  generateSummary: 'GenerateSummary',
  createCustomer: 'CreateCustomer',
  updateCustomerProfile: 'UpdateCustomerProfile',
  requestSignature: 'RequestSignature',
  applyRetentionClass: 'ApplyRetentionClass',
};

export function validateMappings(
  definition: FormDefinition,
  catalog: MappingCatalogSnapshot,
  capabilities: PublisherCapabilities,
): ValidationReport {
  const context = createContext(definition, catalog, capabilities);
  context.mappings.forEach((mapping, index) => validateMapping(context, mapping, index));
  validateCoverage(context);
  return report(context.issues);
}

function createContext(
  definition: FormDefinition,
  catalog: MappingCatalogSnapshot,
  capabilities: PublisherCapabilities,
): MappingContext {
  const sources = new Map<string, MappingSource>();
  const sections = new Map<string, { section: FormSection; page: FormPage }>();
  for (const page of definition.pages ?? [])
    for (const section of page.sections ?? []) {
      if (!sections.has(section.id)) sections.set(section.id, { section, page });
      for (const component of section.components ?? []) {
        const type = getComponentType(component.type);
        const effectiveClass = component.dataClass ?? type?.minimumDataClass;
        if (!sources.has(component.id))
          sources.set(component.id, {
            component,
            section,
            page,
            inRepeater: section.repeat != null,
            isRestricted: component.type === 'taxId' || effectiveClass === 'restricted',
          });
      }
    }
  return {
    definition,
    catalog,
    capabilities,
    sources,
    sections,
    mappings: definition.mappings ?? [],
    mappedTargets: new Map(),
    issues: [],
  };
}

function validateMapping(context: MappingContext, mapping: FormMapping, index: number): void {
  const path = `/mappings/${index}`;
  const target = findTarget(context, mapping.targetKey);
  if (target == null || target.status === 'retired') {
    add(context, ISSUE_CODES.mappingUnknownTarget, `${path}/targetKey`, mapping.componentId);
    return;
  }
  validateTargetUse(context, mapping, target, index, path);
  const section = context.sections.get(mapping.componentId)?.section;
  if (section != null) {
    validateCollection(context, mapping, target, section, path);
    return;
  }
  const source = context.sources.get(mapping.componentId);
  if (source == null)
    add(context, ISSUE_CODES.mappingInvalidTarget, `${path}/componentId`, mapping.componentId);
  else validateScalar(context, mapping, target, source, path);
}

function validateTargetUse(
  context: MappingContext,
  mapping: FormMapping,
  target: MappingTarget,
  index: number,
  path: string,
): void {
  if (target.status === 'deprecated')
    add(context, ISSUE_CODES.mappingDeprecatedTarget, `${path}/targetKey`, mapping.componentId);
  if (!allows(context.capabilities, target.requiredPermissions, target.requiresTenantAdmin))
    add(context, ISSUE_CODES.mappingPermissionDenied, `${path}/targetKey`, mapping.componentId);
  if (context.mappedTargets.has(target.targetKey))
    add(context, ISSUE_CODES.mappingDuplicateTarget, `${path}/targetKey`, mapping.componentId);
  else context.mappedTargets.set(target.targetKey, index);
}

function validateScalar(
  context: MappingContext,
  mapping: FormMapping,
  target: MappingTarget,
  source: MappingSource,
  path: string,
): void {
  const sourcePath = `${path}/componentId`;
  if (!validateSourceShape(context, source, target.dataType, target.sensitivity, sourcePath))
    return;
  if (!allowsTransform(target.dataType, mapping.transform ?? 'none'))
    add(context, ISSUE_CODES.mappingTypeMismatch, `${path}/transform`, source.component.id);
  if (mapping.rowFields != null)
    add(context, ISSUE_CODES.mappingTypeMismatch, `${path}/rowFields`, source.component.id);
  if (target.dataType === 'enum') validateOptionMap(context, mapping, target, source, path);
  else if (mapping.optionMap != null)
    add(context, ISSUE_CODES.mappingTypeMismatch, `${path}/optionMap`, source.component.id);
  validateLimits(context, source.component, target.maxLength, target.pastOnly === true, sourcePath);
}

function validateSourceShape(
  context: MappingContext,
  source: MappingSource,
  targetType: MappingTargetType,
  sensitivity: MappingSensitivity,
  path: string,
): boolean {
  if (source.inRepeater && targetType !== 'collection')
    return reject(context, ISSUE_CODES.mappingTypeMismatch, path, source.component.id);
  if (targetType === 'collection')
    return reject(context, ISSUE_CODES.mappingTypeMismatch, path, source.component.id);
  if (source.isRestricted !== (sensitivity === 'restricted'))
    return reject(context, ISSUE_CODES.mappingSensitivityMismatch, path, source.component.id);
  if (!compatibleComponents[targetType].includes(source.component.type))
    return reject(context, ISSUE_CODES.mappingTypeMismatch, path, source.component.id);
  return true;
}

function validateOptionMap(
  context: MappingContext,
  mapping: FormMapping,
  target: MappingTarget,
  source: MappingSource,
  path: string,
): void {
  const options = optionValues(source.component.props);
  const map = mapping.optionMap;
  const complete =
    map != null &&
    [...options].every((value) => Object.prototype.hasOwnProperty.call(map, value)) &&
    Object.keys(map).every((value) => options.has(value)) &&
    Object.values(map).every((value) => (target.enumValues ?? []).includes(value));
  if (!complete)
    add(context, ISSUE_CODES.mappingOptionMapIncomplete, `${path}/optionMap`, source.component.id);
}

function validateLimits(
  context: MappingContext,
  component: FormComponent,
  maxLength: number | null | undefined,
  pastOnly: boolean,
  path: string,
): void {
  const componentMax =
    component.type === 'text'
      ? intProp(component.props, 'maxLength', 200)
      : component.type === 'textarea'
        ? intProp(component.props, 'maxLength', 2_000)
        : null;
  if (maxLength != null && componentMax != null && componentMax > maxLength)
    add(context, ISSUE_CODES.mappingLengthExceedsTarget, path, component.id);
  if (pastOnly && component.type === 'date' && stringProp(component.props, 'max') !== 'today')
    add(context, ISSUE_CODES.mappingTypeMismatch, path, component.id);
}

function validateCollection(
  context: MappingContext,
  mapping: FormMapping,
  target: MappingTarget,
  section: FormSection,
  path: string,
): void {
  if (section.repeat == null || target.dataType !== 'collection') {
    add(context, ISSUE_CODES.mappingTypeMismatch, `${path}/componentId`, mapping.componentId);
    return;
  }
  if (mapping.optionMap != null || (mapping.transform ?? 'none') !== 'none')
    add(context, ISSUE_CODES.mappingTypeMismatch, path, mapping.componentId);
  if (mapping.rowFields == null || Object.keys(mapping.rowFields).length === 0) {
    add(context, ISSUE_CODES.mappingTypeMismatch, `${path}/rowFields`, mapping.componentId);
    return;
  }
  validateRowFields(context, mapping.rowFields, target, section, path);
}

function validateRowFields(
  context: MappingContext,
  rowFields: Record<string, string>,
  target: MappingTarget,
  section: FormSection,
  path: string,
): void {
  const used = new Set<string>();
  for (const [componentId, fieldName] of Object.entries(rowFields).sort(([left], [right]) =>
    compareOrdinal(left, right),
  )) {
    validateRowField(
      context,
      target,
      section,
      componentId,
      fieldName,
      `${path}/rowFields/${componentId}`,
      used,
    );
  }
  for (const field of target.fields ?? [])
    if (field.required === true && !used.has(field.name))
      add(context, ISSUE_CODES.mappingRequiredTargetMissing, `${path}/rowFields`, section.id);
}

function validateRowField(
  context: MappingContext,
  target: MappingTarget,
  section: FormSection,
  componentId: string,
  fieldName: string,
  path: string,
  used: Set<string>,
): void {
  const source = context.sources.get(componentId);
  if (source == null || source.section !== section) {
    add(context, ISSUE_CODES.mappingTypeMismatch, path, componentId);
    return;
  }
  const field = (target.fields ?? []).find((item) => item.name === fieldName);
  if (field == null) {
    add(context, ISSUE_CODES.mappingUnknownTarget, path, componentId);
    return;
  }
  if (used.has(fieldName)) add(context, ISSUE_CODES.mappingDuplicateTarget, path, componentId);
  else used.add(fieldName);
  const fieldType = field.dataType === 'enum' ? 'collection' : field.dataType;
  if (validateRowSource(context, source, fieldType, target.sensitivity, path))
    validateLimits(context, source.component, field.maxLength, false, path);
}

function validateRowSource(
  context: MappingContext,
  source: MappingSource,
  fieldType: MappingTargetType,
  sensitivity: MappingSensitivity,
  path: string,
): boolean {
  if (source.isRestricted !== (sensitivity === 'restricted'))
    return reject(context, ISSUE_CODES.mappingSensitivityMismatch, path, source.component.id);
  if (!compatibleComponents[fieldType].includes(source.component.type))
    return reject(context, ISSUE_CODES.mappingTypeMismatch, path, source.component.id);
  return true;
}

function validateCoverage(context: MappingContext): void {
  const flagged = new Set<number>();
  (context.definition.actions ?? []).forEach((action, index) => {
    const operation = context.catalog.operations.find(
      (item) => item.name === actionOperation[action.type],
    );
    if (operation != null) validateAction(context, action, operation, `/actions/${index}`, flagged);
  });
}

function validateAction(
  context: MappingContext,
  action: FormAction,
  operation: MappingOperation,
  path: string,
  flagged: Set<number>,
): void {
  if (!allows(context.capabilities, operation.requiredPermissions, operation.requiresTenantAdmin))
    add(context, ISSUE_CODES.mappingPermissionDenied, `${path}/type`, null);
  const constants = readConstants(context, action, operation, path);
  const scope = resolveKinds(context, operation, constants);
  validateRequiredTargets(context, operation, constants, scope.kinds, path);
  validateSources(context, operation, scope, flagged);
}

function readConstants(
  context: MappingContext,
  action: FormAction,
  operation: MappingOperation,
  path: string,
): Map<string, string> {
  const constants = new Map<string, string>();
  for (const [configKey, targetKey] of Object.entries(operation.configTargets).sort(
    ([left], [right]) => compareOrdinal(left, right),
  )) {
    const target = findTarget(context, targetKey);
    const source = action.config?.[configKey];
    const value =
      source != null &&
      typeof source === 'object' &&
      !Array.isArray(source) &&
      typeof (source as Record<string, unknown>)['constant'] === 'string'
        ? (source as Record<string, string>)['constant']
        : null;
    if (target == null || value == null) continue;
    validateConstant(context, target, value, `${path}/config/${configKey}`);
    constants.set(targetKey, value);
  }
  return constants;
}

function validateConstant(
  context: MappingContext,
  target: MappingTarget,
  value: string,
  path: string,
): void {
  if (target.dataType === 'enum' && !(target.enumValues ?? []).includes(value))
    add(context, ISSUE_CODES.mappingTypeMismatch, path, null);
  if (!allows(context.capabilities, target.requiredPermissions, target.requiresTenantAdmin))
    add(context, ISSUE_CODES.mappingPermissionDenied, path, null);
  if (context.mappedTargets.has(target.targetKey))
    add(context, ISSUE_CODES.mappingDuplicateTarget, path, null);
}

interface KindScope {
  kinds: Set<string>;
  analyzer: KindConditionAnalyzer;
}

function resolveKinds(
  context: MappingContext,
  operation: MappingOperation,
  constants: Map<string, string>,
): KindScope {
  const target = findTarget(context, operation.discriminatorTargetKey ?? '');
  if (target == null) return { kinds: new Set(), analyzer: new KindConditionAnalyzer(null, null) };
  const constant = constants.get(target.targetKey);
  if (constant != null)
    return { kinds: new Set([constant]), analyzer: new KindConditionAnalyzer(null, null) };
  const index = context.mappedTargets.get(target.targetKey);
  const mapping = index == null ? null : context.mappings[index];
  const optionKinds = new Map(
    Object.entries(mapping?.optionMap ?? {}).filter(([, value]) =>
      (target.enumValues ?? []).includes(value),
    ),
  );
  return {
    kinds: new Set(optionKinds.size > 0 ? optionKinds.values() : (target.enumValues ?? [])),
    analyzer: new KindConditionAnalyzer(mapping?.componentId ?? null, optionKinds),
  };
}

function validateRequiredTargets(
  context: MappingContext,
  operation: MappingOperation,
  constants: Map<string, string>,
  kinds: Set<string>,
  path: string,
): void {
  for (const target of context.catalog.targets) {
    if (
      target.status === 'retired' ||
      context.mappedTargets.has(target.targetKey) ||
      constants.has(target.targetKey)
    )
      continue;
    const missing = target.requiredFor.find(
      (requirement) =>
        requirement.operation === operation.name &&
        (requirement.kind == null || kinds.has(requirement.kind)),
    );
    if (missing != null) add(context, ISSUE_CODES.mappingRequiredTargetMissing, path, null);
  }
}

function validateSources(
  context: MappingContext,
  operation: MappingOperation,
  scope: KindScope,
  flagged: Set<number>,
): void {
  context.mappings.forEach((mapping, index) => {
    const target = findTarget(context, mapping.targetKey);
    const source = context.sources.get(mapping.componentId);
    if (flagged.has(index) || target == null || source == null || source.inRepeater) return;
    const kinds = requiredKinds(target, operation.name, scope.kinds);
    if (kinds == null || isAlwaysAnswered(source, kinds, scope.analyzer)) return;
    flagged.add(index);
    add(
      context,
      ISSUE_CODES.mappingSourceNotRequired,
      `/mappings/${index}/componentId`,
      source.component.id,
    );
  });
}

function requiredKinds(
  target: MappingTarget,
  operation: string,
  kinds: Set<string>,
): Set<string> | null {
  let result: Set<string> | null = null;
  for (const requirement of target.requiredFor) {
    if (requirement.operation !== operation) continue;
    if (requirement.kind == null) return kinds;
    if (kinds.has(requirement.kind)) (result ??= new Set()).add(requirement.kind);
  }
  return result;
}

function isAlwaysAnswered(
  source: MappingSource,
  kinds: Set<string>,
  analyzer: KindConditionAnalyzer,
): boolean {
  const component = source.component;
  const required =
    component.required === true ||
    (component.requiredWhen != null && analyzer.holdsFor(component.requiredWhen, kinds));
  return (
    required &&
    analyzer.holdsFor(source.page.visibleWhen, kinds) &&
    analyzer.holdsFor(source.section.visibleWhen, kinds) &&
    analyzer.holdsFor(component.visibleWhen, kinds)
  );
}

class KindConditionAnalyzer {
  constructor(
    private readonly discriminator: string | null,
    private readonly optionKinds: ReadonlyMap<string, string> | null,
  ) {}

  holdsFor(condition: Condition | null | undefined, kinds: Set<string>): boolean {
    if (condition == null) return true;
    if (this.discriminator == null || kinds.size === 0) return false;
    const options = [...(this.optionKinds ?? new Map())]
      .filter(([, kind]) => kinds.has(kind))
      .map(([option]) => option);
    return (
      options.length > 0 && options.every((option) => this.evaluate(condition, option) === true)
    );
  }

  private evaluate(condition: Condition, option: string): boolean | null {
    if (condition.all != null)
      return combine(
        condition.all.map((child) => this.evaluate(child, option)),
        true,
      );
    if (condition.any != null)
      return combine(
        condition.any.map((child) => this.evaluate(child, option)),
        false,
      );
    if (condition.not != null) {
      const inner = this.evaluate(condition.not, option);
      return inner == null ? null : !inner;
    }
    if (condition.field !== this.discriminator) return null;
    if (condition.op === 'equals') return matches(condition.value, option);
    if (condition.op === 'notEquals') return negate(matches(condition.value, option));
    if (condition.op === 'in') return contains(condition.value, option);
    if (condition.op === 'notIn') return negate(contains(condition.value, option));
    if (condition.op === 'isAnswered') return true;
    if (condition.op === 'isNotAnswered') return false;
    return null;
  }
}

function combine(results: Array<boolean | null>, requireAll: boolean): boolean | null {
  if (requireAll)
    return results.includes(false) ? false : results.every((value) => value === true) ? true : null;
  return results.includes(true) ? true : results.every((value) => value === false) ? false : null;
}

function matches(value: unknown, option: string): boolean | null {
  return typeof value === 'string' ? value === option : null;
}
function contains(value: unknown, option: string): boolean | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value.includes(option)
    : null;
}
function negate(value: boolean | null): boolean | null {
  return value == null ? null : !value;
}
function findTarget(context: MappingContext, key: string): MappingTarget | undefined {
  return context.catalog.targets.find((target) => target.targetKey === key);
}
function allows(
  capabilities: PublisherCapabilities,
  permissions: string[],
  tenantAdmin: boolean,
): boolean {
  return (
    (!tenantAdmin || capabilities.isTenantAdmin) &&
    permissions.every((permission) => capabilities.permissions.includes(permission))
  );
}
function allowsTransform(type: MappingTargetType, transform: MappingTransform): boolean {
  return (
    transform === 'none' ||
    type === 'string' ||
    (type === 'email' && ['trim', 'lowercase'].includes(transform)) ||
    (type === 'phone' && transform === 'trim')
  );
}
function reject(context: MappingContext, code: string, path: string, componentId: string): false {
  add(context, code, path, componentId);
  return false;
}
function add(
  context: MappingContext,
  code: string,
  path: string,
  componentId: string | null,
): void {
  context.issues.push(issue(code, path, componentId));
}
