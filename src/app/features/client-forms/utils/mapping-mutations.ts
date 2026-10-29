import type {
  FormAction,
  FormDefinition,
  FormMapping,
} from '@shared/utils/data-collection/form-definition.model';

/**
 * Mutaciones puras para usar con `store.change(...)`: el mapeo y las acciones viajan en la misma
 * definición y por el mismo flujo de guardado que el resto del builder.
 */
export function mappingFor(definition: FormDefinition, componentId: string): FormMapping | null {
  return (definition.mappings ?? []).find((mapping) => mapping.componentId === componentId) ?? null;
}

/** Reemplaza (o quita, con null) el mapeo del componente conservando la posición. */
export function setComponentMapping(
  definition: FormDefinition,
  componentId: string,
  mapping: FormMapping | null,
): FormDefinition {
  const current = definition.mappings ?? [];
  const index = current.findIndex((item) => item.componentId === componentId);
  if (mapping == null) {
    if (index < 0) return definition;
    return { ...definition, mappings: current.filter((_, position) => position !== index) };
  }
  const next = { ...mapping, componentId };
  const mappings =
    index < 0 ? [...current, next] : current.map((item, position) => (position === index ? next : item));
  return { ...definition, mappings };
}

export function setActions(definition: FormDefinition, actions: FormAction[]): FormDefinition {
  return { ...definition, actions };
}

/** Qué quitar: el mapeo entero de un campo o sección, o solo una fila de `rowFields`. */
export interface MappingRemoval {
  mappingComponentId: string;
  rowComponentId: string | null;
}

export function removeMapping(definition: FormDefinition, removal: MappingRemoval): FormDefinition {
  if (removal.rowComponentId == null) return setComponentMapping(definition, removal.mappingComponentId, null);
  const mapping = mappingFor(definition, removal.mappingComponentId);
  if (!mapping?.rowFields || !(removal.rowComponentId in mapping.rowFields)) return definition;
  const rowFields = { ...mapping.rowFields };
  delete rowFields[removal.rowComponentId];
  return setComponentMapping(definition, removal.mappingComponentId, { ...mapping, rowFields });
}

/** Mapeos que usan el componente: el suyo propio y las filas de repeaters que alimenta. */
export function mappingReferences(
  definition: FormDefinition,
  componentId: string,
): { own: boolean; rowsOf: string[] } {
  const mappings = definition.mappings ?? [];
  return {
    own: mappings.some((mapping) => mapping.componentId === componentId),
    rowsOf: mappings
      .filter((mapping) => mapping.rowFields != null && componentId in mapping.rowFields)
      .map((mapping) => mapping.componentId),
  };
}

/** Al borrar un campo: se va su mapeo y las filas que alimentaba. */
export function withoutComponentMappings(definition: FormDefinition, componentId: string): FormDefinition {
  let next = setComponentMapping(definition, componentId, null);
  for (const owner of mappingReferences(next, componentId).rowsOf)
    next = removeMapping(next, { mappingComponentId: owner, rowComponentId: componentId });
  return next;
}

/** Al mover un campo fuera de su repeater: deja de alimentar las filas de ese repeater. */
export function withoutStaleRowFields(definition: FormDefinition, componentId: string): FormDefinition {
  const sectionOf = definition.pages
    .flatMap((page) => page.sections)
    .find((section) => section.components.some((component) => component.id === componentId))?.id;
  let next = definition;
  for (const owner of mappingReferences(definition, componentId).rowsOf)
    if (owner !== sectionOf) next = removeMapping(next, { mappingComponentId: owner, rowComponentId: componentId });
  return next;
}
