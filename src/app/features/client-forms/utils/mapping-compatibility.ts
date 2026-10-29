import { getComponentType } from '@shared/utils/data-collection/component-registry';
import type {
  FormComponent,
  FormDefinition,
  FormMapping,
  FormPage,
  FormSection,
  MappingTransform,
} from '@shared/utils/data-collection/form-definition.model';
import type { MappingTargetType } from '@shared/utils/data-collection/mapping.model';
import { intProp, isRecord, stringProp } from '@shared/utils/data-collection/properties';
import type { CatalogTarget, MappingCatalog } from '../data-access/mapping-catalog.model';
import { operationLabel } from './form-action-catalog';

/** Dónde vive un componente: lo necesita la compatibilidad (repeater, sensibilidad). */
export interface ComponentContext {
  component: FormComponent;
  section: FormSection;
  page: FormPage;
  inRepeater: boolean;
  isRestricted: boolean;
}

export type MappingUnavailableReason = 'unsupportedType' | 'inRepeater' | 'noTargets';

export interface ComponentOption {
  value: string;
  label: string;
}

// P-16.3: archivo, consentimiento y firma nunca se mapean.
const NEVER_MAPPED = new Set(['file', 'consent', 'signatureStep']);

export function findComponentContext(
  definition: FormDefinition,
  componentId: string,
): ComponentContext | null {
  for (const page of definition.pages)
    for (const section of page.sections) {
      const component = section.components.find((item) => item.id === componentId);
      if (component) return contextOf(component, section, page);
    }
  return null;
}

export function inputContexts(definition: FormDefinition): ComponentContext[] {
  const result: ComponentContext[] = [];
  for (const page of definition.pages)
    for (const section of page.sections)
      for (const component of section.components)
        if (getComponentType(component.type)?.kind === 'input')
          result.push(contextOf(component, section, page));
  return result;
}

function contextOf(component: FormComponent, section: FormSection, page: FormPage): ComponentContext {
  const effectiveClass = component.dataClass ?? getComponentType(component.type)?.minimumDataClass;
  return {
    component,
    section,
    page,
    inRepeater: section.repeat != null,
    isRestricted: component.type === 'taxId' || effectiveClass === 'restricted',
  };
}

/** Misma regla que `MappingValidator.ValidateSourceShape`, con la compatibilidad del backend. */
export function isTargetCompatible(source: ComponentContext, target: CatalogTarget): boolean {
  return (
    !source.inRepeater &&
    target.dataType !== 'collection' &&
    target.compatibleComponentTypes.includes(source.component.type) &&
    source.isRestricted === (target.sensitivity === 'restricted')
  );
}

/** Destinos que este campo puede alimentar. Un destino obsoleto solo aparece si ya está elegido. */
export function compatibleTargets(
  catalog: MappingCatalog,
  source: ComponentContext,
  currentTargetKey: string | null = null,
): CatalogTarget[] {
  return catalog.targets.filter(
    (target) =>
      target.status !== 'retired' &&
      (target.status === 'active' || target.targetKey === currentTargetKey) &&
      isTargetCompatible(source, target),
  );
}

export function mappingUnavailableReason(
  catalog: MappingCatalog,
  source: ComponentContext,
): MappingUnavailableReason | null {
  const type = getComponentType(source.component.type);
  if (type?.kind !== 'input' || NEVER_MAPPED.has(source.component.type)) return 'unsupportedType';
  if (source.inRepeater) return 'inRepeater';
  return compatibleTargets(catalog, source).length === 0 ? 'noTargets' : null;
}

export function domainsOf(targets: readonly CatalogTarget[]): string[] {
  return [...new Set(targets.map((target) => target.domain))];
}

export function entitiesOf(targets: readonly CatalogTarget[], domain: string): string[] {
  return [...new Set(targets.filter((t) => t.domain === domain).map((t) => t.entity))];
}

/** Replica `MappingCompatibility.AllowsTransform`. */
export function allowedTransforms(type: MappingTargetType): MappingTransform[] {
  if (type === 'string') return ['none', 'trim', 'lowercase', 'uppercase', 'digitsOnly'];
  if (type === 'email') return ['none', 'trim', 'lowercase'];
  if (type === 'phone') return ['none', 'trim'];
  return ['none'];
}

export const TRANSFORM_LABELS: Readonly<Record<MappingTransform, string>> = {
  none: 'Keep as typed',
  trim: 'Trim spaces',
  lowercase: 'Lowercase',
  uppercase: 'Uppercase',
  digitsOnly: 'Digits only',
};

/** "Required for: Create client (Individual)", una entrada por operación. */
export function requirementLabels(target: CatalogTarget): string[] {
  const byOperation = new Map<string, string[]>();
  for (const requirement of target.requiredFor) {
    const kinds = byOperation.get(requirement.operation) ?? [];
    if (requirement.kind) kinds.push(requirement.kind);
    byOperation.set(requirement.operation, kinds);
  }
  return [...byOperation].map(([operation, kinds]) =>
    kinds.length > 0 ? `${operationLabel(operation)} (${kinds.join(', ')})` : operationLabel(operation),
  );
}

export function limitLabels(target: CatalogTarget): string[] {
  const labels: string[] = [];
  if (target.maxLength != null) labels.push(`Max ${target.maxLength} characters`);
  if (target.pastOnly) labels.push('Past dates only');
  if (target.dataType === 'phone') labels.push('International format (+1…)');
  if (target.sensitivity === 'personal') labels.push('Personal data');
  if (target.sensitivity === 'restricted') labels.push('Restricted data');
  if (target.status === 'deprecated') labels.push('Deprecated');
  return labels;
}

/** Avisos que el backend convertiría en issues al publicar (P-16.3), mostrados antes. */
/** Aviso del editor de mapeo, con un arreglo de un clic cuando lo hay. */
export interface MappingWarning {
  message: string;
  fixLabel?: string;
  fix?: Partial<FormComponent>;
}

/**
 * Avisos que el backend convertiría en issues al publicar (P-16.3), mostrados antes. El de
 * "campo requerido" no va aquí: depende de las acciones y del Kind (ver `mapping-coverage`).
 */
export function mappingWarnings(component: FormComponent, target: CatalogTarget): MappingWarning[] {
  const warnings: MappingWarning[] = [];
  const componentMax = componentMaxLength(component);
  if (target.maxLength != null && componentMax != null && componentMax > target.maxLength)
    warnings.push({
      message: `This field allows ${componentMax} characters, but the client record accepts ${target.maxLength}.`,
      fixLabel: `Limit to ${target.maxLength}`,
      fix: { props: { ...(component.props ?? {}), maxLength: target.maxLength } },
    });
  if (target.pastOnly && component.type === 'date' && stringProp(component.props, 'max') !== 'today')
    warnings.push({
      message: 'This property only accepts past dates.',
      fixLabel: 'Use today as the latest date',
      fix: { props: { ...(component.props ?? {}), max: 'today' } },
    });
  if (target.status === 'deprecated')
    warnings.push({ message: 'This property is deprecated and cannot be published in new versions.' });
  return warnings;
}

function componentMaxLength(component: FormComponent): number | null {
  if (component.type === 'text') return intProp(component.props, 'maxLength', 200);
  if (component.type === 'textarea') return intProp(component.props, 'maxLength', 2_000);
  return null;
}

export function componentOptions(component: FormComponent): ComponentOption[] {
  const options = component.props?.['options'];
  if (!Array.isArray(options)) return [];
  return options
    .filter(isRecord)
    .filter((option) => typeof option['value'] === 'string')
    .map((option) => ({
      value: option['value'] as string,
      label: typeof option['label'] === 'string' && option['label'] ? option['label'] : (option['value'] as string),
    }));
}

// El catálogo trae códigos (Es, En…) sin etiquetas: nombres con los que el preparador suele escribir la
// opción, en inglés y en español, para que "Spanish" o "Español" encuentren `Es`.
const ENUM_ALIASES: Readonly<Record<string, readonly string[]>> = {
  es: ['spanish', 'espanol'],
  en: ['english', 'ingles'],
  pt: ['portuguese', 'portugues'],
  fr: ['french', 'frances', 'francais'],
};

// Minúsculas y sin acentos: "Español" y "espanol" valen lo mismo.
function normalizeLabel(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

function matchesEnum(enumValue: string, option: ComponentOption): boolean {
  const value = normalizeLabel(enumValue);
  const candidates = [normalizeLabel(option.value), normalizeLabel(option.label)];
  if (candidates.includes(value)) return true;
  return (ENUM_ALIASES[value] ?? []).some((alias) => candidates.includes(alias));
}

/** Conserva lo válido y propone coincidencias por valor, etiqueta o nombre conocido del código (Spanish → Es). */
export function suggestOptionMap(
  options: readonly ComponentOption[],
  enumValues: readonly string[],
  current: Record<string, string> | null | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const option of options) {
    const kept = current?.[option.value];
    if (kept != null && enumValues.includes(kept)) {
      result[option.value] = kept;
      continue;
    }
    const match = enumValues.find((value) => matchesEnum(value, option));
    if (match) result[option.value] = match;
  }
  return result;
}

/** Misma regla que `ValidateOptionMap`: todas las opciones, ninguna de más, valores válidos. */
export function isOptionMapComplete(
  options: readonly ComponentOption[],
  map: Record<string, string> | null | undefined,
  enumValues: readonly string[],
): boolean {
  if (map == null) return false;
  const values = new Set(options.map((option) => option.value));
  return (
    options.every((option) => Object.prototype.hasOwnProperty.call(map, option.value)) &&
    Object.keys(map).every((key) => values.has(key)) &&
    Object.values(map).every((value) => enumValues.includes(value))
  );
}

/** Mapeo inicial al elegir una propiedad: trim para texto libre y optionMap sugerido para enums. */
export function createMapping(component: FormComponent, target: CatalogTarget): FormMapping {
  const transform: MappingTransform = allowedTransforms(target.dataType).includes('trim') ? 'trim' : 'none';
  const mapping: FormMapping = { componentId: component.id, targetKey: target.targetKey, transform };
  if (target.dataType === 'enum')
    mapping.optionMap = suggestOptionMap(componentOptions(component), target.enumValues ?? [], null);
  return mapping;
}

export function componentLabel(component: FormComponent): string {
  return component.label?.trim() || component.key || component.type;
}

/** Destinos de colección (repeaters, p. ej. dependientes). Uno obsoleto solo si ya está elegido. */
export function collectionTargets(
  catalog: MappingCatalog,
  currentTargetKey: string | null = null,
): CatalogTarget[] {
  return catalog.targets.filter(
    (target) =>
      target.dataType === 'collection' &&
      target.status !== 'retired' &&
      (target.status === 'active' || target.targetKey === currentTargetKey),
  );
}

/** Componentes del repeater que pueden alimentar un campo de fila (`ValidateRowSource`). */
export function rowFieldCandidates(
  definition: FormDefinition,
  section: FormSection,
  target: CatalogTarget,
  fieldName: string,
): FormComponent[] {
  const field = target.fields.find((item) => item.name === fieldName);
  if (!field) return [];
  return section.components.filter((component) => {
    const context = findComponentContext(definition, component.id);
    return (
      context != null &&
      field.compatibleComponentTypes.includes(component.type) &&
      context.isRestricted === (target.sensitivity === 'restricted')
    );
  });
}

/** Propone `rowFields` por etiqueta ("First name" → first_name), conservando lo válido. */
export function suggestRowFields(
  definition: FormDefinition,
  section: FormSection,
  target: CatalogTarget,
  current: Record<string, string> | null | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  const used = new Set<string>();
  for (const [componentId, fieldName] of Object.entries(current ?? {})) {
    const valid = rowFieldCandidates(definition, section, target, fieldName).some(
      (component) => component.id === componentId,
    );
    if (valid && !used.has(fieldName)) {
      result[componentId] = fieldName;
      used.add(fieldName);
    }
  }
  for (const field of target.fields) {
    if (used.has(field.name)) continue;
    const match = rowFieldCandidates(definition, section, target, field.name).find(
      (component) => !(component.id in result) && normalizeName(componentLabel(component)) === field.name,
    );
    if (match) {
      result[match.id] = field.name;
      used.add(field.name);
    }
  }
  return result;
}

export function missingRowFields(target: CatalogTarget, rowFields: Record<string, string> | null | undefined): string[] {
  const used = new Set(Object.values(rowFields ?? {}));
  return target.fields.filter((field) => field.required === true && !used.has(field.name)).map((field) => field.name);
}

/** Avisos de longitud por campo de fila, como `ValidateLimits` en filas. */
export function rowFieldWarnings(
  section: FormSection,
  target: CatalogTarget,
  rowFields: Record<string, string> | null | undefined,
): string[] {
  const warnings: string[] = [];
  for (const [componentId, fieldName] of Object.entries(rowFields ?? {})) {
    const component = section.components.find((item) => item.id === componentId);
    const field = target.fields.find((item) => item.name === fieldName);
    const max = component ? componentMaxLength(component) : null;
    if (component && field?.maxLength != null && max != null && max > field.maxLength)
      warnings.push(
        `"${componentLabel(component)}" allows ${max} characters, but ${humanizeFieldName(fieldName)} accepts ${field.maxLength}.`,
      );
  }
  return warnings;
}

export function humanizeFieldName(name: string): string {
  const words = name.replace(/_/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : name;
}

function normalizeName(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
