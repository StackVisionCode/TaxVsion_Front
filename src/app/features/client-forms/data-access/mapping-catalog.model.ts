import type {
  MappingCatalogSnapshot,
  MappingTarget,
  MappingTargetField,
} from '@shared/utils/data-collection/mapping.model';

/**
 * Respuesta de `GET tasks/forms/mapping-catalog` (FormMappingCatalogResponse). Los enums llegan en
 * PascalCase (`JsonStringEnumConverter` sin política) y el catálogo ya viene filtrado por permisos.
 */
export interface FormMappingCatalogResponse {
  catalogVersion: number;
  targets: FormMappingTargetResponse[];
  operations: FormMappingOperationResponse[];
}

export interface FormMappingTargetResponse {
  targetKey: string;
  domain: string;
  entity: string;
  displayName: string;
  dataType: string;
  sensitivity: string;
  status: string;
  operations: string[];
  requiredFor: { operation: string; kind: string | null }[];
  maxLength: number | null;
  enumValues: string[];
  pastOnly: boolean;
  fields: FormMappingTargetFieldResponse[];
  compatibleComponentTypes: string[];
}

export interface FormMappingTargetFieldResponse {
  name: string;
  dataType: string;
  maxLength: number | null;
  required: boolean;
  compatibleComponentTypes: string[];
}

export interface FormMappingOperationResponse {
  name: string;
  discriminatorTargetKey: string | null;
  configTargets: Record<string, string>;
}

/** Campo de fila con los tipos de componente que el backend declara compatibles. */
export interface CatalogTargetField extends MappingTargetField {
  compatibleComponentTypes: string[];
}

/** Destino del engine más la compatibilidad que publica el backend (única fuente). */
export interface CatalogTarget extends MappingTarget {
  compatibleComponentTypes: string[];
  fields: CatalogTargetField[];
}

/** Catálogo en el formato del engine TS, apto para `validateMappings`. */
export interface MappingCatalog extends MappingCatalogSnapshot {
  targets: CatalogTarget[];
}
